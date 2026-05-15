/**
 * 获取成员列表工具
 */

import type { ToolDefinition, ToolExecutionContext, ToolResult, JsonSchema } from '../types'
import { isChineseLocale, t } from '../utils/format'

const inputSchema: JsonSchema = {
  type: 'object',
  properties: {
    search: { type: 'string', description: '按名称/别名/平台ID搜索过滤' },
    limit: { type: 'number', description: '最大返回数量' },
  },
}

async function handler(params: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const { locale } = context
  const members = await context.dataProvider!.getMembers()

  let filteredMembers = members
  if (params.search) {
    const keyword = (params.search as string).toLowerCase()
    filteredMembers = members.filter((m) => {
      if (m.groupNickname && m.groupNickname.toLowerCase().includes(keyword)) return true
      if (m.accountName && m.accountName.toLowerCase().includes(keyword)) return true
      if (m.platformId.includes(keyword)) return true
      if (m.aliases.some((alias) => alias.toLowerCase().includes(keyword))) return true
      return false
    })
  }

  if (params.limit && (params.limit as number) > 0) {
    filteredMembers = filteredMembers.slice(0, params.limit as number)
  }

  const msgSuffix = isChineseLocale(locale) ? '条' : ''
  const aliasLabel = t('alias', locale)
  const data = {
    totalMembers: members.length,
    returnedMembers: filteredMembers.length,
    members: filteredMembers.map((m) => {
      const displayName = m.groupNickname || m.accountName || m.platformId
      const aliasStr = m.aliases.length > 0 ? `|${aliasLabel}:${m.aliases.join(',')}` : ''
      return `${m.id}|${m.platformId}|${displayName}|${m.messageCount}${msgSuffix}${aliasStr}`
    }),
  }

  return { content: JSON.stringify(data), data }
}

export const getMembersTool: ToolDefinition = {
  name: 'get_members',
  description: '获取成员列表，包括成员的基本信息、别名和消息统计。适用于查询"有哪些人"、"某人的别名是什么"等问题。',
  inputSchema,
  handler,
  category: 'core',
}
