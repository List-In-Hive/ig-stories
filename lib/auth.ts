import { randomBytes, createHash } from 'node:crypto';
import { compareSync } from 'bcryptjs';
import { one, run, now } from './db';
import { AppError } from './errors';
import type { Authentication, User } from './types';
export const devAccess = () =>
  process.env.NODE_ENV !== 'production' || process.env.LOCAL_DEMO_ACCESS === 'true';
export const tokenDigest = (token: string) => createHash('sha256').update(token).digest('hex');
export const localAuth: Authentication = {
  signIn(username, password) {
    const normalized = username.trim().toLowerCase();
    const attempts = one<{ attempts: number; lastAt: string }>(
      'SELECT * FROM login_attempts WHERE username=?',
      normalized,
    );
    const recent = !!attempts && Date.now() - Date.parse(attempts.lastAt) < 15 * 60 * 1000;
    if (recent && attempts.attempts >= 8)
      throw new AppError('Too many attempts. Try again in 15 minutes.', 429);
    const user = one<User & { passwordHash: string }>(
      "SELECT * FROM users WHERE username=? AND username='admin' AND role='admin' AND active=1",
      normalized,
    );
    if (
      Buffer.byteLength(password, 'utf8') > 72 ||
      !user?.passwordHash ||
      !compareSync(password, user.passwordHash)
    ) {
      run(
        'INSERT INTO login_attempts VALUES(?,?,?) ON CONFLICT(username) DO UPDATE SET attempts=excluded.attempts,lastAt=excluded.lastAt',
        normalized,
        recent ? attempts.attempts + 1 : 1,
        now(),
      );
      throw new AppError('Username or password is incorrect.', 401);
    }
    run('DELETE FROM login_attempts WHERE username=?', normalized);
    const token = randomBytes(32).toString('hex');
    run(
      'INSERT INTO sessions VALUES(?,?,?)',
      tokenDigest(token),
      user.id,
      new Date(Date.now() + 7 * 86400000).toISOString(),
    );
    return {
      token,
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        role: user.role,
        active: user.active,
      },
    };
  },
  session(token) {
    return (
      one<User>(
        "SELECT u.id,u.name,u.username,u.role,u.active FROM sessions s JOIN users u ON u.id=s.userId WHERE s.tokenHash=? AND s.expiresAt>? AND u.active=1 AND u.role='admin' AND u.username='admin'",
        tokenDigest(token),
        now(),
      ) ?? null
    );
  },
};
