/**
 * 服务端 LLM 配置加载
 *
 * API Key 从 ~/.chatlab/auth-profiles.json 读取，
 * 匹配顺序：config.authProfile 精确匹配 > config.provider 兜底匹配。
 *
 * 模型/Provider 等配置仍从 llm-config.json 读取。
 */

import * as fs from 'fs'
import * as path from 'path'
import { type Model as PiModel, type Api as PiApi } from '@mariozechner/pi-ai'
import { BUILTIN_PROVIDERS, getBuiltinModelsByProvider, BUILTIN_MODELS } from '@openchatlab/core'
import type { ModelDefinition } from '@openchatlab/core'
import { resolveApiKey, writeAuthProfile } from '@openchatlab/config'
import { randomUUID } from 'crypto'

// ==================== Types ====================

export interface AIServiceConfig {
  id: string
  name: string
  provider: string
  apiKey: string
  model?: string
  baseUrl?: string
  maxTokens?: number
  apiFormat?: string
  disableThinking?: boolean
  isReasoningModel?: boolean
  authProfile?: string
}

interface ModelSlot {
  configId: string
  modelId?: string
}

interface AIConfigStore {
  configs: AIServiceConfig[]
  defaultAssistant: ModelSlot | null
  fastModel: ModelSlot | null
}

// ==================== Config Loading ====================

export function loadLlmConfig(aiDataDir: string): AIConfigStore {
  const configPath = path.join(aiDataDir, 'llm-config.json')
  if (!fs.existsSync(configPath)) {
    return { configs: [], defaultAssistant: null, fastModel: null }
  }

  try {
    const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'))

    const configs = (data.configs || []).map((c: Record<string, unknown>) => {
      const provider = (c.provider as string) || ''
      const authProfile = c.authProfile as string | undefined
      const profileKey = resolveApiKey(provider, authProfile)
      const rawKey = (c.apiKey as string) || ''
      const fallbackKey = rawKey.startsWith('enc:') ? '' : rawKey
      return {
        ...c,
        apiKey: profileKey || fallbackKey,
      }
    })
    return {
      configs,
      defaultAssistant: data.defaultAssistant ?? null,
      fastModel: data.fastModel ?? null,
    }
  } catch {
    return { configs: [], defaultAssistant: null, fastModel: null }
  }
}

function resolveSlot(slot: ModelSlot | null | undefined, configs: AIServiceConfig[]): ModelSlot | null {
  if (slot && configs.some((c) => c.id === slot.configId)) return slot
  const fallback = configs[0]
  if (!fallback) return null
  return { configId: fallback.id, modelId: fallback.model }
}

export function getDefaultAssistantConfig(aiDataDir: string): AIServiceConfig | null {
  const store = loadLlmConfig(aiDataDir)
  const slot = resolveSlot(store.defaultAssistant, store.configs)
  if (!slot) return null
  const config = store.configs.find((c) => c.id === slot.configId)
  if (!config) return null
  return { ...config, model: slot.modelId || config.model }
}

// ==================== Config Write Operations ====================

const MAX_CONFIG_COUNT = 99

function saveLlmConfig(aiDataDir: string, store: AIConfigStore): void {
  const configPath = path.join(aiDataDir, 'llm-config.json')
  const toSave = {
    ...store,
    configs: store.configs.map((c) => {
      const { apiKey: _k, ...rest } = c
      return rest
    }),
    schemaVersion: 3,
  }
  fs.writeFileSync(configPath, JSON.stringify(toSave, null, 2), 'utf-8')
}

export function addLlmConfig(
  aiDataDir: string,
  config: Omit<AIServiceConfig, 'id'>
): { success: boolean; config?: AIServiceConfig; error?: string } {
  const store = loadLlmConfig(aiDataDir)

  if (store.configs.length >= MAX_CONFIG_COUNT) {
    return { success: false, error: `Maximum ${MAX_CONFIG_COUNT} configs reached` }
  }

  const newConfig: AIServiceConfig = {
    ...config,
    id: randomUUID(),
  }

  const storeForSave = loadRawConfigStore(aiDataDir)
  storeForSave.configs.push({
    ...newConfig,
    apiKey: '',
  })

  if (storeForSave.configs.length === 1) {
    storeForSave.defaultAssistant = { configId: newConfig.id, modelId: newConfig.model || '' }
  }

  if (config.apiKey) {
    const profileName = config.name?.toLowerCase().replace(/\s+/g, '-') || config.provider
    writeAuthProfile(profileName, {
      type: 'api_key',
      provider: config.provider,
      key: config.apiKey,
    })
    ;(storeForSave.configs[storeForSave.configs.length - 1] as unknown as Record<string, unknown>).authProfile =
      profileName
  }

  saveLlmConfig(aiDataDir, storeForSave)
  return { success: true, config: { ...newConfig, apiKey: '' } }
}

export function updateLlmConfig(
  aiDataDir: string,
  id: string,
  updates: Partial<Omit<AIServiceConfig, 'id'>>
): { success: boolean; error?: string } {
  const storeForSave = loadRawConfigStore(aiDataDir)
  const index = storeForSave.configs.findIndex((c) => c.id === id)

  if (index === -1) {
    return { success: false, error: 'Config not found' }
  }

  const { apiKey: newApiKey, ...restUpdates } = updates
  const updated = {
    ...storeForSave.configs[index],
    ...restUpdates,
  }
  storeForSave.configs[index] = updated

  if (newApiKey) {
    const profileName = updated.name?.toLowerCase().replace(/\s+/g, '-') || updated.provider
    writeAuthProfile(profileName, {
      type: 'api_key',
      provider: updated.provider,
      key: newApiKey,
    })
    ;(storeForSave.configs[index] as unknown as Record<string, unknown>).authProfile = profileName
  }

  saveLlmConfig(aiDataDir, storeForSave)
  return { success: true }
}

export function deleteLlmConfig(aiDataDir: string, id: string): { success: boolean; error?: string } {
  const storeForSave = loadRawConfigStore(aiDataDir)
  const index = storeForSave.configs.findIndex((c) => c.id === id)

  if (index === -1) {
    return { success: false, error: 'Config not found' }
  }

  storeForSave.configs.splice(index, 1)

  const fallback = storeForSave.configs[0]
  if (storeForSave.defaultAssistant?.configId === id) {
    storeForSave.defaultAssistant = fallback ? { configId: fallback.id, modelId: fallback.model || '' } : null
  }
  if (storeForSave.fastModel?.configId === id) {
    storeForSave.fastModel = fallback ? { configId: fallback.id, modelId: fallback.model || '' } : null
  }

  saveLlmConfig(aiDataDir, storeForSave)
  return { success: true }
}

export function setDefaultAssistantSlot(
  aiDataDir: string,
  configId: string,
  modelId: string
): { success: boolean; error?: string } {
  const storeForSave = loadRawConfigStore(aiDataDir)
  const config = storeForSave.configs.find((c) => c.id === configId)

  if (!config) {
    return { success: false, error: 'Config not found' }
  }

  storeForSave.defaultAssistant = { configId, modelId }
  saveLlmConfig(aiDataDir, storeForSave)
  return { success: true }
}

export function setFastModelSlot(aiDataDir: string, slot: ModelSlot | null): { success: boolean; error?: string } {
  const storeForSave = loadRawConfigStore(aiDataDir)

  if (slot !== null) {
    const config = storeForSave.configs.find((c) => c.id === slot.configId)
    if (!config) {
      return { success: false, error: 'Config not found' }
    }
  }

  storeForSave.fastModel = slot
  saveLlmConfig(aiDataDir, storeForSave)
  return { success: true }
}

function loadRawConfigStore(aiDataDir: string): AIConfigStore {
  const configPath = path.join(aiDataDir, 'llm-config.json')
  if (!fs.existsSync(configPath)) {
    return { configs: [], defaultAssistant: null, fastModel: null }
  }
  try {
    const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    return {
      configs: data.configs || [],
      defaultAssistant: data.defaultAssistant ?? null,
      fastModel: data.fastModel ?? null,
    }
  } catch {
    return { configs: [], defaultAssistant: null, fastModel: null }
  }
}

// ==================== PiModel Builder ====================

const DEFAULT_CONTEXT_WINDOW = 128000

function findModelDefinition(providerId: string, modelId: string): ModelDefinition | null {
  const builtinForProvider = getBuiltinModelsByProvider(providerId)
  return builtinForProvider.find((m) => m.id === modelId) || BUILTIN_MODELS.find((m) => m.id === modelId) || null
}

function normalizeAnthropicBaseUrl(url: string): string {
  return url.replace(/\/v1\/?$/, '')
}

function normalizeOpenAICompatibleBaseUrl(url: string): string {
  if (!url) return url
  const trimmed = url.replace(/\/+$/, '')
  if (trimmed.endsWith('/v1')) return trimmed
  try {
    const parsed = new URL(trimmed)
    if (parsed.pathname === '/' || parsed.pathname === '') {
      return trimmed + '/v1'
    }
  } catch {
    // ignore
  }
  return trimmed
}

export function buildPiModel(config: AIServiceConfig): PiModel<PiApi> {
  const providerDef = BUILTIN_PROVIDERS.find((p) => p.id === config.provider)
  const baseUrl = config.baseUrl || providerDef?.defaultBaseUrl || ''
  const modelId = config.model || ''

  const modelDef = findModelDefinition(config.provider, modelId)
  const contextWindow = modelDef?.contextWindow ?? DEFAULT_CONTEXT_WINDOW

  const BUILTIN_PROVIDER_API: Record<string, PiApi> = {
    gemini: 'google-generative-ai',
    anthropic: 'anthropic-messages',
  }

  const apiFormat: PiApi = (config.apiFormat as PiApi) || BUILTIN_PROVIDER_API[config.provider] || 'openai-completions'

  if (apiFormat === 'google-generative-ai') {
    return {
      id: modelId,
      name: modelId,
      api: 'google-generative-ai',
      provider: 'google',
      baseUrl,
      reasoning: false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow,
      maxTokens: config.maxTokens ?? 8192,
    }
  }

  if (apiFormat === 'anthropic-messages') {
    return {
      id: modelId,
      name: modelId,
      api: 'anthropic-messages',
      provider: 'anthropic',
      baseUrl: normalizeAnthropicBaseUrl(baseUrl),
      reasoning: false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow,
      maxTokens: config.maxTokens ?? 8192,
    }
  }

  const resolvedBaseUrl =
    config.provider === 'openai-compatible' && (apiFormat === 'openai-completions' || apiFormat === 'openai-responses')
      ? normalizeOpenAICompatibleBaseUrl(baseUrl)
      : baseUrl

  return {
    id: modelId,
    name: modelId,
    api: apiFormat,
    provider: config.provider,
    baseUrl: resolvedBaseUrl,
    reasoning: config.isReasoningModel ?? false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow,
    maxTokens: config.maxTokens ?? 4096,
    compat: config.disableThinking ? { thinkingFormat: 'qwen' } : undefined,
  }
}
