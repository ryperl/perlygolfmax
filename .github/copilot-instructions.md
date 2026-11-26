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

## Code readability

Write for a person reading the code for the first time, not only for agents.
Much existing code is very dense; improve the code you touch, gradually.

- One decision per line. Never stack ternaries; use early returns or a small
  named function instead (for example `submitLabel()` returning a label).
- Name things. Pull long inline expressions, conditions and magic numbers into
  named helpers or constants (`removedSoFar(job)`, `spacingMs: 6_500`).
- Keep functions single-purpose and short. Split a long function into a
  coordinator and named steps rather than adding another branch.
- Keep lines under about 120 characters. Do not chain several statements on one
  line, and avoid comma-joined declarations such as `const a = 1, b = 2`.
- Comment why, not what: the rule, limit, race or compatibility concern that
  makes the code look the way it does. Add a short doc comment to exported
  types, hooks and functions whose purpose is not obvious from the name.
- Prefer plain control flow (`if`, `for`) over clever expressions when both
  work. Readable beats short.
- Tests follow the same rules: a test name says what must be true, and long
  set-up gets a helper or a one-line comment explaining the scenario.
- Tidy only what you are already changing. Do not mass-reformat files or mix
  large style-only rewrites into a behavior change; propose those separately.

## Implementation and verification

- Preserve strict TypeScript, readonly inputs, semantic HTML, keyboard access,
  visible focus, and narrow-screen layout. No `any` or unchecked type assertions.
- Use theme variables for component colors. Keep UI copy honest about demo,
  persistence, synchronization, sign-in, and offline behavior.
- Reuse round-theme accents in configured round order, not date-sorted order.
  Scope the selected tone over round views, not only their picker, and use
  round tokens for contextual selections/rails. Do not override global accent
  tokens: save actions, status feedback and golf score marks keep their meaning.
  Keep score fields neutral, status colors semantic and round names visible;
  verify light/dark text contrast and never use color as the only identifier.
- Keep public views compact and informative: remove redundant metrics and
  routine explanatory text. Prefer small inline SVGs for familiar meaning,
  retaining accessible labels and essential state/error explanations.
- Keep recovery actionable for the user's role; never ask players to update
  APIs, repair deployment settings or manage retry IDs. Preserve drafts and
  distinguish unconfirmed writes. Log safe operation/error/correlation fields
  through existing developer telemetry, never scores, identities or secrets.
- Shape network reads for their display purpose. Use explicit allowlisted
  summary contracts instead of sending full scorecards, captures or editing
  context to simple public views. Preserve server authority, exact money,
  freshness, coherent snapshots, compatibility and distributed request budgets.
- Routine scoring uses the versioned lean transport, not eager award evidence.
  Preserve transmitted numerical authority, strict coherence validation and
  immutable backend audits. Do not mount mobile audit/evidence panels or grant
  public history access; explicit legacy/investigation reads stay compatible.
  Show one net money amount per golfer, with optional calculation details.
  Combine standings only for an authoritative explicit Wolf/Dots link, never
  unrelated games or foursomes; retain pending/unavailable/points-only states.
  Common Dots/Churchie entry uses 44px touch choices/steppers without a keyboard.
  Preserve custom/invalid count drafts, explicit saves, retries and focus.
- Add co-located success and edge-case tests for each changed component/module.
- Run `npm run check:lockfile`, `npm run typecheck`, `npm run lint`, `npm test`,
  `npm run build`, and `npm run test:smoke`; inspect individual suite outcomes.
- If adding offline behavior later, define private-data caching, update handling,
  and storage/synchronization semantics explicitly before adding a service worker.
- Identity sign-in is not event admission. Verify access tokens, authoritative
  object permissions and owner-versus-global-creator grants on every operation.
- Only the bootstrapped organizer manages global course/player catalogs.
  The sole public catalog-write exception is create-only shared players with
  required name and manually entered GHIN HI. No public profile edits, index
  history, account fields or catalog administration. Server authors fresh IDs,
  observation dates and unverified public-player attribution; bind immutable
  retries to the allowlisted payload and charge durable site catalog-write quota.
  Advertise `publicPlayerCreation` before enabling the two-field Quick setup
  form. Preserve unconfirmed entries/retry identity and separate creation from
  the conditional round save; never fabricate account/event authority.
  Keep catalogs compact with whole-directory search and focused editors.
  Retain page/cursor progress on interrupted reads; never call a loaded-page
  filter a complete search. Preserve import/creation drafts, publish approval,
  conditional revisions and retry identities independently of presentation.
  Course Update publishes an immutable version, never an in-place scored edit.
  Sort player catalog/selection lists by surname before paging through shared
  display-name ordering; preserve selected-first sections and saved group/order
  identities. Display-name surname parsing is presentation, not profile data.
  Event ownership is not catalog authority. Use allowlisted member projections,
  immutable course versions and captured round inputs. Active unstarted rounds
  use current catalog HI; atomically freeze all indexes with the first saved
  score, immutable capture receipt and setup lock. Started/archived rounds never
  automatically adopt later catalog changes. The explicit manager-only roster
  HI shortcut may apply its acknowledged catalog observation to unfinished
  started rounds in the selected active event; completed rounds remain frozen.
  Complete requires every golfer/hole to have a saved non-unplayed disposition.
  Guard completion with the same conditional event transaction; preserve original
  captures/cards/locks, issue corrected input revisions and retain private audits.
  Keep catalog/event acknowledgements and retries separate, with explicit partial
  success and conflict review. Default manual HI metadata to local today/GHIN,
  never claim GHIN verification; quick entry exposes only HI. Old APIs require
  explicit capability. No ordinary-owner catalog authority; anonymous access
  is limited to the create-only exception above.
  Explicit owner corrections are event-local,
  conditional/idempotent/audited and retain the roster and captured course/version.
  Author changed HI observations on the server; never reuse an observation ID
  for a different value or trust client-authored observation identities.
  Preserve original capture receipts, raw cards and scoring locks. Bind score
  writes/drafts to corrected input revisions, including unsigned public writes.
- Keep ordinary archived events owner-only. Ordinary archive/restore must
  conditionally check both event and owner-grant revisions. The bootstrapped
  organizer may separately list ready Quick-round archive summaries and restore
  them under their authoritative stored policy, never through public routes or
  fabricated ownership. Only that organizer may permanently delete an archived
  event; ordinary events also require current owner authority. Require exact-name
  confirmation and a conditional claim before resumable fenced cleanup of all
  event-owned data/locators. Never delete shared catalogs or unrelated events,
  acknowledge partial cleanup as success, or allow old/delayed writes to recreate
  data. Retain only the minimal technical tombstone needed for safe recovery.
  Pending/completed tombstones must not poison unrelated public discovery;
  preserve its unavailable-event contract, paging and direct-access denial.
  No automatic retention or provider backup/log erasure is implied.
- Public app access is an explicit product decision: any visitor may read all
  active events/rosters/cards/standings/purse amounts and score any saved group,
  without accounts or links. Public roster/group displays may publish only the
  scalar current/captured HI or explicit NH, never observation/history metadata,
  audits, archives, catalogs or management writes. Legacy private projections
  retain their narrower index restrictions. Keep organizer sign-in separate. Public
  audits use a distinct unverified public-event actor, never a fake account or
  owner row. Preserve event/card concurrency, locks, idempotency and shared
  durable site/event request budgets.
- New Quick rounds explicitly allow anonymous creation and collaborative
  setup/game editing, including multiple playing groups. Gate these writes on
  the authoritative stored Quick-round policy, never a client flag, fake owner
  or member row. General ordinary-event setup stays protected; narrow public
  pre-scoring internal-game configuration is separately allowed below.
  Publish only allowlisted
  course selections and player name/scalar HI/NH; full catalogs/history remain
  private. Keep one round, shared game validation/capabilities, conditional
  event checks, immutable retry/audit receipts, staged transports and durable
  site/event budgets. Hide incomplete creations from discovery. Preserve
  first-score whole-round captures and locks, drafts/confirmed saves on failures,
  and explicit conflict review. Except create-only players above, no public
  catalog writes, corrections, purse/KP
  administration, archived-data reads, restore/delete or general organizer
  privileges are granted. Any visitor may archive a ready active Quick round
  after confirmation: exact event revision, immutable public-event receipt,
  stable retry identity and durable site/event budgets. Keep all saved scores,
  captures and history; ordinary event archive/restore stays owner-protected.
- Persist only allowlisted public scoring navigation: version/event/round/group/
  hole/view. No scores, drafts, credentials or identities in that record.
  Cold/foreground resume reads fresh server data without resetting place.
  Advance only after acknowledged Save & Next; failures stay pending on the
  same hole. Surface storage failures/stale selections. Intra-round URL updates
  must not focus the main page or scroll entry back to the landing header.
- Legacy approved account players may view all active events and score only
  their bound
  golfer's saved playing group per round, never competition teams or other
  events. Admission requires private expiring link, explicit claim and owner
  verification/approval. Revalidate member/binding/published-admission proofs;
  discovery indices alone are not authority. Preserve player roles in score
  transactions; never promote them to owner. Keep global catalogs, raw Handicap
  Index observations, audit identities and management endpoints protected.
  Publish derived playing handicaps where readonly net results need them.
  Clear raw invitation secrets after claim/logout/expiry; never log them.
- Legacy tester links are separate seven-day event-scoped capabilities.
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
  Retain old API/audit compatibility, but old UI links open the public event and
  discard secrets. Revoking a legacy link cannot disable separate public access.
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
- Ball Drop and Skins are versioned stroke games, never Stableford presets.
  Net uses full captured CH or explicit saved-group-low SO and personal tees;
  keep their points/allowance controls absent. Ball Drop uses explicit foursomes:
  minimum two-ball combination from different golfers, 1 Net + 1 Gross/2 Net/
  2 Gross, summed relative to personal par, lowest first. Wait for all four saved
  dispositions; fewer than two numeric balls is unavailable. Skins compares
  individual numeric gross/net strokes round-wide, unique lowest wins, highest
  awarded count ranks first. New/changed carries require the entire round to
  be one saved foursome and use its shared starting-hole circuit. Unmarked
  saved carries retain printed order without migration.
  Earlier pending holes block later carry awards; final unclaimed skins remain
  unawarded. Pickup/X7/DNF are ineligible, not penalties. Keep exact overflow,
  pending/unavailable/known-zero, stale teams and saved/draft separation explicit.
  New metrics may fund existing place-based purse prizes with team-member
  attribution, never per-skin transfers. Overall Stableford accepts Stableford
  only; reject converting a bound game until its selection is removed.
- Ball Drop scorecards show one authoritative team row after golfer rows, never
  repeat the team score under every player. N/G cell markers use saved ordered
  counting IDs, not a new client calculation; retain gross score marks, pending/
  unavailable states and actual team identity when playing groups differ.
- Round Stroke Play is gross/net with 100% captured CH, actual strokes and
  personal-to-par ranking; pickup/X7/DNF never acquire invented stroke totals.
  Nassau is separate 18-hole match play: singles, three pairwise individuals,
  1v2 best ball or 2v2 best ball/aggregate, net off the match's lowest captured CH.
  Explicit per-side USD stakes split equally, leaving indivisible cents
  unallocated. Ties push. Manual presses use acknowledged two-down positions;
  automatic presses fire once per bet and may themselves be pressed. Keep
  immutable/stale receipts and independent bet money, not a place-purse metric.
- Explicit game handicap rules preserve unmarked legacy results. New UI net
  games default full CH (Stableford retains configured allowance); selected SO
  subtracts the lowest full CH in the entire saved playing group, not a match
  pair or competition team. Specials/calls remain personal gross. Starts are
  shared round setup, not per-game writes; new Nassau retains printed Front/Back
  membership in actual circuit order. Require negotiated markers and
  fail-before-mutation compatibility. See `docs/game-rules.md`.
- Legacy Wolf version 1 uses explicit foursome order and group starting hole,
  best ball and net
  off lowest captured CH. Partnered wins/losses transfer +/-2 each; Blind Wolf
  (after drives) transfers +/-6 versus +/-2 each; pre-drive PIG +/-9 versus +/-3
  each. Signed balance ranks, zero sum per hole; ties zero/no carry. No second
  settlement or per-dot cash rate. Preserve saved choices, server-marked late
  recovery and honest honor-system timing. Nassau/Wolf setup locks after first
  score; unchanged peers survive other edits. Store declarations on canonical
  group-first cards through conditional saves, preserve raw-only extras and
  require authoritative supported kinds. Legacy testers cannot see or author
  these match ledgers/declarations. Ordinary score transports stay 4 KiB;
  dedicated declaration parts reuse 12 KiB staging and immutable fragments.
- New Wolf is version 2, never an automatic conversion of saved version 1.
  Partnered High/Low each earns 1 per winning teammate, no deductions/carry.
  Solo Blind Wolf earns 2 per winning-side player; PIG earns 3. No opponent-count
  multiplier. Use the actual playing circuit and captured personal inputs.
  Lowest combined Wolf plus explicitly linked prefix specials chooses both
  final played holes after 16/7 in 18/9 holes. Persist the pre-write candidate
  receipt, use the next printed rotation for ties, and preserve the chosen Wolf
  after final holes start even when earlier corrections change standings.
  Put Wolf declaration before scores with name-only partner options. Remind
  who still needs a solo Wolf/PIG using acknowledged choices only; never block
  play or override comeback selection to enforce the reminder.
  New first-tee-order games choose First/Second/Third/Fourth Wolf in entry at
  the group's saved starting hole before declaration; never in setup. Store one
  immutable canonical card receipt, retain raw-only edits/clears/retries, mark
  late recovery on the server, and keep missing order pending without blocking
  raw scores. Unmarked saved orders and comeback proofs stay unchanged.
  Require `wolfOrders=1`/`wolfOrderVersion: 1` before affected reads/publications.
- Legacy Dots version 1 supports individual, fixed partners, or explicit
  linked neutral contexts, never a Wolf-owned special subsystem.
  Individual play uses every golfer in a saved 1–4-player group; two/three
  players never form teams. Solo is stats-only with blank/zero rate, no
  opponents or money. Fixed/rotating/linked modes still require four players.
  Small individual groups require explicit `dotsIndividualPlayerCounts` API
  support; absence permits legacy four-player individual play only.
  Standalone contexts stay independent until explicitly linked. Each qualifying occurrence
  shares with current teammates; Walk, manual Pickup and failed called
  Paree/Murphy/Pully Murphy award actual opponents (none in solo play).
  Count repeated fairway/greenside Sandys, including a separately called Paree.
  Hogan/Seve/Sandy/Paree/Murphy/Haz Par/Chippy allow gross par or better;
  par-3 Hogan/Seve omit fairway conditions. Pully allows its long par or birdie
  putt; called Pully Murphy retains its long par requirement. Birdie does not
  infer Hogan; a qualified manual Hogan may stack. SuperDime replaces Dime;
  Eagle never also earns Birdie. Derive
  streaks from acknowledged scores and actual play order, not drafts.
  String is three consecutive gross par-or-better, then every qualifier;
  BirdyString is birdie-or-better. Award only qualifying configured BirdyString
  when both qualify, retaining the underlying String run for a later par.
  Recalculate existing/future derived results, never raw cards/captures/original
  receipts. Negotiate `stringRules=2` and explicit response version; strictly
  decode missing markers as legacy. Unsupported affected clients require 426
  before mutation, not successful alternate totals or lost pending drafts.
  Ordinary Dots shares called Paree/par and Murphy/par-or-birdie outcomes with
  explicit 1x/2x/3x Murphy stakes times configured units, never hole stakes.
  Require independent `dotsCalls=score-v1`/`dotsCallTargets` support; preserve
  manual legacy calls until opt-in, target IDs and raw-only/old-client echoes.
  Nonrepresentable old reads/writes require an update before any mutation.
  Category carries resolve independently in actual order; final unclaimed stays
  unawarded. Ordinary Dots automatically adds one Category Sweep dot when the
  same golfer wins enabled Long Drive and Blue Plate on the same hole, including
  existing rounds. Share with current teammates; never multiply the bonus,
  infer it from carried ownership/second qualifiers or alter linked High/Low
  Sweep or Churchie. Negotiate the derived calculation context, guard affected
  old writes/publications before mutation, and preserve original receipts.
  King requires every eligible category-hole award owned directly or
  through carry, individual x1 only after complete inputs. No fixed hole counts.
  Assassin needs both approach qualifiers or both longest drives in a 2-v-2
  side. Optional second KP/Blue Plate/Long Drive selections never win extra
  category dots; absent seconds mean no Assassin, not a pending decision.
  Hide seconds in individual/solo contexts. Unmarked legacy Sweep needs real
  linked High/Low outcomes. Explicit `sweepRule: "manual-v1"` allows a
  scorer-declared Sweep with normal units/sharing, without gross qualification.
  Wolf v2 `highLowSweep: true` is separately opt-in, one extra dot per partnered
  winning teammate for both High/Low; no solo, carry or multiplier. Never enable
  both automatic sources for the same match. Require `sweepRules=2`/capabilities,
  preserve legacy definitions/audits and immutable final-hole Wolf choices.
  Thief/full Sixes
  match engines remain deferred except explicit rotating High/Low below.
  Dots cannot stack with Churchie.
- Rotating Dots version 2 shares specials for Modified Sixes (three played
  holes) and Sixes (six). Opt-in Modified Sixes net High/Low uses full captured
  CH or whole-group SO, one dot per winning teammate per lane, ties push/no
  carry; specials stay gross. Keep base/special sources separate and settle
  once. Legacy version-2 games require `dotsHighLow=1` and retain their
  three-hole-only High/Low without automatic Sweep. New version-3 Sixes and
  Modified Sixes use High/Low version 2, adding one automatic High/Low Sweep
  dot per teammate only when the same pair wins both net contests, no carry or
  multiplier. Require `dotsRules=3` plus `dotsHighLow=2` and explicit advertised
  support before affected reads/publications; do not silently rescore old games.
  First-played-hole P1–P4
  order cycles 12/34, 13/24, 14/23 from an acknowledged canonical group-first
  card receipt. Missing order is pending, never inferred fixed partners.
  Preserve the immutable order/origin on clears/raw-only edits and mark absent
  order recovery late on the server. Initial Sixes order goes above score
  fields; after acknowledgement show current teams only, not a future cycle.
  No retrospective reshuffle or implicit High/Low migration; explicit manual
  Sweep remains independent. Require explicit `dotsRulesVersions` support, keep legacy
  definitions/results unchanged and retain group/input/revision/audit checks.
  New first teams use tee flip (12/34,13/24,14/23) or approach rank closest to
  farthest (14/23,13/24,12/34), keeping the selected 3/6-hole period. Choose the
  method in clear setup and actual names on the first tee/first played hole.
  Preserve drafts, canonical immutable receipts and raw scoring on missing order.
  Name Manual Sweep, High/Low Sweep and Category Sweep distinctly; show hole
  stroke/net values and individual round-only bonuses without audit identities.
  New/changed declarations enforce same-source-golfer/whole-hole exclusions:
  Hogan/Seve, Pully with Dime/SuperDime, Hogan with Murphy/Chippy. Shared
  teammate awards may differ. Hogan/Seve with Walk warns but is allowed.
  Also block same-source Chippy/Pully, Seve with KP/Long Drive qualification,
  and Sandy/KP on a default-tee par 3, including first/second category
  qualifiers, never historical carry ownership. Seve with Blue Plate or
  Gorilla is explicitly allowed. Use personal gross score/par to prevent
  newly invalid score-qualified claims and require explicit same-save repair
  on score changes. Keep current UI/group preflight/API checks consistent;
  negotiate `dotCoexistence=2`, preserving valid old writes and historical reads.
  Do not make old version-1 records unreadable or silently delete old awards.
  Failed Paree/Murphy/Pully Murphy excludes that source golfer's same-hole
  par-or-better manual claims, made calls and earned automatic awards, plus
  Dime/Sticky/SuperDime. Enforce new/changed inputs in UI/API, including
  score-derived conflicts, but keep old read calculations and records compatible.
  Preserve teammate-source independence and explicit repair; never silently
  clear saved choices or make an old conflict hide an entire round.
  Keep automatic-award choices in setup only; score entry has manual tap
  choices/counters below each golfer alongside KP, not a keyboard-heavy form.
  Select all applies only to compatible setup rules and preserves custom units.
  Explicit Par for blanks fills untouched unplayed fields using personal par;
  never overwrite saved/typed/cleared/pickup values or imply an automatic save.
- Public pre-scoring internal-game setup in ordinary active events is explicitly
  allowed for Dots, new Wolf and enabled Churchie only. Check both old/new game
  scope, unchanged protected peers, actual saved groups, version and setup locks.
  No legacy Wolf conversion, protected game-ID conversion, owner promotion,
  general setup, catalog, Ball Drop administration, purse or archive authority.
  Keep old tester projections unchanged and omit internal ledgers/declarations.
- Nines is version 1 for one saved playing group of exactly three: 5/3/1 per
  hole, tied places share points, pickup/X7/DNF ranks worst, a hole scores only
  when all three have saved it. Gross, or net with full CH or group SO. Optional
  stake per point settles once with N = 3. Negotiate `nines=1`; older clients
  get 426 for rounds with Nines and never see it advertised. One Dots game may
  link to Nines like Wolf v2: Nines points are the base, Dots keeps its own
  specials/units, one combined settlement at the Nines stake, no Dots stake.
  Every golfer plays alone: individual special rules, no Assassin/automatic
  Sweep, Walk/Pickup award both opponents. Linked Dots requires `nines=2` and
  `ninesLinkedDots`; `nines=1` clients get 426 for those rounds.
- Internal USD settlement is `(N*d_i - sum(d)) * rateMinor`, once per explicitly
  linked combination/group, with separate sources and actual participant count.
  N remains four for partnered games; solo never settles money.
  Blank/zero is points-only.
  User money input is dollars (`1`, `.50`), storage stays exact integer cents;
  dot units remain whole points. Preserve all legacy Churchie math/saved values.
  Total to settle sums positive net balances, never absolute balances or dots.
  Immutable private score/correction receipts retain changed award snapshots
  with rule/input bindings; public views explain current awards without private
  actors or claiming a historical audit browser. No payment transfers.
- Skins leaderboards omit known zero awards from standings/search/pages only.
  Preserve awarded ranks/ties, pending/unavailable displays and underlying
  game/purse results; hidden search controls must not hide refreshed winners.
- Display the game as Churchie; keep internal `churchy` kinds/keys and the
  `CHURCHY_GAME_ENABLED` switch compatible. New games use version 3 with
  explicitly advertised `churchyRulesVersions` support. Never silently
  rescore v1/v2. Only explicit unstarted v2-to-v3 upgrades are allowed;
  preserve their initial partnership sequence from the selected start.
  V3 supports tee order or approach ranking on the group's first played hole.
  Rank 1 closest through 4 farthest; pair 1+4/2+3, then 1+3/2+4, then 1+2/3+4
  in three-played-hole blocks, repeating after nine. Stakes/carries use the
  actual circuit, not printed hole numbering. Approach order is a conditional
  immutable receipt on the canonical group-first card's starting hole, not
  a setup edit. Other groups starting cannot block it. Missing order leaves
  results pending but raw scoring available; late recovery is server-marked.
  Clearing specials/raw-only edits never erase or reshuffle the order.
  Score entry shows the selected hole's current teams directly from that saved
  context, not a collapsed future schedule or a new roster-order calculation.
  Retain pending/order-entry and late-recovery states without extra requests.
  V3 reuses Dots configuration/qualifications: Sticky is canonical Dime, Sandy
  allows par or better, and same-golfer exclusions apply. All compatible
  specials are selectable; defaults retain the familiar subset, Birdie 2/
  Eagle 4/other units 1, including KP and Blue Plate enabled at 1 each.
  KP carries only between default-tee par 3s; Blue Plate requires a qualifying
  GIR on default-tee par 5s and carries only between those holes. No qualifier
  carries; missing decisions stay pending. Credit the full accumulated award
  once to the winning golfer and their current partner, never split or apply
  again for partner entry. Do not retro-enable or relabel saved Other entries.
  Murphy stages scale configured units by 1/2/3;
  Sweep scales units by the current stake and is separate from Dots presses.
  Target-aware Murphy is an explicit per-call par/birdie choice with derived
  gross-personal-par outcomes; blanks stay pending and pickup/DNF misses.
  A missed birdie Murphy followed by par may coexist with valid Sandy/Pully.
  Use called checkbox and 1x/2x/3x stakes; never infer a call from a score.
  Preserve manual calls until explicit opt-in, target identities and raw-only
  edits. Negotiate target-aware transport/capability and project compatible
  reads for older clients; never make old browsers reject entire scorecards.
  Paree has independent explicit par-target opt-in/capability/negotiation and
  score-derived gross par-or-better outcomes. Keep blanks pending, configured
  units/repeated calls/team attribution intact, and legacy manual results until
  explicit opt-in. Raw-only corrections never require a second declaration save.
  Category holes use the captured default tee; source qualifications use
  personal tees. Shared presets copy configuration into games, never bind
  live settings. Custom presets are device-local config/units only, injected
  from app/client adapters, with explicit storage errors and draft retention.
  No public preset catalog, scores/identities/money in preset storage, or
  implicit offline scoring. New Other in ordinary Dots requires explicit
  `dotsSpecialKinds` support; missing capability retains legacy kinds.
- Legacy Churchie version 1 retains its original definition, declarations,
  one-dot Birdie, single Sandy and shared-pot math; never silently convert it.
  Legacy Churchie version 2 supports one independent game per saved foursome, with
  distinct configuration, carry, standings and settlement. Named specials are
  enabled/disabled before scoring at fixed values: Birdie 2, Eagle 4 without
  Birdie overlap, manual Sticky 1, repeated exact-gross-par Sandy and shared
  per-hole Other whole counts without required explanations. Sticky is a
  scorer-decided approach inside flagstick length; no invented score condition.
  Other is a catch-all, not a round-level adjustment or negative earned dots.
  Both current teammates receive each source award in full, entered only once.
  Preserve legacy and new extras on raw-only saves; validate game version,
  enabled fields, group, revision and counters authoritatively. Keep all setup,
  capture, concurrency, retry and audit safeguards. Version 2 requires explicit
  `churchyRulesVersions` support, not just the general Churchie flag.
  New money uses `(4*d_i - sum(d)) * rateMinor`, source-aware earned dots and
  net due/owed, points-only at zero, no second settlement or payments. Keep
  Churchie independent from Dots/Wolf; Ball Drop stays between foursomes.
  Present compact accessible controls/results without Experimental labels,
  redundant copy or hidden essential state. The kill switch remains intact.
- Legacy Churchie v1/v2 gameplay retains
  Explicit P1–P4 order rotates partners in three-hole blocks; stakes 1/2/3 repeat.
  Net compares max/min numeric strokes using captured CH minus the foursome's
  lowest CH on each personal tee. High/Low carry independently across the turn;
  sweep is current stake only. Earned dots credit both partners in full, never
  netted. Calls Paree/Murphy are gross par-or-better; Murphy presses are explicit
  initial/opposing/calling stages 1/2/3. Sandy requires confirmed exact par;
  Pully allows confirmed par or birdie in either Churchie version.
  automatic birdie is exactly one under. Legacy version 1 has no eagle dots.
  Pickup/DNF
  loses High to an all-numeric pair; remaining numeric Low still competes.
  Unapproved both-pair/no-numeric comparisons are unavailable, never penalties
  or automatic ties. Preserve carry uncertainty and pending versus unavailable.
  Stage specials in the same conditional/audited score write, with game revision
  and selected-group checks. No offline dots, second write or optimistic results.
  Legacy version-1 USD minor-unit shared-pot settlement is separate from earned standings:
  units `2*d_i - sum(d)/2`, planned pays/collects only, not place-based purse or
  overall Stableford. Setup/order lock after scoring; stake edits require owner
  authority except for explicitly collaborative Quick-round game management.
  The authoritative API defaults on; `CHURCHY_GAME_ENABLED=false` kills all
  Churchie surfaces and specific mutations without erasing saved definitions,
  specials or audits, or blocking ordinary score/other game edits. UI missing
  capability is disabled for old APIs; never infer backend support from a
  frontend default. Unknown configured flag values fail closed.
- Scoring names show server-derived Course Handicap from captured HI and each
  golfer's captured tee, without game allowance or a stroke-allocation requirement.
  Keep scratch/plus values distinct from NH and other unavailable inputs.
  Scorecard stroke dots use applicable selected-game SO, otherwise full server
  Course Handicap, and the captured
  personal/default tee's complete stroke allocation, never game allowances,
  current catalog HI or Churchie earned dots. Use shared allocation math;
  never halve an already-calculated nine-hole CH again. Bound visual counts,
  preserve gross marks/counting badges and surface unavailable allocation.
- Score-entry headers show subtle CH and applicable authoritative off-low SO
  together, such as CH 4, SO 1; SO is total relative handicap, not hole strokes.
  Keep unavailable distinct from zero, labels generic and existing rule scope.
  Show saved numeric gross-to-personal-par progress afterward, such as
  Thru 6 +2/E/-2. Count only acknowledged numeric holes; missing,
  pickup/X7/DNF never count as par or replace the running total with Incomplete.
  Keep overall completeness separate, no-scores distinct from even par,
  drafts out of saved summaries and no new reads merely for this display.
- Estimated round differentials are server-derived for completed numeric
  18-hole cards only, using captured personal/default tee ratings, full CH and
  allocation. Net-double-bogey caps affect derived adjusted gross only; never
  raw strokes, captures, standings or index history. Label PCC 0 and estimate,
  not official GHIN or posting. Keep missing, pickup/DNF, NH, missing ratings/
  allocation and unsafe arithmetic explicit; never guess nine-hole WHS
  expected-score components or claim incomplete scores are official results.
  Public summaries allowlist derived values without observation metadata.
  Keep missing-state reasons in contracts, but show only — in differential
  cells, without per-row explanations. Use Adj. Gross / Est. Diff. headings
  and A.G / E.D in narrow containers, retaining full accessible column names.
  Keep round and individual differential sections collapsed by default so
  optional summaries do not push the primary scorecards down the page.
- Event Roster retains current HI. Round playing groups, unassigned golfers and
  competition teams show CH using that round's index and each personal/default
  tee through shared domain handicap math, never roster HI or game allowance.
  Public scalar-only projections and private captured observations must agree;
  legacy missing inputs remain unavailable, not scratch or NH.
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
- Public purse uses a course/round pool selector and an event-wide winnings
  table: each roster player, calculated awards and winning pool names only.
  Exclude projected awards from that public summary, not from organizer
  calculations. Known non-winners show 0.00/no pools; missing/overflowed money
  and unavailable sources remain explicit. This is not payment or finalization.
  Award-card breakdown actions lazily load allowlisted winnings explanations, never
  protected edit/audit history. Keep pending money out, exact shares intact,
  newer totals explicit, and abort/ignore closed or superseded reads.
- Review notices use already-loaded canonical data, without extra global scans.
  Flag required manual ties, stale inputs/teams/decisions, unavailable required
  inputs, unassigned awards and budget issues; do not flag normally covered
  skins, automatically pooled ties or ordinary future unplayed holes.
- KP is one separate competition per saved round, using saved default-tee par 3
  holes/lengths/stroke indexes, never personal tees or current catalogs. Whole
  feet/inches require on-green confirmation; explicit zero is a hole-in-one.
  Sparse contenders suffice; absent/No measurement is unknown, not zero or
  missed green. Stage measured/clear/No measurement with existing conditional
  score writes, preserve KP on raw-only clients, and acknowledge before advancing.
  No browser persistence of KP drafts. Owner-only close/reopen does not finalize
  ordinary golf; closed KP refuses changed entries while preserving raw scoring.
  Tie choices bind to exact measured contenders/single-use identities and hole
  amounts. Choose one tied winner or split all, explicitly selecting extra-cent
  recipients. One canonical round pot is a genuine existing-budget purse source;
  100.00 is an unsaved editor default, never automatically configured money.
  Only after closure exclude empty holes and divide equally per winning hole,
  with cents to longest winning default-tee hole then harder/lower stroke index.
  Ambiguous required inputs block allocation; all-empty stays unawarded without
  rollover. Unresolved/stale ties never claim fully allocated money. Preserve
  existing public/legacy permissions, ordinary captures, Churchie and other purses.
- Event-wide skins is an independently enabled version-1 event competition,
  never a replacement for primary overall or round Skins games.
  Details use captured-hole navigation and one saved comparison, without row
  outcomes or repeated covering-name lists. Keep winner cards unchanged.
  Preserve selection across refresh/retry and retain all golfer rows.
  Compete each round/hole separately, sum actual wins across all configured
  rounds, no carry.
  Lowest net numeric strokes uses 100% captured CH/personal tees. Only net ties
  prefer actual gross birdie-or-better on personal par, then lower qualifying
  gross; equal qualifying gross stays tied, gross par never breaks a tie.
  Wait for all field dispositions; pickup/X7/DNF are ineligible and missing net
  inputs unavailable, not scratch. Later independent holes may resolve.
  Owner configuration is conditional/idempotent/audited; public active readers
  may view, testers may not, archives owner-only readonly. Reuse bounded
  quota-charged coherent aggregate reads and digest paging. One explicit event
  skins purse pot divides floor(minor units / awarded skins) per skin, multiplying
  actual wins, leaving cents unallocated. No winners reserves the whole pot;
  pending holes mean projected shares and unknown final denominator. No default
  stake, budget increase, auto-reallocation, transfers or automatic finalization.
- Present golfer scores as hole-ordered scorecards, not audit records. Keep
  operation IDs, actor GUIDs, revisions and raw timestamps out of player
  entry/view screens; preserve backend audit and conditional-save safeguards.
- Keep score entry focused without opening the keyboard: show round navigation,
  reserve save/discard feedback space, and never insert controls above fields
  when drafting. Discard clears all local round drafts, never saved scores.
  Keep navigation buttons below the styled Round picker; block switching while
  foreground requests or local score/game edits are pending. Avoid repeated static
  public disclaimers; retain actionable errors and unsaved/save feedback.
  Use a compact accessible indicator/count rather than routine success/status
  boxes. Only acknowledged writes claim Saved; no-op blanks do not.
  Entry has one Save & Next action with Refresh below it; Refresh never saves.
  Keep toolbar Refresh available in scorecards/games/leaderboard and recovery states.
- Each playing group captures its starting hole; legacy omission uses the first
  captured layout hole. Arrows wrap without saving. Save & Next follows one
  circuit then opens cards, not formal finalization. Preserve remembered places
  and scored setup locks, treating explicit legacy defaults as unchanged.
- Show event purse navigation only for authoritative workspace
  `purseConfigured`; do not calculate winnings or add requests just to show a link.
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
- Azure Functions rejects HTTP routes starting with `admin` or `runtime`,
  including `administration`. Use `organizer` for management routes and verify
  their actual authentication responses before frontend publication; indexed
  deployment metadata alone does not prove a route is reachable.
- Read `docs/operations.md` before identity, infrastructure, deployment or
  recovery changes. Preserve existing SWA/DNS and identity/data continuity;
  IaC scaffolding and execution require their separate approvals.
- Keep the Functions host request ceiling at 12288 bytes for the existing
  12 KiB setup/game/purse transports; ordinary handlers retain 4 KiB limits.
  Verify the host setting during production preparation, not just handler tests.
- Round tee time is optional course-local HH:mm schedule metadata, not a scoring
  input or generated group departure schedule. Preserve it on legacy omission;
  explicit blank clears it. Scored setup locks remain independent of schedule edits.
- Player display names resolve from the current catalog for authorized event
  views. Never rewrite captured handicap/course inputs, stored card revisions or
  audit receipts to propagate a rename; keep catalog profiles private.
- Event end dates are optional date-only scheduling metadata. Validate against
  the effective saved start date, preserve omission and support explicit clearing.
  Event and round sorting still uses start dates, never automatic archival.
- Event/round start dates are optional real YYYY-MM-DD local calendar metadata.
  Omission preserves dates, blank clears, and scoring locks do not prevent date
  edits. Complete bounded directory reads precede global date ordering; failures
  retain progress, never silently publish a partial list as globally sorted.
  Sort dated events earliest-to-latest then undated (ID ties), and display rounds
  by date with configured-order ties without changing stored order or score cursors.
