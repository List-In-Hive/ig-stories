import { z } from 'zod';
import { createHash } from 'node:crypto';
import { db, id, now, one, query, run, transaction, setting, setSetting } from './db';
import { AppError, requireValue } from './errors';
import { assertEngagementAllowed, hasEngagement } from './engagement';
import {
  registerProjectAssets,
  snapshotAssetIds,
  pruneStoryHistory,
  retentionStatus,
} from './lifecycle';
import {
  businessDate,
  nextRun,
  daysBefore,
  scheduledAt,
  timeZone,
  DEFAULT_GENERATE_AT,
} from './schedule';
import { demoImage, demoScript, demoResearch } from './providers';
import {
  type PlanContext,
  claudeScripts,
  openAIImages,
  missingLiveKeys,
  CLAUDE_MODEL,
  OPENAI_IMAGE_MODEL,
} from './ai';
import { localStorage, readFamily } from './storage';
import { defaultLayout, validateComposition, snapshotFonts } from './composition';
import type {
  AppState,
  Job,
  Project,
  Repository,
  Run,
  Script,
  Snapshot,
  Story,
  User,
  Version,
  ResearchRecord,
} from './types';
const text = z.string().max(5000).default('');
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a six-digit hex color.');
const FONTS = ['Inter', 'Lora', 'Montserrat', 'Brand'] as const;
export const projectSchema = z.object({
  name: z.string().trim().min(2).max(80),
  industry: z.string().trim().min(2).max(80),
  status: z.enum(['active', 'paused', 'archived']).default('active'),
  description: z.string().trim().min(10).max(3000),
  services: text,
  audience: text,
  instagram: z
    .string()
    .refine(
      (v) => !v || /^https:\/\/(www\.)?instagram\.com\/[a-zA-Z0-9._]+\/?$/.test(v),
      'Use a public Instagram profile URL, such as https://www.instagram.com/example/',
    )
    .default(''),
  visualDirection: text,
  colors: z.array(color).length(3),
  font: z.enum(FONTS).default('Inter'),
  brandFont: z
    .object({
      name: z.string().trim().min(1).max(60),
      regular: z.object({ id: z.string(), family: z.string().min(1).max(120) }),
      bold: z.object({ id: z.string(), family: z.string().min(1).max(120) }).nullable(),
    })
    .nullable()
    .default(null),
  rules: text,
  prohibited: text,
  facts: text,
  allowEngagement: z.boolean().default(false),
  webResearch: z.boolean().default(true),
  generateAt: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a 24-hour time such as 08:00.')
    .default(DEFAULT_GENERATE_AT),
  logoId: z.string().nullable().default(null),
  website: z
    .string()
    .refine((v) => !v || /^https?:\/\//.test(v), 'Use a full website URL.')
    .default(''),
  email: z.union([z.literal(''), z.email()]).default(''),
  phone: text,
  address: text,
  location: text,
});
const layerSchema = z.object({
  text: z.string().max(5000),
  x: z.number().min(0).max(1080),
  y: z.number().min(0).max(1920),
  width: z.number().min(100).max(1080),
  size: z.number().min(12).max(180),
  color,
  font: z.enum(FONTS),
  align: z.enum(['left', 'center', 'right']),
  visible: z.boolean(),
});
export const layoutSchema = z.object({
  headline: layerSchema,
  body: layerSchema,
  cta: layerSchema,
  contact: layerSchema,
  logo: z.object({
    x: z.number().min(0).max(1080),
    y: z.number().min(0).max(1920),
    width: z.number().min(20).max(900),
    visible: z.boolean(),
  }),
});
export const scriptSchema = z.object({
  kind: z.enum(['standard', 'poll', 'question', 'dm']).optional(),
  topic: z.string().min(1).max(180),
  headline: z.string().min(1).max(500),
  body: z.string().max(5000),
  cta: z.string().max(500),
  visual: z.string().max(3000),
  sources: z.array(z.string()).default([]),
});
type ProjectRow = {
  id: string;
  name: string;
  industry: string;
  status: Project['status'];
  data: string;
  createdAt: string;
  updatedAt: string;
};
export function listProjects() {
  return query<ProjectRow>('SELECT * FROM projects ORDER BY createdAt').map((r) => ({
    allowEngagement: false,
    webResearch: true,
    generateAt: DEFAULT_GENERATE_AT,
    ...JSON.parse(r.data),
    id: r.id,
    name: r.name,
    industry: r.industry,
    status: r.status,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  })) as Project[];
}
export function getProject(projectId: string) {
  return requireValue(
    listProjects().find((p) => p.id === projectId),
    'Project not found',
  );
}
export function saveProject(input: unknown, projectId?: string) {
  const parsed = projectSchema.parse(input);
  return transaction(() => {
    const previous = projectId ? getProject(projectId) : null;
    if (
      parsed.status === 'active' &&
      query("SELECT id FROM projects WHERE status='active' AND id!=?", projectId || '').length >= 10
    )
      throw new AppError('You can have up to 10 active projects. Pause or archive one first.');
    if (parsed.logoId) {
      const asset = one<{ kind: string }>('SELECT kind FROM assets WHERE id=?', parsed.logoId);
      if (!asset || asset.kind !== 'logo') throw new AppError('Choose a valid uploaded logo.');
    }
    for (const file of [parsed.brandFont?.regular, parsed.brandFont?.bold]) {
      if (!file) continue;
      const asset = one<{ kind: string }>('SELECT kind FROM assets WHERE id=?', file.id);
      if (!asset || asset.kind !== 'brand-font') throw new AppError('Upload the brand font again.');
      // The renderer matches the name inside the file, so it is read here rather than trusted.
      file.family = readFamily(localStorage.read(file.id).bytes);
    }
    if (parsed.font === 'Brand' && !parsed.brandFont)
      throw new AppError('Upload a brand font or choose another default font.');
    const projectKey = projectId || id();
    if (projectId)
      run(
        'UPDATE projects SET name=?,industry=?,status=?,data=?,updatedAt=? WHERE id=?',
        parsed.name,
        parsed.industry,
        parsed.status,
        JSON.stringify(parsed),
        now(),
        projectKey,
      );
    else
      run(
        'INSERT INTO projects VALUES(?,?,?,?,?,?,?)',
        projectKey,
        parsed.name,
        parsed.industry,
        parsed.status,
        JSON.stringify(parsed),
        now(),
        now(),
      );
    registerProjectAssets(projectKey, [
      parsed.logoId,
      parsed.brandFont?.regular.id ?? null,
      parsed.brandFont?.bold?.id ?? null,
    ]);
    if (previous && previous.allowEngagement !== parsed.allowEngagement)
      run(
        "DELETE FROM run_scripts WHERE runId IN (SELECT id FROM runs WHERE projectId=? AND status IN ('queued','running','failed'))",
        projectKey,
      );
    return getProject(projectKey);
  });
}
export function getVersion(versionId: string) {
  const row = requireValue(
    one<Omit<Version, 'data'> & { data: string }>(
      'SELECT v.*,u.name AS reviewer,a.createdAt AS approvedAt FROM story_versions v LEFT JOIN approvals a ON a.versionId=v.id LEFT JOIN users u ON u.id=a.reviewerId WHERE v.id=?',
      versionId,
    ),
    'Version not found',
  );
  return { ...row, data: JSON.parse(row.data) } as Version;
}
export function getStory(storyId: string) {
  const story = requireValue(
    one<Omit<Story, 'version' | 'approvedVersionId' | 'exportCount'>>(
      'SELECT * FROM stories WHERE id=?',
      storyId,
    ),
    'Story not found',
  );
  return {
    ...story,
    version: getVersion(story.latestVersionId),
    approvedVersionId:
      one<{ versionId: string }>(
        'SELECT versionId FROM approvals WHERE versionId=?',
        story.latestVersionId,
      )?.versionId ?? null,
    exportCount: one<{ count: number }>(
      'SELECT count(*) AS count FROM exports WHERE storyId=?',
      storyId,
    )!.count,
  };
}
export function listStories() {
  return query<{ id: string }>('SELECT id FROM stories ORDER BY createdAt DESC,rowid DESC').map(
    (s) => getStory(s.id),
  );
}
export const localRepository: Repository = { getProject, listProjects, getVersion, listStories };
export function versions(storyId: string) {
  getStory(storyId);
  return query<{ id: string }>(
    'SELECT id FROM story_versions WHERE storyId=? ORDER BY revision DESC',
    storyId,
  ).map((r) => getVersion(r.id));
}
export function checkVersion(storyId: string, expected: string) {
  const story = getStory(storyId);
  if (story.latestVersionId !== expected)
    throw new AppError(
      'A newer version was saved in another window. Reload to compare your changes before saving.',
      409,
      { latestVersionId: story.latestVersionId },
    );
  return story;
}
export function appendVersion(
  storyId: string,
  snapshot: Snapshot,
  userId: string | null,
  expected?: string,
) {
  return transaction(() => {
    const row = requireValue(
      one<{ latestVersionId: string | null }>(
        'SELECT latestVersionId FROM stories WHERE id=?',
        storyId,
      ),
    );
    if (expected && row.latestVersionId !== expected)
      throw new AppError(
        'A newer version was saved in another window. Reload to compare your changes.',
        409,
        { latestVersionId: row.latestVersionId },
      );
    const project = getProject(getStory(storyId).projectId);
    assertEngagementAllowed(project, snapshot.script);
    registerProjectAssets(project.id, snapshotAssetIds(snapshot));
    const revision =
      (one<{ revision: number }>(
        'SELECT max(revision) AS revision FROM story_versions WHERE storyId=?',
        storyId,
      )?.revision || 0) + 1;
    const versionId = id();
    run(
      'INSERT INTO story_versions VALUES(?,?,?,?,?,?)',
      versionId,
      storyId,
      revision,
      JSON.stringify(snapshot),
      userId,
      now(),
    );
    run('UPDATE stories SET latestVersionId=? WHERE id=?', versionId, storyId);
    return getVersion(versionId);
  });
}
export const liveMode = () =>
  setting('providerMode', process.env.PROVIDER_MODE || 'demo') !== 'demo';
const imageProvider = () => (liveMode() ? openAIImages : demoImage);
// Reviewer taste survives the three-day history window: the latest approvals and written
// feedback per project are kept in settings and shown to Claude when planning.
const TASTE_LIMIT = 12;
function remember(projectId: string, kind: 'approved' | 'feedback', entry: string) {
  const key = `taste:${kind}:${projectId}`;
  const items = JSON.parse(setting(key, '[]')) as string[];
  setSetting(
    key,
    JSON.stringify([entry, ...items.filter((i) => i !== entry)].slice(0, TASTE_LIMIT)),
  );
}
function planContext(project: Project, at = new Date()): PlanContext {
  const today = businessDate(at);
  return {
    today: new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone(),
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(at),
    approved: JSON.parse(setting(`taste:approved:${project.id}`, '[]')),
    skipped: listStories()
      .filter((s) => s.projectId === project.id && s.businessDate < today && !s.approvedVersionId)
      .slice(0, 8)
      .map((s) => `${s.version.data.script.topic}: ${s.version.data.script.headline}`),
    feedback: JSON.parse(setting(`taste:feedback:${project.id}`, '[]')),
  };
}
async function generateScript(project: Project, slot: number, seed: number, recent: string[]) {
  if (liveMode()) return (await claudeScripts.plan(project, 1, recent, planContext(project)))[0];
  return demoScript.generate(project, slot, seed, recent);
}
function providerDetails() {
  return liveMode()
    ? {
        provider: 'live' as const,
        label: `AI draft · ${CLAUDE_MODEL} + ${OPENAI_IMAGE_MODEL}`,
      }
    : { provider: 'demo' as const, label: 'Demo content · Sample artwork' };
}
export async function makeSnapshot(project: Project, slot: number, seed: number, manual?: Script) {
  const recent = listStories()
    .filter((s) => s.projectId === project.id)
    .slice(0, 12)
    .map((s) => s.version.data.script.topic);
  const script = manual || (await generateScript(project, slot, seed, recent));
  assertEngagementAllowed(project, script);
  const image = await imageProvider().generate(project, script, seed);
  return transaction(() => {
    const latestProject = getProject(project.id);
    if (latestProject.updatedAt !== project.updatedAt)
      throw new AppError(
        'The project changed during generation. Please retry with the updated brief.',
      );
    assertEngagementAllowed(latestProject, script);
    const backgroundId = localStorage.put(image.bytes, image.mime, 'background', 1080, 1920);
    setSetting('demoImageOperations', String(Number(setting('demoImageOperations', '0')) + 1));
    const snapshot = {
      script,
      layout: defaultLayout(project, script),
      backgroundId,
      logoId: project.logoId,
      project: structuredClone(project),
      ...providerDetails(),
      seed,
      prompt: script.visual,
      fontAssets: snapshotFonts(project),
    } satisfies Snapshot;
    registerProjectAssets(project.id, snapshotAssetIds(snapshot));
    return snapshot;
  });
}
function storeProjectBackground(projectId: string, image: { bytes: Buffer; mime: string }) {
  return transaction(() => {
    getProject(projectId);
    const assetId = localStorage.put(image.bytes, image.mime, 'background', 1080, 1920);
    registerProjectAssets(projectId, [assetId]);
    return assetId;
  });
}
export const seedFrom = (value: string) =>
  createHash('sha256').update(value).digest().readUInt32BE(0) % 100000;
export function enqueueRun(
  projectId: string,
  kind: 'scheduled' | 'manual',
  at = new Date(),
  requestKey?: string,
) {
  const project = getProject(projectId);
  if (project.status === 'archived' || (kind === 'scheduled' && project.status !== 'active'))
    throw new AppError('This project is not eligible for this run.');
  return transaction(() => {
    const date = businessDate(at);
    const existing =
      kind === 'scheduled'
        ? one<{ id: string }>(
            "SELECT id FROM runs WHERE projectId=? AND businessDate=? AND kind='scheduled'",
            projectId,
            date,
          )
        : requestKey
          ? one<{ id: string }>('SELECT id FROM runs WHERE requestKey=?', requestKey)
          : undefined;
    if (existing) return existing.id;
    const runId = id();
    run(
      'INSERT INTO runs VALUES(?,?,?,?,?,?,?)',
      runId,
      projectId,
      date,
      kind,
      requestKey || null,
      'queued',
      at.toISOString(),
    );
    for (let slot = 1; slot <= 4; slot++)
      run(
        'INSERT INTO jobs(id,runId,slot,status,availableAt) VALUES(?,?,?,?,?)',
        id(),
        runId,
        slot,
        'queued',
        at.toISOString(),
      );
    return runId;
  });
}
// `dueOnly` limits the batch to projects whose daily generation time has passed.
export function dailyBatch(at = new Date(), dueOnly = false) {
  const today = businessDate(at);
  return listProjects()
    .filter((p) => p.status === 'active')
    .filter((p) => !dueOnly || at >= scheduledAt(today, p.generateAt))
    .map((p) => enqueueRun(p.id, 'scheduled', at));
}
export function claimJob(at = new Date()) {
  return transaction(() => {
    const job = one<Job>(
      "SELECT * FROM jobs WHERE status='queued' AND availableAt<=? ORDER BY availableAt,slot LIMIT 1",
      at.toISOString(),
    );
    if (!job) return null;
    run(
      "UPDATE jobs SET status='running',attempts=attempts+1,claimedAt=?,error=NULL WHERE id=?",
      at.toISOString(),
      job.id,
    );
    run("UPDATE runs SET status='running' WHERE id=?", job.runId);
    return { ...job, attempts: job.attempts + 1, status: 'running' };
  });
}
function updateRun(runId: string) {
  const jobs = query<Job>('SELECT * FROM jobs WHERE runId=?', runId);
  const status = jobs.every((j) => j.status === 'complete')
    ? 'complete'
    : jobs.some((j) => ['running', 'queued'].includes(j.status))
      ? 'running'
      : 'failed';
  run('UPDATE runs SET status=? WHERE id=?', status, runId);
}
export function recoverJobs(at = new Date()) {
  run(
    "UPDATE jobs SET status=CASE WHEN attempts>=? THEN 'failed' ELSE 'queued' END,availableAt=?,error='Worker interrupted. Slot recovered after its lease expired.' WHERE status='running' AND claimedAt<?",
    Number(process.env.WORKER_MAX_ATTEMPTS || 3),
    at.toISOString(),
    new Date(at.getTime() - 60000).toISOString(),
  );
  for (const r of query<{ id: string }>("SELECT id FROM runs WHERE status='running'"))
    updateRun(r.id);
}
export async function processJob(job: Job, at = new Date(), simulateFailure = false) {
  try {
    if (simulateFailure) throw new Error('Simulated provider failure for recovery verification.');
    const generationRun = requireValue(
      one<{ projectId: string; businessDate: string }>('SELECT * FROM runs WHERE id=?', job.runId),
    );
    const project = getProject(generationRun.projectId);
    const research = await demoResearch.fetch(project);
    run(
      'INSERT INTO research VALUES(?,?,?,?,?,?,?,?)',
      id(),
      project.id,
      research.sourceUrl,
      research.publishedAt,
      at.toISOString(),
      'demo / Instagram unavailable',
      research.status,
      JSON.stringify({ message: research.message }),
    );
    const script = await plannedScript(job.runId, job.slot, project);
    const snapshot = await makeSnapshot(project, job.slot, seedFrom(job.id + job.attempts), script);
    transaction(() => {
      getProject(project.id);
      requireValue(one('SELECT id FROM jobs WHERE id=?', job.id), 'Generation was cancelled.');
      assertEngagementAllowed(getProject(project.id), snapshot.script);
      const existing = one<{ id: string }>(
        'SELECT id FROM stories WHERE runId=? AND slot=?',
        job.runId,
        job.slot,
      );
      if (!existing) {
        const storyId = id();
        run(
          'INSERT INTO stories VALUES(?,?,?,?,?,?,?)',
          storyId,
          project.id,
          job.runId,
          job.slot,
          generationRun.businessDate,
          null,
          at.toISOString(),
        );
        const versionId = id();
        run(
          'INSERT INTO story_versions VALUES(?,?,?,?,?,?)',
          versionId,
          storyId,
          1,
          JSON.stringify(snapshot),
          null,
          at.toISOString(),
        );
        run('UPDATE stories SET latestVersionId=? WHERE id=?', versionId, storyId);
        run('UPDATE jobs SET storyId=? WHERE id=?', storyId, job.id);
      }
      run("UPDATE jobs SET status='complete',error=NULL WHERE id=?", job.id);
      updateRun(job.runId);
    });
  } catch (error) {
    if (!one('SELECT id FROM jobs WHERE id=?', job.id)) return;
    const retry = job.attempts < Number(process.env.WORKER_MAX_ATTEMPTS || 3);
    // Provider rate limits need a longer pause than ordinary failures.
    const delay = (error as { status?: number }).status === 429 ? 60000 : 5000;
    run(
      'UPDATE jobs SET status=?,error=?,availableAt=? WHERE id=?',
      retry ? 'queued' : 'failed',
      (error as Error).message,
      new Date(at.getTime() + job.attempts * delay).toISOString(),
      job.id,
    );
    updateRun(job.runId);
  }
}
// Returns how many jobs it processed so the worker can slow down while idle.
export async function workerTick(at = new Date()) {
  setSetting('workerHeartbeat', new Date().toISOString());
  recoverJobs(at);
  if (setting('automationEnabled', 'true') === 'true') dailyBatch(at, true);
  const pending = [];
  for (let i = 0; i < Math.max(1, Math.min(8, Number(process.env.WORKER_CONCURRENCY || 3))); i++) {
    const job = claimJob(at);
    if (job) pending.push(processJob(job, at));
  }
  await Promise.all(pending);
  pruneStoryHistory(at);
  return pending.length;
}

async function plannedScript(runId: string, slot: number, project: Project) {
  let row = one<{ data: string }>(
    'SELECT data FROM run_scripts WHERE runId=? AND slot=?',
    runId,
    slot,
  );
  if (!row) {
    const recent = listStories()
      .filter((s) => s.projectId === project.id)
      .slice(0, 10)
      .map((s) => s.version.data.script.topic);
    const planned: Script[] = [];
    if (liveMode())
      planned.push(...(await claudeScripts.plan(project, 4, recent, planContext(project))));
    else
      for (let i = 1; i <= 4; i++) {
        const script = await demoScript.generate(project, i, seedFrom(runId), [
          ...recent,
          ...planned.map((s) => s.topic),
        ]);
        planned.push(script);
      }
    transaction(() => {
      planned.forEach((script, i) =>
        run(
          'INSERT OR IGNORE INTO run_scripts VALUES(?,?,?)',
          runId,
          i + 1,
          JSON.stringify(script),
        ),
      );
    });
    row = one<{ data: string }>(
      'SELECT data FROM run_scripts WHERE runId=? AND slot=?',
      runId,
      slot,
    );
  }
  return JSON.parse(row!.data) as Script;
}

export function retryRun(runId: string) {
  requireValue(one('SELECT id FROM runs WHERE id=?', runId));
  run(
    "UPDATE jobs SET status='queued',attempts=0,error=NULL,availableAt=? WHERE runId=? AND status='failed'",
    now(),
    runId,
  );
  updateRun(runId);
}
export async function createManual(
  projectId: string,
  input: unknown,
  userId: string,
  requestKey: string,
) {
  const previous = one<{ id: string }>(
    'SELECT id FROM stories WHERE runId IN (SELECT id FROM runs WHERE requestKey=?)',
    requestKey,
  );
  if (previous) return getStory(previous.id);
  const project = getProject(projectId);
  if (project.status === 'archived')
    throw new AppError('Reactivate this project to create a story.');
  const script = scriptSchema.parse(input);
  const snapshot = await makeSnapshot(project, 0, seedFrom(requestKey), script);
  const storyId = id();
  const savedStoryId = transaction(() => {
    const currentProject = getProject(project.id);
    if (currentProject.status === 'archived')
      throw new AppError('Reactivate this project to create a story.');
    assertEngagementAllowed(currentProject, script);
    const duplicate = one<{ id: string }>(
      'SELECT id FROM stories WHERE runId IN (SELECT id FROM runs WHERE requestKey=?)',
      requestKey,
    );
    if (duplicate) return duplicate.id;
    const runId = id();
    run(
      'INSERT INTO runs VALUES(?,?,?,?,?,?,?)',
      runId,
      project.id,
      businessDate(new Date()),
      'manual',
      requestKey,
      'complete',
      now(),
    );
    run(
      'INSERT INTO stories VALUES(?,?,?,?,?,?,?)',
      storyId,
      project.id,
      runId,
      1,
      businessDate(new Date()),
      null,
      now(),
    );
    const versionId = id();
    run(
      'INSERT INTO story_versions VALUES(?,?,?,?,?,?)',
      versionId,
      storyId,
      1,
      JSON.stringify(snapshot),
      userId,
      now(),
    );
    run('UPDATE stories SET latestVersionId=? WHERE id=?', versionId, storyId);
    return storyId;
  });
  return getStory(savedStoryId);
}
export function saveStory(storyId: string, expected: string, input: unknown, userId: string) {
  const story = checkVersion(storyId, expected);
  const layout = layoutSchema.parse(input);
  const snapshot = structuredClone(story.version.data);
  snapshot.layout = layout;
  snapshot.script = {
    ...snapshot.script,
    headline: layout.headline.text,
    body: layout.body.text,
    cta: layout.cta.text,
  };
  if (
    !hasEngagement({ headline: layout.headline.text, body: layout.body.text, cta: layout.cta.text })
  )
    delete snapshot.script.kind;
  return appendVersion(storyId, snapshot, userId, expected);
}
export async function reviseStory(
  storyId: string,
  expected: string,
  kind: 'image' | 'idea',
  userId: string,
) {
  const story = checkVersion(storyId, expected);
  const operationId = id();
  run(
    'INSERT INTO operations VALUES(?,?,?,?,?,?)',
    operationId,
    storyId,
    kind,
    'running',
    null,
    now(),
  );
  try {
    const current = story.version.data;
    let seed = seedFrom(id());
    if (seed % 200 === current.seed % 200) seed++;
    let snapshot: Snapshot;
    if (kind === 'idea') {
      snapshot = await makeSnapshot(getProject(story.projectId), 0, seed);
      if (snapshot.script.topic === current.script.topic) {
        snapshot = await makeSnapshot(getProject(story.projectId), 1, seed + 1);
      }
    } else {
      const image = await imageProvider().generate(current.project, current.script, seed);
      snapshot = {
        ...structuredClone(current),
        ...providerDetails(),
        backgroundId: storeProjectBackground(story.projectId, image),
        seed,
        prompt: current.script.visual,
      };
      setSetting('demoImageOperations', String(Number(setting('demoImageOperations', '0')) + 1));
    }
    const version = appendVersion(storyId, snapshot, userId, expected);
    run("UPDATE operations SET status='complete' WHERE id=?", operationId);
    return version;
  } catch (error) {
    run(
      "UPDATE operations SET status='failed',error=? WHERE id=?",
      (error as Error).message,
      operationId,
    );
    throw error;
  }
}
export async function requestChanges(
  storyId: string,
  expected: string,
  target: 'text' | 'visual' | 'layout',
  feedback: string,
  userId: string,
) {
  if (!feedback.trim() || feedback.length > 3000)
    throw new AppError('Enter feedback of up to 3,000 characters.');
  const story = checkVersion(storyId, expected);
  let snapshot = structuredClone(story.version.data);
  let applied = false;
  const normalized = feedback.toLowerCase();
  if (liveMode() && target === 'text') {
    const script = await claudeScripts.rewrite(snapshot.project, snapshot.script, feedback);
    snapshot.script = script;
    snapshot.layout.headline.text = script.headline;
    snapshot.layout.body.text = script.body;
    snapshot.layout.cta.text = script.cta;
    applied = true;
  } else if (liveMode() && target === 'visual') {
    const visual = await claudeScripts.revisualize(snapshot.project, snapshot.script, feedback);
    const seed = seedFrom(id());
    snapshot.script = { ...snapshot.script, visual };
    const image = await openAIImages.generate(snapshot.project, snapshot.script, seed);
    snapshot = {
      ...snapshot,
      ...providerDetails(),
      backgroundId: storeProjectBackground(story.projectId, image),
      seed,
      prompt: visual,
    };
    applied = true;
  } else if (target === 'text' && /shorten.*headline/.test(normalized)) {
    const headline = snapshot.layout.headline.text.split(/\s+/).slice(0, 3).join(' ');
    if (headline !== snapshot.layout.headline.text) {
      snapshot.layout.headline.text = headline;
      snapshot.script.headline = headline;
      applied = true;
    }
  } else if (target === 'layout' && /center/.test(normalized)) {
    for (const layer of [snapshot.layout.headline, snapshot.layout.body, snapshot.layout.cta]) {
      if (layer.align !== 'center') {
        layer.align = 'center';
        applied = true;
      }
    }
  } else if (target === 'visual' && /warm|cool/.test(normalized)) {
    snapshot.project.colors = /warm/.test(normalized)
      ? ['#f3dbc5', '#c28660', '#f9eee4']
      : ['#d9e9ef', '#6599ae', '#edf5f6'];
    const seed = seedFrom(id());
    const image = await demoImage.generate(snapshot.project, snapshot.script, seed);
    snapshot = {
      ...snapshot,
      backgroundId: storeProjectBackground(story.projectId, image),
      seed,
      prompt: `${snapshot.script.visual}\nPalette feedback: ${feedback}`,
    };
    applied = true;
    setSetting('demoImageOperations', String(Number(setting('demoImageOperations', '0')) + 1));
  }
  return transaction(() => {
    checkVersion(storyId, expected);
    remember(story.projectId, 'feedback', `${target}: ${feedback.trim().slice(0, 300)}`);
    run(
      'INSERT INTO feedback VALUES(?,?,?,?,?,?,?,?)',
      id(),
      storyId,
      expected,
      userId,
      target,
      feedback,
      applied ? 1 : 0,
      now(),
    );
    if (applied) {
      assertEngagementAllowed(getProject(story.projectId), snapshot.script);
      registerProjectAssets(story.projectId, snapshotAssetIds(snapshot));
      const versionId = id(),
        revision = story.version.revision + 1;
      run(
        'INSERT INTO story_versions VALUES(?,?,?,?,?,?)',
        versionId,
        storyId,
        revision,
        JSON.stringify(snapshot),
        userId,
        now(),
      );
      run('UPDATE stories SET latestVersionId=? WHERE id=?', versionId, storyId);
    }
    return {
      applied,
      message: applied
        ? 'Feedback applied as a new draft.'
        : liveMode()
          ? 'Feedback saved. Layout feedback other than “center text” is applied by hand in the editor.'
          : 'Feedback saved. Demo supports “shorten headline”, “center text”, and “warmer/cooler palette”. Applying other feedback requires the live AI connection.',
    };
  });
}
export function restoreVersion(
  storyId: string,
  versionId: string,
  expected: string,
  userId: string,
) {
  const version = getVersion(versionId);
  if (version.storyId !== storyId) throw new AppError('Version does not belong to this story.');
  return appendVersion(storyId, version.data, userId, expected);
}
export function approve(items: { storyId: string; versionId: string }[], userId: string) {
  if (!items.length || items.length > 100) throw new AppError('Select between 1 and 100 stories.');
  return transaction(() => {
    for (const item of items) {
      const story = checkVersion(item.storyId, item.versionId);
      assertEngagementAllowed(getProject(story.projectId), story.version.data.script);
      const errors = validateComposition(story.version.data);
      if (errors.length) throw new AppError(errors.join(' '));
      const { topic, headline } = story.version.data.script;
      remember(story.projectId, 'approved', `${topic}: ${headline}`);
      run(
        'INSERT OR IGNORE INTO approvals VALUES(?,?,?,?,?)',
        id(),
        story.id,
        item.versionId,
        userId,
        now(),
      );
    }
    return { approved: items.length };
  });
}
export function exportVersion(versionId: string) {
  const version = getVersion(versionId);
  if (!version.approvedAt)
    throw new AppError('This exact version must be approved before downloading.', 403);
  return version;
}
export function recordExport(version: Version, userId: string, kind: string) {
  run(
    'INSERT INTO exports VALUES(?,?,?,?,?,?)',
    id(),
    version.storyId,
    version.id,
    userId,
    kind,
    now(),
  );
}
export function state(user: User): AppState {
  const projects = listProjects();
  const today = businessDate(new Date());
  const historyStart = daysBefore(today, 2);
  const stories = listStories().filter(
    (s) => s.businessDate >= historyStart && s.businessDate <= today,
  );
  const todayStories = stories.filter(
    (s) =>
      s.businessDate === today &&
      projects.some((p) => p.id === s.projectId && p.status !== 'archived'),
  );
  const heartbeat = setting('workerHeartbeat', '');
  const runs = query<Run>(
    "SELECT r.*,count(j.id) AS total,sum(CASE WHEN j.status='complete' THEN 1 ELSE 0 END) AS completed,sum(CASE WHEN j.status='failed' THEN 1 ELSE 0 END) AS failed FROM runs r LEFT JOIN jobs j ON j.runId=r.id GROUP BY r.id ORDER BY r.createdAt DESC",
  ).filter((r) => r.businessDate >= historyStart && r.businessDate <= today);
  return {
    user,
    projects,
    stories,
    runs,
    jobs: query<Job>(
      'SELECT j.*,r.projectId FROM jobs j JOIN runs r ON r.id=j.runId ORDER BY availableAt DESC',
    ).filter((j) => runs.some((r) => r.id === j.runId)),
    research: query<Omit<ResearchRecord, 'data'> & { data: string }>(
      'SELECT * FROM research ORDER BY fetchedAt DESC LIMIT 100',
    ).map((r) => ({ ...r, data: JSON.parse(r.data) })),
    settings: {
      providerMode: liveMode() ? 'live' : 'demo',
      missingKeys: missingLiveKeys(),
      automationEnabled: setting('automationEnabled', 'true') === 'true',
      timeZone: timeZone(),
      exportFormat:
        setting('exportFormat', process.env.EXPORT_FORMAT || 'jpeg') === 'png' ? 'png' : 'jpeg',
    },
    worker: {
      online: !!heartbeat && Date.now() - Date.parse(heartbeat) < 45000,
      heartbeat: heartbeat || null,
      nextRun: nextRun(
        new Date(),
        projects.filter((p) => p.status === 'active').map((p) => p.generateAt),
      ),
    },
    today,
    historyStart,
    retention: retentionStatus(),
    counts: {
      drafts: todayStories.filter((s) => !s.approvedVersionId).length,
      approved: todayStories.filter((s) => !!s.approvedVersionId).length,
      failed: query(
        "SELECT j.id FROM jobs j JOIN runs r ON r.id=j.runId JOIN projects p ON p.id=r.projectId WHERE j.status='failed' AND r.businessDate=? AND p.status!='archived'",
        today,
      ).length,
      projects: projects.filter((p) => p.status === 'active').length,
    },
    devMode: process.env.NODE_ENV !== 'production',
  };
}
export function feedbackFor(storyId: string) {
  return query(
    'SELECT f.*,u.name AS reviewer FROM feedback f JOIN users u ON u.id=f.userId WHERE storyId=? ORDER BY createdAt DESC,f.rowid DESC',
    storyId,
  );
}
export { db };
