# Dayflow — Setup Guide

## What you need before loading the extension

### 1. Create a Google Cloud project

1. Go to https://console.cloud.google.com
2. Click **New Project** → name it "Dayflow" → Create
3. In the sidebar go to **APIs & Services → Library**
4. Search for **Google Calendar API** → Enable it

### 2. Set up OAuth credentials

1. Go to **APIs & Services → Credentials**
2. Click **Create Credentials → OAuth client ID**
3. Application type: **Chrome Extension**
4. You'll need your Extension ID for this step — see step 4 below first, then come back

### 3. Configure the OAuth consent screen

1. Go to **APIs & Services → OAuth consent screen**
2. Choose **External** → Create
3. Fill in App name: "Dayflow", your email, etc.
4. Scopes: add `https://www.googleapis.com/auth/calendar.events.readonly`
5. Add your Google account as a **Test user**

### 4. Load the extension in Chrome

1. Open Chrome → go to `chrome://extensions`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked** → select the `dayflow/` folder
4. Note the **Extension ID** shown (looks like `abcdefghijklmnop`)

### 5. Finish OAuth setup

1. Back in Google Cloud → Credentials → your OAuth client
2. Paste your Extension ID into the **Application ID** field
3. Copy the **Client ID** (ends in `.apps.googleusercontent.com`)
4. Open `manifest.json` in the dayflow folder
5. Replace `YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com` with your actual Client ID
6. Go back to `chrome://extensions` → click the **refresh icon** on Dayflow

### 6. Try it out

Click the Dayflow icon in your toolbar. It will ask you to sign in with Google.
Allow access → your calendar events for today will appear automatically.

---

## How it works

- **Now** shows whatever calendar event is currently active, with a progress bar
- **Up next** shows the next event and how many minutes away it is
- **Expand** slides open your full schedule for the day
- **Mark complete** ends the current event early and moves to the next
- The toolbar badge shows minutes left in your current event, or a countdown if the next event is within 15 minutes
- A notification fires 5 minutes before each event starts

## Tips

- Only **timed events** show up (all-day events are filtered out)
- Events are pulled from your **primary** Google Calendar
- The extension only requests **read access** to your calendar — it cannot create or modify events
