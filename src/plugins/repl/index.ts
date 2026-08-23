/**
 * REPL 插件入口 —— 第 7 课。
 *
 * 核心循环：
 *   for await (const line of readline):
 *     - 空行 → 跳过
 *     - 以 / 开头 → 子命令（/help /tools /model /clear /exit）
 *     - 否则 → ctx.agent.run(input, { onDelta }) 流式打印结果
 *
 * 工具调用轨迹不放在 agent_loop 里，而是在这里监听 'session/event'
 * 事件打印——保持 agent_loop 纯净，同时演示事件系统的用法。
 */
import readline from 'node:readline'
import type { Context } from '../../core/context.js'
import type { ReplConfig, ReplService } from './types.js'

export function replPlugin(ctx: Context, config: ReplConfig = {}): void {
  const prompt = config.prompt ?? '你 > '

  const service: ReplService = {
    async start(): Promise<void> {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      })

      // 实时打印工具调用轨迹：工具一被调用/返回，就立刻显示
      const off = ctx.on('session/event', (e) => {
        if (e.type === 'tool/call') {
          const p = e.payload as { tool: string; args: Record<string, unknown> }
          console.log(`\n  → 调用 ${p.tool}(${JSON.stringify(p.args)})`)
        } else if (e.type === 'tool/result') {
          const p = e.payload as { tool: string; result: unknown }
          const preview = JSON.stringify(p.result)
          const clipped = preview.length > 200 ? preview.slice(0, 200) + '…' : preview
          console.log(`  ← ${p.tool} 返回: ${clipped}\n`)
        }
      })

      console.log('输入 /help 查看命令，/exit 或 Ctrl+D 退出。')
      rl.setPrompt(prompt)
      rl.prompt()

      try {
        // for await 天然处理 EOF（Ctrl+D）：流结束后循环退出
        for await (const line of rl) {
          const input = line.trim()
          if (!input) {
            rl.prompt()
            continue
          }

          if (input.startsWith('/')) {
            await handleCommand(ctx, input)
          } else {
            // 换行，让流式输出从新的一行开始
            process.stdout.write('\n')
            await ctx.agent.run(input, {
              onDelta: (d) => process.stdout.write(d),
            })
            process.stdout.write('\n\n')
          }
          rl.prompt()
        }
      } finally {
        // 卸载事件监听（注册即副作用，用完即撤）
        off()
        rl.close()
      }
    },
  }

  ctx.provide('repl', service)
}

/** 子命令分发。 */
async function handleCommand(ctx: Context, input: string): Promise<void> {
  const [name, ...rest] = input.split(/\s+/)
  switch (name) {
    case '/help':
      console.log(
        [
          '',
          '/help     查看命令列表',
          '/tools    列出当前可用工具',
          '/model    显示当前模型',
          '/remember 写入一条长期记忆（如：/remember 用户喜欢喝铁观音茶）',
          '/recall   按相关性召回记忆（如：/recall 铁观音）',
          '/mem      列出全部记忆',
          '/clear    清空会话历史（短期记忆）',
          '/exit     退出',
          '',
        ].join('\n'),
      )
      break
    case '/tools':
      for (const t of ctx.tools.list()) {
        console.log(`  ${t.name} — ${t.description}`)
      }
      break
    case '/model':
      console.log(`  ${ctx.llm.provider} / ${ctx.llm.model}`)
      break
    case '/remember': {
      const content = rest.join(' ')
      if (!content) {
        console.log('  用法：/remember <内容>，例如 /remember 用户喜欢喝铁观音茶')
        break
      }
      const entry = ctx.memory.remember(content)
      console.log(`  已记住 (${entry.id}): ${entry.content}`)
      break
    }
    case '/recall': {
      const query = rest.join(' ')
      if (!query) {
        console.log('  用法：/recall <查询>，例如 /recall 铁观音')
        break
      }
      const hits = ctx.memory.recall(query)
      if (hits.length === 0) {
        console.log(`  没有召回到相关记忆（query: ${query}）`)
      } else {
        for (const e of hits) {
          console.log(`  [${e.importance.toFixed(1)}] ${e.content}`)
        }
      }
      break
    }
    case '/mem': {
      const all = ctx.memory.list()
      if (all.length === 0) {
        console.log('  记忆库为空，用 /remember 写入一条试试')
      } else {
        for (const e of all) {
          console.log(`  (${e.namespace}) ${e.content}`)
        }
      }
      break
    }
    case '/clear':
      ctx.sessions.clear()
      console.log('  会话已清空（短期记忆）')
      break
    case '/exit':
    case '/quit':
      console.log('  再见')
      process.exit(0)
      break
    default:
      console.log(`  未知命令: ${name}（/help 查看帮助）`)
  }
  void rest
}

replPlugin.inject = ['sessions', 'llm', 'tools', 'agent', 'memory'] as const
