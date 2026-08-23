/**
 * delegate 工具：主 Agent 把任务委派给隔离的子 Agent。
 *
 * 只注册在「主」ctx（subagent 插件 apply 时调用）。
 * 子 Agent 复制工具时会被排除（见 subagent/index.ts），防止无限递归委派。
 */
import type { Context } from '../../core/context.js'
import type { Tool } from '../tools/types.js'

export function registerDelegateTool(ctx: Context): void {
  const tool: Tool = {
    name: 'delegate',
    description:
      '把一项任务委派给一个隔离的子 Agent 执行，返回它的最终回答。' +
      '适用于：任务需要独立上下文、细分工作、或你想让专门化的 Agent 来处理。',
    schema: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: '要委派给子 Agent 的任务描述（要足够清晰、自包含）',
        },
        tools: {
          type: 'array',
          items: { type: 'string' },
          description: '子 Agent 可用的工具白名单（可选，缺省 = 全部工具）',
        },
      },
      required: ['task'],
    },
    async execute(args): Promise<unknown> {
      const task = args.task as string
      const tools = Array.isArray(args.tools)
        ? args.tools.map(String)
        : undefined
      return await ctx.subagent.run(task, tools ? { tools } : undefined)
    },
  }
  ctx.tools.register(tool)
}
