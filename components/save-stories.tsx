'use client';
import { useEffect, useState } from 'react';
import { Download, Share } from 'lucide-react';
import { Button } from './ui';

// Phones get the system share sheet, whose "Save Image" puts PNGs straight into Photos
// (and can hand them to Instagram). Desktops keep ordinary downloads.
function supportsFileShare() {
  try {
    const probe = new File([new Uint8Array(1)], 'probe.png', { type: 'image/png' });
    return !!navigator.canShare?.({ files: [probe] });
  } catch {
    return false;
  }
}
async function fetchStory(versionId: string) {
  const response = await fetch(`/api/export/${versionId}`);
  if (!response.ok) throw new Error((await response.json()).error);
  const name =
    response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] ||
    `story-${versionId}.png`;
  return new File([await response.blob()], name, { type: 'image/png' });
}
export default function SaveStories({
  versionIds,
  variant = 'primary',
  small = false,
  disabled = false,
  desktopLabel,
  onDesktop,
  notify,
}: {
  versionIds: string[];
  variant?: 'primary' | 'secondary';
  small?: boolean;
  disabled?: boolean;
  desktopLabel: string;
  // Desktop action for several stories (the ZIP download); one story downloads its PNG.
  onDesktop?: () => void;
  notify: (text: string) => void;
}) {
  const [share, setShare] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState<File[] | null>(null);
  useEffect(() => setShare(supportsFileShare()), []);
  const key = versionIds.join();
  useEffect(() => setReady(null), [key]);
  const count = versionIds.length;
  async function shareFiles(files: File[]) {
    try {
      await navigator.share({ files });
      setReady(null);
    } catch (error) {
      const name = (error as Error).name;
      // Safari needs the share to start right after a tap; preparing large files can miss
      // that window, so the next tap shares the files already prepared.
      if (name === 'NotAllowedError') setReady(files);
      else if (name !== 'AbortError') notify((error as Error).message);
    }
  }
  async function save() {
    if (ready) return void shareFiles(ready);
    setBusy(true);
    try {
      const files = await Promise.all(versionIds.map(fetchStory));
      await shareFiles(files);
    } catch (error) {
      notify((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const className = small ? 'small' : '';
  if (!share) {
    if (count === 1 && !onDesktop)
      return (
        <a
          className={`btn ${variant} ${className} ${disabled ? 'disabled' : ''}`}
          href={disabled ? undefined : `/api/export/${versionIds[0]}`}
          aria-disabled={disabled}
        >
          <Download size={small ? 14 : 15} />
          {desktopLabel}
        </a>
      );
    return (
      <Button
        variant={variant}
        className={className}
        disabled={disabled || !count}
        onClick={() => onDesktop?.()}
      >
        <Download size={small ? 14 : 15} />
        {desktopLabel}
      </Button>
    );
  }
  return (
    <Button
      variant={variant}
      className={className}
      busy={busy}
      disabled={disabled || !count}
      onClick={() => void save()}
    >
      <Share size={small ? 14 : 15} />
      {ready
        ? `Tap to save ${count === 1 ? 'image' : `${count} images`}`
        : count === 1
          ? 'Save to Photos'
          : `Save ${count} to Photos`}
    </Button>
  );
}
