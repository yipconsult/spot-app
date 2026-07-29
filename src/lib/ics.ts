/**
 * Generate a valid .ics (iCalendar) file content string.
 * Pure JS — no dependencies. Compatible with iOS Calendar, Google Calendar, Outlook.
 */
export interface ICSEvent {
  title: string;
  description?: string;
  location?: string;
  startDate: Date;
  endDate?: Date; // defaults to startDate + 2 hours
}

function formatICSDate(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return (
    date.getUTCFullYear().toString() +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    'T' +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    'Z'
  );
}

function escapeICS(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

export function generateICS(event: ICSEvent): string {
  const now = formatICSDate(new Date());
  const start = formatICSDate(event.startDate);
  const end = formatICSDate(event.endDate || new Date(event.startDate.getTime() + 2 * 60 * 60 * 1000));
  const uid = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}@spot`;

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Spot App//spot//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `DTSTAMP:${now}`,
    `SUMMARY:${escapeICS(event.title)}`,
    event.description ? `DESCRIPTION:${escapeICS(event.description)}` : '',
    event.location ? `LOCATION:${escapeICS(event.location)}` : '',
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return lines.filter(Boolean).join('\r\n');
}

/**
 * Generate .ics for a saved spot to add to calendar as a planned visit.
 */
export function generateSpotICS(
  spotName: string,
  address: string | null,
  plannedDate: Date,
  notes?: string
): string {
  return generateICS({
    title: `🍽️ ${spotName}`,
    description: notes || `Visit ${spotName}`,
    location: address || undefined,
    startDate: plannedDate,
  });
}
