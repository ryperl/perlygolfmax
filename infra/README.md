# Isolated test infrastructure

These are **reviewable Bicep files, not a deployed environment**. The user
approved generating this test scaffold, not creating resources, assigning
roles, creating customer identities, pushing code or deploying applications.
The only separately approved Azure change so far was registering the
`Microsoft.Quota` provider for capacity inspection.

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

The API is disabled by default. `enableApi` is effective only when the typed
identity configuration is also marked `configured`. This is a safe foundation
phase, not a functioning sign-in environment. The frontend is initially empty
until its separately approved application deployment.

These are proposed TEST defaults for review, not approved production retention,
an SLA or a hard spending cap. Daily log caps can overshoot and cause missing
diagnostics; instance limits do not bound total billed executions/storage/email.
There is no edge WAF, private network, custom domain, mail service, database
backup/export job or paid SWA upgrade. Direct Functions ingress/OTP abuse
risks remain as described in [operations](../docs/operations.md).

Production SWA/DNS/domain resources are deliberately outside this template.
There are no linked SWA APIs or custom domains, repository tokens, generated
GitHub workflows, customer tenant registrations, provider registration actions,
or teardown commands.

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
3. `enableApi: true` only after approved identity, code deployment, RBAC
   propagation, quota checks and access validation.

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
