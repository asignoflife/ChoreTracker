export type EventVisibility = 'family' | 'parents';
export type EventStatus = 'approved' | 'suggested' | 'declined';
export type EventRecurrence = 'none' | 'daily' | 'weekly' | 'monthly';

export type CalendarEvent = {
  id: number;
  family_code: string;
  title: string;
  notes: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  visibility: EventVisibility;
  status: EventStatus;
  recurrence: EventRecurrence;
  recurrence_interval: number;
  recurrence_until: string | null;
  created_by: string | null;
  suggested_by: string | null;
  created_at: string;
};

export type Occurrence = {
  key: string;
  kind: 'event' | 'birthday';
  event: CalendarEvent;
  start: Date;
  end: Date | null;
};

export type FamilyPerson = {
  id: string;
  full_name: string;
  role: 'parent' | 'kid';
  birthday: string | null;
};

const MAX_OCCURRENCES = 400;

export function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function addMonths(date: Date, count: number) {
  return new Date(date.getFullYear(), date.getMonth() + count, 1);
}

export function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

export function addDays(date: Date, count: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + count);
  return result;
}

export function startOfWeek(date: Date) {
  const day = startOfDay(date);
  return addDays(day, -day.getDay());
}

export function endOfWeek(date: Date) {
  return addDays(startOfWeek(date), 6);
}

export function eachDay(start: Date, end: Date) {
  const days: Date[] = [];
  let cursor = startOfDay(start);
  const limit = 370;
  while (cursor.getTime() <= end.getTime() && days.length < limit) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days;
}

export function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function formatDateLabel(date: Date) {
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatWeekLabel(start: Date) {
  const end = addDays(start, 6);
  const startLabel = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const endLabel = end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `${startLabel} – ${endLabel}`;
}

// Merges a calendar day with an optional HH:MM field, keeping local time.
export function combineDateAndTime(date: Date, timeInput: string) {
  if (!timeInput.trim()) {
    return startOfDay(date);
  }
  const match = /^(\d{1,2}):(\d{2})$/.exec(timeInput.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hours, minutes);
}

export function formatMonthLabel(date: Date) {
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export function formatDayHeading(date: Date) {
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export function formatTime(date: Date) {
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export function dayKey(date: Date) {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function toDateInput(date: Date) {
  return dayKey(date);
}

export function toTimeInput(date: Date) {
  return `${`${date.getHours()}`.padStart(2, '0')}:${`${date.getMinutes()}`.padStart(2, '0')}`;
}

// Combines a YYYY-MM-DD field and an optional HH:MM field into a local Date.
export function parseDateAndTime(dateInput: string, timeInput: string) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateInput.trim());
  if (!dateMatch) return null;
  const [, year, month, day] = dateMatch;
  let hours = 0;
  let minutes = 0;
  if (timeInput.trim()) {
    const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(timeInput.trim());
    if (!timeMatch) return null;
    hours = Number(timeMatch[1]);
    minutes = Number(timeMatch[2]);
    if (hours > 23 || minutes > 59) return null;
  }
  const result = new Date(Number(year), Number(month) - 1, Number(day), hours, minutes);
  if (Number.isNaN(result.getTime()) || result.getMonth() !== Number(month) - 1 || result.getDate() !== Number(day)) {
    return null;
  }
  return result;
}

export function formatEventTime(occurrence: Occurrence) {
  if (occurrence.event.all_day) return 'All day';
  const start = formatTime(occurrence.start);
  return occurrence.end ? `${start} – ${formatTime(occurrence.end)}` : start;
}

function step(cursor: Date, event: CalendarEvent) {
  const interval = Math.max(1, Math.min(12, event.recurrence_interval || 1));
  const next = new Date(cursor);
  if (event.recurrence === 'daily') {
    next.setDate(next.getDate() + interval);
    return next;
  }
  if (event.recurrence === 'weekly') {
    next.setDate(next.getDate() + interval * 7);
    return next;
  }
  if (event.recurrence === 'monthly') {
    const day = next.getDate();
    next.setDate(1);
    next.setMonth(next.getMonth() + interval);
    const daysInMonth = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
    next.setDate(Math.min(day, daysInMonth));
    return next;
  }
  return null;
}

// Expands a stored event into the occurrences that fall inside [from, to).
export function occurrencesBetween(event: CalendarEvent, from: Date, to: Date): Occurrence[] {
  const start = new Date(event.starts_at);
  if (Number.isNaN(start.getTime())) return [];
  const until = event.recurrence_until ? new Date(`${event.recurrence_until}T23:59:59`) : null;
  const durationMs = event.ends_at ? Math.max(0, new Date(event.ends_at).getTime() - start.getTime()) : 0;
  const occurrences: Occurrence[] = [];
  let cursor = start;
  for (let count = 0; count < MAX_OCCURRENCES; count += 1) {
    if (until && cursor.getTime() > until.getTime()) break;
    if (cursor.getTime() >= to.getTime()) break;
    if (cursor.getTime() >= from.getTime()) {
      occurrences.push({
        key: `${event.id}-${cursor.toISOString()}`,
        kind: 'event',
        event,
        start: new Date(cursor),
        end: event.ends_at ? new Date(cursor.getTime() + durationMs) : null,
      });
    }
    if (event.recurrence === 'none') break;
    const next = step(cursor, event);
    if (!next || Number.isNaN(next.getTime()) || next.getTime() <= cursor.getTime()) break;
    cursor = next;
  }
  return occurrences;
}

export function expandEvents(events: CalendarEvent[], from: Date, to: Date) {
  return events
    .flatMap((event) => occurrencesBetween(event, from, to))
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

export function groupByDay(occurrences: Occurrence[]) {
  const groups: { key: string; date: Date; items: Occurrence[] }[] = [];
  for (const occurrence of occurrences) {
    const key = dayKey(occurrence.start);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(occurrence);
    else groups.push({ key, date: startOfDay(occurrence.start), items: [occurrence] });
  }
  return groups;
}

function birthdayInYear(year: number, month: number, day: number) {
  const candidate = new Date(year, month, day);
  if (candidate.getMonth() === month) return candidate;
  // February 29 has no date in common years; show it on February 28.
  return new Date(year, month, Math.max(1, day - 1));
}

// Each family member's birthday becomes a yearly calendar entry without
// storing duplicate event rows.
export function birthdayOccurrences(people: FamilyPerson[], from: Date, to: Date): Occurrence[] {
  const occurrences: Occurrence[] = [];
  for (const person of people) {
    if (!person.birthday) continue;
    const born = new Date(`${person.birthday}T00:00:00`);
    if (Number.isNaN(born.getTime())) continue;
    const month = born.getMonth();
    const day = born.getDate();
    for (let year = from.getFullYear() - 1; year <= to.getFullYear() + 1; year += 1) {
      const date = birthdayInYear(year, month, day);
      if (date.getTime() < from.getTime() || date.getTime() >= to.getTime()) continue;
      const age = year - born.getFullYear();
      occurrences.push({
        key: `birthday-${person.id}-${year}`,
        kind: 'birthday',
        start: date,
        end: null,
        event: {
          id: 0,
          family_code: '',
          title: `${person.full_name}’s birthday`,
          notes: age > 0 ? `Turns ${age}` : null,
          location: null,
          starts_at: date.toISOString(),
          ends_at: null,
          all_day: true,
          visibility: 'family',
          status: 'approved',
          recurrence: 'none',
          recurrence_interval: 1,
          recurrence_until: null,
          created_by: null,
          suggested_by: null,
          created_at: '',
        },
      });
    }
  }
  return occurrences;
}

export function describeRecurrence(event: CalendarEvent) {
  if (event.recurrence === 'none') return null;
  const interval = Math.max(1, event.recurrence_interval || 1);
  const unit = event.recurrence === 'daily' ? 'day' : event.recurrence === 'weekly' ? 'week' : 'month';
  return interval === 1 ? `Every ${unit}` : `Every ${interval} ${unit}s`;
}
