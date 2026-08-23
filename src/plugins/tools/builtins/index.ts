/**
 * 内置工具注册入口。
 */
import type { Context } from '../../../core/context.js'
import { createGrepTool } from './grep.js'
import { createListDirTool } from './list_dir.js'
import { createReadFileTool } from './read_file.js'
import { createRunCommandTool, isBlockedCommand } from './run_command.js'
import { createWriteFileTool } from './write_file.js'

/** 注册全部内置文件/命令工具，并安装 run_command 守卫。 */
export function registerBuiltinTools(ctx: Context, rootDir: string): void {
  const tools = [
    createReadFileTool(rootDir),
    createListDirTool(rootDir),
    createGrepTool(rootDir),
    createWriteFileTool(rootDir),
    createRunCommandTool(rootDir),
  ]

  for (const tool of tools) {
    ctx.tools.register(tool)
  }

  ctx.use('tools/execute', (req, next) => {
    if (req.name === 'run_command') {
      const cmd = req.args.cmd as string
      const blocked = isBlockedCommand(cmd)
      if (blocked) return { error: blocked }
    }
    return next()
  })
}
