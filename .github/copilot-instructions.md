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
  Stateful workflow controllers may receive injected typed client interfaces;
  app constructs adapters, and features never construct identity/browser SDKs.
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
- Only the bootstrapped organizer manages global course/player catalogs.
  Event ownership is not catalog authority. Use allowlisted member projections,
  immutable course versions and captured round inputs; never silently refresh
  rounds from catalog or Handicap Index changes.
- Keep archived events owner-only. Archive/restore must conditionally check
  both event and owner-grant revisions. Deletion or retention rules require
  a separate scope decision.
- Approved players may view all active events and score only their bound
  golfer's saved playing group per round, never competition teams or other
  events. Admission requires private expiring link, explicit claim and owner
  verification/approval. Revalidate member/binding/published-admission proofs;
  discovery indices alone are not authority. Preserve player roles in score
  transactions; never promote them to owner. Keep global catalogs, raw Handicap
  Index observations, audit identities and management endpoints protected.
  Publish derived playing handicaps where readonly net results need them.
  Clear raw invitation secrets after claim/logout/expiry; never log them.
- No-account tester links are separate seven-day event-scoped capabilities.
  Holders may view round scorecards and score any group in that event only;
  never global events/catalogs, purse, history, raw indices or management.
  Owner creation/revocation stays JWT-protected. Validate digest/expiry/revocation
  and conditional grant revisions; never fabricate a tenant/object identity.
  Record a distinct shared tester-link score actor and explicit tester
  permissions, not owner role or individual attribution. Keep secrets in the
  URL fragment/authorization header only; no logs or application persistence.
  Clear private views/drafts on access end/change. Archives deny tester access.
  Preserve legacy one-day expiries. Explicit owner renewal retains the same
  URL/digest/creation time and expires seven days from server renewedAt; retries
  must not extend twice. Never renew on reads or reactivate revoked/archived
  grants. Keep conditional event/owner/link checks and expiry audit receipts.
- Scoring is online-only. First saved
  scores lock setup inputs; preserve atomic score/audit/grant checks, explicit
  unplayed/pickup/DNF and incomplete totals. Do not infer admission, offline
  durability, team rules or permission to unlock scored rounds.
  `X7` preserves a pickup's reported seven in recorded totals, but never makes
  that hole a completed numeric score. Blank shorthand stays unplayed.
- Stableford results are server-derived from raw strokes and captured round
  inputs. Games have versioned/audited editable points and net allowance
  (individual default 95%, new team default 100%); never rewrite strokes or
  silently use current global indices.
  Pickup/DNF award minimum configured points; unplayed remains pending.
  Missing net inputs are unavailable, never a zero handicap.
- Leaderboards order saved server game points, not local drafts or projected
  totals. Mixed progress is provisional with holes shown. Equal points share
  positions without a tie-break; unplayed/unavailable golfers are not ranked
  as zero-point scores. Team games rank teams, never individual fallback.
  Do not imply round finalization.
- Competition teams are explicit per round/game, separate from playing groups.
  Require every round golfer exactly once in full teams; count best one of two,
  both of two, or best two of four net point contributions per hole. Wait for
  every teammate's saved entry. Never infer partners or copy conceded scores.
  Stale assignments after an unscored roster change remain visible but produce
  no team results until repaired; unchanged stale peer games may be retained
  while another game is repaired. Keep legacy individual definitions valid.
  Remove artificial golfer/team/group-count ceilings, not safeguards. Keep
  team sizes 2/4, playing groups max4, min1 event golfer and separate round/game
  budgets. Bounded staged writes publish immutable fragments atomically;
  legacy inline data stays readable. Digest-bound read pages must never be
  mixed or exposed partially. Retain progress across quota waits; abort safely.
- Overall standings are an optional setup competition covering every configured
  round dynamically. Stableford sums one selected game's actual points per round;
  team-member credit is explicit. Stroke play ranks cumulative relative-to-par
  on numeric holes, gross/net with captured inputs; pickup/DNF invalidates a
  valid stroke total, never invent a penalty. Keep pending/unavailable distinct.
  Undefined competition in a legacy setup request preserves saved settings;
  explicit null disables. Overall reads allow admitted active-event viewers,
  remain bounded, quota-charged per round and check consistent event/access
  revisions. Archives remain owner-only. No finalization.
- Per-golfer tees are organizer-enabled/assigned per round, common tee default.
  Capture only compatible layouts from the selected immutable course version.
  Use each golfer's par/yardage/rating/slope/allocation throughout entry,
  scorecards, handicap/points and stroke standings; never unlock scored captures.
- Purse management remains owner-only, conditional/idempotent/audited; admitted
  active-event readers may see plans/winnings, never management/audit identities.
  Amounts are planned, never collected/paid. Use exact minor units. Attribute
  team pots to
  individual members; pool occupied-place ties or explicit organizer resolution.
  Keep remainders unallocated, partial results projected, unavailable totals
  distinct from zero, and stale decisions readable for repair. No money transfers.
- Present golfer scores as hole-ordered scorecards, not audit records. Keep
  operation IDs, actor GUIDs, revisions and raw timestamps out of player
  entry/view screens; preserve backend audit and conditional-save safeguards.
- Main trip tabs use the explicitly selected saved event, never demo fallback.
  Keep fictional views under Preview, clear private selection on sign-out and
  preserve server access checks independently of navigation or catalog rights.
- Setup saves the entire event draft, not just the visible round. Keep round
  drafts and pending version reads mounted when switching; search must retain
  selected inputs and must not implicitly save. Distinguish saved-input review
  from editable selections, and preserve scored-round locks and explicit index
  refresh confirmation independently of collapsed sections.
- Keep limits effective across instances; fail closed on missing configuration
  or limit-store failure. CORS and Functions keys are not user authentication.
- Read `docs/operations.md` before identity, infrastructure, deployment or
  recovery changes. Preserve existing SWA/DNS and identity/data continuity;
  IaC scaffolding and execution require their separate approvals.
