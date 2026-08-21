/**
 * Tools 插件入口。
 *
 * 提供 ctx.tools 服务：工具注册表 + 守卫流水线。
 * 执行工具时走 waterfall('tools/execute')，让权限/审计等守卫可以拦截或改写。
 */
import type { Context } from '../../core/context.js'
import type { Tool, ToolRegistry } from './types.js'

export function toolsPlugin(ctx: Context): void {
  // 内部：工具注册表（Map）
  const _tools = new Map<string, Tool>()

  const service: ToolRegistry = {
    register(tool: Tool): void {
      // TODO:
      // 1) 检查同名工具是否已注册（重复注册要报错或警告）
      if(_tools.has(tool.name)){
        throw new Error(`Tool ${tool.name} already registered`)
      }
      // 2) _tools.set(tool.name, tool)
      _tools.set(tool.name, tool)
      // 3) 用 ctx.effect() 登记"卸载时移除该工具"，保证副作用可逆
      ctx.effect(() => _tools.delete(tool.name))
    },

    get(name: string): Tool | undefined {
      // TODO: _tools.get(name)
      return _tools.get(name)
    },

    list(): Tool[] {
      // TODO: 返回所有工具，按 name 排序（供 LLM 生成 schema 列表）
      return Array.from(_tools.values()).sort((a, b) => a.name.localeCompare(b.name))
    },

    async execute(name: string, args: Record<string, unknown>): Promise<unknown> {
      // TODO:
      // 1) 从 _tools 取工具，找不到要抛错
      const tool = _tools.get(name)
      if(!tool){
        throw new Error(`Tool ${name} not found`)
      }
      // 2) 走守卫流水线：
      //    ctx.waterfall('tools/execute', { name, args }, () => tool.execute(args))
      //    这样权限/审计守卫（通过 ctx.use 注册的）能在执行前拦截或改写
      return await ctx.waterfall('tools/execute', { name, args }, () => tool.execute(args))
      // 3) 返回结果
    },
  }

  ctx.provide('tools', service)
}
