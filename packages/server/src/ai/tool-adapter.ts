/**
 * 工具适配层
 *
 * 将 @openchatlab/tools 的 ToolDefinition 适配为 @mariozechner/pi-agent-core 的 AgentTool 格式。
 * 消息类工具返回 rawMessages 时自动执行预处理管道（清洗、去噪、脱敏、截断、格式化）。
 */

import type { ToolDefinition, ToolExecutionContext } from '@openchatlab/tools'
import { CoreDataProvider } from '@openchatlab/tools'
import type { DatabaseAdapter } from '@openchatlab/core'
import {
  applyPreprocessingPipeline,
  type AgentTool,
  type AgentToolResult,
  type PreprocessableMessage,
  type TruncationStrategy,
} from '@openchatlab/node-runtime'
import { getServerAiLogger } from './logger'

const DEFAULT_MAX_TOOL_RESULT_TOKENS = 8000

const TOOL_TRUNCATION_STRATEGY: Record<string, TruncationStrategy> = {
  search_keyword: 'keep_first',
  get_recent_messages: 'keep_last',
}

export interface ServerToolContext {
  db: DatabaseAdapter
  sessionId: string
  locale?: string
}

function convertJsonSchemaToParameters(schema: ToolDefinition['inputSchema']) {
  const properties: Record<string, unknown> = {}
  for (const [key, prop] of Object.entries(schema.properties)) {
    properties[key] = { ...prop }
  }
  return {
    type: 'object' as const,
    properties,
    required: schema.required || [],
  }
}

export function adaptToolsForAgent(
  tools: ToolDefinition[],
  getContext: () => ServerToolContext
): AgentTool<any, any>[] {
  return tools.map((tool) => ({
    name: tool.name,
    label: tool.name,
    description: tool.description,
    parameters: convertJsonSchemaToParameters(tool.inputSchema) as any,
    async execute(_toolCallId: string, params: Record<string, unknown>): Promise<AgentToolResult<unknown>> {
      const ctx = getContext()
      const execCtx: ToolExecutionContext = {
        db: ctx.db,
        dataProvider: new CoreDataProvider(ctx.db),
        sessionId: ctx.sessionId,
        locale: ctx.locale,
      }
      try {
        const result = await tool.handler(params, execCtx)

        if (result.rawMessages && result.rawMessages.length > 0) {
          const pipelineResult = applyPreprocessingPipeline({
            rawMessages: result.rawMessages as PreprocessableMessage[],
            locale: ctx.locale,
            maxToolResultTokens: DEFAULT_MAX_TOOL_RESULT_TOKENS,
            truncationStrategy: TOOL_TRUNCATION_STRATEGY[tool.name] ?? 'keep_last',
            extraDetails: (result.data ?? {}) as Record<string, unknown>,
            logger: getServerAiLogger() ?? undefined,
          })
          return { content: [{ type: 'text', text: pipelineResult.text }], details: null }
        }

        return { content: [{ type: 'text', text: result.content }], details: null }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        return { content: [{ type: 'text', text: `Error: ${msg}` }], details: null }
      }
    },
  }))
}
