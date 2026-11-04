import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

if (!process.argv.includes('--apply')) {
  console.log('Plan only: create secretless test API/SPA registrations and consent to Events.Access.');
  console.log('Use --apply only after approving this isolated test-tenant setup.');
  process.exit(0);
}

const directory = JSON.parse(readFileSync('.azure/test-customer-deployment.json', 'utf8')).properties.outputs;
const foundation = JSON.parse(readFileSync('.azure/test-foundation-outputs.json', 'utf8'));
const tenantId = directory.customerTenantId.value;
const subdomain = directory.customerTenantSubdomain.value;
const frontend = foundation.frontendUrl.value;
const token = JSON.parse(execFileSync('az', [
  'account', 'get-access-token', '--tenant', tenantId,
  '--resource-type', 'ms-graph', '--output', 'json',
], { encoding: 'utf8' })).accessToken;

async function graph(path, method = 'GET', body) {
  const response = await fetch(`https://graph.microsoft.com/v1.0/${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30000),
  });
  const result = response.status === 204 ? undefined : await response.json();
  if (!response.ok) {
    throw new Error(`Test Graph ${method} ${path.split('?')[0]} failed: ${response.status} ${result?.error?.code}`);
  }
  return result;
}

const organization = (await graph('organization?$select=id,displayName,countryLetterCode,tenantType')).value;
assert.equal(organization.length, 1);
assert.equal(organization[0].id, tenantId);
assert.equal(organization[0].tenantType, 'CIAM');
assert.equal(organization[0].countryLetterCode, 'US');
assert.equal(organization[0].displayName, 'Perly Golf Max Test');

const stateFile = '.azure/test-customer-apps.json';
const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : { tenantId, subdomain };
assert.equal(state.tenantId, tenantId, 'Test directory changed; do not overwrite identity mappings');
function save() {
  writeFileSync(stateFile, JSON.stringify(state, null, 2), { mode: 0o600 });
}

async function createApp(key, displayName, properties) {
  if (state[key]) return graph(`applications/${state[key].id}`);
  const matches = await graph(`applications?$filter=${encodeURIComponent(`displayName eq '${displayName}'`)}&$select=id,appId`);
  assert.equal(matches.value.length, 0, `Untracked ${displayName} already exists; inspect instead of adopting`);
  const app = await graph('applications', 'POST', {
    displayName, signInAudience: 'AzureADMyOrg', tags: ['perlygolfmax:test'], ...properties,
  });
  state[key] = { id: app.id, appId: app.appId };
  save();
  assert.equal(app.passwordCredentials.length, 0);
  return app;
}

state.scopeId ??= randomUUID();
save();
const api = await createApp('api', 'Perly Golf Max Test API', {
  api: {
    requestedAccessTokenVersion: 2,
    oauth2PermissionScopes: [{
      id: state.scopeId, value: 'Events.Access', type: 'Admin', isEnabled: true,
      adminConsentDisplayName: 'Access Perly Golf Max test events',
      adminConsentDescription: 'Call the test event API as a signed-in user; event permissions are checked separately.',
    }],
  },
  requiredResourceAccess: [],
});
assert.equal(api.signInAudience, 'AzureADMyOrg');
assert.equal(api.api.requestedAccessTokenVersion, 2);
assert.ok(api.api.oauth2PermissionScopes.some((scope) =>
  scope.id === state.scopeId && scope.value === 'Events.Access' && scope.isEnabled));
await graph(`applications/${api.id}`, 'PATCH', { identifierUris: [`api://${api.appId}`] });

async function principal(key, appId) {
  if (state[key]) return graph(`servicePrincipals/${state[key]}`);
  const result = await graph(`servicePrincipals?$filter=${encodeURIComponent(`appId eq '${appId}'`)}`);
  assert.ok(result.value.length <= 1);
  const servicePrincipal = result.value[0] ?? await graph('servicePrincipals', 'POST', { appId });
  state[key] = servicePrincipal.id;
  save();
  return servicePrincipal;
}

const apiPrincipal = await principal('apiPrincipalId', api.appId);
const spa = await createApp('spa', 'Perly Golf Max Test Web', {
  spa: { redirectUris: [`${frontend}/?event-auth=1`, 'http://localhost:5173/?event-auth=1'] },
  requiredResourceAccess: [{
    resourceAppId: api.appId, resourceAccess: [{ id: state.scopeId, type: 'Scope' }],
  }],
  api: { requestedAccessTokenVersion: 2 },
});
assert.equal(spa.signInAudience, 'AzureADMyOrg');
assert.deepEqual([...spa.spa.redirectUris].sort(), [
  `${frontend}/?event-auth=1`, 'http://localhost:5173/?event-auth=1',
].sort());
const spaPrincipal = await principal('spaPrincipalId', spa.appId);
const existingGrants = await graph(`oauth2PermissionGrants?$filter=${encodeURIComponent(
  `clientId eq '${spaPrincipal.id}' and resourceId eq '${apiPrincipal.id}'`,
)}`);
assert.ok(existingGrants.value.length <= 1, 'Multiple API consent records require inspection');
if (existingGrants.value.length === 0) {
  const grant = await graph('oauth2PermissionGrants', 'POST', {
    clientId: spaPrincipal.id, resourceId: apiPrincipal.id,
    consentType: 'AllPrincipals', scope: 'Events.Access',
  });
  state.apiConsentId = grant.id;
  save();
} else {
  assert.equal(existingGrants.value[0].scope, 'Events.Access', 'Do not silently expand existing consent');
}

for (const appId of [api.id, spa.id]) {
  const app = await graph(`applications/${appId}?$select=requiredResourceAccess,passwordCredentials,keyCredentials`);
  assert.equal(app.passwordCredentials.length, 0);
  assert.equal(app.keyCredentials.length, 0);
  assert.ok(app.requiredResourceAccess.every((access) => access.resourceAppId === api.appId), 'Unexpected Graph or other API permission');
}
state.frontendUrl = frontend;
state.scope = `api://${api.appId}/Events.Access`;
state.flowAssociationPending ??= true;
save();
console.log('Verified secretless test API/Web registrations and Events.Access-only consent.');
console.log('Email-code user-flow association remains pending; no customer event membership was granted.');
