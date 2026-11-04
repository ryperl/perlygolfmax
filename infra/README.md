# Isolated test infrastructure

These are **versioned test-only Bicep definitions**. The foundation has now been
provisioned under separate user approval; that is not permission for arbitrary
redeployment, deletion, production changes or access expansion.

The user also approved a test-only deployment identity/environment and a
dedicated US customer test tenant. The API remains disabled until verified
identity configuration/bootstrap. Customer flow setup is not implied by the
mere existence of an Azure directory resource.

## Scope and proposed defaults

`main.bicep` is a subscription-scoped entry point restricted to a new
`rg-perlygolfmax-test` resource group in `westus2`. It does not contain a
subscription ID. Select the approved subscription explicitly when eventually
reviewing/deploying it; a template cannot protect against choosing the wrong
subscription.

It composes the following resources:

- A new Free Static Web App, with an Azure-generated HTTPS address.
- One Node 22 Functions Flex app/plan, 2,048 MB instances, HTTP concurrency 8,
  at most two on-demand instances by default, and zero always-ready instances.
- A separate LRS host/deployment account and private package container.
- An LRS application data account/table with a `CanNotDelete` management lock.
- Application Insights with AAD-only ingestion and a Log Analytics workspace
  proposing 30-day diagnostic retention and a 0.1 GB daily ingestion cap.
- Only three runtime grants: Blob Data Owner on the host account, Table Data
  Contributor on the single application table, and Metrics Publisher on the
  Application Insights component. No human grants or deployment identity.

The host is disabled by default. `enableApi` controls host startup independently
of identity configuration because OneDeploy rejects a disabled host. The user
separately approved enabling the test host for deployment while identity stays
unconfigured. In that state, actual application endpoints must return an
explicit unavailable response without touching stored event data. Host startup
is not permission to bypass authentication or bootstrap.

These are proposed TEST defaults for review, not approved production retention,
an SLA or a hard spending cap. Daily log caps can overshoot and cause missing
diagnostics; instance limits do not bound total billed executions/storage/email.
There is no edge WAF, private network, custom domain, mail service, database
backup/export job or paid SWA upgrade. Direct Functions ingress/OTP abuse
risks remain as described in [operations](../docs/operations.md).

Production SWA/DNS/domain resources are deliberately outside this template.
The foundation has no linked SWA API, custom domains, repository tokens,
generated workflows, provider registration actions or teardown commands.
Additional approved identity/access lifecycles have separate entry points:

- `pipeline-access.bicep`: user-assigned deployment identity, one environment-
  bound GitHub federation and Website Contributor on the test Function App.
  Use `pipeline.parameters.example.json` for the confirmed Azure region.
- `customer-tenant.bicep`: the explicitly approved US Base/A0 customer test
  directory and a retention lock. Treat identity creation as a separately
  reviewed operation; retain the resulting directory and do not assume that
  replaying creation is a migration/restore mechanism.

These are not part of routine application releases. Runtime identity and
deployment identity are distinct; the deployment identity has no direct
storage grants or customer-directory administration role.

The live customer-directory provider requires `Base/A0` and a fully qualified
`onmicrosoft.com` resource name. Its published 2023 schema documentation lists
different SKU/name constraints; provider preflight, not that stale description,
is the validation authority. The output subdomain remains the bare prefix.

## Source and reproducibility

The Functions composition comes from the official TypeScript HTTP template
discovered in Microsoft's template manifest, version 1.10.3:

- [Template manifest][manifest]
- [Quickstart revision][quickstart]:
  `5b01cb3aa4ffb0f59820548e5abbae07f41831c9` (`v1.0.1`).
- Adapted portions retain the [Microsoft MIT notice][license].

The template's non-VNet path, identity-based host/deployment storage, Flex
runtime configuration, host Blob Data Owner and Metrics Publisher patterns
are retained. The app uses the sample's supported system-assigned identity
variant instead of adding a user-assigned identity. New table access is
narrowed to the application table; automatic developer grants are not enabled.
Shared keys are never a fallback for RBAC propagation.

Verified-module versions are pinned in source:

| Module | Version |
|--------|---------|
| Static Web App | 0.9.6 |
| Storage account | 0.8.3 |
| App Service plan | 0.1.1 |
| Web/Functions site | 0.15.1 |
| Application Insights | 0.6.0 |

The workspace is a local typed resource because the sample's workspace module
accepts only integer-GB daily caps; the proposed test cap is fractional.
Compiled AVM templates contain unused optional resource branches. Their mere
presence does not mean they are deployed; inspect module inputs and the actual
Azure what-if before approving execution.

Names derive deterministically from the test resource-group ID. Preserve that
group, data account name and parameter history when recreating compute. Moving
the group or changing the naming inputs may create empty replacement storage;
that is not a data restore.

## Local checks without npm

Use an approved Bicep compiler. On this machine, v0.48.1 crashed during .NET
TLS certificate handling while restoring modules; the official stable
v0.38.33 restored and compiled successfully without changing certificate checks.
Do not disable TLS validation or certificate policies to restore modules.

After an explicitly approved compiler installation, restore the pinned
Microsoft modules once:

```bash
az bicep restore --file infra/main.bicep
```

Then compile and inspect the actual ARM representation entirely from the
restored cache:

```bash
node --test infra/infra.test.mjs
```

The test runner uses `~/.azure/bin/bicep` (or `.exe` on Windows).
Set `BICEP_CLI` if your approved compiler is elsewhere. It invokes
`build --no-restore`, does not install tooling or contact npm, and fails
explicitly when the compiler/modules are unavailable.

The checks cover test-only scope, Free hosting, private/keyless storage,
protected application data, disabled/unconfigured API defaults, actual runtime
settings, every environment key required by `api/src/config.ts`, narrow role
scopes and bounded telemetry. These checks are not ARM provider validation,
deployed authorization tests or a disaster-recovery rehearsal.

## Parameter and deployment ordering

The checked-in `test.parameters.example.json` contains no tenant/user/client
IDs or credentials. Copy it to ignored `test.local.parameters.json` only when
populating an approved environment. Identity identifiers are public protocol
metadata, not secrets, but must still remain out of this public repository.
The typed identity input accepts configuration fields, never passwords,
client secrets, OTPs, tokens or storage credentials.

The configuration states are:

1. `state: unconfigured`, `enableApi: false` for resource foundation review.
2. `state: configured` with privately supplied `tenantId`, `issuer`,
   `jwksUrl`, `apiClientId`, `spaClientId`, `scope` and verified
   `creatorObjectId`. A malformed configuration still fails the API's runtime
   checks; setting this label is not evidence that identity has been verified.
3. `enableApi: true` after host-startup approval, code deployment and RBAC
   checks. Until verified identity/bootstrap is supplied, require the deployed
   application endpoints to fail closed. Do not equate host readiness with
   a functioning sign-in/data flow.

The future execution sequence, requiring separate approvals, is:

1. Confirm subscription, resource inventory, region/capacity, prices and test
   defaults. Check whether the named test group already exists; do not adopt
   unmanaged resources automatically.
2. Review an Azure what-if. It must not change production resources or DNS.
   Verify all providers are registered; registering another provider is an
   explicit operation, not a template prerequisite to perform silently.
3. Approve provisioning the test foundation. Resource creation and its declared
   managed-identity role assignments are separate from scaffold generation.
4. Choose/create the customer tenant and OTP user flow; approve registrations,
   delegated API consent, admin recovery and exact callbacks. Customer directory
   geography is separate from the Azure resource region.
5. Configure and deploy the test frontend with build-time public client/API
   settings. Approve API deployment identity/workflow separately. No dependency
   request from the blocked local npm source is required.
6. Verify the intended customer's sign-in and object ID out of band, populate
   creator/API configuration privately, approve the final API enabling step
   and deploy/verify through the supported Flex OneDeploy path.
7. Test actual OTP delivery, callbacks/CORS, token rejection, event isolation,
   owner/creator separation, saved events, quota conflicts and storage failures.

The resource foundation and application release are deliberately separate.
Stopped-app deployment behavior, the precise package/deployment workflow and
any provider-specific validation need testing before this sequence is treated
as executable production automation.

The generated frontend URL plus `/?event-auth=1` is the test callback. The API
output includes `/api`. Local development uses a distinct development SPA
registration and exact `http://localhost:5173/?event-auth=1` callback. The test
API permits the generated test origin and `http://localhost:5173`, not
production origins or a wildcard. Production must not inherit local CORS.

## Test application pipeline

`deploy-test.yml` runs CI first, then builds a test-specific frontend and a
precompiled API package. Package installation/auditing occurs on the public
GitHub runner, not through the blocked local npm connection. The archive
whitelists compiled API code, `host.json`, its manifest and installed production
dependencies; it excludes local settings/environment/feed files and the
workspace symlink. An import check exercises the emitted shared-contract paths.

Deployments consume those exact artifacts without remote Oryx/npm rebuilds.
Frontend verification compares the served HTML and every JS/CSS asset with the
uploaded bytes. API upload uses the pinned official Functions action's Flex
OneDeploy path and OIDC. Uploading code does not enable a disabled API.

The `perlygolfmax-test` GitHub environment must restrict deployment to
`ryperl-microsoft-perly-golf-foundation`. Azure federation trusts exactly
`repo:ryperl@<owner-id>/perlygolfmax@<repo-id>:environment:perlygolfmax-test`.
Supply immutable IDs privately from current GitHub repository metadata; do
not deploy the example zero placeholders. The workflow never runs
on pull-request events, and only its API deployment job has `id-token: write`.
Production's token/environment/workflow are not reused.

Environment variables are `AZURE_TEST_CLIENT_ID`, `AZURE_TEST_TENANT_ID`,
`AZURE_TEST_SUBSCRIPTION_ID`, `AZURE_TEST_RESOURCE_GROUP`, `AZURE_TEST_API_NAME`,
`AZURE_TEST_API_URL` and `AZURE_TEST_FRONTEND_URL`. The separate encrypted secret
is `AZURE_STATIC_WEB_APPS_TEST_API_TOKEN`.

Leave all customer identity `VITE_ENTRA_*` variables absent for a clearly
unconfigured foundation deployment. When ready, supply the development SPA
client ID, customer subdomain and fully qualified API scope together. Partial
identity configuration fails deployment. The build injects the API URL only
with complete identity configuration; configured browser smoke checks require
the sign-in UI but do not attempt to retrieve/send real email codes.

`AZURE_TEST_API_READY` declares only the deployment check's expected state;
it never authorizes a request. Absent/false requires actual no-store 503
`SERVICE_NOT_CONFIGURED` responses. Set it true only after verified creator/
server configuration; then unauthenticated probes must return no-store 401
`AUTHENTICATION_REQUIRED`. Frontend sign-in configuration alone must not skip
server access verification.

New workflow-dispatch files may not be dispatchable until present on the
default branch. The approved feature-branch push trigger starts testing without
requiring a main merge. Changing the allowed branch or widening federation
requires explicit approval.

## Customer registrations and email-code flow

`scripts/configure-test-apps.mjs` is plan-only unless explicitly given `--apply`.
After approving customer registrations/API consent, it reads the private Azure
deployment records, verifies the exact US CIAM test organization, and creates
secretless test API/Web registrations plus Events.Access-only consent.
It rejects untracked duplicate app names and preserves private IDs/state under
`.azure/`; no real identities or client IDs are committed. Customer apps get
no Microsoft Graph data permissions, credentials or directory roles.

User-flow management is separate. Azure CLI's first-party client is not
preauthorized for IdentityProvider/EventListener management scopes: tenant
consent alone does not override Microsoft's API-owner restriction
(`AADSTS65002`). An attempted administrator-only temporary setup grant was
removed and its deletion verified. Do not retry by weakening policies or
borrowing another first-party client identity.

Use the supported Entra portal in the `Perly Golf Max Test` directory to create
an email **one-time passcode** customer sign-up/sign-in flow and associate
`Perly Golf Max Test Web`. Do not select password or corporate guest invitation
flows. Signing in creates no event membership or creator permission.
Portal completion is user-reported until actual hosted sign-in is verified;
creator bootstrap still requires independent confirmation of the customer's
identity. Keep frontend identity variables absent until the flow is ready.

## Retained assets and recovery gates

Application data is separate from host/package storage and deletion-locked.
That lock is a safety barrier, not a backup or retention policy; it does not
prevent authorized data-plane score/event changes. Do not remove it or delete
the resource group as part of routine compute cleanup.

Customer tenant/users, creator/owner mappings, backups, DNS/domain ownership,
and GitHub secrets/trust are not recreated by this scaffold. Recreating a
system-assigned API identity changes its principal ID and requires reapproved
role assignments; stale grants need separately reviewed cleanup. Event users
retain their customer identities only if that external tenant is retained.

Before real scores, settle retention/RPO/RTO, implement a protected consistent
backup/export, and rehearse isolated restore and revoked-access checks.
See the [operations guide](../docs/operations.md) for the full recovery boundary.
No backup implementation, real-data migration or teardown is authorized here.

[manifest]: https://cdn.functions.azure.com/public/templates-manifest/manifest.json
[quickstart]: https://github.com/Azure-Samples/functions-quickstart-typescript-azd/tree/5b01cb3aa4ffb0f59820548e5abbae07f41831c9/infra
[license]: LICENSE.functions-template.txt
