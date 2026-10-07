'use client';
import { useState, useEffect } from 'react';
import {
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
} from 'lucide-react';
import type { Layer, Layout, Story, Version } from '@/lib/types';
import { api, Button, Badge, Field, formatTime } from './ui';
import type { Command } from './workspace';
type Feedback = {
  id: string;
  text: string;
  target: string;
  applied: number;
  reviewer: string;
  createdAt: string;
};
export default function StoryEditor({
  story,
  command,
  notify,
  onDirty,
  onBack,
}: {
  story: Story;
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
  async function revise(kind: 'image' | 'idea') {
    setBusy(kind);
    try {
      const version = await command<Version>('revise', {
        storyId: story.id,
        expected: base.id,
        kind,
      });
      accept(version);
      notify(
        kind === 'image'
          ? 'New sample artwork saved. Your script was retained.'
          : 'A new topic, script, and artwork were saved.',
      );
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
            <a
              className={`btn primary ${dirty ? 'disabled' : ''}`}
              href={dirty ? undefined : `/api/export/${base.id}`}
              aria-disabled={dirty}
            >
              <Download size={15} />
              Download PNG
            </a>
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
                {(['headline', 'body', 'cta', 'contact'] as const).map((key) => (
                  <Field
                    key={key}
                    label={
                      {
                        headline: 'Headline',
                        body: 'Body copy',
                        cta: 'Call to action',
                        contact: 'Contact details',
                      }[key]
                    }
                  >
                    <textarea
                      rows={key === 'body' ? 5 : key === 'headline' ? 3 : 2}
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
                  Use verified project facts. Contact details stay editable and can be hidden.
                </div>
              </>
            )}
            {tab === 'Design' && (
              <>
                <div className="panel-title">
                  <h3>Every layer, your way.</h3>
                  <p>Position values use a 1080 × 1920 canvas.</p>
                </div>
                <Field label="Selected layer">
                  <select
                    value={selectedLayer}
                    onChange={(e) => setSelectedLayer(e.target.value as keyof Layout)}
                  >
                    {['headline', 'body', 'cta', 'contact', 'logo'].map((key) => (
                      <option key={key} value={key}>
                        {key.charAt(0).toUpperCase() + key.slice(1)}
                      </option>
                    ))}
                  </select>
                </Field>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={selected.visible}
                    onChange={(e) => update(selectedLayer, { visible: e.target.checked })}
                  />
                  Show this layer
                </label>
                {selectedLayer !== 'logo' && (
                  <>
                    <Field label="Font">
                      <select
                        value={(selected as Layer).font}
                        onChange={(e) =>
                          update(selectedLayer, { font: e.target.value as 'Inter' | 'Lora' })
                        }
                      >
                        <option>Inter</option>
                        <option>Lora</option>
                      </select>
                    </Field>
                    <div className="form-grid">
                      <Field label="Font size">
                        <input
                          type="number"
                          min={12}
                          max={180}
                          value={(selected as Layer).size}
                          onChange={(e) => update(selectedLayer, { size: Number(e.target.value) })}
                        />
                      </Field>
                      <Field label="Text color">
                        <input
                          type="color"
                          value={(selected as Layer).color}
                          onChange={(e) => update(selectedLayer, { color: e.target.value })}
                        />
                      </Field>
                    </div>
                    <Field label="Alignment">
                      <div className="alignment-control">
                        {[
                          { value: 'left', icon: AlignLeft },
                          { value: 'center', icon: AlignCenter },
                          { value: 'right', icon: AlignRight },
                        ].map((a) => (
                          <button
                            aria-label={`Align ${a.value}`}
                            key={a.value}
                            className={(selected as Layer).align === a.value ? 'active' : ''}
                            onClick={() =>
                              update(selectedLayer, { align: a.value as Layer['align'] })
                            }
                          >
                            <a.icon size={17} />
                          </button>
                        ))}
                      </div>
                    </Field>
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
              src={preview || `/api/stories/${story.id}/preview?version=${base.id}`}
            />
            {safeArea && <div className="safe-area" />}
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
          <div className="artwork-actions">
            <Button
              variant="secondary"
              busy={busy === 'image'}
              disabled={blocked}
              onClick={() => void revise('image')}
            >
              <RefreshCw size={15} />
              Regenerate image
            </Button>
            <Button
              variant="secondary"
              busy={busy === 'idea'}
              disabled={blocked}
              onClick={() => void revise('idea')}
            >
              <Sparkles size={15} />
              New idea
            </Button>
          </div>
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
