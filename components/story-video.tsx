'use client';
import { useEffect, useRef, useState } from 'react';
import { Clapperboard, Download, Share, Sparkles } from 'lucide-react';
import { api, Button } from './ui';

const MOTIONS = [
  { id: 'zoom-in', label: 'Zoom in' },
  { id: 'zoom-out', label: 'Zoom out' },
  { id: 'pan', label: 'Pan' },
] as const;
type Animation = { status: 'running' | 'ready' | 'failed'; error?: string } | null;

async function fetchVideo(versionId: string, motion: string) {
  const response = await fetch(`/api/export/${versionId}/video?motion=${motion}`);
  if (!response.ok) throw new Error((await response.json()).error);
  const name =
    response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] ||
    `story-${versionId}.mp4`;
  return new File([await response.blob()], name, { type: 'video/mp4' });
}

// Approved stories can be saved as an 8-second MP4 (made here, free) or a 5-second AI video.
export default function StoryVideo({
  versionId,
  approved,
  aiVideo,
  notify,
}: {
  versionId: string;
  approved: boolean;
  aiVideo: boolean;
  notify: (message: string) => void;
}) {
  const [motion, setMotion] = useState<string>('zoom-in');
  const [busy, setBusy] = useState('');
  const [video, setVideo] = useState<{ file: File; url: string } | null>(null);
  const [prompt, setPrompt] = useState('');
  const [ai, setAi] = useState<Animation>(null);
  const urlRef = useRef('');
  const show = (file: File) => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = URL.createObjectURL(file);
    setVideo({ file, url: urlRef.current });
  };
  useEffect(() => () => URL.revokeObjectURL(urlRef.current), []);
  useEffect(() => {
    setVideo(null);
    setAi(null);
    if (approved && aiVideo)
      api<Animation>('/api/command', { action: 'animation', versionId })
        .then(setAi)
        .catch(() => {});
  }, [versionId, approved, aiVideo]);
  // Runway takes a minute or two; check on it every few seconds while it works.
  useEffect(() => {
    if (ai?.status !== 'running') return;
    const timer = setInterval(() => {
      api<Animation>('/api/command', { action: 'animation', versionId })
        .then(setAi)
        .catch((error) => notify((error as Error).message));
    }, 6000);
    return () => clearInterval(timer);
  }, [ai?.status, versionId, notify]);

  async function make(kind: string) {
    setBusy(kind);
    try {
      show(await fetchVideo(versionId, kind));
    } catch (error) {
      notify((error as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function animate() {
    setBusy('animate');
    try {
      setAi(await api<Animation>('/api/command', { action: 'animate', versionId, prompt }));
    } catch (error) {
      notify((error as Error).message);
    } finally {
      setBusy('');
    }
  }
  // A fresh tap shares the file already made, so Safari allows the share sheet ("Save Video").
  async function save() {
    if (!video) return;
    const files = [video.file];
    if (navigator.canShare?.({ files })) {
      try {
        await navigator.share({ files });
      } catch (error) {
        if ((error as Error).name !== 'AbortError') notify((error as Error).message);
      }
      return;
    }
    const link = document.createElement('a');
    link.href = video.url;
    link.download = video.file.name;
    link.click();
  }

  if (!approved)
    return (
      <div className="video-box">
        <strong>
          <Clapperboard size={15} /> Video story
        </strong>
        <small>Approve this version to save it as an animated video.</small>
      </div>
    );
  return (
    <div className="video-box">
      <strong>
        <Clapperboard size={15} /> Video story
      </strong>
      <div className="motion-chips" role="radiogroup" aria-label="Camera motion">
        {MOTIONS.map((m) => (
          <button
            key={m.id}
            role="radio"
            aria-checked={motion === m.id}
            className={motion === m.id ? 'active' : ''}
            onClick={() => setMotion(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>
      <Button
        variant="secondary"
        busy={busy === motion}
        disabled={!!busy}
        onClick={() => void make(motion)}
      >
        <Clapperboard size={15} />
        Make video
      </Button>
      {aiVideo ? (
        <div className="ai-video">
          <textarea
            aria-label="AI motion prompt"
            rows={2}
            maxLength={1000}
            value={prompt}
            disabled={!!busy || ai?.status === 'running'}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Optional motion, e.g. steam rising from the cup, slow push-in."
          />
          <Button
            variant="secondary"
            busy={busy === 'animate' || ai?.status === 'running'}
            disabled={!!busy || ai?.status === 'running'}
            onClick={() => void animate()}
          >
            <Sparkles size={15} />
            {ai?.status === 'running'
              ? 'AI is animating…'
              : ai?.status === 'ready'
                ? 'Animate again with AI'
                : 'Animate with AI'}
          </Button>
          {ai?.status === 'ready' && (
            <Button
              variant="secondary"
              busy={busy === 'ai'}
              disabled={!!busy}
              onClick={() => void make('ai')}
            >
              <Sparkles size={15} />
              Show AI video
            </Button>
          )}
          <small>
            {ai?.status === 'running'
              ? 'Runway is making a 5-second clip. This usually takes a minute or two.'
              : ai?.status === 'failed'
                ? ai.error
                : 'Runway animates the photo; your text is added on top. About $0.25 per video.'}
          </small>
        </div>
      ) : (
        <small>Add RUNWAYML_API_SECRET to also animate the photo itself with AI.</small>
      )}
      {video && (
        <>
          <video src={video.url} autoPlay muted loop playsInline controls />
          <Button onClick={() => void save()}>
            {navigator.canShare?.({ files: [video.file] }) ? (
              <Share size={15} />
            ) : (
              <Download size={15} />
            )}
            {navigator.canShare?.({ files: [video.file] })
              ? 'Save video to Photos'
              : 'Download video'}
          </Button>
        </>
      )}
    </div>
  );
}
