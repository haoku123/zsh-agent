/**
 * grep —— 在项目内搜索文本。
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import type { Tool } from '../types.js'
import { SKIP_DIR_NAMES, resolveSafePath, toRelativePath } from './path.js'

const MAX_MATCHES = 50
const MAX_FILE_SIZE = 512 * 1024

async function* walkFiles(absDir: string): AsyncGenerator<string> {
  let entries
  try {
    entries = await fs.readdir(absDir, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (SKIP_DIR_NAMES.has(entry.name)) continue
    const full = path.join(absDir, entry.name)
    if (entry.isDirectory()) {
      yield* walkFiles(full)
    } else if (entry.isFile()) {
      yield full
    }
  }
}

export function createGrepTool(rootDir: string): Tool {
  return {
    name: 'grep',
    description:
      '在项目内搜索包含 pattern 的文本行。可选限定目录 path。返回 file、line、text。',
    schema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: '要搜索的字符串（普通文本匹配，非正则）',
        },
        path: {
          type: 'string',
          description: '相对项目根的搜索起点，默认 "."',
        },
      },
      required: ['pattern'],
    },
    async execute(args) {
      const pattern = args.pattern as string
      const rel = (args.path as string | undefined) ?? '.'
      if (!pattern) return { error: '缺少 pattern 参数' }

      try {
        const abs = resolveSafePath(rootDir, rel)
        const stat = await fs.stat(abs)
        const files: string[] = []

        if (stat.isFile()) {
          files.push(abs)
        } else {
          for await (const file of walkFiles(abs)) {
            files.push(file)
          }
        }

        const matches: Array<{ file: string; line: number; text: string }> = []

        for (const file of files) {
          if (matches.length >= MAX_MATCHES) break

          let content: string
          try {
            const info = await fs.stat(file)
            if (info.size > MAX_FILE_SIZE) continue
            content = await fs.readFile(file, 'utf-8')
          } catch {
            continue
          }

          const lines = content.split('\n')
          for (let i = 0; i < lines.length; i++) {
            if (matches.length >= MAX_MATCHES) break
            const text = lines[i]!
            if (text.includes(pattern)) {
              matches.push({
                file: toRelativePath(rootDir, file),
                line: i + 1,
                text: text.trimEnd(),
              })
            }
          }
        }

        return {
          pattern,
          path: rel,
          matchCount: matches.length,
          truncated: matches.length >= MAX_MATCHES,
          matches,
        }
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    },
  }
}
