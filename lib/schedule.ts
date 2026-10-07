import { setting } from './db';
export const DEFAULT_TIME_ZONE = process.env.TIME_ZONE || 'America/Los_Angeles';
export const DEFAULT_GENERATE_AT = '08:00';
// One workspace time zone defines business dates; each project picks its own generation time.
export const timeZone = () => setting('timeZone', DEFAULT_TIME_ZONE);
export function isTimeZone(zone: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}
export function businessDate(at: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone(),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}
function localClock(at: Date) {
  const [hour, minute] = new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone(),
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  })
    .format(at)
    .split(':')
    .map(Number);
  return { hour, minute };
}
export function localHour(at: Date) {
  return localClock(at).hour;
}
export function daysBefore(date: string, days: number) {
  const result = new Date(`${date}T12:00:00Z`);
  result.setUTCDate(result.getUTCDate() - days);
  return result.toISOString().slice(0, 10);
}
// The instant `time` (HH:MM) happens on `date` in the workspace time zone. A time skipped by a
// daylight-saving jump resolves to the first valid minute after it.
export function scheduledAt(date: string, time = DEFAULT_GENERATE_AT) {
  const [hour, minute] = time.split(':').map(Number);
  const base = Date.parse(`${date}T00:00:00Z`) + (hour * 60 + minute) * 60000;
  let fallback: Date | undefined;
  for (let offset = -15 * 60; offset <= 15 * 60; offset += 15) {
    const candidate = new Date(base + offset * 60000);
    if (businessDate(candidate) !== date) continue;
    const clock = localClock(candidate);
    if (clock.hour === hour && clock.minute === minute) return candidate;
    if (clock.hour * 60 + clock.minute > hour * 60 + minute && (!fallback || candidate < fallback))
      fallback = candidate;
  }
  if (fallback) return fallback;
  throw new Error('Cannot resolve the scheduled time');
}
export const eightAM = (date: string) => scheduledAt(date, DEFAULT_GENERATE_AT);
export function nextRun(at: Date, times: string[] = [DEFAULT_GENERATE_AT]) {
  const today = businessDate(at);
  const upcoming = [today, daysBefore(today, -1)]
    .flatMap((date) =>
      (times.length ? times : [DEFAULT_GENERATE_AT]).map((time) => scheduledAt(date, time)),
    )
    .filter((when) => when > at)
    .sort((a, b) => a.getTime() - b.getTime());
  return upcoming[0].toISOString();
}
