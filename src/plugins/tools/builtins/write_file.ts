/**
 * write_file —— 写入或覆盖项目内文本文件。
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import type { Tool } from '../types.js'
import { resolveSafePath } from './path.js'

export function createWriteFileTool(rootDir: string): Tool {
  return {
    name: 'write_file',
    description: '写入或覆盖项目内的文本文件。path 为相对项目根的路径，content 为完整文件内容。',
    schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '相对项目根的文件路径，如 src/hello.ts',
        },
        content: {
          type: 'string',
          description: '要写入的完整文件内容',
        },
      },
      required: ['path', 'content'],
    },
    async execute(args) {
      const rel = args.path as string
      const content = args.content as string
      if (!rel) return { error: '缺少 path 参数' }
      if (typeof content !== 'string') return { error: '缺少 content 参数' }

      try {
        const abs = resolveSafePath(rootDir, rel)
        await fs.mkdir(path.dirname(abs), { recursive: true })
        await fs.writeFile(abs, content, 'utf-8')
        return { path: rel, bytesWritten: Buffer.byteLength(content, 'utf-8') }
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    },
  }
}
