'use client';
import { useState } from 'react';
import { Upload, Check, Sparkles } from 'lucide-react';
import type { Project } from '@/lib/types';
import { api, Button, Field, Modal } from './ui';
const defaults = {
  name: '',
  industry: '',
  status: 'active' as const,
  description: '',
  services: '',
  audience: '',
  instagram: '',
  visualDirection: '',
  colors: ['#ece6f4', '#9d88be', '#f5f1fa'],
  font: 'Inter' as const,
  rules: 'Use clear, thoughtful English. Use only approved project facts.',
  prohibited: '',
  facts: '',
  allowEngagement: false,
  generateAt: '08:00',
  webResearch: true,
  logoId: null as string | null,
  website: '',
  email: '',
  phone: '',
  address: '',
  location: '',
};
export default function ProjectForm({
  project,
  onClose,
  onSave,
}: {
  project?: Project;
  onClose: () => void;
  onSave: (project: typeof defaults, projectId?: string) => Promise<void>;
}) {
  const [form, setForm] = useState({ ...defaults, ...project });
  const [tab, setTab] = useState('Brief');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [quick, setQuick] = useState({ handle: '', website: '' });
  const [drafting, setDrafting] = useState(false);
  const [drafted, setDrafted] = useState(false);
  const [quickError, setQuickError] = useState('');
  const [shots, setShots] = useState<string[]>([]);
  // Phone screenshots are shrunk in the browser before upload to keep the request light.
  async function addShots(files: FileList | null) {
    const picked = Array.from(files || []).slice(0, 10 - shots.length);
    const encoded = await Promise.all(
      picked.map(async (file) => {
        const bitmap = await createImageBitmap(file);
        const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(bitmap.width * scale);
        canvas.height = Math.round(bitmap.height * scale);
        canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/jpeg', 0.8);
      }),
    );
    setShots((current) => [...current, ...encoded].slice(0, 10));
  }
  // Claude reads the website and fills the brief; nothing is saved until the admin reviews it.
  async function draft() {
    setDrafting(true);
    setQuickError('');
    try {
      const website =
        quick.website && !/^https?:\/\//.test(quick.website)
          ? `https://${quick.website}`
          : quick.website;
      const brief = await api<Partial<typeof defaults>>('/api/command', {
        action: 'draftBrief',
        website,
        handle: quick.handle,
        screenshots: shots,
      });
      setForm((f) => ({ ...f, ...brief, logoId: f.logoId, status: f.status }));
      setDrafted(true);
    } catch (e) {
      setQuickError((e as Error).message);
    } finally {
      setDrafting(false);
    }
  }
  function update(key: string, value: unknown) {
    setForm((f) => ({ ...f, [key]: value }));
  }
  async function upload(file?: File) {
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const body = new FormData();
      body.append('file', file);
      const response = await fetch('/api/assets', { method: 'POST', body });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      update('logoId', data.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onSave(form as typeof defaults, project?.id);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const input = (key: keyof typeof defaults, placeholder = '', area = false) =>
    area ? (
      <textarea
        value={String(form[key] || '')}
        placeholder={placeholder}
        onChange={(e) => update(key, e.target.value)}
        rows={4}
      />
    ) : (
      <input
        value={String(form[key] || '')}
        placeholder={placeholder}
        onChange={(e) => update(key, e.target.value)}
      />
    );
  return (
    <Modal
      title={project ? 'Edit project' : 'Create a project'}
      description="A good brief makes better stories. Add the facts your team can confidently use."
      onClose={onClose}
      wide
    >
      <form onSubmit={submit}>
        <div className="tabs">
          {['Brief', 'Branding', 'Guidelines', 'Contact'].map((t) => (
            <button
              type="button"
              className={tab === t ? 'active' : ''}
              onClick={() => setTab(t)}
              key={t}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="modal-body">
          {tab === 'Brief' && (
            <>
              {!project && (
                <div className="surface quick-start">
                  <div>
                    <strong>
                      <Sparkles size={16} /> Quick start with AI
                    </strong>
                    <small>
                      {drafted
                        ? 'Brief drafted from the website. Check every tab, then create the project.'
                        : 'Enter the Instagram handle and website, and add up to 10 screenshots of the profile and posts. Claude studies them and fills in the brief, palette, and contacts for you to review.'}
                    </small>
                  </div>
                  <div className="quick-start-fields">
                    <input
                      value={quick.handle}
                      placeholder="@instagram_handle"
                      autoCapitalize="none"
                      onChange={(e) => setQuick((q) => ({ ...q, handle: e.target.value }))}
                    />
                    <input
                      value={quick.website}
                      placeholder="brand-website.com"
                      inputMode="url"
                      autoCapitalize="none"
                      onChange={(e) => setQuick((q) => ({ ...q, website: e.target.value }))}
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      busy={drafting}
                      disabled={!quick.handle.trim() && !quick.website.trim() && !shots.length}
                      onClick={() => void draft()}
                    >
                      {drafting ? 'Reading the website…' : 'Fill brief with AI'}
                    </Button>
                  </div>
                  <div className="quick-start-shots">
                    {shots.map((src, i) => (
                      <button
                        type="button"
                        key={i}
                        aria-label={`Remove screenshot ${i + 1}`}
                        onClick={() => setShots((all) => all.filter((_, j) => j !== i))}
                      >
                        <img src={src} alt="" />
                      </button>
                    ))}
                    {shots.length < 10 && (
                      <label className="btn ghost small">
                        <Upload size={14} />
                        {shots.length ? 'Add more' : 'Add Instagram screenshots'}
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          hidden
                          onChange={(e) => {
                            void addShots(e.target.files).catch(() =>
                              setQuickError('A screenshot could not be read.'),
                            );
                            e.target.value = '';
                          }}
                        />
                      </label>
                    )}
                  </div>
                  {quickError && (
                    <p className="form-error" role="alert">
                      {quickError}
                    </p>
                  )}
                </div>
              )}
              <div className="form-grid">
                <Field label="Project name *">{input('name', 'e.g. Sunday Coffee')}</Field>
                <Field label="Industry *">{input('industry', 'e.g. Coffee & café')}</Field>
              </div>
              <Field
                label="Business description *"
                hint="At least 10 characters. This is an approved source for demo copy."
              >
                {input('description', 'What does this business do?', true)}
              </Field>
              <div className="form-grid">
                <Field label="Services or products">
                  {input('services', 'Separate with commas or new lines', true)}
                </Field>
                <Field label="Target audience">
                  {input('audience', 'Who are we speaking to?', true)}
                </Field>
              </div>
              <Field
                label="Public Instagram URL"
                hint="Stored for reference. Reading this account's posts is not connected yet."
              >
                {input('instagram', 'https://www.instagram.com/yourbrand/')}
              </Field>
              <Field label="Project status">
                <select value={form.status} onChange={(e) => update('status', e.target.value)}>
                  <option value="active">Active — included in daily generation</option>
                  <option value="paused">Paused — manual generation only</option>
                  {project && <option value="archived">Archived — separate tab</option>}
                </select>
              </Field>
              <Field
                label="Daily generation time"
                hint="Four new drafts are created at this time every day, in the workspace time zone."
              >
                <input
                  type="time"
                  value={form.generateAt}
                  onChange={(e) => update('generateAt', e.target.value)}
                />
              </Field>
              <label className="switch-row">
                <input
                  type="checkbox"
                  checked={form.webResearch}
                  onChange={(e) => update('webResearch', e.target.checked)}
                />
                <span>
                  <strong>Research timely angles on the web</strong>
                  <small>
                    Live AI searches for local events, seasons, and industry news before writing.
                    Sources are listed on each story.
                  </small>
                </span>
              </label>
              <label className="switch-row project-engagement">
                <input
                  type="checkbox"
                  checked={form.allowEngagement}
                  onChange={(e) => update('allowEngagement', e.target.checked)}
                />
                <span>
                  <strong>Allow questions &amp; response prompts</strong>
                  <small>
                    Polls with multiple answers, “Do you like…?”, and “DM us” stories. Off keeps new
                    stories informational.
                  </small>
                </span>
              </label>
            </>
          )}
          {tab === 'Branding' && (
            <>
              <Field
                label="Original logo"
                hint="PNG, JPEG, or WebP. Up to 5 MB. The original aspect ratio is preserved."
              >
                <div className="logo-upload">
                  {form.logoId ? (
                    <img alt="Uploaded project logo" src={`/api/assets/${form.logoId}`} />
                  ) : (
                    <Upload size={28} />
                  )}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    aria-label="Upload project logo"
                    onChange={(e) => upload(e.target.files?.[0])}
                    disabled={uploading}
                  />
                  <span>
                    {uploading
                      ? 'Uploading…'
                      : form.logoId
                        ? 'Choose a replacement logo'
                        : 'Choose a logo'}
                  </span>
                </div>
              </Field>
              <Field label="Brand palette">
                <div className="color-fields">
                  {form.colors.map((color, i) => (
                    <div key={i}>
                      <input
                        type="color"
                        aria-label={`Brand color ${i + 1}`}
                        value={color}
                        onChange={(e) =>
                          update(
                            'colors',
                            form.colors.map((v, j) => (j === i ? e.target.value : v)),
                          )
                        }
                      />
                      <code>{color}</code>
                    </div>
                  ))}
                </div>
              </Field>
              <Field label="Default story font">
                <select value={form.font} onChange={(e) => update('font', e.target.value)}>
                  <option>Inter</option>
                  <option>Lora</option>
                </select>
              </Field>
              <Field label="Visual direction">
                {input(
                  'visualDirection',
                  'Describe the mood, lighting, and design direction.',
                  true,
                )}
              </Field>
            </>
          )}
          {tab === 'Guidelines' && (
            <>
              <Field
                label="Approved facts and offers"
                hint="One fact per line. Demo drafts draw from this list and the business description."
              >
                {input('facts', 'Enter verified facts the team may use.', true)}
              </Field>
              <Field label="Content rules">
                {input('rules', 'Tone of voice and language rules', true)}
              </Field>
              <Field label="Prohibited topics" hint="Separate topics with commas or new lines.">
                {input('prohibited', 'What should stories avoid?', true)}
              </Field>
            </>
          )}
          {tab === 'Contact' && (
            <>
              <p className="soft-note">
                Only non-empty contact fields are included. Their visibility can be changed in the
                editor.
              </p>
              <div className="form-grid">
                {(['website', 'email', 'phone', 'location'] as const).map((key) => (
                  <Field key={key} label={key.charAt(0).toUpperCase() + key.slice(1)}>
                    {input(key)}
                  </Field>
                ))}
              </div>
              <Field label="Address">{input('address')}</Field>
            </>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer className="modal-footer">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" busy={busy} disabled={uploading}>
            <Check size={16} />
            {project ? 'Save project' : 'Create project'}
          </Button>
        </footer>
      </form>
    </Modal>
  );
}
