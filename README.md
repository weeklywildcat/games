# Wildcat Games

A touchscreen arcade from The Weekly Wildcat for the Ninety Six High School library board. Four short games with a weekly leaderboard, a staff dashboard, and everything running offline on one machine.

- **Wildcat Word**: five letters, six tries
- **Connections**: sixteen words, four hidden groups
- **Trivia Blitz**: ten questions against a clock
- **Mini Match**: twelve cards, six pairs
- **Wildcat Rush**: a 90-second mixed round (built, hidden by default; turn it on in the dashboard)

## Develop

Requires Node 22.12 or newer (built and tested on 24).

```sh
npm ci
npm run dev
```

- Board: http://127.0.0.1:5173/play
- Admin: http://127.0.0.1:5173/admin (first run prints a one-time setup code in the server log and writes it to `data/setup-code.txt`)

## Check

```sh
npm run typecheck
npm test
npm run content:validate
npm run build
```

## Layout

| Path | What it is |
| --- | --- |
| `apps/web` | React kiosk (`/play`) and admin dashboard (`/admin`) |
| `apps/server` | Hono API, SQLite (built-in `node:sqlite`), game sessions, auth |
| `packages/shared` | Game rules, scoring, schemas, and validators used by both sides |
| `content/` | Seed bank: Word answers and dictionary, Connections, trivia, Mini Match themes |
| `scripts/` | Build, dictionary, content validation, and dev runner |

## Status

Raspberry Pi kiosk deployment (systemd, Chromium autostart, installer) is not done yet, and nothing has been tested on a Pi or ViewSonic display. Playwright end-to-end tests and full operations docs are still to come. School and local trivia questions are drafts or "needs source" in `content/trivia-review.json` and are never published by the seed.
