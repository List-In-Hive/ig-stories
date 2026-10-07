# Validation — September 29, 2026

Environment: macOS, Node 24.11.0, Next.js 16.3.7, React 19.3.0. No live provider credentials were used and no paid API calls were made.

## Checks performed

| Check                                                | Result                                                                                             |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| TypeScript (`npm run typecheck`)                     | Passed                                                                                             |
| ESLint (`npm run lint`)                              | Passed with zero errors or warnings                                                                |
| Focused workflows (`npm test`)                       | 25 passed, 0 failed                                                                                |
| Production compilation (`npm run build`)             | Passed                                                                                             |
| Lockfile clean-install dry run                       | Passed                                                                                             |
| Dependency audit after final dependency installation | 0 reported vulnerabilities                                                                         |
| Browser sign-in                                      | Local admin account successfully signed in                                                         |
| Browser project creation + upload                    | Fictional test project and PNG logo saved                                                          |
| Project editing + reload                             | Updated approved facts persisted                                                                   |
| Paused-project manual generation                     | Four slots completed; run labeled Manual                                                           |
| Unsaved editor approval                              | Approval disabled until changes were saved                                                         |
| Save + exact-version approval                        | New version created and approved with reviewer                                                     |
| Browser PNG download                                 | Actual downloaded file inspected; 1080 × 1920 PNG containing artwork, copy, CTA, and original logo |
| Regenerate after approval                            | Script retained, new draft created, earlier approved version still downloadable                    |
| Full app/worker restart                              | Saved project facts, copy, versions, assets, and sessions retained                                 |
| Desktop review/editor layouts                        | Inspected at 1440px width                                                                          |
| Mobile layout                                        | Inspected at 390px; document width matched viewport width, with no horizontal overflow             |
| Archiving                                            | Current/Archived tabs separate project lists; archived projects excluded from Today                |
| Question-story switch                                | Off by default during creation; saved on/off setting persisted on fictional verification project  |
| Delete confirmation                                  | Wrong name kept deletion disabled; exact name enabled it; canceled without deleting saved projects |

Automated tests use an isolated temporary database and cover:

- Eight separate processes safely initializing/migrating the same empty database.
- Foreign keys, repeatable seeds, persisted records, properly hashed passwords, one active administrator, username sign-in, server sessions, expiration, login rate limits, and admin access in production mode.
- Migration of legacy admin/manager records: prior sessions and reset links revoked, story authors and approval IDs preserved, roles restricted to admin, and credentials applied only once.
- Project CRUD, logo format/size validation, disguised SVG rejection, Instagram URL validation, active-project capacity, and archived history preservation.
- Four distinct topics and artwork assets per run; project-specific facts; isolated research records explicitly reporting Instagram unavailable.
- Text-only saves without image-provider calls; image-only revisions retaining script; new ideas changing topic/copy; exact supplied manual scripts and concurrent duplicate-submit protection.
- Immutable versions; exact-version approvals; stale save/approval conflicts; new edits requiring approval; restoring earlier versions; truthful supported/unsupported feedback results.
- Controlled 8 AM Los Angeles scheduling, both 2026 daylight-saving transitions, business-date conversion, daily duplicate prevention, paused/archived skips, bounded retries, recovered jobs, and retaining successful slots.
- Ten active projects producing **40 completed stories**, four distinct topics per project.
- PNG dimensions, composed content, snapshotted font references, overflow validation, ZIP filenames/contents, export-event recording, unauthorized asset/export rejection, rejection of legacy manager sessions and removed account-management actions, and cross-origin rejection.
- Explicit errors from unconfigured real adapters, with no simulated fallback in live mode.
- Question-story permissions for scheduled/manual generation, manual copy, editing, approval, and restoration; informational conversion; two-to-four poll choices; 1080 × 1920 poll composition; refreshed queued scripts after toggling.
- Exact-name project deletion, all dependent records removed, foreign-key integrity, unique files removed, shared assets preserved, immutable-version safeguards, and persistence/retry of simulated disk deletion failures.
- Deletion during an in-flight image provider call and stale job processing cannot recreate project records or assets.
- Today plus the previous two Los Angeles calendar dates, including DST boundaries; cleanup waits for every active daily slot, then removes expired records/files for active, paused, and archived projects and is safe to repeat.
- Delete API authentication, exact server-side name confirmation, cross-origin rejection, and successful deletion against an isolated database.

Browser testing added an archived fictional **Browser Test Studio** project. Its saved versions follow the same three-date retention window as other projects. Existing data was not reset. Screenshots are in `docs/screenshots`.

## Environment restrictions and deferred checks

Initial restricted execution blocked compiler/worker process sockets and package-registry access. Those commands were rerun with the required execution permission and succeeded. No required local check remains blocked.

OpenAI, Instagram/news retrieval, Supabase, email delivery, Trigger.dev cloud schedules, GitHub remote operations, and production deployment were intentionally not connected or exercised. Their unconfigured error behavior was tested. The local storage and worker require a running Node environment with a writable data directory; durable serverless storage has not been claimed or validated.

Node 24.11.0 emits its built-in SQLite experimental-feature notice. It did not prevent migration, persistence, concurrency, export, or build verification.

## Inspirovate Creatives update

The app is named **Inspirovate Creatives Storyloom**. The supplied original JPEG logo is used in the login, sidebar, account page, and app icon. The interface uses the website’s blue/lime palette and locally bundled Montserrat fonts. Client story layouts and immutable versions retain their own branding.

There is one active account, username `admin`; the requested eight-character password is stored as a bcrypt hash. The previous manager account is inactive. The Team page, invitations, role changes, and reset-link workflow were removed from both the interface and API. Historical people remain inactive to preserve existing foreign-key references.

The branded update was also verified in the browser: username `admin` signed in successfully, Settings showed one Administrator account, and sign-out returned to the username/password login. Saved data counts before and after migration matched: 4 projects, 15 stories, 17 versions, 5 approvals, 1 export event, and 24 assets, with no foreign-key errors.

The build initially replayed a cached compiler permission error even after execution permission was granted. Disabling the documented production filesystem-cache option in `next.config.ts` resolved it; the final production build passed.

Branded login, Today, and Account screens were checked at 390px width; each document width matched the viewport. The mobile logo and wordmark remained visible on login and Account, and desktop sidebar collapse was scoped to the sidebar. New visual proofs are `docs/screenshots/inspirovate-account.jpg`, `inspirovate-login.jpg`, and `inspirovate-mobile-login.jpg`.

## Project lifecycle update

Migration `005_project_lifecycle.sql` adds opt-in question-story settings, asset ownership and cleanup tracking, and a transaction-scoped exception to immutable-version deletion. Existing projects default to informational stories. The update did not reset the database.

The browser verified the new creation switch, saved/reopened the switch on the fictional Browser Test Studio project, and restored its original off setting. The Archived tab contained only the two archived projects. Delete confirmation was checked with both a wrong and exact project name, then canceled; successful permanent deletion was tested against isolated test data. Proofs are `docs/screenshots/project-content-switch.jpg`, `archived-projects.jpg`, and `delete-project-confirmation.jpg`.

The project tabs and delete dialog were checked at 390px width; document width matched the viewport with and without the dialog. The warning, name field, Cancel action, and disabled deletion action remained visible. Mobile proof is `docs/screenshots/mobile-delete-confirmation.jpg`.
