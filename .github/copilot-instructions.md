# Perly Golf Max contributor instructions

## Public repository safety

- Commit fictional demo data only. Never commit real trip details, names,
  handicaps, emails, scores, credentials, account identifiers, or corporate feeds.
- Keep local `.npmrc` and environment files ignored. The lockfile must use only
  public npm URLs with integrity hashes; run `npm run check:lockfile`.
- Install through the approved local feed when required. After dependency
  updates, run `npm run lockfile:public` and inspect the diff. URL normalization
  does not establish public provenance; never introduce internal packages.
  GitHub CI must use public npm without corporate credentials.
- Do not add deployment, cloud infrastructure, authentication, business rules,
  or score synchronization without an explicit scope decision.

## Module boundaries

- `src/domain/`: readonly TypeScript models; no React, fixtures, browser APIs,
  or infrastructure dependencies. Do not invent unfinished scoring contracts.
- `src/demo/`: explicitly fictional fixtures importing domain models only.
- `src/contracts/`: runtime network validation shared by client and API; no UI
  or provider SDK dependencies.
- `src/client/`: browser identity/API adapters, composed by `src/app/`.
- `api/src/`: separate Functions workspace; JWT trust, concrete event storage
  and request limits. Import shared domain/contracts, never UI or fixtures.
- `src/features/<feature>/`: cohesive UI and co-located tests. Receive data via
  typed props; import another feature only through its public `index.ts`.
- `src/app/`: composition root, navigation, global presentation. This layer
  wires fixtures into feature views, never the reverse.
- `src/test/`: test setup only. Browser smoke tests belong in `tests/smoke/`.
- Keep exports explicit, dependencies downward, and files responsibility-focused.
  Avoid generic repositories/services or placeholder modules for future features.

## Implementation and verification

- Preserve strict TypeScript, readonly inputs, semantic HTML, keyboard access,
  visible focus, and narrow-screen layout. No `any` or unchecked type assertions.
- Use theme variables for component colors. Keep UI copy honest about demo,
  persistence, synchronization, sign-in, and offline behavior.
- Add co-located success and edge-case tests for each changed component/module.
- Run `npm run check:lockfile`, `npm run typecheck`, `npm run lint`, `npm test`,
  `npm run build`, and `npm run test:smoke`; inspect individual suite outcomes.
- If adding offline behavior later, define private-data caching, update handling,
  and storage/synchronization semantics explicitly before adding a service worker.
- Identity sign-in is not event admission. Verify access tokens, authoritative
  object permissions and owner-versus-global-creator grants on every operation.
- Keep limits effective across instances; fail closed on missing configuration
  or limit-store failure. CORS and Functions keys are not user authentication.
- Read `docs/operations.md` before identity, infrastructure, deployment or
  recovery changes. Preserve existing SWA/DNS and identity/data continuity;
  IaC scaffolding and execution require their separate approvals.
