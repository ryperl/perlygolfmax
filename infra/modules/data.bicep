param name string
param location string
param tags object

module account 'br/public:avm/res/storage/storage-account:0.8.3' = {
  name: 'retained-application-storage'
  params: {
    name: name
    location: location
    tags: tags
    skuName: 'Standard_LRS'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    allowCrossTenantReplication: false
    defaultToOAuthAuthentication: true
    supportsHttpsTrafficOnly: true
    minimumTlsVersion: 'TLS1_2'
    publicNetworkAccess: 'Enabled'
    networkAcls: { defaultAction: 'Allow', bypass: 'None' }
    blobServices: {}
    tableServices: { tables: [{ name: 'Events' }] }
    lock: { kind: 'CanNotDelete', name: 'retain-application-data' }
    enableTelemetry: false
  }
}

output tableName string = 'Events'
output tableEndpoint string = 'https://${account.outputs.name}.table.${environment().suffixes.storage}'
