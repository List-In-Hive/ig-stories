CREATE TABLE project_assets (
  projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  assetId TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  touchedAt TEXT NOT NULL,
  PRIMARY KEY(projectId,assetId)
);
INSERT OR IGNORE INTO project_assets
SELECT p.id,a.id,p.updatedAt FROM projects p JOIN assets a ON a.id=json_extract(p.data,'$.logoId');
INSERT OR IGNORE INTO project_assets
SELECT s.projectId,a.id,v.createdAt FROM story_versions v JOIN stories s ON s.id=v.storyId
JOIN assets a ON a.id IN (json_extract(v.data,'$.backgroundId'),json_extract(v.data,'$.logoId'),json_extract(v.data,'$.project.logoId'));
INSERT OR IGNORE INTO project_assets
SELECT s.projectId,a.id,v.createdAt FROM story_versions v JOIN stories s ON s.id=v.storyId
JOIN json_each(v.data,'$.fontAssets') f JOIN assets a ON a.id=f.value;

CREATE TABLE story_purges (storyId TEXT PRIMARY KEY);
DROP TRIGGER immutable_version_delete;
CREATE TRIGGER immutable_version_delete BEFORE DELETE ON story_versions
WHEN NOT EXISTS(SELECT 1 FROM story_purges WHERE storyId=OLD.storyId)
BEGIN SELECT RAISE(ABORT,'Story versions are immutable'); END;

CREATE TABLE asset_cleanup_candidates (assetId TEXT PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE, queuedAt TEXT NOT NULL, graceUntil TEXT);
INSERT INTO asset_cleanup_candidates SELECT id,createdAt,NULL FROM assets;
CREATE TABLE asset_file_deletions (filename TEXT PRIMARY KEY, queuedAt TEXT NOT NULL);
CREATE INDEX stories_retention ON stories(businessDate);
UPDATE projects SET data=json_set(data,'$.allowEngagement',json('false'))
WHERE json_extract(data,'$.allowEngagement') IS NULL;
