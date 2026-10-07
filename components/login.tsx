'use client';
import { useState } from 'react';
import { ArrowRight, ArrowUpRight, ShieldCheck, Sparkles, CheckCheck } from 'lucide-react';
import { api, Button, Field } from './ui';
import Brand from './brand';
export default function Login({ onSuccess }: { onSuccess: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/api/auth', { username, password });
      onSuccess();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login">
      <aside className="login-art">
        <Brand />
        <div className="login-pitch">
          <div className="eyebrow">YOUR IDEAS. OUR CREATIVE RHYTHM.</div>
          <h1>
            CREATE.
            <br />
            <span>INSPIRE.</span>
            <br />
            REPEAT.
          </h1>
          <p>
            Every brand. Every story.
            <br />
            One workspace to bring it all together.
          </p>
          <div className="login-workflow" aria-label="Story workflow">
            <span>
              <Sparkles size={18} /> Create
            </span>
            <ArrowRight size={20} />
            <span>
              <CheckCheck size={18} /> Approve
            </span>
            <ArrowUpRight size={22} />
          </div>
          <div className="login-orbit" aria-hidden="true">
            <ArrowUpRight size={96} />
          </div>
        </div>
        <a
          className="login-website"
          href="https://inspirovatecreatives.com/"
          target="_blank"
          rel="noreferrer"
        >
          INSPIROVATE CREATIVES <ArrowUpRight size={16} />
        </a>
      </aside>
      <main className="login-form">
        <div className="login-form-inner">
          <span className="eyebrow">INSPIROVATE CREATIVES STORYLOOM</span>
          <h2>
            Good stories
            <br />
            start here.
          </h2>
          <p>Sign in to your creative workspace.</p>
          <form onSubmit={submit}>
            <Field label="Username">
              <input
                type="text"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="admin"
                required
                maxLength={80}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </Field>
            <Field label="Password">
              <input
                type="password"
                autoComplete="current-password"
                maxLength={128}
                required
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" busy={busy}>
              Sign in <ArrowRight size={18} />
            </Button>
          </form>
          <div className="login-admin-note">
            <ShieldCheck size={18} />
            <span>Admin workspace · every project, one place.</span>
          </div>
        </div>
      </main>
    </div>
  );
}
