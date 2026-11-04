targetScope = 'subscription'

@description('This entry point is restricted to the isolated test resource group.')
@allowed(['rg-perlygolfmax-test'])
param resourceGroupName string = 'rg-perlygolfmax-test'

@allowed(['westus2'])
param location string = 'westus2'

@discriminator('state')
type IdentityConfiguration =
  | {
    state: 'unconfigured'
  }
  | {
    state: 'configured'
    tenantId: string
    issuer: string
    jwksUrl: string
    apiClientId: string
    spaClientId: string
    scope: string
    creatorObjectId: string
  }

@description('Private environment configuration; never commit populated identity parameters.')
param identityConfiguration IdentityConfiguration = { state: 'unconfigured' }

@description('Controls host startup only. Unconfigured identity still makes application endpoints fail closed.')
param enableApi bool = false

@allowed([1, 2, 3, 4, 5])
param maximumInstanceCount int = 2

var tags = {
  application: 'perlygolfmax'
  environment: 'test'
  managedBy: 'bicep'
}

resource testGroup 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: resourceGroupName
  location: location
  tags: tags
}

module stack './test-stack.bicep' = {
  name: 'perlygolfmax-test-stack'
  scope: testGroup
  params: {
    location: location
    tags: tags
    enableApi: enableApi
    maximumInstanceCount: maximumInstanceCount
    identitySettings: identityConfiguration.state == 'configured'
      ? {
          ENTRA_TENANT_ID: identityConfiguration.tenantId
          ENTRA_ISSUER: identityConfiguration.issuer
          ENTRA_JWKS_URL: identityConfiguration.jwksUrl
          ENTRA_API_CLIENT_ID: identityConfiguration.apiClientId
          ENTRA_SPA_CLIENT_ID: identityConfiguration.spaClientId
          ENTRA_API_SCOPE: identityConfiguration.scope
          EVENT_CREATOR_OBJECT_ID: identityConfiguration.creatorObjectId
        }
      : {
          ENTRA_TENANT_ID: ''
          ENTRA_ISSUER: ''
          ENTRA_JWKS_URL: ''
          ENTRA_API_CLIENT_ID: ''
          ENTRA_SPA_CLIENT_ID: ''
          ENTRA_API_SCOPE: ''
          EVENT_CREATOR_OBJECT_ID: ''
        }
  }
}

output testResourceGroupName string = testGroup.name
output frontendUrl string = stack.outputs.frontendUrl
output apiUrl string = stack.outputs.apiUrl
output authenticationCallback string = '${stack.outputs.frontendUrl}/?event-auth=1'
