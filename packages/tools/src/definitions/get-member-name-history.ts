/**
 * 获取成员昵称变更历史工具
 */

import type { ToolDefinition, ToolExecutionContext, ToolResult, JsonSchema } from '../types'
import { isChineseLocale, t } from '../utils/format'

const inputSchema: JsonSchema = {
  type: 'object',
  properties: {
    member_id: { type: 'number', description: '成员 ID（通过 get_members 获取）' },
  },
  required: ['member_id'],
}

async function handler(params: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const { locale } = context
  const memberId = params.member_id as number

  const members = await context.dataProvider!.getMembers()
  const member = members.find((m) => m.id === memberId)

  if (!member) {
    const data = {
      error: t('memberNotFound', locale),
      member_id: memberId,
    }
    return { content: JSON.stringify(data), data }
  }

  const history = await context.dataProvider!.getMemberNameHistory(memberId)

  const localeStr = isChineseLocale(locale) ? 'zh-CN' : 'en-US'
  const untilNow = t('untilNow', locale)
  const formatHistory = (h: { name: string; startTs: number; endTs: number | null }) => {
    const start = new Date(h.startTs * 1000).toLocaleDateString(localeStr)
    const end = h.endTs ? new Date(h.endTs * 1000).toLocaleDateString(localeStr) : untilNow
    return `${h.name} (${start} ~ ${end})`
  }

  const accountNames = history.filter((h) => h.nameType === 'account_name').map(formatHistory)
  const groupNicknames = history.filter((h) => h.nameType === 'group_nickname').map(formatHistory)

  const displayName = member.groupNickname || member.accountName || member.platformId
  const aliasLabel = t('alias', locale)
  const aliasStr = member.aliases.length > 0 ? `|${aliasLabel}:${member.aliases.join(',')}` : ''
  const noChangeRecord = t('noChangeRecord', locale)

  const data = {
    member: `${member.id}|${member.platformId}|${displayName}${aliasStr}`,
    accountNameHistory: accountNames.length > 0 ? accountNames : noChangeRecord,
    groupNicknameHistory: groupNicknames.length > 0 ? groupNicknames : noChangeRecord,
  }

  return { content: JSON.stringify(data), data }
}

export const getMemberNameHistoryTool: ToolDefinition = {
  name: 'get_member_name_history',
  description: '获取成员的昵称变更历史记录。适用于回答"某人以前叫什么名字"、"某人的昵称变化"等问题。',
  inputSchema,
  handler,
  category: 'analysis',
}
