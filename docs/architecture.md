# Architecture

This is a map of how Perly Golf Max fits together: the layers, which way the
dependencies point, and how a request travels from a phone to storage and
back. It describes structure, not rules. Product and game rules live in the
[README](../README.md) and [game rules](game-rules.md); security, identity,
budgets and recovery live in [operations](operations.md). Contributor rules
are in [`.github/copilot-instructions.md`](../.github/copilot-instructions.md).

## System overview

```text
 Phone / desktop browser
 ┌──────────────────────────────────────────────────────────────┐
 │ React SPA (Vite build, served by Azure Static Web Apps)      │
 │                                                              │
 │  src/app ── composition root, hash navigation, pages         │
 │    │                                                         │
 │    ├── src/features/<feature> ── UI + workflow controllers   │
 │    ├── src/client ── typed API adapters, MSAL sign-in        │
 │    └── src/demo ── fictional Preview fixtures                │
 │                                                              │
 │  shared: src/contracts (runtime validation)                  │
 │          src/domain    (readonly models, game math)          │
 └───────────────────────────┬──────────────────────────────────┘
                             │ HTTPS + JSON
                             │ anonymous public routes, or
                             │ organizer JWT in Authorization
 ┌───────────────────────────▼──────────────────────────────────┐
 │ api/ ── Azure Functions v4 (Node 22), separate npm workspace │
 │                                                              │
 │  functions.ts ── registers routes, builds stores once        │
 │  <area>/handlers.ts ── parse, authorize, budget, respond     │
 │  <area>/store.ts ── Table Storage reads and transactions     │
 │  identity.ts (jose JWKS) · limits.ts (durable quotas)        │
 └───────────────────────────┬──────────────────────────────────┘
                             │ managed identity
                             │ (DefaultAzureCredential)
 ┌───────────────────────────▼──────────────────────────────────┐
 │ Azure Table Storage ── one application table                 │
 │  events, cards, receipts, locks, catalogs, quota counters    │
 └──────────────────────────────────────────────────────────────┘
```

The frontend and the API are built from one repository but deploy
separately. Production currently serves the frontend only; the TEST stack in
[`infra/`](../infra/README.md) also hosts the Functions API.

## Source layout

| Path | Responsibility |
| ---- | -------------- |
| `src/domain/` | Readonly models and pure calculations |
| `src/contracts/` | Runtime validation of network shapes |
| `src/client/` | Browser API adapters and organizer sign-in |
| `src/features/` | One folder per feature: views, controllers, tests |
| `src/app/` | Composition root, pages, navigation, global CSS |
| `src/demo/` | Fictional fixtures for the Preview tab only |
| `src/test/` | Shared Vitest setup |
| `api/src/` | Functions handlers, stores, identity, limits |
| `tests/smoke/` | Playwright browser smoke tests |
| `infra/` | TEST-only Bicep templates and their checks |
| `scripts/` | Lockfile, packaging and environment checks |

### `src/domain/`

Framework-free TypeScript: no React, browser APIs, fixtures or Azure SDKs.
Everything is readonly input to pure functions. It holds the shapes of events,
rounds, tees and cards, plus the calculations the server is authoritative
for: handicap strokes and Course Handicap (`playing-handicaps.ts`,
`handicap-strokes.ts`), each game (`stableford.ts`, `stroke-games.ts`,
`nassau.ts`, `wolf.ts`, `dots.ts`, `churchy-v3.ts`, `nines.ts`, `kp.ts`), money
(`money.ts`, `dot-settlement.ts`, `purse.ts`) and leaderboards.

Because both the browser and the API import it, one calculation runs on both
sides: the server computes the authoritative result and the client can render
the same model without inventing its own rules.

### `src/contracts/`

Runtime decoders and encoders for every network payload, shared by the client
and the API. A response is untrusted until a contract has validated it, and so
is a request body. Contracts also carry the capability markers (for example
`dotsRules=3`, `nines=2`) that let old and new clients coexist; see
[Capability negotiation](#capability-negotiation).

No UI and no provider SDKs belong here.

### `src/client/`

Thin, typed adapters around `fetch`, one per API area (`scoring.ts`,
`events.ts`, `purse.ts`, `public-events.ts`, ...). Each one builds URLs,
attaches headers, decodes the response through a contract and turns failures
into typed errors. `identity.ts` wraps `@azure/msal-browser` for organizer
sign-in. `dot-presets.ts` stores device-local custom Dots presets
(configuration only, never scores or identities).

Adapters are created in `src/app/` and handed to features as interfaces.

### `src/features/<feature>/`

Each folder is one cohesive slice of UI, for example `scoring`, `dots`,
`wolf`, `churchy`, `purse`, `kp`, `setup`, `leaderboard` or `quick-round`.
A feature:

- receives data and injected client interfaces through typed props;
- keeps its workflow state (drafts, pending saves, retries) in its own hooks
  and controllers;
- exports its public surface from `index.ts`, the only path another feature
  may import;
- keeps its tests next to its code.

Features never construct identity providers or fetch through a global
service.

### `src/app/`

The composition root. `main.tsx` mounts `App`, which reads the hash route
(`navigation.ts`), builds the client adapters (`event-services.ts`) and wires
them into feature views through page components such as `SavedEventPage`,
`PublicGroupPage` and `PursePage`. The selected event ID lives in the URL so
links restore their context. `score-resume.ts` remembers only the allowlisted
scoring position: event, round, group, hole and view. `dot-presets.ts` binds
the client preset store to `window.localStorage`.

### `src/demo/`

Explicitly fictional fixtures that feed the Preview tab. Only `app` wires them
in. They never substitute for saved data.

## Dependency direction

```text
            src/app
           /   |    \
          v    v     v
 features/*  client  demo
       \       |      /
        v      v     v
  contracts ──> domain

  api/src ──> contracts, domain   (never app, features, client, demo)
```

- Arrows point from importer to imported; nothing imports upward.
- `contracts` may import `domain` types. `domain` imports nothing in `src/`.
- `no-restricted-imports` rules in `eslint.config.js` enforce the main
  boundaries: domain, contracts, client, demo and API code cannot import UI
  or fixtures, and features are reached only through their public index.

## API structure

`api/` is its own npm workspace with its own `tsconfig`, tests and build. Its
runtime dependencies are `@azure/functions`, `@azure/data-tables`,
`@azure/identity` and `jose`.

### Composition

`api/src/functions.ts` registers every HTTP route with `app.http(...)`.
`resolveApi()` lazily builds a single `TableClient` and every store on top of
it the first time a request arrives, then reuses them for the life of the
instance. Handlers receive a resolver function rather than constructing
dependencies, which keeps them testable with in-memory fakes.

All routes are registered as `authLevel: 'anonymous'`. Authentication and
authorization happen inside each handler, because Functions keys and CORS
are not user authentication.

### Areas

Each folder under `api/src/` owns one area and usually has a `handlers.ts`
(HTTP) and a `store.ts` (persistence):

| Area | Covers |
| ---- | ------ |
| `events/` | Event directory, creation, status changes |
| `setup/`, `catalog/` | Round setup, courses and player catalogs |
| `scoring/` | Cards, per-hole writes, games, KP, leaderboards |
| `corrections/` | Owner input corrections for started rounds |
| `purse/` | Purse plans and calculated winnings |
| `public-access/` | Allowlisted public reads and public scoring |
| `quick-round/` | Anonymous collaborative Quick rounds |
| `admission/` | Legacy account-player invitations |
| `test-access/` | Legacy tester links |
| `event-administration/` | Organizer archive, restore and deletion |
| `churchy/` | Churchie kill switch configuration |

### A handler's steps

Almost every handler runs the same sequence:

1. **Read the body** with a byte ceiling (`http.ts`, 4 KiB by default; 12 KiB
   for staged setup, game and purse transports).
2. **Negotiate capabilities.** `withNinesNegotiation` and the contract
   decoders reject clients that cannot represent the affected data with 426,
   before anything changes.
3. **Identify the caller.** That is a verified JWT for organizers
   (`identity.ts`), the public-event actor for public routes, or a hashed
   tester secret.
4. **Charge a durable budget.** `limits.ts` keeps request counters in Table
   Storage so limits hold across instances. A missing limit store fails
   closed.
5. **Check authority on the stored object.** Being signed in is not
   permission; each operation rechecks event state, owner grants and policy.
6. **Write through a conditional transaction**, or read a shaped projection.
7. **Respond** with a validated contract and safe diagnostic fields only.

## Storage model

There is one Azure Table. Rows that must change together share a partition,
because a Table Storage transaction (entity group transaction) is atomic only
within a single partition:

- **Event partition**, keyed by event ID. Holds the event summary row, member
  and owner grants, round setup, scorecards, game configuration, KP, setup
  locks and immutable receipts. A score save can therefore update the card,
  write its audit receipt, create the round's setup lock and check the event
  and grant revisions in one atomic step.
- **Catalog partitions** (`catalog:players`, `catalog:course:*`) hold shared
  courses and players, managed by the bootstrapped organizer.
- **Quota partitions** (`quota:*`) hold durable request-budget counters.

Every row has an ETag. Writes are optimistic: they carry the revision they
read, and a mismatch becomes an explicit conflict for the user to review,
never a silent overwrite.

## Request flows

### Saving a hole score

```text
 Score entry (features/scoring)
   │ draft held locally until Save & Next
   ▼
 client/scoring.ts
   │ PUT .../rounds/{roundId}/players/{playerId}/holes/{n}
   │ headers: If-Match <card revision> | If-None-Match: *
   │          idempotency key (UUID), capability query
   ▼
 api scoring/handlers.ts
   │ size cap → negotiate → identify → budget → authority
   ▼
 scoring/store.ts ── one transaction in the event partition:
   │   card upsert (conditional on ETag)
   │   immutable before/after receipt
   │   setup lock on first score
   │   event / grant revision checks
   ▼
 response: saved card + server-derived results
   │
   ▼
 UI marks the hole Saved and moves to the next hole
```

If the write fails or conflicts, the draft stays pending on the same hole.
Replaying the same idempotency key confirms the original receipt instead of
writing twice. Only an acknowledged write is shown as Saved.

### Viewing standings

Public views poll shaped, allowlisted summaries such as the public
leaderboard, purse and event skins, rather than full scorecards or audit
data. The server derives points, money and handicaps from raw strokes and the
inputs captured when the round started. Aggregate reads reserve their
per-round budget units atomically up front, and page through results with
digest-bound cursors so a reader never mixes two snapshots.

## Cross-cutting concerns

### Server authority

Clients send raw inputs: strokes, dispositions and declarations. The server
computes everything derived, including Course Handicap, game points,
settlements and purse awards, using the captured round inputs rather than the
current catalog. Clients display those results and never substitute local
projections for saved ones.

### Capability negotiation

New rule versions are opt-in and versioned (`dotsRules=3`, `stringRules=2`,
`nines=2`, `churchyRulesVersions`, ...). The client advertises what it
understands in the query string (`scoringRulesQuery` in
`client/scoring.ts`), and the server answers in the newest representation
that client can decode. A client that cannot represent affected data gets 426
before any mutation, so old browsers are told to update instead of receiving
wrong totals. Saved games keep their original version; nothing is silently
rescored.

### Access models

Several callers share the same routes, each with its own narrow authority:

- **Public visitors** read active events and score any saved group, with no
  account.
- **Quick-round collaborators** may also edit setup, gated on the stored
  Quick-round policy.
- **Event owners** manage their events through organizer sign-in.
- **The bootstrapped organizer** also manages global catalogs, archive
  summaries and permanent deletion.
- **Legacy account players and tester links** keep their narrower historical
  scopes.

[Operations](operations.md#identity-and-application-authority) defines each
one precisely.

### Budgets and request weight

Functions and storage are billed per request, so the frontend stays
request-light and the API enforces durable per-site and per-event budgets.
Score reads and writes, catalog writes and aggregate reads are charged
separately. Rejected reservations consume nothing.

## Build, test and deploy

| Stage | What runs |
| ----- | --------- |
| Typecheck | `tsc -b` across app, tests, config and API |
| Lint | Type-aware ESLint (zero warnings), markdownlint |
| Unit | Vitest for `src/` and `api/`, node tests for scripts |
| Build | Vite to `dist/`, `tsc` for the API |
| Smoke | Playwright: Chromium desktop/mobile, iPhone WebKit |

CI runs once for each push to a pull request, with read-only permissions and
public npm only. Deployment workflows reuse that same validation and upload
the artifact it verified, without rebuilding:

- `main` deploys the frontend to the production Static Web App.
- The approved TEST branch (named in `.github/workflows/deploy-test.yml`)
  deploys the frontend and API to the TEST stack.

See the README's
[CI and deployment](../README.md#continuous-integration-and-deployment)
section and [infra](../infra/README.md) for details.

## Where to change things

| Change | Start in |
| ------ | -------- |
| A game's rules or math | `src/domain/<game>.ts` and its tests |
| What crosses the network | `src/contracts/`, then client and API |
| A new screen or control | `src/features/<feature>/` |
| Wiring a feature into a page | `src/app/` |
| Persistence or authority | `api/src/<area>/store.ts`, `handlers.ts` |
| A new route | `api/src/functions.ts` (avoid `admin*`, `runtime*`) |
| Limits or budgets | `api/src/limits.ts`, then operations docs |
