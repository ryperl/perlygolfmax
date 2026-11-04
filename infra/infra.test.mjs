import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

let template;
let stack;
let pipeline;
let customer;

function resources(document) {
  return Array.isArray(document.resources)
    ? document.resources
    : Object.values(document.resources ?? {});
}

function deployment(document, name) {
  const resource = resources(document).find((item) => item.name === name);
  assert.ok(resource, `Missing deployment: ${name}`);
  assert.equal(resource.type, 'Microsoft.Resources/deployments');
  assert.equal(resource.properties.mode, 'Incremental');
  return resource;
}

function parameters(document, name) {
  return deployment(document, name).properties.parameters;
}

before(() => {
  const binary = process.env.BICEP_CLI
    ?? join(homedir(), '.azure', 'bin', process.platform === 'win32' ? 'bicep.exe' : 'bicep');
  function compile(file) {
    const compiled = execFileSync(binary, [
      'build', '--no-restore',
      fileURLToPath(new URL(file, import.meta.url)), '--stdout',
    ], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
    return JSON.parse(compiled);
  }
  template = compile('./main.bicep');
  pipeline = compile('./pipeline-access.bicep');
  customer = compile('./customer-tenant.bicep');
  stack = deployment(template, 'perlygolfmax-test-stack').properties.template;
});

test('entry point is restricted to the test group/region and never binds production DNS', () => {
  assert.deepEqual(template.parameters.resourceGroupName.allowedValues, ['rg-perlygolfmax-test']);
  assert.deepEqual(template.parameters.location.allowedValues, ['westus2']);
  assert.deepEqual(resources(template).map((item) => item.type).sort(), [
    'Microsoft.Resources/deployments', 'Microsoft.Resources/resourceGroups',
  ]);
  assert.equal(deployment(template, 'perlygolfmax-test-stack').resourceGroup, "[parameters('resourceGroupName')]");
  const frontend = parameters(stack, 'test-frontend');
  assert.equal(frontend.sku.value, 'Free');
  assert.equal(frontend.buildProperties.value.skipGithubActionWorkflowGeneration, true);
  assert.deepEqual(frontend.customDomains.value, []);
  assert.deepEqual(frontend.linkedBackend.value, {});
  assert.equal(frontend.repositoryUrl, undefined);
  assert.equal(frontend.repositoryToken, undefined);
});

test('runtime and retained application storage use LRS without keys or anonymous blobs', () => {
  const host = parameters(stack, 'test-host-storage');
  const data = deployment(stack, 'test-application-data').properties.template;
  const retained = parameters(data, 'retained-application-storage');
  for (const storage of [host, retained]) {
    assert.equal(storage.skuName.value, 'Standard_LRS');
    assert.equal(storage.allowSharedKeyAccess.value, false);
    assert.equal(storage.allowBlobPublicAccess.value, false);
    assert.equal(storage.minimumTlsVersion.value, 'TLS1_2');
    assert.equal(storage.supportsHttpsTrafficOnly.value, true);
    assert.equal(storage.defaultToOAuthAuthentication.value, true);
  }
  assert.equal(retained.lock.value.kind, 'CanNotDelete');
  assert.deepEqual(retained.tableServices.value.tables, [{ name: 'Events' }]);
  assert.deepEqual(host.blobServices.value.containers, [
    { name: 'function-packages', publicAccess: 'None' },
  ]);
});

test('API defaults disabled, requires configured identity and has bounded on-demand scaling', () => {
  assert.equal(template.parameters.enableApi.defaultValue, false);
  assert.equal(template.parameters.identityConfiguration.defaultValue.state, 'unconfigured');
  assert.equal(template.parameters.maximumInstanceCount.defaultValue, 2);
  assert.deepEqual(template.parameters.maximumInstanceCount.allowedValues, [1, 2, 3, 4, 5]);
  const wiring = parameters(template, 'perlygolfmax-test-stack');
  assert.match(wiring.enableApi.value, /and\(parameters\('enableApi'\)/);
  assert.match(wiring.enableApi.value, /configured/);
  const api = deployment(stack, 'test-api').properties.template;
  const settings = parameters(api, 'test-functions-host');
  assert.deepEqual(settings.managedIdentities.value, { systemAssigned: true });
  assert.equal(settings.httpsOnly.value, true);
  assert.deepEqual(settings.functionAppConfig.value.runtime, { name: 'node', version: '22' });
  assert.equal(settings.functionAppConfig.value.scaleAndConcurrency.instanceMemoryMB, 2048);
  assert.deepEqual(settings.functionAppConfig.value.scaleAndConcurrency.alwaysReady, []);
  assert.equal(settings.functionAppConfig.value.scaleAndConcurrency.triggers.http.perInstanceConcurrency, 8);
  assert.deepEqual(settings.functionAppConfig.value.deployment.storage.authentication, {
    type: 'SystemAssignedIdentity',
  });
  assert.equal(settings.siteConfig.value.minTlsVersion, '1.2');
  assert.equal(settings.siteConfig.value.ftpsState, 'Disabled');
  assert.equal(settings.siteConfig.value.cors.supportCredentials, false);
  assert.deepEqual(settings.basicPublishingCredentialsPolicies.value, [
    { name: 'scm', allow: false }, { name: 'ftp', allow: false },
  ]);
});

test('every API environment contract is wired without storage keys or identity outputs', () => {
  const source = readFileSync(new URL('../api/src/config.ts', import.meta.url), 'utf8');
  const requiredNames = [...source.matchAll(/env\.([A-Z_]+)/g)].map((match) => match[1]);
  const rootWiring = JSON.stringify(parameters(template, 'perlygolfmax-test-stack'));
  const api = deployment(stack, 'test-api').properties.template;
  const appSettings = JSON.stringify(parameters(api, 'test-functions-host').appSettingsKeyValuePairs);
  for (const name of requiredNames) {
    assert.ok(`${rootWiring}${appSettings}`.includes(name), `Unwired API setting: ${name}`);
  }
  assert.match(appSettings, /FUNCTIONS_REQUEST_BODY_SIZE_LIMIT/);
  assert.match(appSettings, /4096/);
  assert.match(appSettings, /managedidentity/);
  assert.doesNotMatch(appSettings, /listKeys|AccountKey|SharedAccessSignature|client_secret/i);
  assert.deepEqual(Object.keys(template.outputs).sort(), [
    'apiUrl', 'authenticationCallback', 'frontendUrl', 'testResourceGroupName',
  ]);
});

test('runtime access is only host blob owner, one-table contributor and telemetry publisher', () => {
  const access = deployment(stack, 'test-runtime-access').properties.template;
  const assignments = resources(access);
  assert.equal(assignments.length, 3);
  for (const assignment of assignments) {
    assert.equal(assignment.type, 'Microsoft.Authorization/roleAssignments');
    assert.equal(assignment.properties.principalType, 'ServicePrincipal');
    assert.equal(assignment.properties.principalId, "[parameters('principalId')]");
  }
  const eventAccess = assignments.find((item) => item.name.includes('tableContributor'));
  assert.ok(eventAccess);
  assert.equal(eventAccess.scope, "[format('Microsoft.Storage/storageAccounts/{0}/tableServices/{1}/tables/{2}', parameters('dataStorageName'), 'default', parameters('tableName'))]");
  const definitions = JSON.stringify(access.variables);
  assert.match(definitions, /b7e6dc6d-f1e8-4753-8033-0f276bb0955b/);
  assert.match(definitions, /0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3/);
  assert.match(definitions, /3913510d-42f4-4e42-8a64-420c390055eb/);
  assert.doesNotMatch(definitions, /b24988ac-6180-42a0-ab88-20f7382dd24c|8e3af657-a8ff-443c-a75c-2fe8c4bcb635/);
});

test('monitoring is bounded and example parameters contain no real identity configuration', () => {
  const monitoring = deployment(stack, 'test-monitoring').properties.template;
  const workspace = resources(monitoring).find((item) => item.type === 'Microsoft.OperationalInsights/workspaces');
  assert.ok(workspace);
  assert.equal(workspace.properties.retentionInDays, 30);
  assert.equal(workspace.properties.workspaceCapping.dailyQuotaGb, "[json('0.1')]");
  assert.equal(workspace.properties.features.disableLocalAuth, true);
  const example = JSON.parse(readFileSync(new URL('./test.parameters.example.json', import.meta.url), 'utf8'));
  assert.deepEqual(example.parameters.identityConfiguration.value, { state: 'unconfigured' });
  assert.equal(example.parameters.enableApi.value, false);
  assert.equal(example.parameters.location.value, 'westus2');
});

test('pipeline federation is test-environment-only and deployment access is scoped to the test API', () => {
  const federation = resources(pipeline).find((item) => item.type.endsWith('/federatedIdentityCredentials'));
  assert.ok(federation);
  assert.equal(federation.properties.issuer, 'https://token.actions.githubusercontent.com');
  assert.equal(federation.properties.subject, 'repo:ryperl/perlygolfmax:environment:perlygolfmax-test');
  assert.deepEqual(federation.properties.audiences, ['api://AzureADTokenExchange']);
  const access = deployment(pipeline, 'test-pipeline-website-access').properties.template;
  assert.equal(resources(access).length, 1);
  const assignment = resources(access)[0];
  assert.equal(assignment.type, 'Microsoft.Authorization/roleAssignments');
  assert.match(assignment.scope, /Microsoft.Web\/sites/);
  assert.match(JSON.stringify(access.variables), /de139f84-1756-47ae-9be6-808fbbe84772/);
  assert.equal(assignment.properties.principalType, 'ServicePrincipal');
});

test('customer directory creation uses only the approved US test geography and retained Standard tier', () => {
  const directory = resources(customer).find((item) => item.type === 'Microsoft.AzureActiveDirectory/ciamDirectories');
  assert.ok(directory);
  assert.equal(directory.location, 'United States');
  assert.deepEqual(directory.sku, { name: 'Standard', tier: 'A0' });
  assert.deepEqual(directory.properties.createTenantProperties, {
    countryCode: 'US', displayName: 'Perly Golf Max Test',
  });
  const lock = resources(customer).find((item) => item.type === 'Microsoft.Authorization/locks');
  assert.ok(lock);
  assert.equal(lock.properties.level, 'CanNotDelete');
  assert.equal(resources(customer).length, 2);
  assert.deepEqual(Object.keys(customer.outputs).sort(), ['customerTenantId', 'customerTenantSubdomain']);
});
