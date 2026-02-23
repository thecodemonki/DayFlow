// ─── DAYFLOW — popup.js ──────────────────────────────────────────

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

// ─── CALENDAR HELPERS ────────────────────────────────────────────

function getAuthToken(interactive = true) {
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

function refreshToken() {
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

async function fetchTodayEvents(token) {
  const now   = new Date();
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const end   = new Date(now); end.setHours(23, 59, 59, 999);

  const params = new URLSearchParams({
    timeMin:      start.toISOString(),
    timeMax:      end.toISOString(),
    singleEvents: 'true',
    orderBy:      'startTime',
    maxResults:   '20',
  });

  const res = await fetch(`${CALENDAR_API}/calendars/primary/events?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 401) throw new Error('UNAUTHORIZED');
  if (!res.ok) throw new Error(`Calendar API error: ${res.status}`);

  const data = await res.json();
  return (data.items || []).map(normalizeEvent).filter(Boolean);
}

function normalizeEvent(raw) {
  const startDT = raw.start?.dateTime;
  const endDT   = raw.end?.dateTime;
  if (!startDT || !endDT) return null;
  return {
    id:    raw.id,
    title: raw.summary || '(no title)',
    start: new Date(startDT),
    end:   new Date(endDT),
  };
}

function classifyEvents(events, now = new Date()) {
  const current  = events.find(e => e.start <= now && e.end > now) || null;
  const future   = events.filter(e => e.start > now);
  const next     = future[0] || null;
  const upcoming = future.slice(1);
  const past     = events.filter(e => e.end <= now);
  return { current, next, upcoming, past };
}

function eventProgress(event, now = new Date()) {
  const total   = event.end - event.start;
  const elapsed = now - event.start;
  return Math.min(100, Math.max(0, (elapsed / total) * 100));
}

function fmtRange(start, end) {
  const s = start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toLowerCase();
  const e = end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toLowerCase();
  return `${s.replace(/ ?[ap]m$/, '')} – ${e}`;
}

function minutesUntil(date, now = new Date()) {
  return Math.max(0, Math.round((date - now) / 60000));
}

function minutesLeft(event, now = new Date()) {
  return Math.max(0, Math.round((event.end - now) / 60000));
}

function eventEmoji(title) {
  const t = title.toLowerCase();
  if (/math|calculus|algebra|geometry|stats/i.test(t))   return '📐';
  if (/english|lit|reading|essay|writing|book/i.test(t)) return '📖';
  if (/science|physics|chem|bio/i.test(t))               return '🔬';
  if (/history|geo|social/i.test(t))                     return '🌍';
  if (/music|guitar|piano|practice/i.test(t))            return '🎵';
  if (/gym|workout|run|yoga|exercise/i.test(t))          return '🏃';
  if (/lunch|dinner|breakfast|eat|food/i.test(t))        return '🍽️';
  if (/meeting|call|zoom|standup/i.test(t))              return '📞';
  if (/review|study|notes|homework|hw/i.test(t))         return '📝';
  if (/code|dev|build|design/i.test(t))                  return '💻';
  if (/sleep|nap|rest/i.test(t))                         return '😴';
  return '✦';
}

// ─── PERSISTENCE ─────────────────────────────────────────────────

// Returns today's date as a "YYYY-MM-DD" key
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// Load set of manually-completed event IDs for today
async function loadCompletedIds() {
  return new Promise((resolve) => {
    const key = `completed_${todayKey()}`;
    chrome.storage.local.get([key], (result) => {
      resolve(new Set(result[key] || []));
    });
  });
}

// Save a newly completed event ID
async function saveCompletedId(eventId) {
  const key = `completed_${todayKey()}`;
  const existing = await loadCompletedIds();
  existing.add(eventId);
  return new Promise((resolve) => {
    chrome.storage.local.set({ [key]: [...existing] }, resolve);
  });
}

// Remove a completed event ID (undo)
async function removeCompletedId(eventId) {
  const key = `completed_${todayKey()}`;
  const existing = await loadCompletedIds();
  existing.delete(eventId);
  return new Promise((resolve) => {
    chrome.storage.local.set({ [key]: [...existing] }, resolve);
  });
}

// ─── STREAK ──────────────────────────────────────────────────────

async function getStreak() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['streak', 'streakLastDate'], (result) => {
      const streak       = result.streak || 1;
      const lastDate     = result.streakLastDate || todayKey();
      resolve({ streak, lastDate });
    });
  });
}

async function updateStreak() {
  const { streak, lastDate } = await getStreak();
  const today = todayKey();
  if (lastDate === today) return streak; // already updated today

  // Check if lastDate was yesterday
  const last = new Date(lastDate);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yKey = `${yesterday.getFullYear()}-${String(yesterday.getMonth()+1).padStart(2,'0')}-${String(yesterday.getDate()).padStart(2,'0')}`;

  const newStreak = lastDate === yKey ? streak + 1 : 1;

  return new Promise((resolve) => {
    chrome.storage.local.set({ streak: newStreak, streakLastDate: today }, () => resolve(newStreak));
  });
}

// ─── STATE ───────────────────────────────────────────────────────

let events       = [];
let classified   = { current: null, next: null, upcoming: [], past: [] };
let completedIds = new Set();
let drawerOpen   = false;
let tickInterval = null;

// ─── INIT ────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  setDate();
  showLoading(true);

  // Load streak
  const streak = await updateStreak();
  const pill = document.getElementById('streakPill');
  if (streak > 1) {
    pill.textContent = `🔥 ${streak} day streak`;
  } else {
    pill.textContent = '🌸 day 1';
  }

  try {
    const token = await getAuthToken(true);
    await loadAndRender(token);
  } catch (err) {
    showError(err?.toString?.().includes('Auth') ? 'sign-in' : 'general');
  }

  document.getElementById('expandBtn').addEventListener('click', toggleDrawer);
  document.getElementById('completeBtn').addEventListener('click', onMarkComplete);
  document.getElementById('signInBtn')?.addEventListener('click', async () => {
    hideError();
    showLoading(true);
    try {
      const token = await getAuthToken(true);
      await loadAndRender(token);
    } catch (e) {
      showError('sign-in');
    }
  });
});

// ─── LOAD & RENDER ───────────────────────────────────────────────

async function loadAndRender(token) {
  try {
    events = await fetchTodayEvents(token);
  } catch (err) {
    if (err.message === 'UNAUTHORIZED') {
      await refreshToken();
      const newToken = await getAuthToken(false);
      events = await fetchTodayEvents(newToken);
    } else throw err;
  }

  // Load persisted completed IDs
  completedIds = await loadCompletedIds();

  // Apply persisted completions to event objects
  applyCompletedIds();

  showLoading(false);
  render();

  if (tickInterval) clearInterval(tickInterval);
  tickInterval = setInterval(async () => {
    completedIds = await loadCompletedIds();
    applyCompletedIds();
    render();
  }, 30_000);
}

// Override event end times for manually completed events
function applyCompletedIds() {
  const now = new Date();
  events.forEach(e => {
    if (completedIds.has(e.id) && e.end > now) {
      e._manuallyCompleted = true;
      e.end = new Date(Math.min(e.end.getTime(), now.getTime()));
    }
  });
}

// ─── RENDER ──────────────────────────────────────────────────────

function render() {
  const now = new Date();
  classified = classifyEvents(events, now);

  renderDayProgress(now);
  renderNow(classified.current, now);
  renderNext(classified.next, now);
  renderDrawer(classified);

  const total  = events.length;
  const shown  = (classified.current ? 1 : 0) + (classified.next ? 1 : 0);
  const hidden = total - shown;
  const expandBtn = document.getElementById('expandBtn');

  if (total === 0) {
    expandBtn.style.display = 'none';
  } else if (hidden <= 0 && !drawerOpen) {
    expandBtn.style.display = 'none';
  } else {
    expandBtn.style.display = 'flex';
    document.getElementById('expandLabel').textContent = drawerOpen
      ? 'hide schedule'
      : `${hidden > 0 ? hidden + ' more task' + (hidden !== 1 ? 's' : '') : 'see full schedule'} today`;
  }
}

function renderDayProgress(now) {
  const mins = now.getHours() * 60 + now.getMinutes();
  const pct  = Math.min(100, Math.max(0, (mins / 1440) * 100));
  document.getElementById('arcFill').style.width = pct + '%';
  document.getElementById('dayPct').textContent  = Math.round(pct) + '%';

  const h = now.getHours();
  let orb = '🌙';
  if (h >= 5  && h < 7)  orb = '🌅';
  if (h >= 7  && h < 11) orb = '☀️';
  if (h >= 11 && h < 14) orb = '🌤️';
  if (h >= 14 && h < 17) orb = '🌇';
  if (h >= 17 && h < 20) orb = '🌆';
  if (h >= 20 && h < 23) orb = '🌃';
  document.querySelector('.arc-orb').textContent = orb;
}

function renderNow(current, now) {
  const card = document.getElementById('nowCard');

  if (!current) {
    card.classList.add('idle');
    document.getElementById('nowTitle').textContent   = 'No event right now';
    document.getElementById('nowTime').textContent    = 'Enjoy the free time ✦';
    document.getElementById('questFill').style.width  = '0%';
    document.getElementById('minLeft').textContent    = '';
    document.getElementById('completeBtn').style.display = 'none';
    return;
  }

  card.classList.remove('idle');
  document.getElementById('nowTitle').textContent   = current.title;
  document.getElementById('nowTime').textContent    = fmtRange(current.start, current.end);
  document.getElementById('questFill').style.width = eventProgress(current, now) + '%';
  document.getElementById('minLeft').textContent   = minutesLeft(current, now) + ' min left';
  document.getElementById('completeBtn').style.display = '';
  document.getElementById('completeBtn').disabled  = false;
}

function renderNext(next, now) {
  const card = document.getElementById('nextCard');
  if (!next) { card.style.display = 'none'; return; }

  card.style.display = 'flex';
  document.getElementById('nextIcon').textContent = eventEmoji(next.title);
  document.getElementById('nextName').textContent = next.title;
  document.getElementById('nextTime').textContent = fmtRange(next.start, next.end);

  const mins = minutesUntil(next.start, now);
  document.getElementById('nextEta').textContent =
    mins < 60 ? `in ${mins}m` : `in ${Math.round(mins / 60)}h`;
}

function renderDrawer({ past, current, next, upcoming }) {
  const container = document.getElementById('drawerList');
  container.innerHTML = '';
  const now = new Date();
  const all = [...past, ...(current ? [current] : []), ...(next ? [next] : []), ...upcoming];

  if (all.length === 0) {
    container.innerHTML = `<div class="drawer-empty">No events today ✦</div>`;
    return;
  }

  all.forEach(event => {
    const isDone    = event.end <= now;
    const isCurrent = current && event.id === current.id;
    const isNext    = next    && event.id === next.id;

    const row   = document.createElement('div');
    row.className = 'task-row' + (isDone ? ' done-row' : '');

    const check = document.createElement('div');
    check.className = 't-check ' + (isDone ? 'checked' : isCurrent ? 'current' : 'empty');
    check.textContent = isDone ? '✓' : '';

    // Allow clicking check to toggle manual completion
    if (isCurrent) {
      check.style.cursor = 'pointer';
      check.title = 'Mark complete';
      check.addEventListener('click', (e) => {
        e.stopPropagation();
        onMarkComplete();
      });
    } else if (isDone && completedIds.has(event.id)) {
      check.style.cursor = 'pointer';
      check.title = 'Undo completion';
      check.addEventListener('click', async (e) => {
        e.stopPropagation();
        await removeCompletedId(event.id);
        completedIds = await loadCompletedIds();
        // Restore original end time by re-fetching — simplest approach: reload
        const token = await getAuthToken(false);
        await loadAndRender(token);
      });
    }

    const info = document.createElement('div');
    info.className = 't-info';
    info.innerHTML = `<div class="t-name">${event.title}</div><div class="t-time">${fmtRange(event.start, event.end)}</div>`;

    const tag = document.createElement('div');
    tag.className = 't-tag';
    tag.textContent = isCurrent ? 'now' : isNext ? 'next' : '';

    row.append(check, info, tag);
    container.appendChild(row);
  });
}

// ─── TOGGLE DRAWER ───────────────────────────────────────────────

function toggleDrawer() {
  drawerOpen = !drawerOpen;
  document.getElementById('taskDrawer').classList.toggle('open', drawerOpen);
  document.getElementById('expandArrow').classList.toggle('open', drawerOpen);
  render();
}

// ─── MARK COMPLETE ───────────────────────────────────────────────

async function onMarkComplete() {
  if (!classified.current) return;
  const event = classified.current;

  // Persist to storage
  await saveCompletedId(event.id);
  completedIds.add(event.id);

  // Optimistically end the event now
  event._manuallyCompleted = true;
  event.end = new Date();

  // Flash animation
  const flash = document.getElementById('flash');
  const pop   = document.getElementById('xpFloat');
  flash.classList.remove('pop'); void flash.offsetWidth; flash.classList.add('pop');
  pop.classList.remove('pop');   void pop.offsetWidth;   pop.classList.add('pop');

  render();
}

// ─── UTILS ───────────────────────────────────────────────────────

function setDate() {
  const months   = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const now = new Date();
  document.getElementById('dateLabel').textContent =
    dayNames[now.getDay()] + ', ' + months[now.getMonth()] + ' ' + now.getDate();
}

function showLoading(show) {
  document.getElementById('loadingState').style.display = show ? 'flex' : 'none';
  document.getElementById('mainContent').style.display  = show ? 'none' : 'block';
}

function showError(type) {
  showLoading(false);
  document.getElementById('errorState').style.display  = 'flex';
  document.getElementById('mainContent').style.display = 'none';
  document.getElementById('errorMsg').textContent =
    type === 'sign-in'
      ? 'Connect your Google Calendar to get started.'
      : 'Something went wrong loading your calendar.';
  document.getElementById('signInBtn').style.display = type === 'sign-in' ? '' : 'none';
}

function hideError() {
  document.getElementById('errorState').style.display = 'none';
}