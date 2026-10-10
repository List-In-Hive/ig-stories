'use client';
import { useState } from 'react';
import { Upload, Check, Sparkles, X } from 'lucide-react';
import type { BrandFont, FontName, Project } from '@/lib/types';
import { PALETTE_ROLES, contrast, normalizePalette } from '@/lib/palette';
import { api, Button, Field, Modal } from './ui';
// Photos only guide the style, so a 1024 px copy (longest side) is plenty and keeps 20 uploads light.
const MAX_PHOTOS = 20;
const defaults = {
  name: '',
  industry: '',
  status: 'active' as const,
  description: '',
  services: '',
  audience: '',
  instagram: '',
  visualDirection: '',
  colors: ['#ece6f4', '#172420', '#9d88be', '#f5f1fa'],
  font: 'Inter' as FontName,
  brandFont: null as BrandFont | null,
  rules: 'Use clear, thoughtful English. Use only approved project facts.',
  prohibited: '',
  facts: '',
  allowEngagement: false,
  generateAt: '08:00',
  webResearch: true,
  logoId: null as string | null,
  photoIds: [] as string[],
  stockPhotos: true,
  website: '',
  email: '',
  phone: '',
  address: '',
  location: '',
};
export default function ProjectForm({
  project,
  stock,
  onClose,
  onSave,
}: {
  project?: Project;
  stock?: string | null;
  onClose: () => void;
  onSave: (project: typeof defaults, projectId?: string) => Promise<void>;
}) {
  const start = {
    ...defaults,
    ...project,
    photoIds: project?.photoIds ?? [],
    stockPhotos: project?.stockPhotos ?? true,
    colors: normalizePalette(project?.colors ?? defaults.colors),
  };
  const [form, setForm] = useState(start);
  const [initial] = useState(() => JSON.stringify(start));
  const [tab, setTab] = useState('Brief');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [quick, setQuick] = useState({ handle: '', website: '' });
  const [drafting, setDrafting] = useState(false);
  const [drafted, setDrafted] = useState(false);
  const [quickError, setQuickError] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  // Styles the admin set by hand; the AI draft keeps them instead of replacing them.
  const [manual, setManual] = useState<Set<'colors' | 'font' | 'visualDirection'>>(new Set());
  const [fontUploading, setFontUploading] = useState(false);
  function setStyle(key: 'colors' | 'font' | 'visualDirection', value: unknown) {
    update(key, value);
    setManual((current) => new Set(current).add(key));
  }
  // Phone photos are shrunk in the browser before upload to keep the request light.
  async function addPhotos(files: FileList | null) {
    const picked = Array.from(files || []).slice(0, MAX_PHOTOS - photos.length);
    const encoded = await Promise.all(
      picked.map(async (file) => {
        const bitmap = await createImageBitmap(file);
        const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(bitmap.width * scale);
        canvas.height = Math.round(bitmap.height * scale);
        canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/jpeg', 0.8);
      }),
    );
    setPhotos((current) => [...current, ...encoded].slice(0, MAX_PHOTOS));
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
        photos,
        keep: Object.fromEntries([...manual].map((key) => [key, form[key]])),
      });
      setForm((f) => ({ ...f, ...brief, logoId: f.logoId, status: f.status }));
      setDrafted(true);
      if (!brief.name || !brief.description)
        setQuickError(
          'The AI could not find the business name or description. Add the website, or type them below.',
        );
    } catch (e) {
      setQuickError((e as Error).message);
    } finally {
      setDrafting(false);
    }
  }
  // A stray click on the backdrop or Escape must not throw away a running AI draft or unsaved edits.
  function close() {
    if (drafting || busy || uploading || fontUploading) return;
    const changed = JSON.stringify(form) !== initial || photos.length > 0;
    if (changed && !window.confirm('Close without saving? Your changes will be lost.')) return;
    onClose();
  }
  function draftOnEnter(e: React.KeyboardEvent) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (!drafting) void draft();
  }
  function update(key: string, value: unknown) {
    setForm((f) => ({ ...f, [key]: value }));
  }
  async function uploadFont(file: File | undefined, weight: 'regular' | 'bold') {
    if (!file) return;
    setFontUploading(true);
    setError('');
    try {
      const body = new FormData();
      body.append('file', file);
      body.append('kind', 'font');
      const response = await fetch('/api/assets', { method: 'POST', body });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      const current = form.brandFont;
      const next: BrandFont =
        weight === 'regular'
          ? { name: current?.name || data.family, regular: data, bold: current?.bold ?? null }
          : { name: current!.name, regular: current!.regular, bold: data };
      update('brandFont', next);
      if (weight === 'regular') setStyle('font', 'Brand');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setFontUploading(false);
    }
  }
  const [photoUploading, setPhotoUploading] = useState(0);
  async function uploadPhotos(files: File[]) {
    const room = 60 - form.photoIds.length;
    if (files.length > room) setError(`Up to 60 brand photos. Added the first ${room}.`);
    else setError('');
    for (const file of files.slice(0, Math.max(0, room))) {
      setPhotoUploading((n) => n + 1);
      try {
        const body = new FormData();
        body.append('file', file);
        body.append('kind', 'photo');
        const response = await fetch('/api/assets', { method: 'POST', body });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        setForm((f) => ({ ...f, photoIds: [...f.photoIds, data.id] }));
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setPhotoUploading((n) => n - 1);
      }
    }
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
    // The required fields live on the Brief tab; point there instead of failing on the server.
    const missing = [
      form.name.trim().length < 2 && 'project name',
      form.industry.trim().length < 2 && 'industry',
      form.description.trim().length < 10 && 'business description (10+ characters)',
    ].filter(Boolean);
    if (missing.length) {
      setTab('Brief');
      setError(`Fill in the ${missing.join(', ')} on the Brief tab.`);
      return;
    }
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
        maxLength={key === 'name' || key === 'industry' ? 80 : undefined}
        onChange={(e) => update(key, e.target.value)}
      />
    );
  return (
    <Modal
      title={project ? 'Edit project' : 'Create a project'}
      description="A good brief makes better stories. Add the facts your team can confidently use."
      onClose={close}
      wide
    >
      <form onSubmit={submit}>
        <div className="tabs">
          {['Brief', 'Branding', 'Photos', 'Guidelines', 'Contact'].map((t) => (
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
                      {drafting
                        ? 'ChatGPT is studying the photos while Claude reads the website. This usually takes 20–60 seconds; keep this window open.'
                        : drafted
                          ? 'Brief drafted. Check every tab, then create the project.'
                          : 'Enter the Instagram handle and website, and add up to 20 photos the brand has posted. ChatGPT studies the photos for style and palette while Claude researches the business, at the same time. Review the result before creating the project; colors and fonts you set on the Branding tab are kept.'}
                    </small>
                  </div>
                  <div className="quick-start-fields">
                    <input
                      value={quick.handle}
                      placeholder="@instagram_handle"
                      onKeyDown={draftOnEnter}
                      autoCapitalize="none"
                      onChange={(e) => setQuick((q) => ({ ...q, handle: e.target.value }))}
                    />
                    <input
                      value={quick.website}
                      placeholder="brand-website.com"
                      onKeyDown={draftOnEnter}
                      inputMode="url"
                      autoCapitalize="none"
                      onChange={(e) => setQuick((q) => ({ ...q, website: e.target.value }))}
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      busy={drafting}
                      disabled={!quick.handle.trim() && !quick.website.trim() && !photos.length}
                      onClick={() => void draft()}
                    >
                      {drafting ? 'Studying the brand…' : 'Fill brief with AI'}
                    </Button>
                  </div>
                  <div className="quick-start-shots">
                    {photos.map((src, i) => (
                      <button
                        type="button"
                        key={i}
                        aria-label={`Remove photo ${i + 1}`}
                        onClick={() => setPhotos((all) => all.filter((_, j) => j !== i))}
                      >
                        <img src={src} alt="" />
                      </button>
                    ))}
                    {photos.length < MAX_PHOTOS && (
                      <label className="btn ghost small">
                        <Upload size={14} />
                        {photos.length ? 'Add more' : 'Add post photos'}
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          hidden
                          onChange={(e) => {
                            void addPhotos(e.target.files).catch(() =>
                              setQuickError('A photo could not be read.'),
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
              <Field
                label="Brand palette"
                hint="Background and accent guide the artwork; text colors the story copy. Extra is optional."
              >
                <div className="color-fields">
                  {form.colors.map((color, i) => (
                    <div key={i}>
                      <span className="color-role">{PALETTE_ROLES[i]}</span>
                      <input
                        type="color"
                        aria-label={`${PALETTE_ROLES[i]} color`}
                        value={color}
                        onChange={(e) =>
                          setStyle(
                            'colors',
                            form.colors.map((v, j) => (j === i ? e.target.value : v)),
                          )
                        }
                      />
                      <HexInput
                        label={`${PALETTE_ROLES[i]} color hex code`}
                        value={color}
                        onChange={(value) =>
                          setStyle(
                            'colors',
                            form.colors.map((v, j) => (j === i ? value : v)),
                          )
                        }
                      />
                      {i === 4 && (
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => setStyle('colors', form.colors.slice(0, 4))}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  ))}
                  {form.colors.length < 5 && (
                    <button
                      type="button"
                      className="btn ghost small"
                      onClick={() => setStyle('colors', [...form.colors, form.colors[3]])}
                    >
                      + Extra color
                    </button>
                  )}
                </div>
                {contrast(form.colors[1], form.colors[0]) < 4.5 && (
                  <small className="soft-note">
                    Text on this background is hard to read, so stories will use a darker or lighter
                    text color automatically.
                  </small>
                )}
              </Field>
              <Field label="Default story font">
                <select value={form.font} onChange={(e) => setStyle('font', e.target.value)}>
                  <option value="Inter">Inter (clean sans)</option>
                  <option value="Lora">Lora (classic serif)</option>
                  <option value="Montserrat">Montserrat (bold geometric)</option>
                  {form.brandFont && (
                    <option value="Brand">{form.brandFont.name} (brand font)</option>
                  )}
                </select>
              </Field>
              <Field
                label="Brand font"
                hint="Optional. Upload the brand's own .ttf or .otf file: a regular weight, and a bold one for headlines if you have it."
              >
                <div className="brand-font">
                  {form.brandFont ? (
                    <>
                      <input
                        aria-label="Brand font name"
                        value={form.brandFont.name}
                        onChange={(e) =>
                          update('brandFont', { ...form.brandFont!, name: e.target.value })
                        }
                      />
                      <small>
                        Regular: {form.brandFont.regular.family}
                        {form.brandFont.bold
                          ? ` · Bold: ${form.brandFont.bold.family}`
                          : ' · No bold file, headlines use the regular one'}
                      </small>
                    </>
                  ) : null}
                  <div className="brand-font-actions">
                    <label className="btn ghost small">
                      <Upload size={14} />
                      {form.brandFont ? 'Replace regular' : 'Upload font'}
                      <input
                        type="file"
                        accept=".ttf,.otf,font/ttf,font/otf"
                        hidden
                        disabled={fontUploading}
                        onChange={(e) => {
                          void uploadFont(e.target.files?.[0], 'regular');
                          e.target.value = '';
                        }}
                      />
                    </label>
                    {form.brandFont && (
                      <label className="btn ghost small">
                        <Upload size={14} />
                        {form.brandFont.bold ? 'Replace bold' : 'Add bold'}
                        <input
                          type="file"
                          accept=".ttf,.otf,font/ttf,font/otf"
                          hidden
                          disabled={fontUploading}
                          onChange={(e) => {
                            void uploadFont(e.target.files?.[0], 'bold');
                            e.target.value = '';
                          }}
                        />
                      </label>
                    )}
                    {form.brandFont && (
                      <button
                        type="button"
                        className="btn ghost small"
                        onClick={() => {
                          update('brandFont', null);
                          if (form.font === 'Brand') update('font', 'Inter');
                        }}
                      >
                        Remove
                      </button>
                    )}
                    {fontUploading && <small>Uploading…</small>}
                  </div>
                </div>
              </Field>
              <Field
                label="Visual direction"
                hint="Guides the AI artwork: subjects, photo style, lighting, and mood."
              >
                <textarea
                  value={form.visualDirection}
                  placeholder="Describe the mood, lighting, and design direction."
                  rows={4}
                  onChange={(e) => setStyle('visualDirection', e.target.value)}
                />
              </Field>
            </>
          )}
          {tab === 'Photos' && (
            <>
              <Field
                label="Brand photos"
                group
                hint="Your own photos (products, place, team, work). About half of each day's stories use a real photo; these come first. JPEG, PNG, or WebP, up to 60."
              >
                <div className="photo-library">
                  {form.photoIds.map((photoId) => (
                    <div key={photoId} className="photo-thumb">
                      <img alt="Brand photo" src={`/api/assets/${photoId}`} />
                      <button
                        type="button"
                        aria-label="Remove photo"
                        onClick={() =>
                          update(
                            'photoIds',
                            form.photoIds.filter((p) => p !== photoId),
                          )
                        }
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                  <label className="photo-add">
                    <Upload size={20} />
                    <span>{photoUploading ? 'Uploading…' : 'Add photos'}</span>
                    <input
                      type="file"
                      multiple
                      accept="image/png,image/jpeg,image/webp"
                      aria-label="Add brand photos"
                      onChange={(e) => {
                        void uploadPhotos([...(e.target.files ?? [])]);
                        e.target.value = '';
                      }}
                    />
                  </label>
                </div>
              </Field>
              <label className="switch-row">
                <input
                  type="checkbox"
                  checked={form.stockPhotos}
                  onChange={(e) => update('stockPhotos', e.target.checked)}
                />
                <span>
                  <strong>Use free stock photos</strong>
                  <small>
                    {stock
                      ? `Real photos from ${stock} matched to each story, mixed with your photos and AI artwork.`
                      : 'Add PIXABAY_API_KEY to .env (free at pixabay.com/api/docs) to turn this on.'}
                  </small>
                </span>
              </label>
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
                Used by the AI for research and local facts. Contact details are not printed on
                stories.
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
          <Button type="button" variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" busy={busy} disabled={uploading || fontUploading}>
            <Check size={16} />
            {project ? 'Save project' : 'Create project'}
          </Button>
        </footer>
      </form>
    </Modal>
  );
}

// Lets the admin paste exact brand hex codes; the color swatch alone is hard to use on a phone.
function HexInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  return (
    <input
      className="hex-input"
      aria-label={label}
      value={focused ? draft : value}
      maxLength={7}
      autoCapitalize="none"
      spellCheck={false}
      onFocus={() => {
        setDraft(value);
        setFocused(true);
      }}
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        const next = e.target.value.trim();
        setDraft(next);
        const hex = next.startsWith('#') ? next : `#${next}`;
        if (/^#[0-9a-fA-F]{6}$/.test(hex)) onChange(hex.toLowerCase());
      }}
    />
  );
}
