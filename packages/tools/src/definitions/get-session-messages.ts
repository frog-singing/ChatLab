/**
 * 获取会话完整消息工具
 */

import type { ToolDefinition, ToolExecutionContext, ToolResult, JsonSchema } from '../types'
import { isChineseLocale } from '../utils/format'

const inputSchema: JsonSchema = {
  type: 'object',
  properties: {
    session_id: { type: 'number', description: '会话 ID（通过 search_sessions 获取）' },
    limit: { type: 'number', description: '返回的最大消息条数' },
  },
  required: ['session_id'],
}

async function handler(params: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const { locale, maxMessagesLimit } = context
  const limit = maxMessagesLimit || (params.limit as number) || 1000

  const result = await context.dataProvider!.getSessionMessages(params.session_id as number, limit)

  if (!result) {
    const data = {
      error: isChineseLocale(locale) ? '未找到指定的会话' : 'Session not found',
      sessionId: params.session_id,
    }
    return { content: JSON.stringify(data), data }
  }

  const localeStr = isChineseLocale(locale) ? 'zh-CN' : 'en-US'
  const startTime = new Date(result.startTs * 1000).toLocaleString(localeStr)
  const endTime = new Date(result.endTs * 1000).toLocaleString(localeStr)
  const rawMessages = result.messages.map((m) => ({
    id: m.id,
    senderName: m.senderName,
    content: m.content,
    timestamp: m.timestamp,
  }))

  const data = {
    sessionId: result.sessionId,
    time: `${startTime} ~ ${endTime}`,
    messageCount: result.messageCount,
    returnedCount: result.returnedCount,
    participants: result.participants,
    rawMessages,
  }

  return { content: JSON.stringify(data), data, rawMessages }
}

export const getSessionMessagesTool: ToolDefinition = {
  name: 'get_session_messages',
  description: '获取指定会话的完整消息列表。用于在 search_sessions 找到相关会话后，获取该会话的完整上下文。',
  inputSchema,
  handler,
  category: 'core',
  truncationStrategy: 'keep_last',
}
