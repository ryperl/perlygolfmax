param workspaceName string
param insightsName string
param location string
param tags object

// The pinned workspace AVM only accepts integer quotas; use the ARM schema for a fractional test cap.
resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: workspaceName
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
    workspaceCapping: { dailyQuotaGb: json('0.1') }
    features: {
      disableLocalAuth: true
      enableLogAccessUsingOnlyResourcePermissions: true
    }
  }
}

module insights 'br/public:avm/res/insights/component:0.6.0' = {
  name: 'test-application-insights'
  params: {
    name: insightsName
    location: location
    tags: tags
    workspaceResourceId: workspace.id
    disableLocalAuth: true
    enableTelemetry: false
  }
}
