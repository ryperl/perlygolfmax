# Operational architecture and recovery

## Status and approval boundary

The approved design is Static Web Apps (SWA) Free, Entra External ID hosted
email-code sign-in, a standalone Functions API and Table Storage. The production
planning allowance is roughly USD 15/month, not a quote or spending cap.

The repository contains an initial implementation with a provisioned test
foundation, not a connected operational scoreboard:
customer sign-in, token acquisition, API handlers, bounded event discovery and
idempotent event creation with atomic owner membership. Manual test verification
has exercised hosted customer sign-in, signed-in event loading and event
creation followed by a page reload. Runtime resource settings and narrow
role scopes have been read back after foundation creation. Those checks do not
prove all authorization, concurrency or recovery boundaries.
No invitations, owner appointment UI, rounds,
score-entry endpoints, scoring engine, audit exports or backup job are shipped.
An unconfigured Events page says so explicitly, without fictional saved events.

Further tenant, consent, role, resource, push and deployment changes require the
relevant scope approval. The production frontend deployment workflow is
unchanged. The separate test workflow publishes validated frontend/API
artifacts, never infrastructure or production, and does not enable the API.

## Identity and application authority

React uses MSAL authorization code with PKCE against a dedicated customer
tenant's hosted email one-time-passcode flow. No Microsoft account is required
for golfers. Configure OTP from the start; changing a password flow later does
not automatically migrate existing users. Use the default `ciamlogin.com`
login host initially; no custom mail relay/domain is implied.

The frontend calls a separate HTTPS API with an explicit bearer access token,
without cookies. It does not rely on SWA custom OIDC, `/.auth/me`, principal
headers or Functions keys. Server validation checks signature, allowed
algorithm, fixed issuer/JWKS, API audience, lifetime, tenant, delegated scope,
SPA client and user object ID. User identity is `(tid, oid)`, never display name,
email, an ID token or a client-supplied owner ID. CORS is not authentication.

Only the explicitly bootstrapped creator initially creates events. The creator
can later appoint owners of specific events; those appointments must not grant
global creation or directory administration. Event membership is authoritative
for every private object operation, not a stale listing index or hidden button.
No public roster/score access is authorized. Invitation admission mechanics and
owner-appointment lifecycle remain pending; do not infer them from sign-in.

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
new backup guarantee. Future detail, score and invitation endpoints must enforce
these lifecycle rules independently of discovery.

The score policy for a later increment is per-hole gross strokes, blank
unplayed holes, explicit picked-up/did-not-finish status, self-entry and a
round/foursome-assigned scorekeeper. Owners retain correction rights with
history. Scorekeeper assignment is not event administration. Pickup points,
Stableford, purse and financial rules are undefined; no missing value becomes
zero and no points are implied. These payloads/endpoints are not implemented.

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
event ownership. Event-local reads still check authoritative membership and
archived-state rules. Owner setup writes additionally require catalog authority
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

Player profiles, login identities, event roster membership and round entries
are separate. Dated, source-attributed manual index observations are audited.
An older effective date may add history without replacing the newer current
projection; a same-date correction requires the current revision. There is no
official GHIN fetch/post or automatic index calculation. Unknown remains null.
Only owner workspace data contains captured index observations; participant
projections omit them and their audit identities.

Round setup stores explicit course-version/tee and player input snapshots.
Later catalog/index changes do not silently update configured rounds. New
rounds/players capture selected/current inputs; changing a saved round's
handicap treatment is outside this increment. Existing configured rounds cannot
be silently removed by a whole-workspace save. Setup remains 4–8 players with
manual group numbers 1–4, at most four per group and one assignment per round.

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
event/identity quotas and 4 KiB request cap are unchanged. Course profiles are
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
event data, owner/creator grants, future scores/audit, identity sessions and the
cloud bill. A directory administrator, application creator and event owner
are separate trust boundaries.

| Threat | Current control |
|--------|-----------------|
| Forged/wrong API token | Fixed JWT metadata/claims; negative tests |
| Cross-event read/escalation | Authoritative membership; creator-only POST |
| Lost response/replay | UUID idempotency; atomic metadata/owner writes |
| Oversized writes/reads | Streaming body cap; bounded discovery pages |
| Authenticated floods | Shared ETag-based quotas; bounded conflict retries |
| Quota-store outage | Fail closed, no unlimited in-memory fallback |
| Secret/private-data leakage | Managed identity; safe diagnostic fields |
| Stale/logout UI | Abort reads; session expiry; provider logout; no-store |

JSON writes are limited to 4 KiB, event names to 100 characters and authorization
headers to 8 KiB. Discovery scans at most 50 metadata rows/page and rechecks
membership before returning each event. Quotas are 20 identity reads, 60 event
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
