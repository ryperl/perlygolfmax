# Perly Golf Max

A mobile-first golf-trip companion for a planned group of 12 golfers and five
rounds. This repository currently contains a **read-only foundation demo**, not
a live scoreboard.

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
| `npm run typecheck` | Strict TypeScript checks for source, tests, and config |
| `npm run lint` | Type-aware ESLint with zero warnings |
| `npm run lint:docs` | Check README and contributor Markdown |
| `npm test` | Run component, module, and lockfile-tooling tests once |
| `npm run test:watch` | Interactive unit/component test runner |
| `npm run build` | Type check and generate production assets in `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run test:smoke` | Chromium desktop/mobile smoke tests against `dist/` |
| `npm run check:lockfile` | Verify public package URLs and integrity |
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

All names, locations, courses, and tee times are **fictional sample content**.
There are no real bookings, invitations, scores, handicap indexes, or identities.
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

Gross-score entry, server-calculated net Stableford/team results, permissions,
private invitations, score-edit history, offline score storage/synchronization,
and leaderboards are later milestones. Detailed scoring, betting, payouts,
reporting, overall-trip rules, identity provider, and database remain undecided.
No scoring or handicap formulas are implied by this demo.

## Structure and dependency direction

```text
src/
  app/             Composition, hash navigation, global styles, co-located tests
  domain/          Readonly, framework-independent trip models
  demo/            Fictional fixtures and fixture-invariant tests
  features/trip/   Overview, rounds, group views and their own tests
  test/            Shared test environment setup
tests/smoke/       Production-browser smoke tests
public/           Manifest and static icons
scripts/          Dependency-source checks and deterministic icon generation
.github/          CI and contributor instructions
```

Dependencies flow from `app` into feature public exports and demo fixtures,
and from features/fixtures into `domain`. Features receive typed data through
props rather than importing demo data or fetching it themselves. Domain models
do not depend on React, the browser, fixtures, or backend technology. Tests live
beside the code they exercise; only end-to-end checks live in `tests/`.
No empty future layers or generalized service frameworks are included.

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
Feature branches and pull requests never receive deployment credentials and do
not deploy. Manual production runs are also restricted to `main`.

## Azure hosting

The approved production target is the existing Azure Static Web App, serving
the frontend at `https://perlygolf.com` and `https://www.perlygolf.com`.
The pipeline uses the repository Actions secret
`AZURE_STATIC_WEB_APPS_API_TOKEN`. Configure it using Azure's supported deployment
token flow; never print the token or put it in tracked configuration.
No new Azure resources, pricing-tier changes, DNS changes, backend, or identity
services are included.

The previous source repository is retained, but its deployment workflow must
remain disabled after cutover to prevent it overwriting this app. To roll back,
explicitly approve redeploying a known-good earlier commit through the same
checks; if reverting to the old repository, first stop this deployment pipeline
and coordinate re-enabling the old one. Never leave both writers active.

A later approved milestone can select backend and identity services and start
with near-real-time polling rather than requiring SignalR. Cloud architecture,
resources, and spending changes require separate approval.
