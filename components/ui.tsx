'use client';
import { useEffect, useRef, type ReactNode } from 'react';
import { X, LoaderCircle, ArrowUpRight } from 'lucide-react';
export function Button({
  children,
  variant = 'primary',
  busy = false,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  busy?: boolean;
}) {
  return (
    <button
      {...props}
      className={`btn ${variant} ${props.className || ''}`}
      disabled={props.disabled || busy}
    >
      {busy && <LoaderCircle className="spin" size={15} />}
      {children}
    </button>
  );
}
export function Badge({ status }: { status: string }) {
  return (
    <span className={`badge ${status}`}>
      <i />
      {status === 'draft' ? 'Needs review' : status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}
export function Modal({
  title,
  description,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const root = dialog.current;
    const candidates = () =>
      Array.from(
        root?.querySelectorAll<HTMLElement>(
          'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href]',
        ) || [],
      );
    (root?.querySelector<HTMLElement>('input,textarea,select') || candidates()[0])?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const elements = candidates();
      const first = elements[0],
        last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    root?.addEventListener('keydown', trap);
    return () => {
      root?.removeEventListener('keydown', trap);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <section
        ref={dialog}
        className={`modal ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-heading">
          <div>
            <h2>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close dialog">
            <X size={20} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
export function Field({
  label,
  hint,
  group,
  children,
}: {
  label: string;
  hint?: string;
  // A set of buttons is not one form control, so it gets a named group instead of a label.
  group?: boolean;
  children: ReactNode;
}) {
  const body = (
    <>
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </>
  );
  return group ? (
    <div className="field" role="group" aria-label={label}>
      {body}
    </div>
  ) : (
    <label className="field">{body}</label>
  );
}
export function Empty({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <ArrowUpRight size={26} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export async function api<T = Record<string, unknown>>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || 'Something went wrong.') as Error & { status: number };
    error.status = response.status;
    throw error;
  }
  return data;
}
// Times show in the workspace time zone (Settings > Automation), set once the state loads.
let displayZone = 'America/Los_Angeles';
export function setDisplayTimeZone(zone: string) {
  displayZone = zone;
}
// The abbreviation for the workspace zone, such as "GMT+4" or "PDT".
export const zoneLabel = () =>
  new Date()
    .toLocaleString('en-US', { timeZone: displayZone, timeZoneName: 'short' })
    .split(' ')
    .pop();
// "08:00" as "8:00 AM", read as a wall-clock time in the workspace zone.
export const formatClock = (time: string) => {
  const [h, m] = time.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
export const formatDate = (value: string, options?: Intl.DateTimeFormatOptions) =>
  // Business dates (YYYY-MM-DD) are calendar days already, so they are shown without a zone shift.
  value.length === 10
    ? new Date(value + 'T12:00:00Z').toLocaleDateString('en-US', {
        timeZone: 'UTC',
        month: 'short',
        day: 'numeric',
        ...options,
      })
    : new Date(value).toLocaleDateString('en-US', {
        timeZone: displayZone,
        month: 'short',
        day: 'numeric',
        ...options,
      });
// Compact time for small cards; the zone is shown elsewhere on the page.
export const formatShortTime = (value: string) =>
  new Date(value).toLocaleString('en-US', {
    timeZone: displayZone,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
export const formatTime = (value: string) =>
  new Date(value).toLocaleString('en-US', {
    timeZone: displayZone,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
