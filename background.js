// background.js — Dayflow service worker

// Set up a recurring alarm every minute to keep the badge fresh
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('tick', { periodInMinutes: 1 });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'tick') {
    await updateBadge();
  }
});

// Also update badge when browser starts
chrome.runtime.onStartup.addListener(updateBadge);

async function updateBadge() {
  try {
    const token = await getTokenSilent();
    if (!token) { chrome.action.setBadgeText({ text: '' }); return; }

    const events = await fetchEvents(token);
    const now = new Date();

    const current = events.find(e => new Date(e.start.dateTime) <= now && new Date(e.end.dateTime) > now);
    const next    = events.find(e => new Date(e.start.dateTime) > now);

    if (current) {
      // Show minutes left in current event
      const minsLeft = Math.round((new Date(current.end.dateTime) - now) / 60000);
      chrome.action.setBadgeText({ text: minsLeft + 'm' });
      chrome.action.setBadgeBackgroundColor({ color: '#c9b8f0' });
    } else if (next) {
      // Show countdown to next event
      const minsUntil = Math.round((new Date(next.start.dateTime) - now) / 60000);
      if (minsUntil <= 15) {
        chrome.action.setBadgeText({ text: minsUntil + 'm' });
        chrome.action.setBadgeBackgroundColor({ color: '#f5c4a8' });
        // Notify if 5 minutes away
        if (minsUntil === 5) notifyUpcoming(next.summary);
      } else {
        chrome.action.setBadgeText({ text: '' });
      }
    } else {
      chrome.action.setBadgeText({ text: '' });
    }
  } catch (e) {
    chrome.action.setBadgeText({ text: '' });
  }
}

async function getTokenSilent() {
  return new Promise((resolve) => {
    chrome.identity.getAuthToken({ interactive: false }, (token) => {
      resolve(chrome.runtime.lastError ? null : token);
    });
  });
}

async function fetchEvents(token) {
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

  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) return [];
  const data = await res.json();
  return (data.items || []).filter(e => e.start?.dateTime);
}

function notifyUpcoming(title) {
  chrome.notifications.create({
    type:    'basic',
    iconUrl: 'icons/icon48.png',
    title:   'Up next in 5 minutes',
    message: title || '(no title)',
  });
}
