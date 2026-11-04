targetScope = 'resourceGroup'

@allowed(['westus2'])
param location string = 'westus2'

var token = uniqueString(resourceGroup().id, 'perlygolfmax-test')

resource api 'Microsoft.Web/sites@2024-04-01' existing = {
  name: 'pgm-test-api-${token}'
}

module deploymentIdentity 'br/public:avm/res/managed-identity/user-assigned-identity:0.4.1' = {
  name: 'test-pipeline-identity'
  params: {
    name: 'perlygolfmax-test-deploy'
    location: location
    tags: {
      application: 'perlygolfmax'
      environment: 'test'
      purpose: 'github-deployment'
    }
    enableTelemetry: false
  }
}

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = {
  name: 'perlygolfmax-test-deploy'
}

resource federation 'Microsoft.ManagedIdentity/userAssignedIdentities/federatedIdentityCredentials@2023-01-31' = {
  parent: identity
  name: 'github-test-environment'
  properties: {
    issuer: 'https://token.actions.githubusercontent.com'
    subject: 'repo:ryperl/perlygolfmax:environment:perlygolfmax-test'
    audiences: ['api://AzureADTokenExchange']
  }
  dependsOn: [deploymentIdentity]
}

module deploymentAccess './modules/deployment-access.bicep' = {
  name: 'test-pipeline-website-access'
  params: {
    functionAppName: api.name
    principalId: deploymentIdentity.outputs.principalId
  }
}

output clientId string = deploymentIdentity.outputs.clientId
output tenantId string = tenant().tenantId
output subscriptionId string = subscription().subscriptionId
