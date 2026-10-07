export const TIME_ZONE = 'America/Los_Angeles';
export function businessDate(at: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}
export function localHour(at: Date) {
  return Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: TIME_ZONE,
      hour: 'numeric',
      hourCycle: 'h23',
    }).format(at),
  );
}
export function daysBefore(date: string, days: number) {
  const result = new Date(`${date}T12:00:00Z`);
  result.setUTCDate(result.getUTCDate() - days);
  return result.toISOString().slice(0, 10);
}
export function eightAM(date: string) {
  const base = new Date(`${date}T08:00:00Z`);
  for (let hour = 6; hour <= 9; hour++) {
    const candidate = new Date(base.getTime() + hour * 3600000);
    if (businessDate(candidate) === date && localHour(candidate) === 8) return candidate;
  }
  throw new Error('Cannot resolve Los Angeles schedule');
}
export function nextRun(at: Date) {
  const today = businessDate(at);
  const next = eightAM(today);
  if (next > at) return next.toISOString();
  const tomorrow = new Date(`${today}T12:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  return eightAM(tomorrow.toISOString().slice(0, 10)).toISOString();
}
