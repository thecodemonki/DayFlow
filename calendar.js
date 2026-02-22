// ─── CALENDAR API ───────────────────────────────────────────────

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

/**
 * Get an OAuth token via chrome.identity (will prompt sign-in if needed).
 * Returns the token string or throws on failure.
 */
export async function getAuthToken(interactive = true) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(chrome.runtime.lastError?.message || 'Auth failed');
      } else {
        resolve(token);
      }
    });
  });
}

/**
 * Remove cached token and re-auth (useful if token expires).
 */
export async function refreshToken() {
  return new Promise((resolve) => {
    chrome.identity.getAuthToken({ interactive: false }, (token) => {
      if (token) {
        chrome.identity.removeCachedAuthToken({ token }, () => resolve());
      } else {
        resolve();
      }
    });
  });
}

/**
 * Fetch today's calendar events, sorted by start time.
 * Only returns events from 12 hours ago to end of today.
 */
export async function fetchTodayEvents(token) {
  const now   = new Date();
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const end   = new Date(now); end.setHours(23, 59, 59, 999);

  const params = new URLSearchParams({
    calendarId:   'primary',
    timeMin:      start.toISOString(),
    timeMax:      end.toISOString(),
    singleEvents: 'true',
    orderBy:      'startTime',
    maxResults:   '20',
  });

  const res = await fetch(`${CALENDAR_API}/calendars/primary/events?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 401) {
    // Token expired — caller should refresh and retry
    throw new Error('UNAUTHORIZED');
  }

  if (!res.ok) throw new Error(`Calendar API error: ${res.status}`);

  const data = await res.json();
  return (data.items || []).map(normalizeEvent).filter(Boolean);
}

/**
 * Normalise a raw Google Calendar event into a simple object.
 * Filters out all-day events (no dateTime).
 */
function normalizeEvent(raw) {
  const startDT = raw.start?.dateTime;
  const endDT   = raw.end?.dateTime;
  if (!startDT || !endDT) return null; // skip all-day events

  return {
    id:          raw.id,
    title:       raw.summary || '(no title)',
    start:       new Date(startDT),
    end:         new Date(endDT),
    color:       raw.colorId || null,
    description: raw.description || '',
    location:    raw.location || '',
  };
}

/**
 * Given a sorted list of events and the current time,
 * returns { current, next, upcoming } where:
 *   current  = the event happening right now (or null)
 *   next     = the very next event after now (or after current)
 *   upcoming = all future events after next
 */
export function classifyEvents(events, now = new Date()) {
  const current  = events.find(e => e.start <= now && e.end > now) || null;
  const future   = events.filter(e => e.start > now);
  const next     = future[0] || null;
  const upcoming = future.slice(1);
  const past     = events.filter(e => e.end <= now);

  return { current, next, upcoming, past };
}

/**
 * Compute how far through an event we are (0–100).
 */
export function eventProgress(event, now = new Date()) {
  const total   = event.end - event.start;
  const elapsed = now - event.start;
  return Math.min(100, Math.max(0, (elapsed / total) * 100));
}

/**
 * Format a Date as "3:00 pm"
 */
export function fmtTime(date) {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toLowerCase();
}

/**
 * Format a time range as "3:00 – 4:30 pm"
 */
export function fmtRange(start, end) {
  const s = start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toLowerCase();
  const e = end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toLowerCase();
  // Remove duplicate am/pm from start if same period
  const sCleaned = s.replace(/ ?[ap]m$/, '');
  return `${sCleaned} – ${e}`;
}

/**
 * Minutes until a Date from now.
 */
export function minutesUntil(date, now = new Date()) {
  return Math.max(0, Math.round((date - now) / 60000));
}

/**
 * Minutes remaining in an event.
 */
export function minutesLeft(event, now = new Date()) {
  return Math.max(0, Math.round((event.end - now) / 60000));
}

/**
 * Pick an emoji for an event based on keywords in the title.
 */
export function eventEmoji(title) {
  const t = title.toLowerCase();
  if (/math|calculus|algebra|geometry|stats/i.test(t))    return '📐';
  if (/english|lit|reading|essay|writing|book/i.test(t))  return '📖';
  if (/science|physics|chem|bio/i.test(t))                return '🔬';
  if (/history|geo|social/i.test(t))                      return '🌍';
  if (/music|guitar|piano|practice/i.test(t))             return '🎵';
  if (/gym|workout|run|yoga|exercise/i.test(t))           return '🏃';
  if (/lunch|dinner|breakfast|eat|food/i.test(t))         return '🍽️';
  if (/meeting|call|zoom|standup/i.test(t))               return '📞';
  if (/review|study|notes|homework|hw/i.test(t))          return '📝';
  if (/code|dev|build|design/i.test(t))                   return '💻';
  if (/sleep|nap|rest/i.test(t))                          return '😴';
  return '✦';
}
