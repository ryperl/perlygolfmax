param functionAppName string
param principalId string

resource api 'Microsoft.Web/sites@2024-04-01' existing = {
  name: functionAppName
}

var websiteContributor = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  'de139f84-1756-47ae-9be6-808fbbe84772'
)

resource deploymentAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(api.id, principalId, websiteContributor)
  scope: api
  properties: {
    principalId: principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: websiteContributor
  }
}
