/**
 * 消息搜索工具
 *
 * 在聊天记录中按关键词搜索消息。
 */

import type { ToolDefinition, ToolExecutionContext, ToolResult, JsonSchema } from '../types'

const inputSchema: JsonSchema = {
  type: 'object',
  properties: {
    keyword: {
      type: 'string',
      description: '搜索关键词',
    },
    limit: {
      type: 'number',
      description: '返回的最大消息条数',
      default: 50,
    },
  },
  required: ['keyword'],
}

async function handler(params: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const keyword = params.keyword as string
  const limit = (params.limit as number) || 50

  const result = await context.dataProvider!.searchMessages([keyword], {
    timeFilter: context.timeFilter,
    limit,
  })

  const data = {
    total: result.total,
    returned: result.messages.length,
    hasMore: result.messages.length < result.total,
    messages: result.messages.map((m) => ({
      sender: m.senderName,
      content: m.content,
      time: new Date(m.timestamp * 1000).toISOString(),
    })),
  }

  return {
    content: JSON.stringify(data),
    data,
    rawMessages: result.messages,
  }
}

export const searchTool: ToolDefinition = {
  name: 'search_keyword',
  description: '在聊天记录中搜索关键词，返回匹配的消息列表（发送者、内容、时间）',
  inputSchema,
  handler,
  category: 'core',
  truncationStrategy: 'keep_first',
}
