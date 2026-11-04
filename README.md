# Perly Golf Max

A mobile-first golf-trip companion for a planned group of 12 golfers and five
rounds. It includes a private, selected-event workspace with an owner-operated
online gross-scoring simulation and a separate **read-only fictional preview**.
Local identity/API configuration is optional and explicitly unconfigured by
default; this is not yet a golfer-admission or offline-capable tournament app.

## Local setup

Use Node.js 22.14.0 (see `.nvmrc`) and npm 10.

```bash
nvm use
npm ci
npm run dev
```

Open the localhost URL printed by Vite. No account, environment variables,
database, or Azure services are required. Dependencies and the committed
lockfile use public open-source npm packages. Use only a package source approved
for your machine; local authentication and registry configuration must stay
outside version control. Never bypass organizational network restrictions.

## Commands

| Command | Purpose |
|---------|---------|
| `npm run dev` | Local development server, bound to loopback |
| `npm run dev:api` | Build/start configured API; requires Core Tools |
| `npm run typecheck` | Strict TypeScript checks for source, tests, and config |
| `npm run lint` | Type-aware ESLint with zero warnings |
| `npm run lint:docs` | Check README and contributor Markdown |
| `npm test` | Run component, module, and lockfile-tooling tests once |
| `npm run test:watch` | Interactive unit/component test runner |
| `npm run build` | Type check and generate production assets in `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run test:smoke` | Chromium desktop/mobile smoke tests against `dist/` |
| `npm run check:lockfile` | Verify public package URLs and integrity |
| `npm run check:dependencies` | Audit high/critical production advisories |
| `npm run check:infra` | Compile/check test IaC from restored Bicep modules |
| `npm run lockfile:public` | Normalize public-package lockfile URLs, offline |
| `npm run icons` | Regenerate PNG icons with Node.js only |

Before the first browser smoke run, install its browser and build:

```bash
npx playwright install chromium
npm run build
npm run test:smoke
```

The smoke runner manages its own loopback preview server on port 4173; leave
that port available. On Linux, Playwright may also require system dependencies
(`npx playwright install --with-deps chromium`). Browser downloads are separate
from npm installation and must also comply with your machine's policies.

## Implemented scope

- Live Overview, Rounds and The Group views for an explicitly selected saved
  event, using its actual roster, round snapshots, tees and manual groups.
- A separate Preview with a fictional five-round itinerary and twelve-person
  group; fictional data never substitutes for failed or missing private data.
- Hash-based navigation with direct links, browser history, keyboard focus
  management, skip link, and semantic landmarks.
- Light/dark presentation follows the system setting at page load.
- Separate typed domain models, fictional fixtures, feature views, and app wiring.
- Web app manifest, SVG favicon, Apple touch icon, standard PNG icons, and a
  dedicated maskable icon with inset artwork.
- Strict checks, component/module tests, production-browser smoke tests, and CI.
- Separate Events navigation with explicit unconfigured/signed-out/loading/
  empty/error states, email-code MSAL integration and authorized event creation.
- Active/Archived event lists with owner-only archive and restore. Archived
  events stay private to their owners, preserve their data, and can be restored.
  Permanent deletion is not implemented.
- An independent TypeScript Functions workspace with strict JWT validation,
  Table event/membership transactions, idempotent create requests, bounded
  pagination/body sizes and shared ETag-based per-user request limits.
- Local catalog/setup slice (separate release approval required): organizer-only
  reusable course versions and tee profiles, staged validated JSON import,
  reusable players with dated manual Handicap Index history, and saved-event
  owner setup with explicit course/tee selection, roster and manual foursomes.
  Real source exports are never bundled or committed.
- Owner-only online gross scorecard simulation from saved round setup:
  explicit hole dispositions, conditional saved scores, correction history
  and complete-versus-incomplete gross summaries.
- Configurable individual Stableford games derived server-side from the same
  stroke cards: gross/net, Standard/Modified Stableford presets, editable scoring
  bands and per-game handicap allowance. Multiple games can share one round.
  This is not golfer admission, team scoring, offline recording or a finished
  tournament scoreboard.

The Events screen is deliberately unavailable until an approved identity tenant
and API are configured. Customer sign-in and event creation/reload have been
manually verified in isolated test; archive/restore also has automated coverage.
This does not establish all live authorization, concurrency or recovery cases.
The fictional Preview remains available without configuration. Main navigation
starts at Events, not the demo. See [architecture, security and recovery](docs/operations.md)
for setup requirements, controls, residual risks and separate approval gates.

Bundled names, locations, courses, and tee times are **fictional sample content**.
The repository contains no real bookings, invitations, scores, handicap indexes,
or identities. Private saved events live separately in the configured environment.
Never commit real trip data, contact details, account identifiers, credentials,
corporate feed configuration, or secrets to this public repository.

### PWA and offline boundaries

The manifest and icons are a PWA foundation, not a guarantee of installation on
every browser or platform. There is **no service worker**, explicit offline
cache, offline score storage, synchronization, or update prompt. An already-open
page can continue displaying its bundled demo data without a connection, but
offline navigation/reload is not supported or guaranteed. New builds are picked
up on normal network reload; there is no service-worker update lifecycle.
Production PWA capabilities require HTTPS and platform-specific verification.

### Future work, not implemented

Golfer/self/assigned-foursome admission and scoring, team formats and aggregate
trip results, owner appointment UI, offline synchronization and
leaderboards remain later increments. The selected design is Entra External ID
email codes, a standalone Functions API and Table Storage, with SWA staying Free.
Provisioning/deployment is separately approval-gated. Detailed scoring, betting,
payouts, reporting, overall-trip rules, admission and retention remain unsettled.
The fictional Preview remains separate from authenticated scoring and results.

### Owner gross scorecard simulation

An event owner can open scorecards for a saved round and enter each player's
per-hole gross strokes. Unplayed, picked-up and did-not-finish are distinct
states, never automatic zero/penalty strokes. The normal entry flow is one hole
for one selected group: blank means unplayed, a number means strokes, and `X`
or `X7` means picked up. The number in `X7` contributes seven to the recorded
total but the hole remains picked up, not a completed seven-stroke hole.
A recorded total is labelled incomplete unless every hole has a completed
numeric stroke entry; cards are not ranked
by incomplete totals. Positive whole strokes are bounded only for exact numeric
arithmetic, not by an invented golf scoring cap.

Use the group **Save & Next Hole** action for normal entry. Each player's
acknowledgement is tracked separately: on partial failure, saved values stay
saved, pending drafts remain and the screen does not advance. A foursome uses
one compact card with a row per golfer and one shared save footer; single-player
entry can additionally offer explicit quick scores.
Opening a round shows a traditional group scorecard immediately: holes run
left to right, with a row per golfer, front/back nines and Out/In/Total columns.
Select a golfer for their individual card, or choose **Enter scores** for the
hole-first editor. Front/back controls and locally scrolling tables with fixed
player labels support narrow screens. Circles/squares mark raw gross strokes
relative to source par, not net or handicap-adjusted results.
Cards include source yardage, par and stroke index, exact hole shorthand and
recorded totals. Normal score entry has no extra disposition menu or format
instruction paragraph; blank and X shorthand remain supported.
Pickup or missing values keep subtotals/results marked incomplete. The recap
is available without finalizing a round; no Net or Stableford row is fabricated.
Internal audit records, actor/request IDs, revisions and raw timestamps are not
part of golfer entry or scorecard screens. Cards omit saved-state summaries and
long legends, with only a compact incomplete-total indication when needed.
Audit storage and the owner-protected history API remain unchanged; separate
organizer audit, master-edit and player-report interfaces are not built.

Each saved operation has an idempotency ID, conditional card revision and
immutable before/after/actor/time history. Conflicting edits require explicit
refresh/review; failed local drafts are not confirmed saves. Owner access is
checked by authoritative event membership, not global course-manager status.
Ordinary members do not yet have scoring access. Archived owner cards are
read-only.

The first saved score locks that round's course, tee, roster/group and captured
index inputs, even if all holes are later cleared. Catalog index changes remain
independent. Event name/location edits are not score reinterpretation. There is
no score deletion/unlock/finalization or handicap-policy selector in this slice.

This simulation is online-only. Unsaved drafts exist only in the open page:
closing/reloading it or losing browser storage can lose unsaved work. The PWA
manifest is not offline score storage or synchronization. Keep a paper backup.
Automatic visible-page reads do not guarantee real-time updates, and
another device sees changes only after the server saves them.
Routine background checks do not toggle foreground loading/disabled controls
or replace unchanged round projections. Editing during a pending check preserves
the edit-time card baseline; a save waits for that read rather than overlapping
it. Changed saved data, errors, permission revocation and session expiry remain
visible and guarded.

### Individual Stableford games

Open a saved round's **Games** tab to add games, edit their rules or see results.
Entry stays in gross strokes; changing a game does not rewrite the stroke card.
The scorecard automatically shows the first saved game's per-hole points below
the strokes, including Out/In/Total points. Its **Game** selector switches
between saved games or a strokes-only view, for both group and individual cards.
These are the existing server-derived results, not a second client calculation.
Standard and Modified Stableford presets can each use gross or net scoring, and
multiple games can use the same round. Net allowance defaults to 95% and is
configurable per game.

In Games, expand a golfer to inspect hole points. Each expanded table scrolls
horizontally within its own section without widening the page or moving other
golfers' tables.

| Result relative to par | Standard preset | Modified Stableford preset |
|------------------------|----------------:|-------------------------:|
| Four under | 6 | Configured better-score value |
| Albatross, three under | 5 | 8 |
| Eagle, two under | 4 | 5 |
| Birdie, one under | 3 | 2 |
| Par | 2 | 0 |
| Bogey, one over | 1 | -1 |
| Double bogey, two over | 0 | -2 |

These are starting configurations, not a universal definition of modified
Stableford. Edit individual points, add contiguous better/worse scoring bands
and set explicit values for scores beyond the listed rows. Initial outside-row
values are 6/0 for Standard and 8/-2 for Modified; they remain editable, rather
than being silently extrapolated. Customized results are labelled custom.
See the [user-selected GolfLink reference](https://www.golflink.com/lifestyle/stableford-scoring-go-big-or-go-home)
and [R&A Rule 21](https://www.randa.org/rog/the-rules-of-golf/rule-21).

Pickup (`X`/`X7`) and per-hole DNF receive the minimum configured points
(initially 0/-2). Unplayed holes remain pending, not automatic zero/negative
points. Partial totals are identified and are not ranked as completed results.
Missing captured Handicap Index, rating or stroke-allocation inputs make net
results explicitly unavailable; gross results do not require a handicap.

Net calculations use the round's saved tee **Total** rating for its complete
9- or 18-hole layout and the captured manual index, never a later global
catalog/index value. Nine-hole index halving rounds to one decimal first;
allowance applies to the unrounded Course Handicap, followed by final whole
Playing Handicap rounding. Exact decimal ties round toward positive infinity,
including mathematically negative plus-handicap values. This was checked with
synthetic boundary cases against the [official R&A calculator](https://www.randa.org/en/course-handicap-calculator).
Handicap strokes repeat through stroke-index order; plus handicaps give strokes
back starting with the highest stroke index. This is game scoring, not WHS
score posting or automatic adjusted-gross/net-double-bogey processing.

Game settings are owner-only, online, conditional and idempotent, with
before/after audit records. Active-event games can be added or adjusted on
existing stroke cards; archived events remain read-only. Conflicts preserve
the draft and require explicit refresh/review. Saved-game removal and a
general administrative/history interface are not included. Technical budgets
are 16 games and 32 points rows, also subject to the existing 4 KiB request
limit; an oversized request is refused explicitly, not partially saved.

### Local catalog and round setup

The explicitly bootstrapped organizer manages the private reusable course and
player catalogs. Being an event owner or signing in does not grant catalog
search/import/edit rights. Participants receive only authorized event-local
course and roster projections, never the global player directory or its index
history.

Course import validates the supplied export and stages metadata plus each
independently identified tee-rating profile before publishing an immutable
version. Matching names/colors do not merge source categories, hole definitions
or ratings. Repeating an import is idempotent; an authorized changed import
creates a new version, not an overwrite of an existing round. Saved courses are
reusable without the original file or a live provider. Source attribution and
an unknown export date are not a claim that ratings were freshly verified.
Expand a tee profile in the import preview or saved-version view to inspect its
hole yardage, par, stroke-index allocation and Total/Front/Back ratings after
choosing **Preview tee**. Only the chosen profile is displayed; no tee is selected
automatically. Previewing a profile does not select it for a round or reduce the
set of profiles validated/staged/published by an import.

Players are independent of sign-in accounts and event membership. Manual index
observations have effective dates, source labels and audit history. Unknown is
not zero, and plus-index notation is preserved without calculating handicaps.
An optional starting index can be entered when creating a player; the player
and first audited observation are saved together. Editing opens beside the
selected player rather than below the whole directory.
Backdated observations remain in history rather than replacing a newer current
observation. Round-captured inputs do not automatically change on catalog edits.
Official index verification/posting and scored-round index correction remain
outside this increment.

The manager's owner workspace distinguishes current catalog indices from saved
round captures. An explicit, confirmed setup refresh can replace one round's
captured indices with current catalog observations, preserving the previous
inputs in an audit record. This does not change course/tee/group selections,
update the global players, calculate handicaps or select a future scored-round
correction policy.

Owner setup selects saved players and an explicit course version/tee for one
or more rounds, with manual groups numbered 1–4 and at most four players per
group. Every selected player must be assigned once per round. Group choices
show their current counts and are disabled for additional players when full;
moving or unassigning a player frees a place without moving anyone else.
Stale edits require refresh rather than silently overwrite another update.
Setup does not bind a player to an account, invite anyone, save scores or provide
offline sync.
The setup screen separates collapsible event details and player selection from
the selected round's editor. Player search keeps selected players visible;
course search retains the current choice without selecting a new version or tee.
Each round keeps its draft and version-load state when switching rounds. Adding
a round selects its new draft. The save bar applies the whole event draft, not
only the visible round; incomplete hidden rounds still prevent saving and are
identified in the checklist. Saved inputs and captured/current index comparison
are in a separate expandable review, never a preview of unsaved choices.
Saved, unsaved and scoring-locked round labels do not imply offline persistence.
The current pilot remains limited to eight players and eight rounds.
The local implementation and validation are not authorization for a deployment
or an actual private-source seed. Those remain separate release/import steps.

A later UI migration is planned to **Fluent UI v9 and Griffel**, using
component-owned classes and named slots instead of generic tag selectors or
inline styling. Preserve semantic HTML, keyboard/focus behavior, themes and
mobile layouts. A related readability pass will simplify deep shared imports
and dense component/handler code without breaking NodeNext ESM resolution.
These follow-ups are tracked; no Fluent/Griffel dependencies are installed yet.

## Structure and dependency direction

```text
src/
  app/             Composition, hash navigation, global styles, co-located tests
  domain/          Readonly, framework-independent trip models
  contracts/       Runtime-validated network contracts, no provider SDKs
  client/          Browser identity and typed API adapters
  demo/            Fictional fixtures and fixture-invariant tests
  features/trip/   Explicit fictional Preview views and their own tests
  features/event-trip/ Saved-event Overview, Rounds, Group and their tests
  features/events/ Private Events presentation and co-located tests
  features/scoring/ Group entry and saved scorecards, with co-located tests
  test/            Shared test environment setup
tests/smoke/       Production-browser smoke tests
public/           Manifest and static icons
scripts/          Dependency-source checks and deterministic icon generation
.github/          CI and contributor instructions
api/              Independent Functions workspace, handlers/adapters/own tests
docs/             Architecture, security, provisioning and recovery boundaries
infra/            Test-only Bicep, parameter template and compiled-ARM checks
```

Dependencies flow from `app` into feature public exports and demo fixtures,
and from features/fixtures into `domain`. Presentation receives typed data through
props rather than importing demo data. Stateful catalog/setup controllers own
their cohesive workflow state and receive injected typed client interfaces;
`app` alone constructs the browser adapters. Controllers never construct
identity providers or fetch through a global service. This keeps these workflows
co-located instead of expanding the Events composition page with every form.
Domain models
do not depend on React, the browser, fixtures, or backend technology. Tests live
beside the code they exercise; only end-to-end checks live in `tests/`.
The API imports only shared domain/contracts, never UI/demo/client code.
Provider SDKs stay in concrete adapters; the browser never imports storage or
server credentials. No empty future layers or generic service framework exists.

The selected event is explicit in each live-tab URL and retained only in app
memory while moving between screens. Opening an event links its Overview,
Rounds, Group, setup and scorecards without reusing demo models or fetching the
global catalogs for read-only views. Direct links restore the event context;
without one, choose an event rather than automatically taking the first result.
Sign-out/session expiry clears the in-memory selection and private UI.
Workspace reads retain their existing membership checks and allowlisted
member projections. Setup writes keep their owner-plus-catalog checks;
scorecards and game management require event ownership, not catalog authority.
This does not add player admission or grants.

## Local feeds versus public CI

On a managed machine, configure your approved internal registry in a local,
ignored `.npmrc` using your organization's supported authentication flow.
Do not copy credentials into this repo or change its CI to use a private feed.
`npm ci` uses the committed lockfile; npm can replace its public registry host
with your configured local registry. Do not retry public endpoints locally
when organizational policy blocks them.

For intentional dependency updates:

1. Select public open-source packages only; verify their provenance and license.
2. Run `npm install` using your approved local source.
3. Run `npm run lockfile:public` to replace feed-specific tarball URLs.
4. Inspect the diff, run all checks, and commit `package.json` and the lockfile.

Normalization is offline and preserves package versions and integrity hashes.
It does not publish packages or prove that a private package exists on npm.
Never use it to disguise an internal dependency as a public one. The independent
`check:lockfile` step rejects private sources, embedded credentials, URL query
parameters, and missing/malformed integrity hashes before CI installs anything.
GitHub Actions explicitly selects `https://registry.npmjs.org` with no corporate
feed credentials. A clean public-registry installation still needs verification
on the GitHub runner; a local cache-backed run is not proof of network access
or registry availability there.

## Continuous integration and deployment

Pull requests and branch pushes run locked installation, public-lockfile
checks, strict type checking, lint, named unit/component suites, production
build, and Chromium desktop/mobile smoke tests. CI has read-only repository
permissions and uses no production secrets. The workflow uses ordinary
`pull_request`, not privileged `pull_request_target`.

Production deployment on `main` calls that same validation workflow and only
uploads the resulting verified `dist/` artifact after every check passes.
There is no second platform build or dependency installation during upload.
Ordinary feature branches and pull requests do not deploy or receive deployment
credentials. The separately approved, branch-restricted test environment has
its own frontend token and narrow API deployment identity; it cannot deploy
production. Manual production runs are also restricted to `main`. After upload,
the workflow verifies HTTPS responses from both custom domains, matching their
published JS/CSS bytes against that run's verified artifact and checking the
manifest. Failed verification fails the run; it does not automatically roll back.

## Azure hosting

The approved production target is the existing Azure Static Web App, serving
the frontend at `https://perlygolf.com` and `https://www.perlygolf.com`.
The pipeline uses the repository Actions secret
`AZURE_STATIC_WEB_APPS_API_TOKEN`. Configure it using Azure's supported deployment
token flow; never print the token or put it in tracked configuration.
No new Azure resources, pricing-tier changes, DNS changes or identity services
have been provisioned. API code is not deployed by this frontend pipeline.

The previous source repository is retained, but its deployment workflow must
remain disabled after cutover to prevent it overwriting this app. To roll back,
explicitly approve redeploying a known-good earlier commit through the same
checks; if reverting to the old repository, first stop this deployment pipeline
and coordinate re-enabling the old one. Never leave both writers active.

The approved next design uses near-real-time polling rather than SignalR.
The [operations guide](docs/operations.md) separates reproducible stateless
infrastructure from data restore, retained identity/DNS, secret rotation and
explicit creator bootstrap. IaC generation, cloud resources, permissions,
spending and deployment changes require separate approval.

The [test infrastructure scaffold](infra/README.md) defines a separate Free
frontend, disabled-by-default Flex API, keyless runtime/application storage,
bounded monitoring and narrow runtime permissions using Azure-generated URLs.
That test foundation has been provisioned under separate approval; customer
sign-in/bootstrap remains an explicit gate before enabling the API.
Production SWA/DNS and its deployment workflow are unchanged.

The test deployment workflow runs only on the approved feature branch (or an
authorized manual invocation), behind full CI. It uses a branch-restricted
GitHub environment, a separate test frontend token and secretless OIDC with
Website Contributor on the test API only. It packages compiled API code and
locked production dependencies, not local configuration/credentials, and
uploads prebuilt artifacts without a platform dependency rebuild.
