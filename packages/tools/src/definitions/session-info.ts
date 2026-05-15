/**
 * 会话信息工具
 *
 * 获取指定会话的详细信息（概览统计）。
 */

import type { ToolDefinition, ToolExecutionContext, ToolResult, JsonSchema } from '../types'
import { getSessionMeta, getSessionOverview, getMembers } from '@openchatlab/core'

const inputSchema: JsonSchema = {
  type: 'object',
  properties: {
    include_members: {
      type: 'boolean',
      description: '是否包含成员列表（默认 false）',
      default: false,
    },
  },
}

function handler(params: Record<string, unknown>, context: ToolExecutionContext): ToolResult {
  const db = context.db!
  const meta = getSessionMeta(db)
  const overview = getSessionOverview(db)
  const includeMembers = params.include_members as boolean

  const data: Record<string, unknown> = { ...meta, ...overview }

  if (includeMembers) {
    data.members = getMembers(db)
  }

  return {
    content: JSON.stringify(data),
    data,
  }
}

export const sessionInfoTool: ToolDefinition = {
  name: 'get_session_info',
  description: '获取当前会话的详细信息，包括名称、平台、消息总数、成员数、时间范围等',
  inputSchema,
  handler,
}
