/**
 * 聊天概览工具
 */

import type { ToolDefinition, ToolExecutionContext, ToolResult, JsonSchema } from '../types'
import { isChineseLocale } from '../utils/format'

const inputSchema: JsonSchema = {
  type: 'object',
  properties: {
    top_n: { type: 'number', description: '返回活跃度最高的前 N 个成员，默认 10' },
  },
}

async function handler(params: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const { locale } = context
  const topN = (params.top_n as number) || 10

  const result = await context.dataProvider!.getChatOverview(topN)
  if (!result) {
    const msg = isChineseLocale(locale) ? '无法获取聊天概览' : 'Unable to get chat overview'
    return { content: msg, data: { error: msg } }
  }

  const msgSuffix = isChineseLocale(locale) ? '条' : ''
  const lines: string[] = [
    `name: ${result.name}`,
    `platform: ${result.platform}`,
    `type: ${result.type}`,
    `totalMessages: ${result.totalMessages}`,
    `totalMembers: ${result.totalMembers}`,
  ]

  if (result.firstMessageTs != null && result.lastMessageTs != null) {
    const start = new Date(result.firstMessageTs * 1000).toLocaleDateString()
    const end = new Date(result.lastMessageTs * 1000).toLocaleDateString()
    lines.push(`timeRange: ${start} ~ ${end}`)
  }

  if (result.topMembers.length > 0) {
    lines.push(`topMembers:`)
    for (let i = 0; i < result.topMembers.length; i++) {
      const m = result.topMembers[i]
      const pct = result.totalMessages > 0 ? ((m.count / result.totalMessages) * 100).toFixed(1) : '0'
      lines.push(`${i + 1}. ${m.name} ${m.count}${msgSuffix}(${pct}%)`)
    }
  }

  return { content: lines.join('\n'), data: result }
}

export const chatOverviewTool: ToolDefinition = {
  name: 'get_chat_overview',
  description: '获取聊天概览信息，包括聊天名称、平台、总消息数、总成员数、时间范围和活跃成员排行',
  inputSchema,
  handler,
  category: 'core',
}
