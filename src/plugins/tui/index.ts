/**
 * TUI 插件入口 —— 第 10 课。
 *
 * 用 ink（React for CLI）渲染终端聊天界面。
 * 渲染逻辑在 App.tsx（含 JSX，所以是 .tsx）；这里保持 .ts。
 */
import type { Context } from '../../core/context.js'
import { startTui } from './App.js'
import type { TuiConfig, TuiService } from './types.js'

export function tuiPlugin(ctx: Context, config: TuiConfig = {}): void {
  const title = config.title ?? 'Agent TUI'

  const service: TuiService = {
    async start(): Promise<void> {
      await startTui(ctx, title)
    },
  }

  ctx.provide('tui', service)
}

tuiPlugin.inject = ['sessions', 'llm', 'tools', 'agent'] as const
