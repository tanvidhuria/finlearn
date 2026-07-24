# Paisa Patra 🔥

A calm, diary-style web app that teaches personal finance in 90 daily bites — from cash flow basics to derivatives to writing your own money plan. One topic a day, a Deep Dive when you want more, streaks and quiet milestone badges to keep the habit going.

Built with React + Vite. Design: "Morning Ledger" — paper background, Fraunces serif date as the daily hero, Inter body.

**Live:** https://tanvidhuria.github.io/finlearn/

## Run locally

```bash
npm install
npm run dev
```

Open the printed localhost URL. `npm run build` produces the production bundle in `dist/`.

## Deploy to GitHub Pages (one-time setup)

1. Create the repo `finlearn` under your GitHub account and push this folder to `main`.
2. In the repo: **Settings → Pages → Source: GitHub Actions**.
3. Push to `main` — the included workflow (`.github/workflows/deploy.yml`) builds and deploys automatically. The site appears at `https://<username>.github.io/finlearn/` in ~2 minutes.

> If you rename the repo, update `base` in `vite.config.js` to match (`/<repo-name>/`).

## Progress & sync

- Progress always saves to **localStorage** on the device.
- Optional **cross-device sync** via a private GitHub Gist: click ⚙ in the app, paste a fine-grained personal access token with **only the `gist` scope** (GitHub → Settings → Developer settings → Fine-grained tokens). Leave the gist ID empty on first connect — the app creates a private gist for you; copy that gist ID into the second device.
- The token never leaves your browser (stored in localStorage, sent only to api.github.com).

## How the daily logic works

- **Today** shows one lesson. *Mark Completed* records date + time. *Deep Dive* expands the longer read below and auto-marks the topic completed. *Explore More* jumps ahead to the next topic without marking anything.
- A topic shown but not completed becomes **Missed** the next day. Missed topics **resurface after 3 days**, queued ahead of new topics.
- **Streak** counts consecutive calendar days with at least one completion. Badges at 7 / 15 / 30 / 45 / 60 / 90 completions.
- **View demo** (link under the card) shows a pre-filled history without touching your real progress.

## Customising

| Change | Where |
|---|---|
| Lessons / topics / sources | `public/curriculum.json` — edit any lesson's `title`, `body`, `deepDive`, `sources`. Keep the same field names. |
| Colours, fonts, spacing | `CSS` string at the bottom of `src/App.jsx` (design tokens at the top of `.fl-root`). |
| Badge milestones / names | `BADGES` array in `src/App.jsx`. |
| Resurface window | `RESURFACE_AFTER_DAYS` in `src/App.jsx`. |
| App name | `index.html` title + `fl-wordmark` in `src/App.jsx`. |

Everything is plain React + one JSON file — no backend, no database, nothing to pay for.
