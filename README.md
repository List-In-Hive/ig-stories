# Inspirovate Creatives Storyloom

A working local Next.js workspace for creating, reviewing, versioning, approving, and exporting Instagram story drafts. It uses one repository, a server-side SQLite database, private local assets, and a separate persisted-queue worker. The interface uses Inspirovate Creatives’ blue, lime, charcoal, Montserrat typography, and supplied logo. Story compositions retain each client project’s own branding and bundled Inter/Lora fonts.

## Start locally

Requires **Node.js 24.11 or newer** and a writable local data directory. No external accounts or API credentials are required.

```sh
npm ci
cp .env.example .env
npm run dev
```

Open **http://127.0.0.1:3000**. This command starts the web app and worker together and initializes fictional demo data only when the development database is empty. Saved work is never reset on restart.

One administrator account:

| Username | Password |
| -------- | -------- |
| admin    | 9741faso |

The username is a plain text login, not an email address. Passwords are bcrypt-hashed. Sessions are server-validated, expire after seven days, and use HTTP-only cookies. HTTPS sets secure session cookies. There is one active admin account, with no manager role or teammate invitations. The account works in both development and production mode; `LOCAL_DEMO_ACCESS` controls fictional project seeding only.

Migration `004_single_admin.sql` applies the requested credentials once, revokes old sessions and outstanding reset/invite tokens, and disables previous logins. Legacy people remain inactive for saved story/audit references. Restarting or running migrations again does not reset passwords or stories. A database backup from before this change is retained in the ignored `data/backups` directory.

Other commands:

```sh
npm run db:migrate       # apply unapplied SQL migrations
npm run db:seed          # seed only an empty database; retain existing work
npm run dev:web          # web app separately
npm run worker           # persisted queue worker separately
npm run typecheck
npm run lint
npm test
npm run build
LOCAL_DEMO_ACCESS=true npm start  # local production preview with worker
```

Default database: `data/storyloom.sqlite`. Private logos, sample backgrounds, and snapshotted fonts are in `data/assets`. Set `DATA_DIR` to an absolute directory for an alternative location. Database files, uploads, credentials, and build output are ignored by Git. Back up the complete data directory with the worker stopped; restore the database and assets together. Fonts are bundled from the OFL-licensed Montserrat, Inter, and Lora packages and prepared during installation.

## Working workflows

- **Today:** stored counts, project/date/status filters, progress, individual and batch approval, PNG downloads, and ZIP export of selected approved versions.
- **Projects:** create, edit, logo upload, pause, archive, reactivate, and permanently delete with exact-name confirmation. Current and archived projects have separate tabs; archived projects are excluded from Today. Up to 10 active projects; the admin can access all projects. Changing a brief affects subsequent drafts. Archived projects keep their brief and use the same three-date story history window.
- **Question stories:** each project has an opt-in “Allow questions & response prompts” switch during creation and editing. Enabled projects can generate multiple-answer polls, question stories, and DM/reply prompts; disabled projects use informational copy. The server enforces this rule for generation, manual creation, edits, restoration, and approval. Manual polls accept two to four labeled answers, rendered as text in the PNG; native Instagram stickers are not connected.
- **Project details:** approved facts, branding, research availability, recent stories, run history, explicit four-story manual generation, and exact-copy manual story creation.
- **Story editor:** independent headline, body, call-to-action, contact, logo, and artwork layers on a 1080 × 1920 canvas. Text, bundled font, size, color, alignment, position, width, visibility, and aspect-preserving logo scale are editable. Copy/layout edits do not invoke the image provider.
- **Revisions:** regenerate artwork while retaining the script; create a new idea with different topic/copy/artwork; restore any earlier version as a new draft; save written feedback. Demo feedback implements **shorten headline**, **center text**, and **warmer/cooler palette**. Other requests are stored and explicitly reported as unapplied.
- **Approval:** each immutable saved version includes copy, layout, project settings and asset references. The exact version ID, reviewer, and timestamp are recorded. Later edits require new approval. Earlier approved versions remain downloadable while their story is within retention. Stale saves and approvals return HTTP 409 with the latest version ID; the editor preserves unsaved changes and offers comparison and reload.
- **History:** today and the previous two Los Angeles calendar dates, with separate current/archived tabs, date/project/status filters, versions in the editor, approval records, and per-story export-event counts in storage. Downloading never marks a story as published.
- **Account:** one administrator username with access to every project, integration setting, and automation control. Manager access, invitations, role controls, and local recovery links have been removed.

## Local scheduling and queue

The separate worker checks every two seconds. Its heartbeat and next Los Angeles scheduled time are visible in the interface. It starts scheduled runs at **08:00 America/Los_Angeles**, using the actual business date and daylight-saving offset. After restart later in the day, it catches up missing runs for that day. It does not backfill missed previous days.

Each scheduled project/day has a unique database row and four independent persisted slots. `Run daily batch now` uses this same uniqueness rule, including before 8 AM. Paused and archived projects are skipped by scheduled batches; paused projects accept explicit manual runs. Manual submissions use a request key to prevent duplicate submissions.

Jobs are claimed in `BEGIN IMMEDIATE` transactions, with a 60-second recovery lease. Successful slots are retained. Failed jobs retry up to `WORKER_MAX_ATTEMPTS` (default 3) with bounded delay; an administrator can requeue only terminal failed slots. `WORKER_CONCURRENCY` defaults to 2, bounded to 1–8. Script topics are planned and persisted per run to keep its four topics distinct even with concurrent workers. Demo artwork stores its deterministic seed, prompt, asset, mode, and operation outcome.

The worker remains independent of browser tabs. **The web app, SQLite, local files, and worker require a running Node environment with writable storage.** This is a working local deployment path. Ephemeral preview hosts lose local data when their filesystem is reset. SQLite/files are not claimed to be durable on serverless deployments, and a cloud schedule is not active.

## Retention and deletion

History shows **today plus the previous two calendar dates in America/Los_Angeles**. At or after 8 AM, once all active projects have their four scheduled stories ready, the worker removes day-minus-three and older stories, versions, approvals, feedback, export records, operations, completed/expired run records, and old research. A failed or incomplete daily slot postpones physical cleanup until it succeeds. Paused and archived projects use the same retention window; if there are no active projects, cleanup can proceed after 8 AM. Automation settings show whether cleanup is waiting and its last successful date.

Permanent project deletion requires typing the current project name exactly. One database transaction removes its brief, research, stories, versions, approvals, feedback, exports, operations, jobs, run scripts, run records, and asset associations. In-flight generation cannot recreate a deleted project. Saved versions remain immutable except inside these explicit project-deletion and retention transactions.

Asset cleanup preserves current project logos and assets referenced by any retained story version, including shared fonts or images. Unreferenced project files and metadata are removed; disk failures remain in a persisted deletion queue for worker retries. New unattached logo uploads have a one-hour saving grace period, and in-flight generated assets have a five-minute lease. Unique assets belonging to a deleted project bypass the upload grace period. Independent backups and files already downloaded outside the app are not altered.

## Demo providers and truthfulness

Three fictional brands are seeded: Sunday Coffee, Forma Studio, and Fern & Field. They have different branding and a mixture of approved drafts and an intentionally failed slot that can be retried.

Generated copy and artwork are labeled demo/sample content. The script provider uses project facts, description, services, and recent project topics. Artwork is deterministic vector scenery stored separately from text and logos. A regeneration uses a visibly different seed. Instagram research is explicitly unavailable, no live news is fetched, and no supporting research URLs are invented. Empty optional contact fields are omitted. No paid API calls are made, no measured OpenAI spend is displayed, and no emails are claimed to have been delivered.

Integrations can select `Live (unconfigured)` to verify clear configuration errors; it never silently falls back to simulated content. Database, storage, authentication, research, script generation, image generation, and job execution have typed boundaries. Explicit Supabase, OpenAI, Instagram/news, and Trigger.dev stubs are isolated in `lib/providers.ts` and do not break startup.

PNG export and preview use the same SVG composition, bundled font metrics, explicit wrapping, private asset references, and safe-area checks. Overflow blocks approval and export. New snapshots retain original font files in private storage as well as artwork and logos. Approved snapshots are exported, not unsaved editor changes. ZIP filenames contain project, business date, story identifier, and version. Exports and assets require a valid server session.

## Later integration checklist

Changing a database URL alone does not complete migration.

- **GitHub:** create/connect the remote, review this code, add protected branches and CI for types/lint/build/workflow tests. No remote was configured or pushed.
- **Supabase database:** translate SQLite migrations to PostgreSQL, migrate all records and timestamps transactionally, preserve version/approval IDs and daily uniqueness, implement the repository, test concurrent claiming and conflict behavior, add backups.
- **Supabase Auth:** migrate the single administrator account, implement the authentication boundary, and add server-side authorization and RLS policies granting the admin project access.
- **Managed storage:** transfer original logos, backgrounds, and immutable font references; verify checksums; use private buckets and authenticated/signed access; update storage references and retain approved snapshots.
- **OpenAI:** add server-only credentials and explicitly chosen models/endpoints, implement script/image contracts, apply rules/feedback, validate factual copy, record real usage separately from demo operations, enforce budgets/timeouts/retries.
- **Instagram/news:** implement public-profile retrieval and recent dated sources; store genuine source URL/publication/fetched/provider/status fields; verify project isolation and approved-fact fallback when unavailable.
- **Trigger.dev:** implement the runner boundary and managed job execution using shared services; configure 8 AM America/Los_Angeles scheduling and verify DST, deduplication, retries, and concurrency. Disable the local scheduler before enabling the cloud scheduler.
- **Deployment:** select durable PostgreSQL/storage and managed jobs, configure HTTPS/server secrets, validate backups and authorization, review the admin authentication configuration, perform production workflow/export checks, then deploy.

## Validation

`tests/workflows.test.ts` and `tests/lifecycle.test.ts` use isolated temporary databases, deterministic providers, and controlled scheduling times. The 25 tests cover persistence, single-admin authentication and migration, CRUD/uploads, generation, versioning/conflicts, exact copy, revisions/feedback, DST, deduplication, restart recovery, retries, 40-slot capacity, composition, PNG/ZIP export, route authorization, question-story permissions, confirmed deletion, shared assets, file-deletion retries, in-flight deletion, and the three-date retention rule. See `VALIDATION.md` for checks actually performed in this environment.
