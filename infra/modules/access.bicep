param hostStorageName string
param dataStorageName string
param tableName string
param insightsName string
param principalId string

resource hostStorage 'Microsoft.Storage/storageAccounts@2023-05-01' existing = { name: hostStorageName }
resource dataStorage 'Microsoft.Storage/storageAccounts@2023-05-01' existing = { name: dataStorageName }
resource tableService 'Microsoft.Storage/storageAccounts/tableServices@2023-05-01' existing = {
  parent: dataStorage
  name: 'default'
}
resource table 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' existing = {
  parent: tableService
  name: tableName
}
resource insights 'Microsoft.Insights/components@2020-02-02' existing = { name: insightsName }

var blobOwner = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  'b7e6dc6d-f1e8-4753-8033-0f276bb0955b'
)
var tableContributor = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3'
)
var metricsPublisher = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '3913510d-42f4-4e42-8a64-420c390055eb'
)

resource hostAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(hostStorage.id, principalId, blobOwner)
  scope: hostStorage
  properties: { principalId: principalId, principalType: 'ServicePrincipal', roleDefinitionId: blobOwner }
}
resource eventAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(table.id, principalId, tableContributor)
  scope: table
  properties: { principalId: principalId, principalType: 'ServicePrincipal', roleDefinitionId: tableContributor }
}
resource telemetryAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(insights.id, principalId, metricsPublisher)
  scope: insights
  properties: { principalId: principalId, principalType: 'ServicePrincipal', roleDefinitionId: metricsPublisher }
}
