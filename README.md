# Inspirovate Creatives Storyloom

A Next.js workspace that prepares Instagram Story drafts for several brand accounts every day. For each account, Claude researches timely angles on the web and writes four stories, ChatGPT reviews them, Claude revises anything the reviewer flags, and OpenAI paints the background artwork. The admin edits, approves, and downloads finished 1080 × 1920 PNGs (or a ZIP) and posts them by hand.

It runs as a web app plus a background worker that share a SQLite database and a local assets folder.

## Start locally

Requires **Node.js 24.11 or newer**.

```sh
npm ci
cp .env.example .env    # set ADMIN_PASSWORD; add API keys for live AI
npm run dev
```

Open **http://127.0.0.1:3000** and sign in as `admin`. The password is whatever `ADMIN_PASSWORD` is set to: on startup the app stores its bcrypt hash and signs out older sessions when it changes. Production start refuses to run without `ADMIN_PASSWORD`. In development, fictional demo projects are seeded into an empty database.

Other commands:

```sh
npm run db:migrate       # apply unapplied SQL migrations
npm run db:seed          # seed only an empty database
npm run dev:web          # web app only
npm run worker           # background worker only
npm run typecheck
npm run lint
npm test
npm run build
npm start                # production web app + worker
```

## Generation providers

Settings → Integrations switches between:

- **Demo:** free, deterministic sample copy and vector artwork, for trying the app.
- **Live AI:** needs `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` on the server. It never falls back to demo content; missing keys produce a clear error.

How a live daily run works for one account:

1. **Research and write (Claude, `ANTHROPIC_MODEL`, default `claude-opus-5-5`).** Claude gets the brief, today's date, recent topics, the stories the admin approved or skipped, and recent written feedback. When the project's "Research timely angles on the web" switch is on, it first uses web search for local events, seasons, and industry news. It returns four different stories. Only source URLs that the search actually returned are kept.
2. **Review (ChatGPT, `OPENAI_REVIEW_MODEL`, default `gpt-5.5`).** Each draft is checked against the brief, content rules, prohibited topics, sourcing, and length.
3. **Revise (Claude).** Flagged drafts are rewritten once with the reviewer's notes. The verdict and notes appear under "Generation details" in the editor.
4. **Artwork (OpenAI, `OPENAI_IMAGE_MODEL`, default `gpt-image-2`).** One background per story, cropped to 1080 × 1920 with a light wash behind the text areas.

Written feedback in the editor is applied by Claude: text feedback rewrites the copy, visual feedback writes a new image prompt and repaints. Approved headlines and feedback are remembered per project beyond the three-day history.

Engagement stories (polls, questions, DM prompts) are only produced for projects with "Allow questions & response prompts" turned on, and the server enforces this on every path.

## Adding an account

The project form's **Quick start with AI** takes the Instagram handle, the website, and up to 10 photos the brand has posted. Claude studies the photos (subjects, photo style, lighting, colors, lettering) and the website, then fills in the brief, visual direction, palette, and font for review. Photos are shrunk to 1280 px in the browser before upload.

Styles set by hand on the Branding tab are kept when the AI fills the brief: the palette (color picker or pasted hex code), the default font (Inter, Lora, Montserrat, or an uploaded brand font), and the visual direction. A brand font is a `.ttf` or `.otf` file, with an optional bold file for headlines; it is frozen into each story so later changes do not alter earlier drafts.

## Scheduling and the queue

- Each project has its own **daily generation time** (project form, default 08:00). Times are in the **workspace time zone** (Settings → Automation; default `TIME_ZONE`). Daylight-saving changes are handled; a time skipped by a clock change runs at the first valid minute after it.
- The worker creates one scheduled run per project per day, with four slots. If the worker restarts after a project's time, the day's run is caught up; earlier days are not backfilled. "Run daily batch now" queues every active project immediately, with the same one-run-per-day rule.
- Jobs are claimed in transactions with a 60-second recovery lease and processed `WORKER_CONCURRENCY` at a time (default 3). Failures retry up to `WORKER_MAX_ATTEMPTS` (default 3); rate-limit errors wait a minute per attempt.
- The worker checks the queue every 2 seconds while busy and every 15 seconds when idle. Checking is a local SQLite query; AI providers are only called for real jobs.
- Paused and archived projects are skipped by the schedule; paused projects still accept manual runs.

## Retention and deletion

History shows today and the previous two dates in the workspace time zone. Once every active project has passed its generation time and has its four daily stories, older stories, versions, approvals, feedback, exports, runs, research, and unused files are removed. Permanent project deletion requires typing the project name and removes everything that belongs to it in one transaction; shared fonts and images still referenced elsewhere are kept.

## Deployment

The app needs an always-on Node host with a persistent disk (not serverless). The intended setup is **Railway**:

- one service running `npm start` (web app and worker together),
- a volume mounted at the path given in `DATA_DIR`,
- environment variables: `ADMIN_PASSWORD`, `DATA_DIR`, `TIME_ZONE`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, and optionally the model variables from `.env.example`.

Back up the whole data directory (database and `assets`) together.

## Validation

`npm test` runs the workflow, lifecycle, and live-AI suites against isolated temporary databases with fake AI clients, so no paid calls are made. They cover persistence, authentication and the admin password, CRUD and uploads, generation, versioning and conflicts, revisions and feedback, scheduling and DST, deduplication, restart recovery and retries, composition and export, route authorization, engagement permissions, deletion, retention, and the live research, review, and revision flow.

`npm audit` still reports a `braces` advisory in ESLint's file matching (development only, no fixed release upstream); production dependencies are clean.
