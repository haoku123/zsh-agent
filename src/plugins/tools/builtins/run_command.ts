/**
 * run_command —— 在项目根目录执行 shell 命令（危险操作）。
 */
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import type { Tool } from '../types.js'

const execAsync = promisify(exec)

export function createRunCommandTool(rootDir: string): Tool {
  return {
    name: 'run_command',
    description:
      '在项目根目录执行 shell 命令，返回 stdout/stderr。仅用于 npm run、git status 等必要操作。',
    dangerous: true,
    schema: {
      type: 'object',
      properties: {
        cmd: {
          type: 'string',
          description: '要执行的 shell 命令，如 "npm run typecheck"',
        },
      },
      required: ['cmd'],
    },
    async execute(args) {
      const cmd = args.cmd as string
      if (!cmd) return { error: '缺少 cmd 参数' }

      try {
        const { stdout, stderr } = await execAsync(cmd, {
          cwd: path.resolve(rootDir),
          timeout: 30_000,
          maxBuffer: 1024 * 1024,
          env: process.env,
        })
        return {
          cmd,
          stdout: stdout.trimEnd(),
          stderr: stderr.trimEnd(),
        }
      } catch (err) {
        const e = err as { stdout?: string; stderr?: string; message?: string }
        return {
          cmd,
          error: e.message ?? String(err),
          stdout: e.stdout?.trimEnd() ?? '',
          stderr: e.stderr?.trimEnd() ?? '',
        }
      }
    },
  }
}

/** 拦截明显危险的 shell 片段。 */
export function isBlockedCommand(cmd: string): string | null {
  const blocked = [
    /\brm\s+-rf\b/i,
    /\bsudo\b/i,
    /\bmkfs\b/i,
    /\bdd\s+if=/i,
    /\bchmod\s+-R\s+777\b/i,
    />\s*\/dev\/sd/i,
  ]
  for (const re of blocked) {
    if (re.test(cmd)) return `拒绝执行危险命令: ${cmd}`
  }
  return null
}
