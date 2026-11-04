targetScope = 'resourceGroup'

param location string
param tags object
param enableApi bool
param enableDevDomain bool
param maximumInstanceCount int
@secure()
param identitySettings object

var token = uniqueString(resourceGroup().id, 'perlygolfmax-test')
var names = {
  frontend: 'pgm-test-web-${token}'
  api: 'pgm-test-api-${token}'
  plan: 'pgm-test-plan-${token}'
  hostStorage: 'pgmhost${token}'
  dataStorage: 'pgmdata${token}'
  workspace: 'pgm-test-logs-${token}'
  insights: 'pgm-test-insights-${token}'
}

module frontend 'br/public:avm/res/web/static-site:0.9.6' = {
  name: 'test-frontend'
  params: {
    name: names.frontend
    location: location
    tags: tags
    sku: 'Free'
    provider: 'Custom'
    buildProperties: { skipGithubActionWorkflowGeneration: true }
    stagingEnvironmentPolicy: 'Disabled'
    enterpriseGradeCdnStatus: 'Disabled'
    publicNetworkAccess: 'Enabled'
    customDomains: enableDevDomain ? [
      { name: 'dev.perlygolf.com', validationMethod: 'cname-delegation' }
    ] : []
    linkedBackend: {}
    enableTelemetry: false
  }
}

module hostStorage 'br/public:avm/res/storage/storage-account:0.8.3' = {
  name: 'test-host-storage'
  params: {
    name: names.hostStorage
    location: location
    tags: tags
    skuName: 'Standard_LRS'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    allowCrossTenantReplication: false
    defaultToOAuthAuthentication: true
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    publicNetworkAccess: 'Enabled'
    networkAcls: { defaultAction: 'Allow', bypass: 'None' }
    blobServices: {
      containers: [{ name: 'function-packages', publicAccess: 'None' }]
      containerDeleteRetentionPolicyEnabled: false
      deleteRetentionPolicyEnabled: false
    }
    enableTelemetry: false
  }
}

module data './modules/data.bicep' = {
  name: 'test-application-data'
  params: {
    name: names.dataStorage
    location: location
    tags: tags
  }
}

module monitoring './modules/monitoring.bicep' = {
  name: 'test-monitoring'
  params: {
    workspaceName: names.workspace
    insightsName: names.insights
    location: location
    tags: tags
  }
}

module plan 'br/public:avm/res/web/serverfarm:0.1.1' = {
  name: 'test-flex-plan'
  params: {
    name: names.plan
    location: location
    tags: tags
    sku: { name: 'FC1', tier: 'FlexConsumption' }
    reserved: true
    enableTelemetry: false
  }
}

module api './modules/api.bicep' = {
  name: 'test-api'
  params: {
    name: names.api
    location: location
    tags: tags
    planId: plan.outputs.resourceId
    hostStorageName: names.hostStorage
    insightsName: names.insights
    enabled: enableApi
    maximumInstanceCount: maximumInstanceCount
    allowedOrigins: concat(
      ['https://${frontend.outputs.defaultHostname}', 'http://localhost:5173'],
      enableDevDomain ? ['https://dev.perlygolf.com'] : []
    )
    identitySettings: identitySettings
    dataEndpoint: data.outputs.tableEndpoint
    tableName: data.outputs.tableName
  }
  dependsOn: [hostStorage, monitoring]
}

module access './modules/access.bicep' = {
  name: 'test-runtime-access'
  params: {
    hostStorageName: names.hostStorage
    dataStorageName: names.dataStorage
    tableName: data.outputs.tableName
    insightsName: names.insights
    principalId: api.outputs.principalId
  }
}

output frontendUrl string = 'https://${frontend.outputs.defaultHostname}'
output apiUrl string = api.outputs.apiUrl
