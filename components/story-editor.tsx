'use client';
import { useState, useEffect, type FormEvent, type MouseEvent } from 'react';
import {
  Clapperboard,
  ArrowLeft,
  Check,
  Download,
  RefreshCw,
  Sparkles,
  Save,
  Type,
  Palette,
  MessageSquare,
  Clock3,
  RotateCcw,
  Eye,
  AlignLeft,
  AlignCenter,
  AlignRight,
  ShieldCheck,
  AlertCircle,
  Bold,
  CaseUpper,
  Layers,
  Plus,
  Search,
  Image as ImageIcon,
} from 'lucide-react';
import type { FontName, Layer, Layout, Project, Story, Version } from '@/lib/types';
import { api, Button, Badge, Field, formatTime } from './ui';
import SaveStories from './save-stories';
import StoryVideo from './story-video';
import type { Command } from './workspace';
const LAYERS = [
  { key: 'headline', label: 'Headline' },
  { key: 'body', label: 'Body' },
  { key: 'logo', label: 'Logo' },
] as const;
const TEXT_LAYERS = ['headline', 'body'] as const;
// A rough box for the selected layer on the preview; the server does the exact line wrapping.
function outlineHeight(key: keyof Layout, layer: Layout[keyof Layout]) {
  if (key === 'logo') return layer.width / 2;
  const t = layer as Layer;
  const perLine = Math.max(1, Math.floor(t.width / (t.size * 0.52)));
  const lines = t.text
    .split('\n')
    .reduce((sum, p) => sum + Math.max(1, Math.ceil(p.length / perLine)), 0);
  return lines * t.size * (t.lineHeight ?? 1.25) + t.size * 0.3;
}
function ColorHex({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      className="hex-input"
      aria-label="Hex color"
      value={draft}
      maxLength={7}
      spellCheck={false}
      onChange={(e) => {
        const next = e.target.value.trim();
        setDraft(next);
        const full = next.startsWith('#') ? next : '#' + next;
        if (/^#[0-9a-fA-F]{6}$/.test(full)) onChange(full.toLowerCase());
      }}
      onBlur={() => setDraft(value)}
    />
  );
}
type Feedback = {
  id: string;
  text: string;
  target: string;
  applied: number;
  reviewer: string;
  createdAt: string;
};
type StockPhoto = { id: string; thumb: string; alt: string; photographer: string };
export default function StoryEditor({
  story,
  project,
  stock,
  command,
  notify,
  onDirty,
  onBack,
}: {
  story: Story;
  project?: Project;
  stock?: string | null;
  command: Command;
  notify: (message: string) => void;
  onDirty: (dirty: boolean) => void;
  onBack: () => void;
}) {
  const [base, setBase] = useState(story.version);
  const [layout, setLayout] = useState<Layout>(structuredClone(story.version.data.layout));
  const [tab, setTab] = useState('Copy');
  const [selectedLayer, setSelectedLayer] = useState<keyof Layout>('headline');
  const [busy, setBusy] = useState('');
  const [preview, setPreview] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [versions, setVersions] = useState<Version[]>([]);
  const [feedbackHistory, setFeedbackHistory] = useState<Feedback[]>([]);
  const [feedback, setFeedback] = useState('');
  const [target, setTarget] = useState('text');
  const [safeArea, setSafeArea] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [picker, setPicker] = useState<'' | 'stock' | 'library'>('');
  const [query, setQuery] = useState(story.version.data.script.photoSearch || '');
  const [results, setResults] = useState<StockPhoto[]>([]);
  const library = project?.photoIds ?? [];
  // Stock search only for projects that allow stock photos.
  const stockOn = project?.stockPhotos === false ? null : stock;
  const dirty = JSON.stringify(layout) !== JSON.stringify(base.data.layout);
  const conflict = story.latestVersionId !== base.id;
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);
  useEffect(() => {
    const listener = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', listener);
    return () => window.removeEventListener('beforeunload', listener);
  }, [dirty]);
  useEffect(() => {
    let canceled = false;
    const timer = setTimeout(() => {
      api<{ svg: string; errors: string[] }>('/api/preview', { storyId: story.id, layout })
        .then((result) => {
          if (!canceled) {
            setPreview('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(result.svg));
            setErrors(result.errors);
          }
        })
        .catch((e) => {
          if (!canceled) setErrors([(e as Error).message]);
        });
    }, 250);
    return () => {
      canceled = true;
      clearTimeout(timer);
    };
  }, [layout, story.id]);
  useEffect(() => {
    void api<{ versions: Version[]; feedback: Feedback[] }>('/api/command', {
      action: 'versions',
      storyId: story.id,
    }).then((data) => {
      setVersions(data.versions);
      setFeedbackHistory(data.feedback);
    });
  }, [story.id, story.latestVersionId, story.approvedVersionId]);
  function accept(version: Version) {
    setBase(version);
    setLayout(structuredClone(version.data.layout));
    onDirty(false);
  }
  function update(layer: keyof Layout, patch: Partial<Layer>) {
    setLayout((current) => ({ ...current, [layer]: { ...current[layer], ...patch } }));
  }
  async function save() {
    setBusy('save');
    try {
      const version = await command<Version>('saveStory', {
        storyId: story.id,
        expected: base.id,
        layout,
      });
      accept(version);
      notify('Saved as a new draft version.');
    } catch {
      // The shared command handler already displayed the server error.
    } finally {
      setBusy('');
    }
  }
  async function approve() {
    setBusy('approve');
    try {
      await command('approve', { items: [{ storyId: story.id, versionId: base.id }] });
      notify('This exact saved version is approved.');
    } catch {
      // The shared command handler already displayed the server error.
    } finally {
      setBusy('');
    }
  }
  async function revise(kind: 'image' | 'idea' | 'text') {
    setBusy(kind);
    try {
      const version = await command<Version>('revise', {
        storyId: story.id,
        expected: base.id,
        kind,
        prompt,
      });
      accept(version);
      setPrompt('');
      notify(
        {
          image: 'New image saved as a draft. Your text was kept.',
          text: 'New text saved as a draft. Your image was kept.',
          idea: 'A new story, text and image, was saved as a draft.',
        }[kind],
      );
    } catch {
      // The shared command handler already displayed the server error.
    } finally {
      setBusy('');
    }
  }
  async function searchPhotos(e?: FormEvent) {
    e?.preventDefault();
    setBusy('search');
    try {
      setResults(
        await api<StockPhoto[]>('/api/command', {
          action: 'stockSearch',
          query: query || base.data.script.topic,
        }),
      );
    } catch (error) {
      notify((error as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function choosePhoto(choice: { stock?: string; library?: string }) {
    setBusy('photo');
    try {
      accept(await command<Version>('usePhoto', { storyId: story.id, expected: base.id, choice }));
      notify('Photo swapped. Your text and design were kept.');
    } catch {
      // The shared command handler already displayed the server error.
    } finally {
      setBusy('');
    }
  }
  async function applyFeedback() {
    setBusy('feedback');
    try {
      const result = await command<{ applied: boolean; message: string }>('feedback', {
        storyId: story.id,
        expected: base.id,
        target,
        feedback,
      });
      notify(result.message);
      setFeedback('');
      const data = await api<{ versions: Version[]; feedback: Feedback[] }>('/api/command', {
        action: 'versions',
        storyId: story.id,
      });
      setVersions(data.versions);
      setFeedbackHistory(data.feedback);
      if (result.applied) accept(data.versions[0]);
    } catch {
      // The shared command handler already displayed the server error.
    } finally {
      setBusy('');
    }
  }
  async function restore(versionId: string) {
    setBusy('restore');
    try {
      accept(
        await command<Version>('restore', { storyId: story.id, versionId, expected: base.id }),
      );
      notify('Earlier version restored as a new draft.');
    } catch {
      // The shared command handler already displayed the server error.
    } finally {
      setBusy('');
    }
  }
  const approved = story.approvedVersionId === base.id;
  const selected = layout[selectedLayer];
  const text = selectedLayer === 'logo' ? null : (selected as Layer);
  const swatches = [
    ...new Set(
      [...(story.version.data.project.colors || []), '#ffffff', '#000000'].map((c) =>
        c.toLowerCase(),
      ),
    ),
  ];
  function applyToAll() {
    if (!text) return;
    setLayout((current) => {
      const next = { ...current };
      for (const l of TEXT_LAYERS) next[l] = { ...next[l], font: text.font, color: text.color };
      return next;
    });
  }
  // Tapping the preview selects the text layer under the finger (or the closest one above it).
  function pick(e: MouseEvent<HTMLImageElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - box.left) / box.width) * 1080;
    const y = ((e.clientY - box.top) / box.height) * 1920;
    const hit = LAYERS.filter((l) => {
      const layer = layout[l.key];
      return (
        layer.visible && x >= layer.x - 40 && x <= layer.x + layer.width + 40 && y >= layer.y - 40
      );
    }).sort((a, b) => layout[b.key].y - layout[a.key].y)[0];
    if (!hit) return;
    setSelectedLayer(hit.key);
    setTab('Design');
    // On phones the controls sit below the preview, so bring them into view.
    if (window.innerWidth < 900)
      document.querySelector('.editor-controls')?.scrollIntoView({ behavior: 'smooth' });
  }
  const blocked = !!busy || dirty || conflict;
  return (
    <>
      <div className="editor-top">
        <div>
          <button className="back-link" onClick={onBack}>
            <ArrowLeft size={14} />
            Back to stories
          </button>
          <h1>
            {story.version.data.project.name}
            <span>Story {story.slot || 1}</span>
          </h1>
        </div>
        <div className="editor-save-state">
          <span className={dirty ? 'unsaved' : 'saved'}>
            <i />
            {dirty ? 'Unsaved changes' : `Saved · version ${base.revision}`}
          </span>
          <Badge status={approved ? 'approved' : 'draft'} />
        </div>
        <div className="button-group">
          <Button
            variant="secondary"
            busy={busy === 'save'}
            disabled={!dirty || !!busy}
            onClick={() => void save()}
          >
            <Save size={15} />
            Save changes
          </Button>
          {approved ? (
            <SaveStories
              versionIds={[base.id]}
              disabled={dirty}
              desktopLabel="Download image"
              notify={notify}
            />
          ) : (
            <Button
              busy={busy === 'approve'}
              disabled={blocked || errors.length > 0}
              onClick={() => void approve()}
            >
              <Check size={16} />
              Approve version
            </Button>
          )}
        </div>
      </div>
      {conflict && (
        <div className="conflict-banner">
          <AlertCircle size={18} />
          <span>
            A newer version is saved. Compare it in Version history, then reload before saving or
            approving.
          </span>
          <Button
            variant="secondary"
            onClick={() => {
              if (!dirty || window.confirm('Discard unsaved changes and load the latest version?'))
                accept(story.version);
            }}
          >
            Reload latest
          </Button>
        </div>
      )}
      <div className="editor-grid">
        <aside className="editor-controls surface">
          <div className="editor-tabs">
            {[
              { name: 'Copy', icon: Type },
              { name: 'Design', icon: Palette },
              { name: 'Feedback', icon: MessageSquare },
            ].map((t) => (
              <button
                key={t.name}
                onClick={() => setTab(t.name)}
                className={tab === t.name ? 'active' : ''}
              >
                <t.icon size={15} />
                {t.name}
              </button>
            ))}
          </div>
          <div className="editor-panel-body">
            {tab === 'Copy' && (
              <>
                <div className="panel-title">
                  <h3>Give it your voice.</h3>
                  <p>Text edits keep the artwork.</p>
                </div>
                {(['headline', 'body'] as const).map((key) => (
                  <Field
                    key={key}
                    label={
                      {
                        headline: 'Headline',
                        body: 'Body copy',
                      }[key]
                    }
                  >
                    <textarea
                      rows={key === 'body' ? 5 : 3}
                      value={layout[key].text}
                      onChange={(e) =>
                        update(key, { text: e.target.value, visible: !!e.target.value })
                      }
                      maxLength={5000}
                    />
                  </Field>
                ))}
                <div className="soft-note">
                  <ShieldCheck size={16} />
                  Use verified project facts.
                </div>
              </>
            )}
            {tab === 'Design' && (
              <>
                <div className="panel-title">
                  <h3>Every layer, your way.</h3>
                  <p>Pick a text, or tap it on the preview, then style it.</p>
                </div>
                <div className="layer-picker" role="tablist" aria-label="Layer">
                  {LAYERS.map((l) => (
                    <button
                      key={l.key}
                      role="tab"
                      aria-selected={selectedLayer === l.key}
                      className={`${selectedLayer === l.key ? 'active' : ''} ${layout[l.key].visible ? '' : 'hidden-layer'}`}
                      onClick={() => setSelectedLayer(l.key)}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={selected.visible}
                    onChange={(e) => update(selectedLayer, { visible: e.target.checked })}
                  />
                  Show this layer
                </label>
                {text && (
                  <>
                    <Field label="Font">
                      <select
                        value={text.font}
                        onChange={(e) =>
                          update(selectedLayer, { font: e.target.value as FontName })
                        }
                      >
                        <option>Inter</option>
                        <option>Lora</option>
                        <option>Montserrat</option>
                        {story.version.data.fontAssets?.Brand && (
                          <option value="Brand">
                            {story.version.data.project.brandFont?.name || 'Brand font'}
                          </option>
                        )}
                      </select>
                    </Field>
                    <Field label="Style" group>
                      <div className="style-toggles">
                        {(
                          [
                            {
                              key: 'bold',
                              label: 'Bold',
                              icon: Bold,
                              on: text.bold ?? selectedLayer === 'headline',
                            },
                            {
                              key: 'uppercase',
                              label: 'Caps',
                              icon: CaseUpper,
                              on: !!text.uppercase,
                            },
                            { key: 'shadow', label: 'Shadow', icon: Layers, on: !!text.shadow },
                          ] as const
                        ).map((t) => (
                          <button
                            key={t.key}
                            aria-pressed={t.on}
                            className={t.on ? 'active' : ''}
                            onClick={() => update(selectedLayer, { [t.key]: !t.on })}
                          >
                            <t.icon size={16} />
                            {t.label}
                          </button>
                        ))}
                      </div>
                    </Field>
                    <Field label={`Font size · ${text.size}px`}>
                      <div className="range-row">
                        <input
                          type="range"
                          min={12}
                          max={180}
                          value={text.size}
                          onChange={(e) => update(selectedLayer, { size: Number(e.target.value) })}
                        />
                        <input
                          type="number"
                          min={12}
                          max={180}
                          value={text.size}
                          onChange={(e) => update(selectedLayer, { size: Number(e.target.value) })}
                        />
                      </div>
                    </Field>
                    <Field label={`Line spacing · ${(text.lineHeight ?? 1.25).toFixed(2)}`}>
                      <input
                        type="range"
                        min={0.8}
                        max={2.5}
                        step={0.05}
                        value={text.lineHeight ?? 1.25}
                        onChange={(e) =>
                          update(selectedLayer, { lineHeight: Number(e.target.value) })
                        }
                      />
                    </Field>
                    <Field label="Text color" group>
                      <div className="color-picker">
                        <div className="swatches">
                          {swatches.map((c) => (
                            <button
                              key={c}
                              aria-label={`Use ${c}`}
                              title={c}
                              className={text.color.toLowerCase() === c ? 'active' : ''}
                              style={{ background: c }}
                              onClick={() => update(selectedLayer, { color: c })}
                            />
                          ))}
                          <label className="swatch-custom" title="Any color">
                            <input
                              type="color"
                              aria-label="Pick any color"
                              value={text.color}
                              onChange={(e) => update(selectedLayer, { color: e.target.value })}
                            />
                            <Plus size={14} />
                          </label>
                        </div>
                        <ColorHex
                          value={text.color}
                          onChange={(color) => update(selectedLayer, { color })}
                        />
                      </div>
                    </Field>
                    <Field label="Alignment" group>
                      <div className="alignment-control">
                        {[
                          { value: 'left', icon: AlignLeft },
                          { value: 'center', icon: AlignCenter },
                          { value: 'right', icon: AlignRight },
                        ].map((a) => (
                          <button
                            aria-label={`Align ${a.value}`}
                            key={a.value}
                            className={text.align === a.value ? 'active' : ''}
                            onClick={() =>
                              update(selectedLayer, { align: a.value as Layer['align'] })
                            }
                          >
                            <a.icon size={17} />
                          </button>
                        ))}
                      </div>
                    </Field>
                    <button className="text-link" onClick={applyToAll}>
                      Use this font and color for all text
                    </button>
                  </>
                )}
                <div className="form-grid">
                  {(['x', 'y', 'width'] as const).map((key) => (
                    <Field
                      key={key}
                      label={
                        {
                          x: 'X position',
                          y: 'Y position',
                          width: selectedLayer === 'logo' ? 'Logo width' : 'Text box width',
                        }[key]
                      }
                    >
                      <input
                        type="number"
                        min={0}
                        max={key === 'y' ? 1920 : 1080}
                        value={selected[key]}
                        onChange={(e) => update(selectedLayer, { [key]: Number(e.target.value) })}
                      />
                    </Field>
                  ))}
                </div>
                <p className="soft-note">Positions use the 1080 × 1920 story canvas.</p>
                {selectedLayer === 'logo' && (
                  <p className="soft-note">
                    Logo height follows the original aspect ratio. This version keeps its original
                    uploaded asset.
                  </p>
                )}
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={safeArea}
                    onChange={(e) => setSafeArea(e.target.checked)}
                  />
                  Show safe area
                </label>
              </>
            )}
            {tab === 'Feedback' && (
              <>
                <div className="panel-title">
                  <h3>A little direction.</h3>
                  <p>Feedback is saved with the story.</p>
                </div>
                <Field label="Change target">
                  <select value={target} onChange={(e) => setTarget(e.target.value)}>
                    <option value="text">Text</option>
                    <option value="visual">Visual</option>
                    <option value="layout">Layout</option>
                  </select>
                </Field>
                <Field label="Your feedback">
                  <textarea
                    rows={5}
                    value={feedback}
                    maxLength={3000}
                    onChange={(e) => setFeedback(e.target.value)}
                    placeholder="What would make this story better?"
                  />
                </Field>
                <div className="feedback-presets">
                  {[
                    { text: 'Shorten the headline', target: 'text' },
                    { text: 'Use a warmer palette', target: 'visual' },
                    { text: 'Use a cooler palette', target: 'visual' },
                    { text: 'Center the text', target: 'layout' },
                  ].map((p) => (
                    <button
                      key={p.text}
                      onClick={() => {
                        setFeedback(p.text);
                        setTarget(p.target);
                      }}
                    >
                      {p.text}
                    </button>
                  ))}
                </div>
                <Button
                  busy={busy === 'feedback'}
                  disabled={blocked || !feedback.trim()}
                  onClick={() => void applyFeedback()}
                >
                  Save & apply feedback
                  <ArrowRightIcon />
                </Button>
                <p className="soft-note">
                  With Live AI, text and visual feedback is applied by Claude as a new draft. Demo
                  applies only the example actions above.
                </p>
                {feedbackHistory.map((f) => (
                  <div className="feedback-entry" key={f.id}>
                    <strong>{f.reviewer}</strong>
                    <p>{f.text}</p>
                    <small>
                      {f.applied ? 'Applied to a new draft' : 'Saved · not applied'} ·{' '}
                      {formatTime(f.createdAt)}
                    </small>
                  </div>
                ))}
              </>
            )}
          </div>
        </aside>
        <section className="editor-stage">
          <div className="stage-heading">
            <span>
              <Eye size={14} />
              Story preview
            </span>
            <span>1080 × 1920</span>
          </div>
          <div className="editor-canvas">
            <img
              alt="Story composition preview"
              onClick={pick}
              src={preview || `/api/stories/${story.id}/preview?version=${base.id}`}
            />
            {safeArea && <div className="safe-area" />}
            {tab === 'Design' && selected.visible && (
              <div
                className="layer-outline"
                style={{
                  left: `${(selected.x / 1080) * 100}%`,
                  top: `${(selected.y / 1920) * 100}%`,
                  width: `${(selected.width / 1080) * 100}%`,
                  height: `${(outlineHeight(selectedLayer, selected) / 1920) * 100}%`,
                }}
              />
            )}
          </div>
          <div className="stage-caption">
            <span>{base.data.label}</span>
            <small>Text & logo are separate, editable layers.</small>
          </div>
          {errors.length > 0 && (
            <div className="composition-errors" role="alert">
              {errors.map((e) => (
                <p key={e}>
                  <AlertCircle size={14} />
                  {e}
                </p>
              ))}
            </div>
          )}
          <details className="story-tool">
            <summary>
              <RefreshCw size={16} />
              <span>
                Regenerate
                <small>New image, new text or a whole new story</small>
              </span>
            </summary>
            <div className="regenerate-box">
              <label htmlFor="regen-prompt">Your idea (optional)</label>
              <textarea
                id="regen-prompt"
                rows={3}
                maxLength={2000}
                value={prompt}
                disabled={!!busy}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Optional. e.g. A latte on a sunny windowsill, morning light. Or: make it about our new pumpkin latte."
              />
              <div className="artwork-actions">
                <Button
                  variant="secondary"
                  busy={busy === 'image'}
                  disabled={blocked}
                  onClick={() => void revise('image')}
                >
                  <RefreshCw size={15} />
                  New image
                </Button>
                <Button
                  variant="secondary"
                  busy={busy === 'text'}
                  disabled={blocked}
                  onClick={() => void revise('text')}
                >
                  <Type size={15} />
                  New text
                </Button>
                <Button
                  variant="secondary"
                  busy={busy === 'idea'}
                  disabled={blocked}
                  onClick={() => void revise('idea')}
                >
                  <Sparkles size={15} />
                  New story
                </Button>
              </div>
              <small>
                {prompt.trim()
                  ? 'Your prompt guides the result. Your design (fonts, colors, positions) is kept.'
                  : 'Leave it empty for a fresh take. Your design (fonts, colors, positions) is kept.'}
              </small>
            </div>
          </details>
          {(stockOn || library.length > 0) && (
            <details className="story-tool">
              <summary>
                <ImageIcon size={16} />
                <span>
                  Change photo
                  <small>
                    {stockOn && library.length
                      ? 'Free stock photos or your brand photos'
                      : stockOn
                        ? 'Free stock photos'
                        : 'Your brand photos'}
                  </small>
                </span>
              </summary>
              <div className="photo-picker">
                <div className="picker-tabs">
                  {stockOn && (
                    <Button
                      variant={picker === 'stock' ? 'primary' : 'secondary'}

                      disabled={blocked}
                      onClick={() => {
                        setPicker(picker === 'stock' ? '' : 'stock');
                        if (!results.length) void searchPhotos();
                      }}
                    >
                      <Search size={14} />
                      Find stock photo
                    </Button>
                  )}
                  {library.length > 0 && (
                    <Button
                      variant={picker === 'library' ? 'primary' : 'secondary'}

                      disabled={blocked}
                      onClick={() => setPicker(picker === 'library' ? '' : 'library')}
                    >
                      <ImageIcon size={14} />
                      Brand photos
                    </Button>
                  )}
                </div>
                {picker === 'stock' && (
                  <>
                    <form className="picker-search" onSubmit={searchPhotos}>
                      <input
                        aria-label="Search stock photos"
                        value={query}
                        maxLength={100}
                        placeholder="e.g. latte art close up"
                        onChange={(e) => setQuery(e.target.value)}
                      />
                      <Button variant="secondary" busy={busy === 'search'}>
                        Search
                      </Button>
                    </form>
                    <div className="photo-grid">
                      {results.map((photo) => (
                        <button
                          key={photo.id}
                          disabled={!!busy || blocked}
                          title={`${photo.alt} · ${photo.photographer}`}
                          onClick={() => void choosePhoto({ stock: photo.id })}
                        >
                          <img alt={photo.alt} src={photo.thumb} loading="lazy" />
                        </button>
                      ))}
                    </div>
                    <small className="photo-credit">
                      Free photos from {stockOn}. Tap one to use it.
                    </small>
                  </>
                )}
                {picker === 'library' && (
                  <div className="photo-grid">
                    {library.map((photoId) => (
                      <button
                        key={photoId}
                        disabled={!!busy || blocked}
                        onClick={() => void choosePhoto({ library: photoId })}
                      >
                        <img alt="Brand photo" src={`/api/assets/${photoId}`} loading="lazy" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </details>
          )}
          {base.data.script.credit && (
            <small className="photo-credit">
              Photo by{' '}
              <a href={base.data.script.credit.photoUrl} target="_blank" rel="noreferrer">
                {base.data.script.credit.name}
              </a>
            </small>
          )}
          <details className="story-tool">
            <summary>
              <Clapperboard size={16} />
              <span>
                Video story
                <small>Save as an 8-second video</small>
              </span>
            </summary>
            <StoryVideo versionId={base.id} approved={approved && !dirty} notify={notify} />
          </details>
          {dirty && (
            <small className="muted center">
              Save your changes before generating or approving.
            </small>
          )}
        </section>
        <aside className="version-panel">
          <div className="surface">
            <div className="panel-title">
              <h3>
                <Clock3 size={16} />
                Version history
              </h3>
              <p>Every saved change stays here.</p>
            </div>
            <div className="versions">
              {versions.map((v) => (
                <div className={`version-entry ${v.id === base.id ? 'current' : ''}`} key={v.id}>
                  <div>
                    <strong>Version {v.revision}</strong>
                    {v.id === base.id ? (
                      <span className="tiny-tag">CURRENT</span>
                    ) : v.approvedAt ? (
                      <Check size={14} />
                    ) : null}
                  </div>
                  <p>{formatTime(v.createdAt)}</p>
                  {v.approvedAt && <small>Approved by {v.reviewer}</small>}
                  {v.id !== base.id && (
                    <>
                      <a
                        className="text-button"
                        href={`/api/stories/${story.id}/preview?version=${v.id}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        View saved version
                        <ArrowRightIcon />
                      </a>
                      <Button variant="ghost" disabled={blocked} onClick={() => void restore(v.id)}>
                        <RotateCcw size={12} />
                        Restore as draft
                      </Button>
                      {v.approvedAt && (
                        <a className="text-button" href={`/api/export/${v.id}`}>
                          <Download size={12} />
                          Download approved
                        </a>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
          <div className="editor-note">
            <ShieldCheck size={19} />
            <h4>Your approval is specific.</h4>
            <p>
              Editing an approved story creates a new draft. Earlier approved versions stay
              available.
            </p>
          </div>
          <details className="prompt-details">
            <summary>Generation details</summary>
            <p>
              Provider: {base.data.provider === 'live' ? 'Claude + OpenAI' : 'demo'}
              <br />
              Seed: {base.data.seed}
            </p>
            <p>{base.data.prompt}</p>
            <p>
              Sources:{' '}
              {base.data.script.sources.length
                ? base.data.script.sources.map((url) => (
                    <a key={url} href={url} target="_blank" rel="noreferrer">
                      {url}{' '}
                    </a>
                  ))
                : 'Approved project brief only.'}
            </p>
            {base.data.script.review && (
              <p>
                Review by {base.data.script.review.reviewer}:{' '}
                {base.data.script.review.passed
                  ? 'passed'
                  : base.data.script.review.revised
                    ? 'revised by Claude after these notes'
                    : 'flagged'}
                {base.data.script.review.notes.map((note) => (
                  <span key={note}>
                    <br />· {note}
                  </span>
                ))}
              </p>
            )}
          </details>
        </aside>
      </div>
    </>
  );
}
function ArrowRightIcon() {
  return <span aria-hidden="true">↗</span>;
}
