-- Keep legacy people for audit references, but allow one active administrator only.
ALTER TABLE users RENAME COLUMN email TO username;
ALTER TABLE login_attempts RENAME COLUMN email TO username;

DELETE FROM sessions;
DELETE FROM login_attempts;
UPDATE tokens SET consumedAt=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE consumedAt IS NULL;
UPDATE users SET active=0,role='admin';

INSERT INTO users(id,name,username,passwordHash,role,active,createdAt)
SELECT lower(hex(randomblob(16))),'Inspirovate Creatives','admin',NULL,'admin',0,strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE NOT EXISTS(SELECT 1 FROM users);

INSERT INTO settings(key,value)
SELECT 'primaryAdminId',id FROM users
ORDER BY CASE WHEN username='admin' THEN 0 WHEN username='admin@storyloom.local' THEN 1 ELSE 2 END,createdAt,id
LIMIT 1;

UPDATE users SET name='Inspirovate Creatives',username='admin',
passwordHash='$2b$12$3VOPv.3lufrVh1X8lRtjNunagQnS5jqwcjJxzXaQPqcv6WpPL1fE2',active=1
WHERE id=(SELECT value FROM settings WHERE key='primaryAdminId');

CREATE UNIQUE INDEX single_active_admin ON users(active) WHERE active=1;
CREATE TRIGGER admin_only_insert BEFORE INSERT ON users
WHEN NEW.role<>'admin' OR (NEW.active=1 AND NEW.username<>'admin')
BEGIN SELECT RAISE(ABORT,'Only the admin account can access this workspace'); END;
CREATE TRIGGER admin_only_update BEFORE UPDATE ON users
WHEN NEW.role<>'admin' OR (NEW.active=1 AND NEW.username<>'admin')
BEGIN SELECT RAISE(ABORT,'Only the admin account can access this workspace'); END;
