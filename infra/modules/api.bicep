// Adapted from the Microsoft Functions TypeScript quickstart; see ../README.md and ../LICENSE.functions-template.txt.
param name string
param location string
param tags object
param planId string
param hostStorageName string
param insightsName string
param enabled bool
param maximumInstanceCount int
param allowedOrigins string[]
param dataEndpoint string
param tableName string
@secure()
param identitySettings object

resource hostStorage 'Microsoft.Storage/storageAccounts@2023-05-01' existing = { name: hostStorageName }
resource insights 'Microsoft.Insights/components@2020-02-02' existing = { name: insightsName }

module app 'br/public:avm/res/web/site:0.15.1' = {
  name: 'test-functions-host'
  params: {
    name: name
    kind: 'functionapp,linux'
    location: location
    tags: tags
    serverFarmResourceId: planId
    enabled: enabled
    managedIdentities: { systemAssigned: true }
    httpsOnly: true
    publicNetworkAccess: 'Enabled'
    clientAffinityEnabled: false
    basicPublishingCredentialsPolicies: [
      { name: 'scm', allow: false }
      { name: 'ftp', allow: false }
    ]
    functionAppConfig: {
      deployment: {
        storage: {
          type: 'blobContainer'
          value: '${hostStorage.properties.primaryEndpoints.blob}function-packages'
          authentication: { type: 'SystemAssignedIdentity' }
        }
      }
      runtime: { name: 'node', version: '22' }
      scaleAndConcurrency: {
        instanceMemoryMB: 2048
        maximumInstanceCount: maximumInstanceCount
        alwaysReady: []
        triggers: { http: { perInstanceConcurrency: 8 } }
      }
    }
    siteConfig: {
      alwaysOn: false
      minTlsVersion: '1.2'
      scmMinTlsVersion: '1.2'
      ftpsState: 'Disabled'
      cors: { allowedOrigins: allowedOrigins, supportCredentials: false }
    }
    appSettingsKeyValuePairs: union(identitySettings, {
      AzureWebJobsStorage__credential: 'managedidentity'
      AzureWebJobsStorage__blobServiceUri: hostStorage.properties.primaryEndpoints.blob
      APPLICATIONINSIGHTS_CONNECTION_STRING: insights.properties.ConnectionString
      APPLICATIONINSIGHTS_AUTHENTICATION_STRING: 'Authorization=AAD'
      EVENTS_TABLE_ENDPOINT: dataEndpoint
      EVENTS_TABLE_NAME: tableName
      FUNCTIONS_REQUEST_BODY_SIZE_LIMIT: '12288'
      AzureFunctionsJobHost__functionTimeout: '00:01:00'
      AzureFunctionsJobHost__logging__applicationInsights__samplingSettings__maxTelemetryItemsPerSecond: '2'
    })
    enableTelemetry: false
  }
}

output principalId string = app.outputs.systemAssignedMIPrincipalId!
output apiUrl string = 'https://${app.outputs.defaultHostname}/api'
