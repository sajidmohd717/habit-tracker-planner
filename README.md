# Habitloom — Habit Tracker & Day Planner

*Weave a better you, one day at a time.*

**Live app: [sajidmohd717.github.io/habit-tracker-planner](https://sajidmohd717.github.io/habit-tracker-planner/)**

An all-round self-improvement app in one page: build habits one at a time, plan your day realistically, and find out where your time *actually* goes. No accounts, no ads, no backend — everything lives in your browser.

> Currently a small hobby project for personal self-improvement. If you stumbled across this repo — welcome! Try it, break it, open an issue.

## Motivation

This project was inspired by the idea of **improving 1% every day** (from *Atomic Habits* by James Clear). Small, consistent improvements compound into big change — but most tools only cover one piece of the puzzle. This app combines the three pieces:

1. **Habits** — long-term compounding. Build one small habit at a time and protect the streak.
2. **Planner** — intention. Most to-do lists fail because tasks have no time attached. Here, every task needs a duration and a start time — including the travel/prep/cleanup time people always forget.
3. **Tracker** — reality. Days disappear and we don't know where they went. Track activities continuously and organize them into meaningful parts of life such as work, family, studies, hobbies, entertainment, or time wasters.

Plan the day, live the day, then compare intention against reality — all in one place.

## Features

### 🔥 Habit Tracker
- Add **custom habits** — anything you want to build ("drink 2 glasses of water on waking", "run 1 km", "no devices after 10pm").
- Tap **Continue streak** each day you keep the habit. One check-in per day.
- **Streak freezes** 🧊 — miss a day and a freeze is spent automatically to protect your streak. You earn one freeze at every 7-day milestone (max 2 banked). No freezes left? The streak resets, but your **best streak** is always remembered.
- **Habit stacking nudge** — once *all* your habits hit a 7-day streak, the app suggests you're ready to stack a new one. Master one habit before adding the next.

### 📅 Day Planner
- Add a task through a short wizard: **what** → **how long (estimated)** → **anything you're forgetting?** (optional travel/prep/cleanup blocks before and after) → **when to start**.
- Everything renders on a **calendar-style day timeline** — your main tasks in blue, the surrounding travel/prep blocks in amber.
- Check off blocks as you complete them, or remove them. Each day starts with a fresh plan.

### ⏱ Time Tracker
- Organize activities with **custom categories**. Add, rename, recolor, archive, restore, and delete categories as your life changes.
- Start with three practical defaults—**Work · Family · Studies**—and add your own as needed (Fitness, Entertainment, Time wasters, …).
- New categories pick from a **curated palette of distinct colors**, with a custom color picker for anything beyond it.
- **Deleting a category** offers a choice: move its tracked history into another category, or delete the history along with it. Archiving remains the safe option that keeps history intact.
- **Continuous tracking, one timer at a time** — starting or restarting an activity is the switch: it ends the current activity at that exact moment and immediately starts the next one.
- There is intentionally no standalone stop button. If you are between tasks, start a break, downtime, travel, sleep, or another honest description so the day remains complete.
- A **persistent tracking bar** stays visible on every tab with a live timer and a shortcut to switch activities.
- **"Where your time went today"** — a color-coded breakdown with totals and percentages for every category.
- **Recent activity chips** — restart a past activity with one tap.

## User Guide

1. **Open the [live app](https://sajidmohd717.github.io/habit-tracker-planner/)** — no sign-up needed.
2. **Start with ONE habit.** Add it on the Habits tab. Every day you keep it, hit *Continue streak*.
3. **Plan tomorrow the night before (or your day in the morning).** On the Planner tab, add each task with an honest time estimate. When the wizard asks about before/after time — take it seriously; that's where plans usually fall apart.
4. **Track as you go.** On the Tracker tab, start the next activity whenever you switch; doing so ends the previous activity automatically. For gaps, switch to a break or downtime activity rather than stopping the timeline. Be honest with the categories — knowing how much time went to time wasters is the whole point.
5. **Review at night.** How much of the bar is green? Did reality match the plan? Adjust tomorrow accordingly.
6. **After a week of consistency**, the app will nudge you to stack your next habit.

### Things to know
- **Local-first.** Everything is stored in your browser's `localStorage` and works fully offline with no account.
- **Optional cloud sync.** If the deployment has Firebase configured, a *Sign in with Google* button appears — signing in syncs your habits, plans, and tracked time across devices, live. On first sign-in, local and cloud data are merged so no progress is lost on either side.
- **Safe sign-out.** The app first flushes the latest activity switch, then removes signed-in data from that browser while keeping the cloud copy. If the final sync cannot complete, the local copy is kept to avoid data loss.
- Without sign-in, data is **per-browser, per-device**, and clearing browser data erases it.

## Enabling cloud sync (for your own deployment)

Sync is off by default (`firebase-config.js` has a `null` config, and the app runs local-only). To enable it on your fork:

1. Go to [console.firebase.google.com](https://console.firebase.google.com) → **Add project** (Analytics not needed).
2. **Build → Authentication → Get started → Sign-in method** → enable **Google**.
3. Still in Authentication → **Settings → Authorized domains** → add your GitHub Pages domain (e.g. `yourname.github.io`).
4. **Build → Firestore Database → Create database** (production mode), then set the rules to:
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{uid} {
         allow read, write: if request.auth != null && request.auth.uid == uid;
       }
     }
   }
   ```
5. Project overview → **Add app → Web** → copy the config object into `firebase-config.js`:
   ```js
   window.FIREBASE_CONFIG = { apiKey: "...", authDomain: "...", projectId: "...", ... };
   ```
6. Commit and push. (The config is safe to commit — Firebase web configs are public by design; the Firestore rules are what protect the data.)

## Running Locally

No build step, no dependencies. It's plain HTML/CSS/JS:

```bash
git clone https://github.com/sajidmohd717/habit-tracker-planner.git
cd habit-tracker-planner
# open index.html directly, or serve it:
npx http-server -p 4173 .
```

Then open `http://localhost:4173`.

## Project Structure

```
index.html         # markup for all three tabs + modals
styles.css         # all styling, one file
app.js             # state, localStorage persistence, and all logic
category-model.js  # category defaults and backward-compatible data migration
state-merge.js     # deterministic cross-tab and cross-device state merging
firebase-config.js # optional Firebase config (null = local-only mode)
sync.js            # Google sign-in + Firestore cross-device sync
tests/              # merge, deletion-tombstone, and category-migration regression tests
```

## Roadmap / Ideas

- [ ] "Today" dashboard combining habits, next planned block, and running timer
- [ ] Overlay tracked time onto the planner timeline (plan vs. reality)
- [ ] Habit history heatmap (GitHub-contributions style)
- [ ] Browser notifications for daily check-in reminders
- [ ] Drag-to-reschedule blocks on the timeline
- [ ] Weekly/monthly time reports
- [ ] Data export/import (JSON)
- [x] Optional sync across devices (Google sign-in + Firestore)

## Contributing

This is a hobby project, but issues, suggestions, and pull requests are welcome. If you use the app and something feels off, that feedback is just as valuable as code.

## License

MIT — free to use, copy, and learn from.
