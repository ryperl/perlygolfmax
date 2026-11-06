# Operational architecture and recovery

## Status and approval boundary

### Request-size configuration for test and future production

Set `FUNCTIONS_REQUEST_BODY_SIZE_LIMIT` to **12288 bytes (12 KiB)** on the
Functions host. The previous 4096-byte host limit rejected larger event setup
requests before the application handlers could enforce their own limits,
surfacing as HTTP 500 errors when adding rounds.

Keep this setting in the infrastructure source and verify its live value during
future production preparation; application-only deployments do not apply
infrastructure settings. Workspace, game and purse handlers retain their
12 KiB transport limits, ordinary endpoints retain 4 KiB limits, and larger
logical private writes still use bounded staging. Authentication, conditional
writes and durable request budgets remain required. Raising the host ceiling
does not authorize a larger endpoint payload or bypass application validation.
Production provisioning or settings changes still require separate approval.

The approved design is Static Web Apps (SWA) Free, Entra External ID hosted
email-code sign-in, a standalone Functions API and Table Storage. The production
planning allowance is roughly USD 15/month, not a quote or spending cap.

The repository implements public round scoring and a separate organizer
workspace. The public model was explicitly chosen: any internet visitor may
browse active rosters/events, change any group score, and view standings and
purse/winnings. This is not a private tournament or verified-player model.
Organizer sign-in, API handlers, bounded discovery and idempotent event creation
with atomic owner membership remain. Manual test verification
has exercised hosted customer sign-in, signed-in event loading and event
creation followed by a page reload. Runtime resource settings and narrow
role scopes have been read back after foundation creation. Those checks do not
prove all authorization, concurrency or recovery boundaries.
Saved owner round setup and online group-scoped player scoring are implemented.
Individual gross/net Stableford, explicit net team games and configurable point
tables are implemented. Optional overall standings are configured in event
setup: actual daily Stableford points with explicit member credit, or individual
gross/net stroke play. Private invitations support explicit claim, organizer
verification/approval and revocation. No owner appointment UI, payment transfers,
audit exports or backup job are shipped. Organizer
purse configuration and calculated individual winnings are implemented.
An unconfigured Events page says so explicitly, without fictional saved events.

Main navigation starts at Events. Opening a saved event binds Overview, Rounds
and The Group to the same explicit event ID in the URL. Their typed projections
use allowlisted active-event projections, not global catalog reads or synthetic
demo models. Organizer management still checks authoritative owner/catalog
grants. Legacy memberships/tester links are not prerequisites for public scoring.
Snapshot rounds/groups are not assumed finished just because scoring started.
The public scoring cursor persists in an allowlisted navigation-only localStorage
record; fresh server scores are read on cold launch/foreground return. Tokens,
scores and unsaved drafts are not persisted. Requests abort on source changes.
Missing selection, unavailable configuration, rejected access and service errors
never fall back to fictional data. The separate Preview is explicitly selected.

Further tenant, consent, role, resource, push and deployment changes require the
relevant scope approval. The production frontend deployment workflow is
unchanged. The separate test workflow publishes validated frontend/API
artifacts, never infrastructure or production, and does not enable the API.
The test frontend publication waits for API deployment/readiness. This
intentionally trades deployment parallelism for compatibility: newly exposed
initial-index and setup-refresh controls must not reach older handlers that
ignore or lack their request contract.

## Identity and application authority

Organizer tools use MSAL authorization code with PKCE against a dedicated customer
tenant's hosted email one-time-passcode flow. Golfers require no account or
sign-in. Configure organizer OTP from the start; changing a password flow later does
not automatically migrate existing users. Use the default `ciamlogin.com`
login host initially; no custom mail relay/domain is implied.

Organizer calls use explicit bearer access tokens without cookies. Public calls
send neither Authorization nor cookies. The app does not rely on SWA custom OIDC,
`/.auth/me`, principal
headers or Functions keys. Server validation checks signature, allowed
algorithm, fixed issuer/JWKS, API audience, lifetime, tenant, delegated scope,
SPA client and user object ID. User identity is `(tid, oid)`, never display name,
email, an ID token or a client-supplied owner ID. CORS is not authentication.

Only the explicitly bootstrapped creator initially creates events. The creator
can later appoint owners of specific events; those appointments must not grant
global creation or directory administration. Event membership is authoritative
for every private object operation, not a stale listing index or hidden button.
Public active-event reads and score writes are separately authorized by current
event state, not membership. Owner appointment remains separate; public actors
never acquire management authority.

### Public scoring and short-visit recovery

The default app is public Events/rounds/groups/cards, score entry, leaderboards
and purse/winnings. Organizer tools live separately at `#organizer`; existing
protected setup/catalog routes remain private. Public startup does not initialize
identity or acquire a token. API URL configuration alone is sufficient for it.

The `/api/public` namespace exposes only active event discovery, workspace,
round scores, per-player hole writes, overall leaderboard and purse reads.
There are no public catalog, setup/game/purse/access mutation, archive or audit
history routes. Private management endpoints remain JWT-only. Public projections
exclude raw Handicap Index observations and audit identities.

Scores use the same validated raw dispositions, conditional card/event revision,
UUID idempotency, immutable audit and first-score setup lock. Public authority
is the active event revision, not a fabricated member/grant row. A distinct
unverified public-event actor records these edits; no individually verified
identity is claimed. Shared durable quotas are site-scoped for discovery and
event-scoped for public reads/writes. They are safeguards, not per-person
authentication, tamper prevention or global ingress protection.

Anyone on the internet can intentionally or accidentally change an active
score. This exposure was explicitly approved, including public prize amounts.
Archived events, organizer-only catalogs/configuration and audit records remain
protected. A legacy link's expiry/revocation cannot prevent use of the separate
public website.

For eighteen short course visits, only version/event ID/round ID/group/hole/view
are persisted under `perly-golf-max:last-score-location:v1`. Cold root/home-screen
launches restore this context, validate against fresh data and resume entry.
Saved cursor changes are independent of score data; no offline queue/cache is
introduced. Save & Next advances only after intended writes are acknowledged.
Failures/conflicts retain the hole and unconfirmed in-memory entries. The user
must wait for Saved before closing; mobile browsers cannot promise background
saving or a reliable unload prompt.

Foreground/bfcache return refreshes without resetting selection or overlapping
an active request. Dirty drafts remain protected. Storage errors are visible;
stale group/hole or unavailable round data requires explicit selection and never
falls back to fictional content. Internal hole/view URL updates do not refocus
the whole page, which would otherwise scroll mobile entry back to the top.
The manifest's `/` launch is now the public recovery entry. iOS standalone apps
may have storage separate from Safari, so their initial selection can differ.
WebKit tests emulate the iPhone 16 Pro viewport and eighteen cold launches;
physical Add to Home Screen remains manual.

### Legacy no-account tester protocol

The ordinary app no longer requires tester links. Old tester/admission URLs
discard their secret and open the public event or remembered scoring position.
The following protocol remains for old API clients and immutable audit continuity;
its checks do not restrict the newly public namespace.

An event owner can create a private seven-day tester link without appointing an
account or granting membership. Anyone holding it can read saved round setup/
scorecards and enter scores for any playing group in that one active event.
No account creation, sign-in or organizer approval is required for its holder.
The owner still signs in for creation/revocation and all management.

Owner endpoints `GET .../test-access`, `POST .../test-access/create`,
`POST .../test-access/renew` and `POST .../test-access/revoke` retain JWT,
event-owner checks, exact event/link
revisions and UUID idempotency receipts. Creation stores only a SHA-256 digest
of the browser-generated 32-byte secret, with a server-established seven-day
expiry. The raw secret cannot be recovered; explicitly revoke lost links and
create new ones. Revocation does not delete scores.

Existing one-day grants retain their persisted expiry. Explicit owner renewal
keeps the original creation time, link ID and digest, adds a server `renewedAt`
and sets expiry to exactly seven days from that instant. An expired unrevoked
grant may be renewed; a revoked or archived grant may not. Renewal atomically
checks event, owner and link revisions and records before/after expiry and actor
in the immutable request receipt. An identical request retry never extends the
expiry again. Listing/page refresh is read-only. Readers accept legacy one-day,
new seven-day and explicitly renewed seven-day records without rewriting data;
other lifetimes or renewal times before creation fail validation.

Dedicated guest routes live under `/api/tester/events/<event-id>`: workspace,
round scores and per-player hole writes only. They require
`Authorization: Tester <link-id>.<secret>`, never a secret query/path parameter.
The ordinary API remains JWT-only. Every guest request validates the event,
digest, expiry and current link grant; archived/revoked/expired links fail
closed. Conditional score publication checks the actual link grant, event/card
revisions and existing first-score lock/audit invariants. Durable request limits,
private paged reads, no-store responses and explicit failure semantics remain.
No new cloud identity, role, storage account or resource is required.

Guest projections never grant global event discovery, admission, catalogs, raw
index observations, history, purse or game/setup/access administration. Explicit
tester permissions permit all score targets in this event without making the
holder an owner. Audit actors distinguish a shared tester link from a verified
account; individual attribution is not implied. Existing owner/account-player
access is unchanged.

The legacy guest entry protocol bypasses identity initialization and global discovery.
It retains its secret in the fragment/in-memory adapter only; secrets must not
be logged, rendered as ordinary score-entry text or put into app storage.
Round/credential changes abort old requests and reset private state. Access
loss clears private views instead of sending the tester to account sign-in.
This remains online-only; unsaved drafts can be lost when leaving/reloading.

### Legacy account-based player admission

The event owner creates a private single-golfer link after saving the roster.
The browser generates a 32-byte random secret; the server stores its SHA-256
digest, not the secret. Links expire after 24 hours. An authenticated explicit
claim binds the pending request to verified tenant/object identity. The owner
verifies the person and matching request code before approving. No email
matching, email delivery, automatic approval or cloud-role grant occurs.

The owner management endpoints are `GET .../admissions` and
`POST .../admissions/invite`, `/approve` and `/revoke`. Owner mutations require
the current event ETag, request UUID and applicable invitation revision.
`POST .../admissions/claim` receives the secret in its body, never query/path.
`GET .../admissions/status?inviteId=...` returns only the caller-bound claim.
All endpoints use existing JWT validation, request limits and private responses.

Approval publishes matching event membership, unique roster/account binding
and approved invitation records plus an immutable actor-scoped index locator.
Only completed publication grants admission. Every read validates the current
counterparts and their revisions; the index alone is not authority. Revocation
invalidates that grant, including when a stale index remains. Another approved
admission may still authorize general viewing.

An admitted player can view every active event: rosters, groups, scorecards,
game/overall standings and saved prize results. A reader without a validated
binding in the target event is explicitly a viewer. Only the bound golfer's
saved playing group grants score-write targets; competition teams do not.
Owners retain organizer controls and corrections. Global catalogs, raw captured
Handicap Index observations and audit identities are not player projections.
Derived playing handicaps support identical net results without raw observations.
Archived target events remain owner-only.

The fragment link is stripped to a caller-bound claim reference after success.
During identity redirect only, validated invitation continuation lives in tab
session storage for at most 30 minutes, consumed once and cleared on claim,
logout or expiry. Do not log/share link secrets publicly. No real invitations,
claims or approvals are created by release verification.

### Event archiving

Events have `active` or `archived` status. Existing records without a status
are read as active; invalid stored values fail explicitly. The default list
contains active events for authoritative members. `GET /api/events?status=archived`
returns only archived events owned by the caller, with the same bounded paging.
Archive discovery never grants access based on the global creator setting.

An event owner can `PATCH /api/events/<event-id>/status` with JSON
`{"status":"archived"}` or `{"status":"active"}` and the event's exact `If-Match`
revision. Wildcard/missing revisions are rejected. The event status merge and
an unchanged owner membership merge are committed in one partition transaction,
each with its own ETag, so concurrent metadata or owner-grant changes prevent
the write. A stale revision returns `409 EVENT_CHANGED`; refresh before retrying.
Nonowners cannot manage events, and nonmembers receive no event-existence detail.

Archiving hides an event from active lists and from ordinary members; restoring
returns it to its existing members. Metadata, membership and other event data
are not deleted. Creation retries do not restore an already archived event.
There is no permanent-delete endpoint, automatic expiry, retention policy or
new backup guarantee. Detail, score and invitation endpoints enforce
these lifecycle rules independently of discovery.

The current scoring slice is online: per-hole
gross strokes, unplayed holes and explicit pickup/DNF dispositions with audited
corrections. Pickup may include an organizer-entered reported stroke value:
`X7` records a pickup and contributes seven to the recorded total, while the
round remains incomplete. This is not a completed seven-stroke hole, automatic
maximum/penalty, handicap posting rule or invented Stableford treatment.
Public visitors can enter/correct any saved playing group in active events.
The legacy account namespace still restricts admitted players to their assigned
group. Neither path confers event administration.
Individual/team Stableford rules are configured per game;
configured prize plans derive individual winnings without payment operations.
Missing inputs never become zero.

### Overall competition configuration and reads

The optional competition is part of the existing conditional whole-event setup,
with unchanged owner plus catalog-manager write authority. It is not a new
membership grant. Legacy requests omitting the property retain saved settings;
explicit null disables them. Configured Stableford bindings must reference a
current event round and a saved game; incomplete configuration remains explicit.
The setup PUT alone has a 12 KiB UTF-8 request budget, alongside the separate
12 KiB game-configuration budget. Other ordinary writes remain bounded at 4 KiB.

`GET /api/public/events/<event-id>/leaderboard` permits unsigned active-event
reads. `GET /api/events/<event-id>/leaderboard` remains bearer-authenticated:
owners and
admitted players can read active events; only owners can read archives.
Disabled events do not fetch scorecards. Enabled reads
include every configured round with at most three parallel score reads and
charge the existing score-read quota for each round, in addition to the request.
The service checks the event and current authority revisions before returning the
aggregate; concurrent changes fail explicitly instead of returning mixed data.
It does not write cards, refresh handicap captures or manufacture missing scores.

Stableford uses saved daily points unchanged; stroke play derives gross/net
relative-to-par from numeric holes using captured inputs. Pickup/DNF invalidates
a valid stroke total; unplayed holes stay pending. Neither mode provides
finalization, a final leaderboard tie-break or WHS posting.
Purse allocation is separate and never performs a payment.

### Scalable private values and transfers

There is no application golfer/team-count ceiling. Playing groups stay at most
four and competition teams exactly two/four; minimum saved event roster is one.
Individual rounds support one, two or three golfers without placeholder players.
Team game setup still requires complete teams covering every round golfer.
Requests, storage properties, transactions and finite runtime resources still
have safeguards. Large setup/game/purse writes use immutable owner-bound parts
followed by conditional publication. Ordinary bodies remain 4 KiB; the part
parser is 12 KiB, logical staged writes 4 MiB and private values 32 MiB.
Oversized work fails explicitly, never as a partial active event.

Large JSON content uses digest-verified immutable fragments below the Table
UTF-16 property limit. Only the original logical row's pointer is published in
the event/owner-conditional transaction. Fragment staging is separate from the
bounded publication transaction, so golfer count does not become an oversized
batch. Existing inline JSON remains readable; no bulk migration is performed.
Staged/inactive fragments are retained, not public or active application data.
Automatic cleanup/retention is separate policy work, not an implicit deletion.

Large private reads use bounded digest-bound pages. Each page reauthorizes and
rejects changed source data; clients reassemble and verify the whole value
before exposing a complete typed result. Cursor/digest values are not authority.
Quota waits retain the current part/page, honor Retry-After and can be aborted.
Catalogue setup loading also continues the exact throttled page without
publishing a partial directory as complete. No new cloud resources or grants.

### Personal tee captures

The organizer's event option permits sparse golfer/round overrides from the
selected immutable course version. Matching hole count/numbers are required;
each captured tee's own par, distance, rating, slope and allocation are used.
The common tee remains the default. Captures are event-local metadata; global
catalogue changes do not replace them, and ordinary member projections still
exclude Handicap Index observations.

First score locks personal choices along with existing inputs. Disabling the
option cannot reinterpret a scored mixed-tee round. Legacy request omission
preserves assignments; an unreviewed course-version change with old overrides
is rejected. New explicit incompatible/foreign assignments fail validation.
No self-selection permission, admission or score-history rewrite is introduced.

### Private purse plans and calculated winnings

`GET /api/public/events/<event-id>/purse` exposes active-event planned amounts
and calculated winnings without login, by explicit product choice.
`GET /api/events/<event-id>/purse` permits admitted active-event readers as well
as owners. PUT and staged configuration writes remain owner-only;
catalog management alone is insufficient and is not required of an event owner.
Archives are readable but never writable. Writes use exact configuration
preconditions and request identity, atomically checking event/owner revisions,
publishing settings plus immutable before/after/actor/time receipts and an
event registry marker. Missing settings with surviving evidence fail closed.
Retries confirm the original request independently of a later current plan.

Reads verify consistent saved workspace/round sources with bounded concurrency
and existing quotas. Prize calculations use exact minor units, actual selected
game/event rankings, explicit team/member units, pooled occupied-place ties or
organizer resolutions. Leaderboard positions are not rewritten. Stored stale
decisions remain readable as unavailable for repair, not fabricated valid awards.
Projection, reserves, rounding remainders and overcommitment are explicit.

All totals are individual winnings calculations, not collected/paid balances.
There is no payment provider, transfer, banking data, finalization or hidden
closest-to-pin measurement engine. Real financial/trip data stays out of source.

### Scoring authority and persistence

Public scoring reads/writes require an active event, with all groups writable.
Legacy private scoring requires owner, approved account-player binding or
tester-link authority under that protocol's scope. History and game management
remain owner-only. Catalog-manager/global-creator status alone is not owner
scoring authority. No public actor becomes a member. Owner archive reads remain
private and read-only.

The round score read uses the saved course/tee/hole layout and roster, not the
live catalogs or fictional previews. New cards are virtual unplayed cards until
a saved operation creates their revision. A first-card write requires
`If-None-Match: *`; an existing-card write requires the exact `If-Match` revision.
Every write requires a UUID idempotency key and a validated explicit disposition.
The conditional event/member/card transaction also records immutable before/after,
actor/time and operation identity. Replays confirm the original audit, not a
potentially newer current projection.

First score persistence creates a per-round setup lock. Conditional event and
grant checks coordinate scoring against setup/index-refresh/archive/revocation
races. A started round cannot have its setup inputs or event roster silently
changed, and clearing scores does not unlock it. This conservative simulation
does not define finalization, score deletion, unlock or future handicap policy.
Audit/score rows use the existing application table and runtime data-plane role;
there is no new database, queue, role or infrastructure grant.
Score reads and writes have separate durable limits of 60 requests per
identity/minute. The existing 4 KiB request cap is unchanged. Polling honors
bounded `Retry-After` seconds/dates and exponential backoff; explicit retries
do not bypass the server minimum. These are application controls, not global
ingress protection or new production quota approval.

The client distinguishes server-saved cards from local unsaved edits and
conflicts. Foreground polling is bounded, non-overlapping, paused when hidden
and backed off on failures; it must not overwrite local edits. No score or
token is put in IndexedDB/localStorage/Cache Storage in this increment. A
connection is required to save, background execution is not promised, and
reload/close may lose unsaved page drafts. This is not the offline-capable
Arizona pilot; private caching/logout/retention/update/sync design is still
pending, and paper backup remains necessary.

The primary interaction is one selected group/hole with shorthand input, not a
status dropdown and save form for every player/hole. Blank input is unplayed;
unchanged blanks need no fabricated write. Group save serializes the existing
per-player write contract; it is not an all-or-nothing group transaction.
Partial acknowledgements stay saved, pending/unattempted drafts retain their
intent/revision/request identity and a failure never advances the hole. A later
owner projection must not silently rebase another player's draft or be reported
as matching the user's intended value.
Foursome entry uses one compact card rather than four expanded player panels.
Routine polling has separate background semantics: no foreground busy/control
pulses and no replacement of unchanged projections. An edit that starts during
a pending poll keeps its original baseline; changed poll data is marked stale
rather than overwriting that draft. A foreground action waits behind the pending
read, preserving single-operation serialization and Retry-After minimums.
Authorization failures still clear private data and errors remain visible.

The round opens on a golfer-facing group scorecard, not the score editor or
an audit log. Its columns follow saved hole numbers, irrespective of entry or
storage order. Group and individual cards show front/back nines, Out/In/Total,
source par/yardage/stroke index and recorded values. Circle/square markings
compare only completed raw gross strokes with source par; they do not imply
handicap, net or Stableford rules. Pickup counts are not a separate column.
Normal entry omits disposition menus and explanatory shorthand boilerplate.
Conflict/error and online/first-save-lock warnings remain visible when needed.

Golfer screens do not call the audit-history endpoint or expose operation
identities, actor GUIDs, ETags or raw timestamps. Conditional requests,
immutable acknowledgements, audited corrections and owner-only backend history
are preserved. A separate organizer audit interface, including its access and
presentation choices, is deferred rather than hidden behind a device-width gate.
Saved-card summaries, repeated completion counts and long explanatory legends
are omitted from player cards. Incomplete totals retain a short indication;
administrative master edits and player reports remain future scope.

### Round game configuration and results

`PUT /api/events/<event-id>/rounds/<round-id>/games` saves the complete game
configuration for a round. It requires the active event's authoritative owner,
bounded JSON parts within the 12 KiB game request cap, an exact configuration
`If-Match` or
first-create `If-None-Match: *`, and a UUID `Idempotency-Key`. It shares the
existing durable `scores-write` quota. Catalog management is not required.

The same-event-partition transaction checks both event and owner-grant
revisions, creates/replaces `round-games:<round-id>`, updates the event's
additive `gameRoundIds` registry and writes an immutable before/after/actor/time
receipt under `game-change:<round-id>:<request-id>`. Lost-response retries match
the exact original settings, actor and base revision. Acknowledgements remain
separate from a later current projection, just as stroke receipts do.
Existing configured game IDs cannot be silently removed by a whole-set save.
There is no saved-game delete endpoint or new retention policy.

Game settings do not lock an unstarted round's course setup. The first
persisted stroke card retains that responsibility. Games can be applied to
existing saved strokes and their settings edited with audit while the event
is active; neither operation changes those strokes or captured course/index
inputs. Archived owners can read results but cannot change settings.

`GET .../scores` and confirmed stroke/game writes include an additive `games`
projection only when configuration exists. Results are computed server-side
from the current validated cards, captured player inputs, selected tee Total
rating and saved point rules. Nothing is written back as a replacement stroke.
Legacy rounds without games remain compatible. Missing/corrupt known settings
fail closed before reads or score writes; a missing registry/config pair also
probes for surviving round-specific audit evidence with a one-row bounded
query. A partial empty page is not proof of no configuration.

The game editor preserves its original configuration revision and request ID
until confirmation or explicit new intent. Conflicts require a real refresh
and explicit review; rebasing replaces only the edited game and preserves
other owners' additional games. Stroke and game requests share the existing
single-operation hook, and both kinds of local draft pause background polling.
No game configuration, points input or audit log is added to normal stroke
entry. Game controls never confer player admission or organizer authority.
Group and individual scorecards display the selected game's server-derived
hole points and Out/In/Total values below the raw strokes. The first configured
game is the default view; a compact selector switches games or shows strokes
only. This selection is local presentation state, not a game-setting write,
and is preserved when moving between score entry, cards and games.

MSAL manages tab-scoped sessionStorage. The callback and logout reply URI is
`https://<frontend-host>/?event-auth=1`; local development uses the exact local
origin instead. Register each approved origin explicitly. A callback goes to
Events before MSAL consumes its authorization response. Sign-out clears private
UI and invokes provider logout; interrupted provider logout is reported. It
does not guarantee instant bearer-token revocation or all-device sign-out.
Provider cookies/Stay signed in influence future code prompts; session policy
still needs approval.

### Test custom domain

The approved `https://dev.perlygolf.com` alias uses the existing test SWA,
customer registration, API and data, not production. Keep the generated test
URL working. Register the exact additional SPA callback/logout return
`https://dev.perlygolf.com/?event-auth=1` and allow only the exact additional
HTTPS API origin. No new credentials, Graph grants or event permissions are
needed. Origin-derived MSAL settings require no rebuild, but sessions do not
transfer between origins.

Follow the [domain setup and rollback sequence](../infra/README.md#optional-dev-alias-for-the-existing-test-environment).
Preserve `enableDevDomain: true` in approved private redeployment parameters
after setup, or a later infrastructure deployment would remove dev from CORS.
The shared production DNS zone stays outside the test stack's ownership.
Actual dev email-code completion, authorized event read/create/reload and
logout remain manual verification boundaries; no automated form check
establishes those outcomes.

## Local configuration

### Local catalog/setup implementation and seed boundary

The next local slice reuses the existing application table and runtime identity;
it creates no storage resources, operator data-plane grants or directory roles.
Catalog partitions are distinct from event partitions and metadata row names.
Only the exact configured organizer `(tid, oid)` may use catalog APIs, via an
explicit `canManageCatalog` capability, not a browser-supplied role or inferred
event ownership. Private event reads still check authoritative membership;
public projections require active state and withhold catalog/audit/index fields.
Owner setup writes additionally require catalog authority
for selecting global data; other owners remain default-denied for that access.

Import accepts validated course metadata and complete per-profile records in
separate requests under the existing 4 KiB body limit. Incomplete staging is not
a selectable course. Publication creates a content-addressed immutable version
and conditionally advances the reusable catalog entry. Requests and publication
are retryable without duplicating courses or silently replacing newer data.
Source category, every profile's own holes and Total/Front/Back ratings, units,
season and source identifiers are preserved. Missing source numbers stay null;
they are not invented. Source provenance records the organizer's attribution
and optional known export date; import time is not source freshness.
Published and staged course previews show one explicitly selected tee profile.
Changing this preview changes no saved-round selection or immutable snapshot,
and does not omit any profile from import validation, staging or publication.

Player profiles, login identities, event roster membership and round entries
are separate. Dated, source-attributed manual index observations are audited.
An older effective date may add history without replacing the newer current
projection; a same-date correction requires the current revision. There is no
official GHIN fetch/post or automatic index calculation. Unknown remains null.
An optional initial manual index is created atomically with a new player and
its first audit observation. Creation retries compare the complete original
name/index/date/source payload; a failed write cannot leave a player without
the requested observation.
Only owner workspace data contains captured index observations; participant
projections omit them and their audit identities.

Round setup stores explicit course-version/tee and player input snapshots.
Later catalog/index changes do not silently update configured rounds. New
rounds/players capture selected/current inputs; changing a saved round's
handicap treatment is outside this increment. Existing configured rounds cannot
be silently removed by a whole-workspace save. Setup requires at least four
players, with no golfer/team/group-count ceiling. Playing groups contain at
most four golfers, with positive safe-integer group numbers and one assignment
per golfer per round. Separate eight-round/16-game/32-point-row budgets remain.

The organizer's workspace shows latest catalog values separately from captured
round inputs. `POST /api/events/<event-id>/workspace/rounds/<round-id>/indices/refresh`
is an explicit setup action with `If-Match` and a UUID `Idempotency-Key`.
It requires the active event's current owner grant plus catalog authority.
The conditional event/owner/round transaction records prior/new captures and
the actor/time in an immutable receipt; retry does not duplicate that history.
It leaves course, tee, roster groups and global player observations untouched.
This is not automatic refresh, net calculation or permission to revise future
scored/locked rounds; the scoring increment must define and enforce those rules.

No live source seed is performed by implementing or testing this workflow.
After a separately approved release/review, the organizer may select the
authorized private JSON in the import UI and publish through authenticated,
validated endpoints. Do not write to Azure Tables as a subscription Owner,
grant temporary data rights, submit Graph consent or embed exports in a
deployment package to bypass that workflow. Test fixtures must be fictional.
Local dry-run validation reads only the individually authorized file and
prints validation/payload summaries, never uploads it. Scoring, admission,
offline synchronization and production changes require later approval.

The local adapter uses separate durable quotas: catalog reads/writes are
60 per user/minute, workspace reads 60 and workspace writes 30. The original
event/identity quotas remain. Ordinary course/player/score bodies retain 4 KiB;
setup/game/purse parts use 12 KiB. Course profiles are
staged individually rather than raising the global body limit. Staged imports,
immutable course versions and index history have no automatic purge/expiry
in this increment; retention and cleanup are separate policy work.

The frontend demo and unconfigured Events screen work without an account or
environment values. For an approved test identity/API, copy `.env.example` to
an ignored `.env.local` and supply the five values. `VITE_ENTRA_API_SCOPE` is
the fully qualified `api://<API-client-ID>/Events.Access` scope, not the SPA ID.
`VITE_API_URL` includes the `/api` path. HTTPS is required except loopback HTTP.
Vite embeds these public application settings at build time; never put a
secret, private roster or storage credential in a `VITE_` variable.

`VITE_ENTRA_TENANT_ID` is the customer tenant GUID, not the hosting/deployment
tenant. The authority includes that explicit tenant path: current MSAL
validates CIAM discovery issuers strictly, and name-only discovery can return
a GUID-based issuer that it rejects. Do not disable issuer validation or trust
arbitrary authority hosts to work around that mismatch.

The API uses Functions Core Tools v4, installed separately through an approved
source. Run `npm run dev:api` after configuration. Missing Core Tools is an
explicit prerequisite failure, not a working local API. The production bundle
is `api/dist/`; its entry point is declared in `api/package.json`.

Create ignored `api/local.settings.json` locally with `IsEncrypted: false`,
`Values.FUNCTIONS_WORKER_RUNTIME: "node"` and these environment values:

| API setting | Meaning |
|-------------|---------|
| `ENTRA_TENANT_ID` | Approved customer directory ID |
| `ENTRA_ISSUER` | Exact issuer from that tenant's trusted discovery document |
| `ENTRA_JWKS_URL` | Trusted HTTPS signing-key URL from the same document |
| `ENTRA_API_CLIENT_ID` | API audience/client ID, using v2 tokens |
| `ENTRA_SPA_CLIENT_ID` | Only permitted browser client |
| `ENTRA_API_SCOPE` | Delegated scope claim value, e.g. `Events.Access` |
| `EVENT_CREATOR_OBJECT_ID` | Verified initial creator's customer object ID |
| `EVENTS_TABLE_ENDPOINT` | HTTPS application storage endpoint |
| `EVENTS_TABLE_NAME` | Precreated application table name |

Functions host storage settings depend on the approved hosting plan and local
host setup. The current data adapter requires HTTPS plus DefaultAzureCredential
and does not accept a browser token or a storage connection string. A local
developer needs separately approved data access; configuration does not create
a table or grant access. Azurite integration is not yet provided or verified.
Never use an emulated/local identity bypass in a production build.

## Threat model and enforced controls

Treat callers, browser state, token contents before verification, body fields,
pagination cursors and client ownership claims as untrusted. Protect private
management data, owner/creator grants, immutable audits, identity sessions and the
cloud bill. A directory administrator, application creator and event owner
are separate trust boundaries.

| Threat | Current control |
|--------|-----------------|
| Forged/wrong API token | Fixed JWT metadata/claims; negative tests |
| Management escalation | Owner grants; no public management writes |
| Anonymous score changes | Public edits allowed; unverified actor audit |
| Lost response/replay | UUID idempotency; atomic metadata/owner writes |
| Oversized writes/reads | Streaming body cap; bounded discovery pages |
| Request floods | Durable quotas; bounded conflict retries |
| Quota-store outage | Fail closed, no unlimited in-memory fallback |
| Secret/private-data leakage | Managed identity; safe diagnostic fields |
| Stale/logout UI | Abort reads; session expiry; provider logout; no-store |

Ordinary JSON writes are limited to 4 KiB, event names to 100 characters and authorization
headers to 8 KiB. Discovery scans at most 50 metadata rows/page and rechecks
active state (public) or membership (private) before returning each event.
Public counters are shared site/event budgets, not per-person limits.
Private quotas are 20 identity reads, 60 event
reads, 10 creates and 10 archive/restore requests per user/minute. Reusing an
idempotency key with changed
content or identity conflicts rather than overwriting. Real key rotation,
provider outages and storage transaction behavior still need integration tests.

Fixed-minute quotas allow bursts across minute boundaries. Counters are one
reused row per identity/endpoint, not an unbounded row per minute, and remain
application data subject to the eventual deletion policy. A valid but uninvited
directory identity can still consume authentication, quota/storage operations
and bounded event-discovery work; it cannot read event data.

Missing entity handling checks the exact Table Storage `ResourceNotFound`
service code, including the SDK's nested `details.odataError.code` shape.
A missing table, an unclassified 404 or a permission/outage error is not an
empty event list or an unlimited quota. A loopback HTTP test exercises actual
SDK error deserialization and first-counter creation without Azure credentials.
Service-failure logs contain bounded error type/code/status and network-cause
codes plus invocation IDs, never raw exception messages, bodies or tokens.

These are application limits, NOT a global ingress or volumetric DDoS defense.
Requests with bad tokens can reach Functions before authentication; request
bytes may reach the platform before the handler's streaming cap. Multi-account
signup, OTP email abuse, signature-verification load, cold starts, storage/JWKS
availability and invocation/logging costs remain material. Configure platform
body/concurrency/scale limits, narrow CORS, provider abuse controls and bounded
telemetry during the approved deployment design. Confirm actual multi-instance
behavior, rather than relying solely on mock counter tests.

An enforceable pre-authentication edge limit/WAF/APIM would change resources
and costs and is not included or approved. Accept that residual risk explicitly
or approve a scoped edge proposal before exposing production APIs. Do not call
direct Functions exposure fully abuse-proof. Budget alerts are not hard caps.

Provider-managed OTP delivery needs mailbox/spam/quarantine, resend/throttling
and expired-code verification. Core External ID has a shared first-50,000-MAU
free tier; default OTP email is not separately priced in the reviewed table,
which is not a promise of unlimited sending or guaranteed delivery. Branded
mail needs a provider extension and ACS/another relay with separate cost and
permissions. Automated invitation email is separate scope.

Run `npm run check:dependencies` for high/critical production dependency
advisories and `npm audit` for the whole toolchain. A production-only audit
does not clear development-tool advisories. Do not expose Vite/Vitest/test
servers publicly. CI runs all named tests; a clean type/lint run is not proof
of secure deployed identity or storage configuration.

Before production, review implemented auth/data flows and deployed settings.
Exercise missing/expired/forged/wrong-audience tokens, membership revocation,
cross-event requests, owner-vs-creator separation, idempotency races, actual
quota conflicts across instances and storage/JWKS failures. Add score-specific
bounds, object permission tests, concurrent edits and audit transactions before
shipping score endpoints.

Create operational alerts for authentication failures, authorization denials,
throttles, service failures, anomalous writes and cost. Current structured
diagnostics contain only code/status/invocation ID; dashboards, alert rules,
sampling/retention and diagnostic costs are not yet provisioned. Do not log
JWTs, OTPs, request bodies, emails or full exceptions containing private data.

## Reproducible infrastructure scaffold

The separately approved [test-only Bicep definitions](../infra/README.md) contain
pinned modules and an unconfigured environment parameter template. These were
used to provision the test foundation. Stateful retained storage is separated
from replaceable compute/host storage, with deterministic names and no real
credentials/account identifiers in this public repo.

The scoped design should cover standalone Functions/hosting/host storage,
application Table Storage, table-scoped managed-identity data roles, required
host-storage roles, minimal telemetry, CORS/settings and approved scale/cost
controls. An infrastructure operator needs reviewed provisioning/role-assignment
permissions. The application pipeline identity has only Website Contributor on
the test API; neither that identity nor runtime identity may grant roles or
administer the customer directory. Host-storage roles depend on the plan.
No wildcard Owner/Contributor data-runtime grant.

Inventory/adopt the existing SWA and DNS explicitly as existing/retained
resources; do not redeclare them as disposable defaults. Review a what-if before
any future deployment. Never use complete-mode resource-group deletion to
reconcile this app. Existing domain bindings, registrar records and the
frontend workflow remain intact until an approved replacement is ready.

### Provisioning and bootstrap approval checklist

1. Approve deployment subscription/resource scope, region/hosting plan,
   non-production isolation, scale limits, telemetry costs and residual edge
   risk. Recheck availability/pricing; no always-ready instances by default.
2. Approve a dedicated customer tenant's country/region (immutable), domain,
   billing link and directory admin/recovery ownership. Do not repurpose the
   corporate tenant or move the existing hosting subscription into this tenant.
3. Approve separate SPA/API registrations per environment, exact callback/
   logout origins, v2 API audience, OTP user flow and delegated API-only scope
   consent. Do not grant Graph directory-wide access or customer admin roles.
4. Approve the resource IaC scaffold, then review what-if before execution.
   Create application/host storage and narrowly scoped API managed identity;
   verify actual identity permissions and denied access outside its table.
5. After verified customer sign-in, independently verify the intended creator's
   tenant/object ID and set the one-time creator configuration. Record the
   private operational evidence outside source control. No first-user bootstrap.
6. Approve API deployment identity/workflow and environment settings separately;
   keep the existing frontend workflow. No browser/deployment secret in commits.
7. Prove real OTP, token/API isolation, Azure Table transactions/quotas and
   restore checks on the approved test target before production cutover.

### Recreation is not restoration

- **Code/compute:** rebuild pinned source/lockfile and approved IaC; verify
  artifacts and configuration.
- **Event/score/audit data:** restore a separately protected consistent backup,
  not an empty recreated table.
- **External ID:** retain tenant and customer object identities. A new tenant
  needs an approved identity remapping/migration, not just redeployed code.
- **Creator/owner grants:** restore trusted private mappings or repeat verified
  bootstrap. Never infer ownership from email.
- **DNS/domains/registrar/SWA:** retain/adopt existing assets and validate
  rebinding without losing domain control.
- **Secrets:** recreate/rotate privately and update the appropriate secret store.
  IaC output is not secret recovery.
- **GitHub:** restore approved environments/permissions and verify exact artifact
  deployment. Source files do not restore secret values or external trust.

Retention, deletion obligations, RPO (acceptable data loss) and RTO (time to
recover) remain user decisions. Do not invent a backup frequency or claim
Table Storage has built-in point-in-time recovery. Before real scores, approve
a consistent, encrypted export/backup with a schema version, snapshot boundary,
checksums, access separation, retention and deletion handling. The backup must
cover event/membership/round/score/revision relationships as implemented, not
just current totals. An audit log or LRS replication alone is not a backup.

Rehearse restore into isolated storage with a frozen write boundary or a
documented snapshot/change sequence. Verify counts/checksums, relationship
integrity, immutable audit ordering, identity mapping, memberships, revoked
access, idempotent retry behavior, required new ETags and real authorized/
unauthorized API calls. Do not restore old ETags as active concurrency tokens.
Keep backup data out of public CI artifacts, fixtures and this repository.

Any future teardown needs an explicit reviewed resource list and user approval.
Retain the external tenant/users, protected application data/backups, DNS/
registrar/domain ownership and GitHub recovery configuration by default.
First verify an independent usable backup, stop writes, document last-good
revision/configuration and confirm a tested restore path. Removing compute
does not authorize deleting data, identities, DNS, roles or the resource group.
Teardown scripts and restore automation are not implemented.
