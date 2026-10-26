export interface CohostModelRoute {
  id: string
  backendName?: string
  mountPath: string
  baseUrl: string
  apiKey: string
  models: Array<string | { alias: string; model: string; api?: string }>
  blobRoot?: string
}

/** Build CLI/cohost model configuration with credentials only in the Nexus backend. */
export function buildCohostModelConfiguration(routes: CohostModelRoute[]): Record<string, string> {
  if (!routes.length) throw new Error('At least one mounted model route is required')
  const accounts: Record<string, { baseUrl: string; apiKey: string }> = {}
  const models: Record<string, { providers: { proxy: { model: string; provider?: string; api?: string } } }> = {}
  const paths = new Set<string>()
  const mounts = [...routes].sort((a, b) => a.id.localeCompare(b.id)).map(route => {
    const url = new URL(route.baseUrl)
    if (!/^[a-z][a-z0-9-]{0,62}$/.test(route.id) || (route.backendName !== undefined && !/^[a-z][a-z0-9-]{0,62}$/.test(route.backendName)) || accounts[route.id] || paths.has(route.mountPath) ||
      !route.mountPath.startsWith('/') || route.mountPath.split('/').slice(1).some(part => !part || part === '.' || part === '..') ||
      !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid mounted model route')
    paths.add(route.mountPath)
    accounts[route.id] = { baseUrl: `nexus://${route.mountPath}`, apiKey: '' }
    for (const entry of route.models) {
      const model = typeof entry === 'string' ? { alias: entry, model: entry } : entry
      if (!model.alias.trim() || !model.model.trim() || models[model.alias]) throw new Error('Invalid or ambiguous mounted model alias')
      models[model.alias] = { providers: { proxy: { model: model.model,
        ...(routes.length > 1 ? { provider: route.id } : {}), ...(typeof entry !== 'string' && entry.api ? { api: entry.api } : {}) } } }
    }
    const baseUrl = route.baseUrl.replace(/\/+$/, '')
    return { path: route.mountPath, backend_type: 'anthropic', backend_name: route.backendName ?? route.id, backend_params: {
      base_url: baseUrl.replace(/\/v1$/, ''), openai_base_url: baseUrl,
      api_key: route.apiKey, blob_root: route.blobRoot ?? '/data/model-cache',
    } }
  })
  return {
    'sudocode.json': JSON.stringify({ auth_modes: { proxy: accounts }, models }),
    'backend-config.json': JSON.stringify({ mounts }),
  }
}
