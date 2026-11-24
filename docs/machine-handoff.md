# Moving development to another machine

This guide transfers development, not Azure resources or application data.
The repository is public. Never commit credentials, real golf data, tenant or
subscription identifiers, local corporate feeds, or private release evidence.

## What transfers

| Material | Transfer method |
| --- | --- |
| Source, tests, docs, workflows and IaC | Git clone or verified bundle |
| Unmerged work | Separate feature branches; do not silently merge them |
| GitHub Actions configuration | Retained on the existing GitHub repository |
| GitHub variables and secrets | Remain on GitHub; local settings are private |
| Azure resources, data, roles and identity | Remain in Azure; sign in afresh |
| Local parameters, evidence and references | Reviewed private transfer |
| Copilot history, skills, plugins and squad | Separate private migration |
| npm, GitHub and Azure login caches | Do not copy; sign in afresh |
| Dependencies, builds and browsers | Restore from approved sources |

A clone is not a database backup, a restore of GitHub secrets, or an Azure access
grant. Do not copy a linked worktree's `.git` file: it points at the old machine.

## Choose the correct branch

The default branch `main` is **not** the current TEST application branch.
The existing TEST workflow deploys
`ryperl-microsoft-perly-golf-foundation`; `main` triggers production publication.

For this transfer, `ryperl/machine-handoff` contains this guide and the current
application baseline. Separate pending features remain on their own branches:

- `ryperl-microsoft-game-starts-and-handicaps`: Dots game descriptions.
- `ryperl-microsoft-dots-category-sweeps`: compact per-hole dot breakdowns.

These descriptions record the handoff inventory, not permanent branch purposes.
Consult the private transfer manifest for exact revisions and publication state.
The feature branches overlap older work; do not merge both blindly into a newer
application. Review their net changes first.

Use Git Bash on Windows or a shell on macOS/Linux for the examples:

```bash
gh auth login --hostname github.com --git-protocol https --web
gh auth status --hostname github.com
gh api repos/ryperl/perlygolfmax --jq '{default_branch,permissions}'
gh repo clone ryperl/perlygolfmax
cd perlygolfmax
git fetch origin
git switch --track origin/ryperl/machine-handoff
git status --short
git log -1 --format='%H %s'
```

Select the personal GitHub account with access to `ryperl/perlygolfmax`, not a
corporate account that cannot push to it. Never print or copy an authentication
token into the handoff. If you use SSH instead, enroll a new approved key rather
than sharing the old machine's private key.

Before resuming deployment work, inspect the current remote foundation branch
and recent runs. Do not reset your local work to an assumed historical revision.
Develop changes locally; publication still needs explicit approval.

## Offline Git bundle alternative

The companion bundle preserves named local branches and tags, including unmerged
commits. It excludes app checkpoint refs, ignored files and authentication state.
Copy it through an approved private channel and verify its recorded SHA-256.

```bash
git clone --branch ryperl/machine-handoff \
  /approved/transfer/perlygolfmax.bundle perlygolfmax
cd perlygolfmax
git bundle verify /approved/transfer/perlygolfmax.bundle
git remote set-url origin https://github.com/ryperl/perlygolfmax.git
git fetch origin
```

Inspect `git branch -a` and the manifest. Selecting the handoff branch explicitly
avoids a stale default checkout. The bundle preserves the old local `main`
reference; fetch before treating it as current GitHub `main`. An offline bundle
cannot tell you whether GitHub has newer commits until you fetch.

## Install and verify locally

Use the Node version in `.nvmrc` and the npm version documented in the README.
Install Git, GitHub CLI, Azure CLI and any optional Functions Core Tools v4
through approved channels. Install Docker only if you intend to reproduce the
existing containerized CI browser checks; ordinary local development does not
need it.

Check the effective npm registry and relevant scope configuration before
installing. Use an approved local feed, never a public-registry fallback on a
restricted machine. Keep feed authentication in ignored local configuration.
The lockfile contains public package URLs; verify that your approved tooling
handles those URLs without bypassing policy. If it cannot, stop and resolve the
feed configuration rather than rewriting package provenance or disabling TLS.

```bash
nvm use
node --version
npm --version
npm config get registry
npm config get @azure:registry
npm ci
npm run check:lockfile
npm run typecheck
npm run lint
npm run lint:docs
npm test
npm run build
```

After dependencies exist, use the installed Playwright CLI rather than an `npx`
fallback that could download an npm package:

```bash
node node_modules/@playwright/test/cli.js install chromium webkit
npm run test:smoke
npm run dev
```

Browser downloads and Linux system dependencies require their own approved
source/permissions. Keep port 4173 free for smoke tests. Read actual PASS/FAIL
lines; a command that selected no tests is not verification.

## Reconnect to the existing Azure subscription

Use the **private** companion inventory to identify the existing hosting
subscription, deployment tenant, resource group and resources. Do not infer
these from the current CLI account or provision replacements.

```bash
az login --tenant <hosting-tenant-id>
az account list --query "[].{name:name,id:id,isDefault:isDefault}" -o table
az account set --subscription <approved-subscription-id>
az account show --query "{name:name,id:id,tenantId:tenantId}" -o json
az group show --name <existing-test-resource-group> \
  --query "{name:name,location:location}" -o json
```

If browser sign-in is unavailable, use the Azure CLI's supported device-code
flow when permitted. Passwords, consent and MFA stay with the identity provider.
The hosting/deployment tenant differs from the customer sign-in tenant.

Azure permissions belong to the signed-in identity, not the machine. Existing
roles continue for the same identity. Missing permissions require a separately
approved grant; this guide does not grant Owner, directory administration or
storage access.

The Functions runtime managed identity, GitHub deployment identity, local Azure
developer and customer organizer are distinct. GitHub deploys the API through
its existing environment-bound OIDC identity, not your laptop's token.
Local API development uses DefaultAzureCredential and needs approved data-plane
access to the configured table; subscription access alone does not establish it.
Never substitute account keys or direct production table writes.

## Recreate only the local configuration you need

The fictional preview and unconfigured UI work with no Azure configuration.
For the existing TEST UI, copy `.env.example` to ignored `.env.local`.
Obtain approved values from `perlygolfmax-test` on GitHub:

```bash
gh api --method GET \
  repos/ryperl/perlygolfmax/environments/perlygolfmax-test/variables \
  -f per_page=100 \
  --jq '{total_count,names:[.variables[].name]}'
gh api \
  repos/ryperl/perlygolfmax/environments/perlygolfmax-test/secrets \
  --jq '{total_count,names:[.secrets[].name]}'
```

Use explicit pagination and check the count. Map `AZURE_TEST_API_URL` to
`VITE_API_URL`; retain the four `VITE_ENTRA_*` settings by name. Vite embeds
these values at build time: they must never contain secrets.

GitHub cannot return secret values through these APIs. Existing secrets remain
usable by Actions; if recovery is necessary, rotate/reissue privately rather
than pretending Git can recover them. Do not copy CLI token caches.

Local Functions configuration is optional. See
[the local API configuration](operations.md#local-configuration)
and `api/src/config.ts` for required settings. Keep `api/local.settings.json`
ignored. Do not copy all deployed settings into a public file.

## GitHub Actions and release boundaries

Keep the same repository and its existing `perlygolfmax-test` environment.
Its variables, deployment secret, OIDC federation and approvals are server-side.
Moving a laptop does not require recreating them.

| Workflow | Purpose and trigger |
| --- | --- |
| `ci.yml` | PRs/non-main pushes; locked checks/build/browsers |
| `deploy-test.yml` | Foundation push/approved dispatch; API first |
| `deploy.yml` | Production frontend publication from `main` |

The TEST workflow requires both CI validation and configured packaging before
API deployment, then frontend exact-artifact checks and hosted sign-in.
Do not bypass these gates or start competing publishers.

```bash
gh run list --repo ryperl/perlygolfmax --workflow deploy-test.yml --limit 5
gh run view <run-id> --repo ryperl/perlygolfmax
gh run watch <run-id> --repo ryperl/perlygolfmax --exit-status
```

These are inspection commands, not deployment authorization. A push to the
foundation branch publishes TEST; a push to `main` publishes production.
Never push a branch or dispatch a release merely to check access.

Read [operations](operations.md), [game rules](game-rules.md) and
[infrastructure boundaries](../infra/README.md) before changing behavior or
releasing. Routine application publication must not apply IaC. In particular,
example parameters may disable services or omit the existing dev alias; do not
replay them against live resources. Keep captured data, identities, DNS, limits
and resource scopes unchanged. Azure prepare/validate/deploy procedures and
their approvals remain required for deployment work.

## Transfer completion checklist

- Verify the selected branch and exact manifest revision, including both
  unmerged feature branches.
- Complete local checks and a fictional preview without writing live data.
- Verify GitHub access, existing environment metadata and recent Actions runs.
- Sign in to the correct Azure tenant/subscription and verify existing resources
  read-only. Do not claim write/data-plane access from a successful login alone.
- Recreate needed local configuration privately; verify it is ignored.
- Transfer selected private evidence separately, only if needed for continuity.
- Keep the old machine and private records until the new machine is verified.
