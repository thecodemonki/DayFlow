// popup.js — Dayflow
// Runs inside popup.html. Handles auth, data fetching, and rendering.

import {
  getAuthToken, refreshToken, fetchTodayEvents,
  classifyEvents, eventProgress, fmtRange, minutesUntil,
  minutesLeft, eventEmoji, fmtTime
} from './calendar.js';

// ─── STATE ──────────────────────────────────────────────────────
let events    = [];
let classified = { current: null, next: null, upcoming: [], past: [] };
let drawerOpen = false;
let tickInterval = null;

// ─── INIT ────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  setDate();
  showLoading(true);

  try {
    const token = await getAuthToken(true);
    await loadAndRender(token);
  } catch (err) {
    if (err === 'UNAUTHORIZED' || err?.includes?.('Auth')) {
      showError('sign-in');
    } else {
      showError('general');
      console.error(err);
    }
  }

  // Expand/collapse button
  document.getElementById('expandBtn').addEventListener('click', toggleDrawer);

  // Mark complete button
  document.getElementById('completeBtn').addEventListener('click', onMarkComplete);

  // Sign-in button (shown if not authed)
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

  showLoading(false);
  render();

  // Re-render every 30 seconds to keep timers fresh
  if (tickInterval) clearInterval(tickInterval);
  tickInterval = setInterval(render, 30_000);
}

// ─── RENDER ──────────────────────────────────────────────────────
function render() {
  const now = new Date();
  classified = classifyEvents(events, now);

  renderDayProgress(now);
  renderNow(classified.current, now);
  renderNext(classified.next, now);
  renderDrawer(classified);

  // Update expand button count
  const futureCount = (classified.next ? 1 : 0) + classified.upcoming.length;
  const remainingAfterNext = classified.upcoming.length;
  const expandBtn = document.getElementById('expandBtn');

  if (events.length === 0) {
    expandBtn.style.display = 'none';
  } else {
    const total = classified.past.length + classified.upcoming.length +
                  (classified.current ? 1 : 0) + (classified.next ? 1 : 0);
    const shown = 1 + (classified.next ? 1 : 0); // now + next
    const hidden = total - shown;
    if (hidden <= 0) {
      expandBtn.style.display = 'none';
    } else {
      expandBtn.style.display = 'flex';
      const label = drawerOpen
        ? 'hide tasks'
        : `${hidden} more task${hidden !== 1 ? 's' : ''} today`;
      expandBtn.querySelector('#expandLabel').textContent = label;
    }
  }
}

// ─── DAY PROGRESS ────────────────────────────────────────────────
function renderDayProgress(now) {
  const mins = now.getHours() * 60 + now.getMinutes();
  // 6am = 360min, 10pm = 1320min  → 960min window
  const pct = Math.min(100, Math.max(0, ((mins - 360) / 960) * 100));
  document.getElementById('arcFill').style.width = pct + '%';
  document.getElementById('dayPct').textContent   = Math.round(pct) + '%';
}

// ─── NOW ─────────────────────────────────────────────────────────
function renderNow(current, now) {
  const card = document.getElementById('nowCard');

  if (!current) {
    // Nothing happening right now
    card.classList.add('idle');
    document.getElementById('nowTitle').textContent    = 'No event right now';
    document.getElementById('nowTime').textContent     = 'Enjoy the free time ✦';
    document.getElementById('questFill').style.width  = '0%';
    document.getElementById('minLeft').textContent    = '';
    document.getElementById('completeBtn').disabled   = true;
    document.getElementById('completeBtn').style.display = 'none';
    return;
  }

  card.classList.remove('idle');
  document.getElementById('nowTitle').textContent    = current.title;
  document.getElementById('nowTime').textContent     = fmtRange(current.start, current.end);
  document.getElementById('questFill').style.width  = eventProgress(current, now) + '%';
  document.getElementById('minLeft').textContent    = minutesLeft(current, now) + ' min left';
  document.getElementById('completeBtn').style.display = '';
  document.getElementById('completeBtn').disabled   = false;
}

// ─── NEXT ────────────────────────────────────────────────────────
function renderNext(next, now) {
  const card = document.getElementById('nextCard');

  if (!next) {
    card.style.display = 'none';
    return;
  }

  card.style.display = 'flex';
  document.getElementById('nextIcon').textContent = eventEmoji(next.title);
  document.getElementById('nextName').textContent = next.title;
  document.getElementById('nextTime').textContent = fmtRange(next.start, next.end);

  const mins = minutesUntil(next.start, now);
  document.getElementById('nextEta').textContent =
    mins < 60 ? `in ${mins}m` : `in ${Math.round(mins/60)}h`;
}

// ─── DRAWER ──────────────────────────────────────────────────────
function renderDrawer({ past, current, next, upcoming }) {
  const container = document.getElementById('drawerList');
  container.innerHTML = '';

  const allShown = [...past, ...(current ? [current] : []), ...(next ? [next] : []), ...upcoming];
  const now = new Date();

  // Show ALL tasks from today in the drawer
  allShown.forEach(event => {
    const isDone    = event.end <= now;
    const isCurrent = current && event.id === current.id;
    const isNext    = next && event.id === next.id;

    const row = document.createElement('div');
    row.className = 'task-row' + (isDone ? ' done-row' : '');

    const check = document.createElement('div');
    check.className = 't-check ' + (isDone ? 'checked' : isCurrent ? 'current' : 'empty');
    check.textContent = isDone ? '✓' : '';

    const info = document.createElement('div');
    info.className = 't-info';
    info.innerHTML = `
      <div class="t-name">${event.title}</div>
      <div class="t-time">${fmtRange(event.start, event.end)}</div>
    `;

    const tag = document.createElement('div');
    tag.className = 't-tag';
    tag.textContent = isCurrent ? 'now' : isNext ? 'next' : '';

    row.append(check, info, tag);
    container.appendChild(row);
  });

  if (allShown.length === 0) {
    container.innerHTML = `<div class="drawer-empty">No events scheduled for today</div>`;
  }
}

// ─── TOGGLE DRAWER ───────────────────────────────────────────────
function toggleDrawer() {
  drawerOpen = !drawerOpen;
  document.getElementById('taskDrawer').classList.toggle('open', drawerOpen);
  document.getElementById('expandArrow').classList.toggle('open', drawerOpen);
  // Re-trigger render to update button label
  render();
}

// ─── MARK COMPLETE ───────────────────────────────────────────────
function onMarkComplete() {
  const { current } = classified;
  if (!current) return;

  // Optimistically treat this event as ended
  current.end = new Date();

  // Flash + float
  triggerFX();

  // Re-render immediately
  render();
}

function triggerFX() {
  const flash = document.getElementById('flash');
  const xpF   = document.getElementById('xpFloat');
  flash.classList.remove('pop'); void flash.offsetWidth; flash.classList.add('pop');
  xpF.classList.remove('pop');   void xpF.offsetWidth;   xpF.classList.add('pop');
}

// ─── HELPERS ─────────────────────────────────────────────────────
function setDate() {
  const months   = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const now = new Date();
  document.getElementById('dateLabel').textContent =
    dayNames[now.getDay()] + ', ' + months[now.getMonth()] + ' ' + now.getDate();
}

function showLoading(show) {
  document.getElementById('loadingState').style.display  = show ? 'flex' : 'none';
  document.getElementById('mainContent').style.display   = show ? 'none' : 'block';
}

function showError(type) {
  showLoading(false);
  document.getElementById('errorState').style.display = 'flex';
  document.getElementById('mainContent').style.display = 'none';
  if (type === 'sign-in') {
    document.getElementById('errorMsg').textContent = 'Connect your Google Calendar to get started.';
    document.getElementById('signInBtn').style.display = '';
  } else {
    document.getElementById('errorMsg').textContent = 'Something went wrong loading your calendar.';
    document.getElementById('signInBtn').style.display = 'none';
  }
}

function hideError() {
  document.getElementById('errorState').style.display = 'none';
}
