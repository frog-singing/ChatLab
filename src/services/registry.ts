/**
 * Service Registry — 平台检测与 Adapter 实例管理
 *
 * 应用启动时调用 initServices()，根据运行平台创建并注册
 * 各领域 Adapter。各 useXxxService() composable 通过
 * getAdapter<T>(key) 获取已注册的实例。
 */

import { IS_ELECTRON, IS_BROWSER_STANDALONE } from '@/utils/platform'

export type Platform = 'electron' | 'web-serve' | 'web-browser'

export function detectPlatform(): Platform {
  if (IS_ELECTRON) return 'electron'
  if (IS_BROWSER_STANDALONE) return 'web-browser'
  return 'web-serve'
}

const adapters = new Map<string, unknown>()
let _initialized = false

export function registerAdapter<T>(key: string, instance: T): void {
  adapters.set(key, instance)
}

export function getRegisteredAdapter<T>(key: string): T {
  const adapter = adapters.get(key)
  if (!adapter) {
    throw new Error(`[services] Adapter "${key}" not registered. Call initServices() first.`)
  }
  return adapter as T
}

export function isInitialized(): boolean {
  return _initialized
}

/**
 * 初始化所有 Service Adapter。
 * 应用启动时调用一次（App.vue 或 main.ts）。
 */
export async function initServices(): Promise<void> {
  if (_initialized) return

  const platform = detectPlatform()

  switch (platform) {
    case 'electron':
      await initElectronAdapters()
      break
    case 'web-serve':
      await initWebServeAdapters()
      break
    case 'web-browser':
      await initWebBrowserAdapters()
      break
  }

  _initialized = true
}

async function initElectronAdapters(): Promise<void> {
  const { ElectronDataAdapter } = await import('./data/electron')
  registerAdapter('data', new ElectronDataAdapter())

  const { ElectronImportAdapter } = await import('./import/electron')
  registerAdapter('import', new ElectronImportAdapter())

  const { ElectronSessionIndexAdapter } = await import('./session-index/electron')
  registerAdapter('session-index', new ElectronSessionIndexAdapter())

  const { ElectronMessageAdapter } = await import('./message/electron')
  registerAdapter('message', new ElectronMessageAdapter())

  const { ElectronPlatformAdapter } = await import('./platform/electron')
  registerAdapter('platform', new ElectronPlatformAdapter())

  const { ElectronAIAdapter } = await import('./ai/electron')
  registerAdapter('ai', new ElectronAIAdapter())
}

async function initWebServeAdapters(): Promise<void> {
  const { FetchDataAdapter } = await import('./data/fetch')
  registerAdapter('data', new FetchDataAdapter())

  const { FetchImportAdapter } = await import('./import/fetch')
  registerAdapter('import', new FetchImportAdapter())

  const { FetchSessionIndexAdapter } = await import('./session-index/fetch')
  registerAdapter('session-index', new FetchSessionIndexAdapter())

  const { FetchMessageAdapter } = await import('./message/fetch')
  registerAdapter('message', new FetchMessageAdapter())

  const { WebPlatformAdapter } = await import('./platform/web')
  registerAdapter('platform', new WebPlatformAdapter())

  const { FetchAIAdapter } = await import('./ai/fetch')
  registerAdapter('ai', new FetchAIAdapter())

  await installChartPluginShims()
  await installNlpApiShim()
  await installAiApiShims()
}

/**
 * chart-* packages (packages/chart-ranking, chart-message, etc.) directly
 * call window.chatApi.pluginQuery / pluginCompute / getMemberActivity /
 * getAvailableYears. In Electron, these are injected by the preload script.
 * In web-serve mode, we install equivalent shims backed by DataService.
 */
async function installChartPluginShims(): Promise<void> {
  const { useDataService } = await import('./data/service')
  if (!(window as any).chatApi) {
    ;(window as any).chatApi = {}
  }
  const chatApi = (window as any).chatApi
  const dataService = useDataService()

  chatApi.pluginQuery = <T>(sid: string, sql: string, params?: unknown[]) =>
    dataService.pluginQuery<T>(sid, sql, params)
  chatApi.pluginCompute = <T>(_fnString: string, input: unknown): Promise<T> => {
    const fn = new Function('return ' + _fnString)()
    return Promise.resolve(fn(input))
  }
  chatApi.getMemberActivity = (sid: string, f?: any) => dataService.getMemberActivity(sid, f)
  chatApi.getAvailableYears = (sid: string) => dataService.getAvailableYears(sid)
}

async function installNlpApiShim(): Promise<void> {
  const { get, post, del } = await import('./utils/http')
  ;(window as any).nlpApi = {
    getWordFrequency: (params: unknown) => post('/nlp/word-frequency', params),
    segmentText: (text: string, locale: string, minLength?: number) =>
      post('/nlp/segment', { text, locale, minLength }),
    getPosTags: () => get('/nlp/pos-tags'),
    getDictList: () => get('/nlp/dicts'),
    isDictDownloaded: (dictId: string) => get(`/nlp/dicts/${dictId}/status`),
    downloadDict: (dictId: string) => post(`/nlp/dicts/${dictId}/download`),
    deleteDict: (dictId: string) => del(`/nlp/dicts/${dictId}`),
  }
}

const WEB_STUB = { success: false as const, error: 'Not available in web mode' }

async function installAiApiShims(): Promise<void> {
  const { get } = await import('./utils/http')

  ;(window as any).assistantApi = {
    getAll: () => get('/ai/assistants'),
    getConfig: (id: string) => get(`/ai/assistants/${id}`),
    getBuiltinToolCatalog: () => get('/ai/tools/catalog'),
    getBuiltinCatalog: () => Promise.resolve([]),
    importFromMd: () => Promise.resolve(WEB_STUB),
    update: () => Promise.resolve(WEB_STUB),
    reset: () => Promise.resolve(WEB_STUB),
    importAssistant: () => Promise.resolve(WEB_STUB),
    reimportAssistant: () => Promise.resolve(WEB_STUB),
    create: () => Promise.resolve(WEB_STUB),
    delete: () => Promise.resolve(WEB_STUB),
  }
  ;(window as any).skillApi = {
    getAll: () => get('/ai/skills'),
    getConfig: (id: string) => get(`/ai/skills/${id}`),
    getBuiltinCatalog: () => Promise.resolve([]),
    importFromMd: () => Promise.resolve(WEB_STUB),
    update: () => Promise.resolve(WEB_STUB),
    create: () => Promise.resolve(WEB_STUB),
    delete: () => Promise.resolve(WEB_STUB),
    importSkill: () => Promise.resolve(WEB_STUB),
    reimportSkill: () => Promise.resolve(WEB_STUB),
  }

  let _cachedLlmData: { configs: any[]; defaultAssistant: any; fastModel: any } | null = null
  async function loadLlmData() {
    if (!_cachedLlmData) {
      _cachedLlmData = await get('/ai/llm/configs')
    }
    return _cachedLlmData!
  }

  ;(window as any).llmApi = {
    hasConfig: () => get('/ai/llm/has-config'),
    getAllConfigs: async () => (await loadLlmData()).configs,
    getDefaultAssistantSlot: () => get('/ai/llm/default-assistant-slot'),
    getFastModelSlot: () => get('/ai/llm/fast-model-slot'),
    getProviders: () => get('/ai/llm/providers'),
    getProviderRegistry: () => get('/ai/llm/provider-registry'),
    getModelCatalog: () => get('/ai/llm/model-catalog'),
    setDefaultAssistantModel: async (configId: string, modelId: string) => {
      const { put: httpPut } = await import('./utils/http')
      _cachedLlmData = null
      return httpPut('/ai/llm/default-assistant-slot', { configId, modelId })
    },
    setFastModel: async (slot: { configId: string; modelId: string } | null) => {
      const { put: httpPut } = await import('./utils/http')
      _cachedLlmData = null
      return httpPut('/ai/llm/fast-model-slot', slot)
    },
    deleteConfig: async (id?: string) => {
      if (!id) return WEB_STUB
      const { del } = await import('./utils/http')
      _cachedLlmData = null
      return del(`/ai/llm/configs/${id}`)
    },
    addConfig: async (config: Record<string, unknown>) => {
      const { post: httpPost } = await import('./utils/http')
      _cachedLlmData = null
      return httpPost('/ai/llm/configs', config)
    },
    updateConfig: async (id: string, updates: Record<string, unknown>) => {
      const { put: httpPut } = await import('./utils/http')
      _cachedLlmData = null
      return httpPut(`/ai/llm/configs/${id}`, updates)
    },
    validateApiKey: () => Promise.resolve(WEB_STUB),
    fetchRemoteModels: () => Promise.resolve({ success: false, error: 'Not available in web mode', models: [] }),
    chatStream: () => Promise.resolve({ success: false, error: 'Not available in web mode' }),
    addCustomModel: () => Promise.resolve(WEB_STUB),
    updateCustomModel: () => Promise.resolve(WEB_STUB),
    deleteCustomModel: () => Promise.resolve(WEB_STUB),
  }
  const { fetchSSE } = await import('./utils/sse')
  const { post: httpPost } = await import('./utils/http')

  const agentApiImpl = {
    runStream: (
      userMessage: string,
      context: Record<string, unknown>,
      onChunk?: (chunk: Record<string, unknown>) => void,
      chatType?: string,
      locale?: string,
      assistantId?: string,
      _skillId?: string | null,
      _enableAutoSkill?: boolean,
      _compressionConfig?: Record<string, unknown>
    ): {
      requestId: string
      promise: Promise<{ success: boolean; result?: Record<string, unknown>; error?: Record<string, unknown> }>
    } => {
      const localRequestId = `agent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      let serverRequestId = localRequestId
      const abortController = new AbortController()

      const promise = new Promise<{
        success: boolean
        result?: Record<string, unknown>
        error?: Record<string, unknown>
      }>((resolve) => {
        let content = ''
        const toolsUsed: string[] = []
        let toolRounds = 0
        let lastUsage: Record<string, unknown> | undefined
        let hasError = false
        let streamError: Record<string, unknown> | undefined

        fetchSSE({
          url: '/_web/ai/agent/stream',
          method: 'POST',
          body: {
            userMessage,
            conversationId: context.conversationId,
            sessionId: context.sessionId,
            chatType: chatType || 'group',
            locale: locale || 'zh-CN',
            assistantId,
          },
          signal: abortController.signal,
          onEvent: ({ event, data }) => {
            try {
              const parsed = JSON.parse(data)

              if (event === 'meta') {
                serverRequestId = parsed.requestId || localRequestId
                return
              }

              if (onChunk) onChunk(parsed)

              switch (event) {
                case 'content':
                  if (parsed.content) content += parsed.content
                  break
                case 'tool_start':
                  if (parsed.toolName) toolsUsed.push(parsed.toolName)
                  break
                case 'tool_result':
                  break
                case 'status':
                  if (parsed.status?.round !== undefined) toolRounds = parsed.status.round
                  break
                case 'error':
                  hasError = true
                  streamError = parsed.error
                  break
                case 'done':
                  if (parsed.usage) lastUsage = parsed.usage
                  break
              }
            } catch {
              // skip malformed
            }
          },
        })
          .then(() => {
            if (hasError) {
              resolve({ success: false, error: streamError })
            } else {
              resolve({
                success: true,
                result: { content, toolsUsed, toolRounds, totalUsage: lastUsage },
              })
            }
          })
          .catch((err) => {
            if (abortController.signal.aborted) {
              resolve({ success: false, error: { name: 'AbortError', message: 'Aborted' } })
            } else {
              resolve({ success: false, error: { name: 'NetworkError', message: err?.message || String(err) } })
            }
          })
      })

      // Store abort controller for external abort
      ;(agentApiImpl as any)._abortControllers = (agentApiImpl as any)._abortControllers || new Map()
      ;(agentApiImpl as any)._abortControllers.set(localRequestId, {
        abortController,
        serverRequestId: () => serverRequestId,
      })

      return { requestId: localRequestId, promise }
    },

    abort: async (requestId: string) => {
      const controllers = (agentApiImpl as any)._abortControllers as
        | Map<string, { abortController: AbortController; serverRequestId: () => string }>
        | undefined
      const entry = controllers?.get(requestId)
      if (entry) {
        entry.abortController.abort()
        controllers!.delete(requestId)
        try {
          await httpPost('/ai/agent/abort', { requestId: entry.serverRequestId() })
        } catch {
          // best-effort
        }
      }
    },
  }

  ;(window as any).agentApi = agentApiImpl
}

async function initWebBrowserAdapters(): Promise<void> {
  // Phase 6+: BrowserSql Adapter
  throw new Error('[services] web-browser platform not yet supported')
}
