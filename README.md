# Perly Golf Max

A mobile-first golf-trip companion for a planned group of 12 golfers and five
rounds. It includes a **read-only fictional preview** and an initial private
Events/API implementation. The isolated test foundation is provisioned, but
customer identity and saved events are not connected by default; this is not
yet an operational scoreboard.

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

- Responsive overview, five-round itinerary, and twelve-person demo group.
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

The Events screen is deliberately unavailable until an approved identity tenant
and API are configured. Customer sign-in and event creation/reload have been
manually verified in isolated test; archive/restore also has automated coverage.
This does not establish all live authorization, concurrency or recovery cases.
The existing fictional preview remains available
without configuration. See [architecture, security and recovery](docs/operations.md)
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

Gross-score entry, calculated Stableford/team results, invitation admission,
owner appointment UI, score-edit history, offline synchronization and
leaderboards remain later increments. The selected design is Entra External ID
email codes, a standalone Functions API and Table Storage, with SWA staying Free.
Provisioning/deployment is separately approval-gated. Detailed scoring, betting,
payouts, reporting, overall-trip rules, admission and retention remain unsettled.
No scoring or handicap formulas are implied by this demo.

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
hole yardage, par, stroke-index allocation and Total/Front/Back ratings. Previewing
a profile does not select it for a round.

Players are independent of sign-in accounts and event membership. Manual index
observations have effective dates, source labels and audit history. Unknown is
not zero, and plus-index notation is preserved without calculating handicaps.
Backdated observations remain in history rather than replacing a newer current
observation. Round-captured inputs do not automatically change on catalog edits.
The eventual event/per-round handicap policy is not implemented.

Owner setup selects saved players and an explicit course version/tee for one
or more rounds, with manual groups numbered 1–4 and at most four players per
group. Every selected player must be assigned once per round. Stale edits
require refresh rather than silently overwrite another update. Setup does not
bind a player to an account, invite anyone, save scores or provide offline sync.
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
  features/trip/   Overview, rounds, group views and their own tests
  features/events/ Private Events presentation and co-located tests
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
