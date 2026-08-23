/**
 * list_dir —— 列出项目内目录内容。
 */
import fs from 'node:fs/promises'
import type { Tool } from '../types.js'
import { resolveSafePath } from './path.js'

export function createListDirTool(rootDir: string): Tool {
  return {
    name: 'list_dir',
    description: '列出项目内某目录下的文件和子目录。path 为相对项目根的路径，默认 "."。',
    schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '相对项目根的目录路径，如 src/plugins',
        },
      },
    },
    async execute(args) {
      const rel = (args.path as string | undefined) ?? '.'

      try {
        const abs = resolveSafePath(rootDir, rel)
        const entries = await fs.readdir(abs, { withFileTypes: true })
        return {
          path: rel,
          entries: entries
            .map((e) => ({
              name: e.name,
              type: e.isDirectory() ? 'dir' : 'file',
            }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        }
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    },
  }
}
