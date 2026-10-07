import fs from 'node:fs';
import path from 'node:path';
import { dataDir, one, query, run, transaction, now, setting, setSetting } from './db';
import { AppError, requireValue } from './errors';
import { businessDate, daysBefore, scheduledAt } from './schedule';
import type { Snapshot } from './types';

export function snapshotAssetIds(snapshot: Snapshot) {
  return [
    snapshot.backgroundId,
    snapshot.logoId,
    snapshot.project?.logoId,
    ...Object.values(snapshot.fontAssets || {}),
  ].filter((value): value is string => !!value);
}
export function registerProjectAssets(projectId: string, assetIds: (string | null)[]) {
  requireValue(one('SELECT id FROM projects WHERE id=?', projectId), 'Project no longer exists.');
  for (const assetId of new Set(assetIds.filter((value): value is string => !!value)))
    run(
      'INSERT INTO project_assets VALUES(?,?,?) ON CONFLICT(projectId,assetId) DO UPDATE SET touchedAt=excluded.touchedAt',
      projectId,
      assetId,
      now(),
    );
}
function queueAssets(assetIds: string[], immediate = false) {
  for (const assetId of new Set(assetIds)) {
    run(
      'INSERT OR IGNORE INTO asset_cleanup_candidates SELECT id,?,NULL FROM assets WHERE id=?',
      now(),
      assetId,
    );
    if (immediate)
      run('UPDATE asset_cleanup_candidates SET graceUntil=NULL WHERE assetId=?', assetId);
  }
}
// This scope exists only inside the deletion transaction; ordinary version deletion stays blocked.
function removeStories(storyIds: string[]) {
  const assets: string[] = [];
  for (const storyId of storyIds) {
    for (const version of query<{ data: string }>(
      'SELECT data FROM story_versions WHERE storyId=?',
      storyId,
    ))
      assets.push(...snapshotAssetIds(JSON.parse(version.data)));
    run('INSERT INTO story_purges VALUES(?)', storyId);
  }
  for (const table of ['feedback', 'approvals', 'exports', 'operations'])
    run(`DELETE FROM ${table} WHERE storyId IN (SELECT storyId FROM story_purges)`);
  run('UPDATE jobs SET storyId=NULL WHERE storyId IN (SELECT storyId FROM story_purges)');
  run('UPDATE stories SET latestVersionId=NULL WHERE id IN (SELECT storyId FROM story_purges)');
  run('DELETE FROM story_versions WHERE storyId IN (SELECT storyId FROM story_purges)');
  run('DELETE FROM stories WHERE id IN (SELECT storyId FROM story_purges)');
  run('DELETE FROM story_purges');
  queueAssets(assets);
}
function removeRuns(runIds: string[]) {
  for (const runId of runIds) {
    run('DELETE FROM jobs WHERE runId=?', runId);
    run('DELETE FROM run_scripts WHERE runId=?', runId);
    run('DELETE FROM runs WHERE id=?', runId);
  }
}
export function drainAssetDeletions() {
  for (const { filename } of query<{ filename: string }>(
    'SELECT filename FROM asset_file_deletions',
  )) {
    try {
      if (filename !== path.basename(filename)) throw new Error('Invalid asset filename');
      fs.unlinkSync(path.join(dataDir, 'assets', filename));
      run('DELETE FROM asset_file_deletions WHERE filename=?', filename);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        run('DELETE FROM asset_file_deletions WHERE filename=?', filename);
      // Other disk errors remain queued for the next worker tick.
    }
  }
  return query('SELECT filename FROM asset_file_deletions').length;
}
export function sweepUnusedAssets(at = new Date()) {
  transaction(() => {
    const referenced = new Set<string>();
    for (const project of query<{ data: string }>('SELECT data FROM projects')) {
      const logoId = JSON.parse(project.data).logoId;
      if (logoId) referenced.add(logoId);
    }
    for (const version of query<{ data: string }>('SELECT data FROM story_versions'))
      snapshotAssetIds(JSON.parse(version.data)).forEach((value) => referenced.add(value));
    // A newly generated snapshot may be between provider completion and its final save.
    for (const asset of query<{ assetId: string }>(
      'SELECT assetId FROM project_assets WHERE touchedAt>?',
      new Date(at.getTime() - 300000).toISOString(),
    ))
      referenced.add(asset.assetId);
    for (const asset of query<{ id: string; filename: string }>(
      'SELECT a.id,a.filename FROM assets a JOIN asset_cleanup_candidates c ON c.assetId=a.id WHERE c.graceUntil IS NULL OR c.graceUntil<=?',
      at.toISOString(),
    )) {
      if (referenced.has(asset.id)) continue;
      run('INSERT OR IGNORE INTO asset_file_deletions VALUES(?,?)', asset.filename, now());
      run("DELETE FROM settings WHERE key LIKE 'font:%' AND value=?", asset.id);
      run('DELETE FROM assets WHERE id=?', asset.id);
    }
  });
  return drainAssetDeletions();
}
export function deleteProject(projectId: string, confirmation: string) {
  const deleted = transaction(() => {
    const project = requireValue(
      one<{ name: string }>('SELECT name FROM projects WHERE id=?', projectId),
      'Project not found',
    );
    if (confirmation !== project.name)
      throw new AppError('Type the project name exactly to confirm deletion.');
    const assetIds = query<{ assetId: string }>(
      'SELECT assetId FROM project_assets WHERE projectId=?',
      projectId,
    ).map((a) => a.assetId);
    const stories = query<{ id: string }>(
      'SELECT id FROM stories WHERE projectId=?',
      projectId,
    ).map((s) => s.id);
    removeStories(stories);
    removeRuns(
      query<{ id: string }>('SELECT id FROM runs WHERE projectId=?', projectId).map((r) => r.id),
    );
    run('DELETE FROM research WHERE projectId=?', projectId);
    run('DELETE FROM projects WHERE id=?', projectId);
    queueAssets(assetIds, true);
    return { name: project.name, storiesDeleted: stories.length };
  });
  const pendingFileDeletes = sweepUnusedAssets();
  return { deleted: true, ...deleted, pendingFileDeletes };
}
export function dailyStoriesReady(at = new Date()) {
  const today = businessDate(at);
  if (at < scheduledAt(today)) return false;
  const active = query<{ id: string; data: string }>(
    "SELECT id,data FROM projects WHERE status='active'",
  );
  // Cleanup waits until every active project has reached its own generation time.
  if (active.some((p) => at < scheduledAt(today, JSON.parse(p.data).generateAt))) return false;
  return active.every((project) => {
    const result = one<{ total: number; complete: number; stories: number }>(
      "SELECT count(j.id) AS total,sum(CASE WHEN j.status='complete' THEN 1 ELSE 0 END) AS complete,count(s.id) AS stories FROM runs r JOIN jobs j ON j.runId=r.id LEFT JOIN stories s ON s.id=j.storyId WHERE r.projectId=? AND r.businessDate=? AND r.kind='scheduled'",
      project.id,
      today,
    );
    return result?.total === 4 && result.complete === 4 && result.stories === 4;
  });
}
export function pruneStoryHistory(at = new Date()) {
  const today = businessDate(at),
    cutoff = daysBefore(today, 2);
  const result = transaction(() => {
    if (!dailyStoriesReady(at)) return { ready: false, storiesDeleted: 0 };
    const expired = query<{ id: string }>(
      'SELECT id FROM stories WHERE businessDate<?',
      cutoff,
    ).map((s) => s.id);
    removeStories(expired);
    removeRuns(
      query<{ id: string }>(
        'SELECT r.id FROM runs r WHERE r.businessDate<? AND NOT EXISTS(SELECT 1 FROM stories s WHERE s.runId=r.id)',
        cutoff,
      ).map((r) => r.id),
    );
    for (const research of query<{ id: string; fetchedAt: string }>(
      'SELECT id,fetchedAt FROM research',
    ))
      if (businessDate(new Date(research.fetchedAt)) < cutoff)
        run('DELETE FROM research WHERE id=?', research.id);
    setSetting('lastHistoryCleanup', today);
    return { ready: true, storiesDeleted: expired.length };
  });
  const pendingFileDeletes = sweepUnusedAssets(at);
  return { ...result, cutoff, pendingFileDeletes };
}
export const retentionStatus = (at = new Date()) => ({
  lastCleanup: setting('lastHistoryCleanup', '') || null,
  awaitingDailyBatch: !dailyStoriesReady(at),
});
