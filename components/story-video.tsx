'use client';
import { useEffect, useRef, useState } from 'react';
import { Clapperboard, Download, Share } from 'lucide-react';
import { Button } from './ui';

const MOTIONS = [
  { id: 'zoom-in', label: 'Zoom in' },
  { id: 'zoom-out', label: 'Zoom out' },
  { id: 'pan', label: 'Pan' },
] as const;

async function fetchVideo(versionId: string, motion: string) {
  const response = await fetch(`/api/export/${versionId}/video?motion=${motion}`);
  if (!response.ok) throw new Error((await response.json()).error);
  const name =
    response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] ||
    `story-${versionId}.mp4`;
  return new File([await response.blob()], name, { type: 'video/mp4' });
}
const canShare = (file: File) => {
  try {
    return !!navigator.canShare?.({ files: [file] });
  } catch {
    return false;
  }
};

// Approved stories can also be saved as an 8-second MP4 with a slow camera move.
export default function StoryVideo({
  versionId,
  approved,
  notify,
}: {
  versionId: string;
  approved: boolean;
  notify: (message: string) => void;
}) {
  const [motion, setMotion] = useState<string>('zoom-in');
  const [busy, setBusy] = useState(false);
  const [video, setVideo] = useState<{ file: File; url: string; motion: string } | null>(null);
  const urlRef = useRef('');
  useEffect(() => () => URL.revokeObjectURL(urlRef.current), []);
  useEffect(() => setVideo(null), [versionId]);

  async function make() {
    setBusy(true);
    try {
      const file = await fetchVideo(versionId, motion);
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = URL.createObjectURL(file);
      setVideo({ file, url: urlRef.current, motion });
    } catch (error) {
      notify((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  // A fresh tap shares the file already made, so Safari allows the share sheet ("Save Video").
  async function save() {
    if (!video) return;
    if (canShare(video.file)) {
      try {
        await navigator.share({ files: [video.file] });
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
        <small>Approve this version to also save it as a short video.</small>
      </div>
    );
  const ready = video?.motion === motion;
  const share = !!video && canShare(video.file);
  return (
    <div className="video-box">
      <small>The photo moves slowly and the text fades in. Pick a motion:</small>
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
      {ready ? (
        <>
          <video src={video.url} autoPlay muted loop playsInline />
          <Button onClick={() => void save()}>
            {share ? <Share size={15} /> : <Download size={15} />}
            {share ? 'Save video to Photos' : 'Download video'}
          </Button>
        </>
      ) : (
        <Button variant="secondary" busy={busy} onClick={() => void make()}>
          <Clapperboard size={15} />
          {busy ? 'Making video…' : 'Make video'}
        </Button>
      )}
    </div>
  );
}
