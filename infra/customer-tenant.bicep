targetScope = 'resourceGroup'

var directoryName = 'pgm${take(uniqueString(resourceGroup().id, 'customer-identities'), 7)}'

resource directory 'Microsoft.AzureActiveDirectory/ciamDirectories@2023-05-17-preview' = {
  name: '${directoryName}.onmicrosoft.com'
  location: 'United States'
  sku: {
    name: 'Base'
    tier: 'A0'
  }
  tags: {
    application: 'perlygolfmax'
    environment: 'test'
    lifecycle: 'retain-customer-identities'
  }
  properties: {
    createTenantProperties: {
      countryCode: 'US'
      displayName: 'Perly Golf Max Test'
    }
  }
}

resource retentionLock 'Microsoft.Authorization/locks@2020-05-01' = {
  name: 'retain-customer-identities'
  scope: directory
  properties: {
    level: 'CanNotDelete'
    notes: 'Retain the customer directory and user identity continuity independently of compute.'
  }
}

output customerTenantId string = directory.properties.tenantId
output customerTenantSubdomain string = directoryName
