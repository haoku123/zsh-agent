/**
 * read_file —— 读取项目内文本文件。
 */
import fs from 'node:fs/promises'
import type { Tool } from '../types.js'
import { resolveSafePath } from './path.js'

export function createReadFileTool(rootDir: string): Tool {
  return {
    name: 'read_file',
    description: '读取项目内文本文件的内容。path 为相对项目根的路径。',
    schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '相对项目根的文件路径，如 src/main.ts',
        },
      },
      required: ['path'],
    },
    async execute(args) {
      const rel = args.path as string
      if (!rel) return { error: '缺少 path 参数' }

      try {
        const abs = resolveSafePath(rootDir, rel)
        const content = await fs.readFile(abs, 'utf-8')
        return { path: rel, content }
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    },
  }
}
