/**
 * 文件型记忆存储：整个记忆库存在一个 JSON 文件里（.agent/memory.json）。
 *
 * 只负责「存」，不负责「检索」——检索算法在 index.ts 里由你来写。
 * 每次修改都落盘，保证跨会话持久。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { MemoryEntry, MemoryStore } from './types.js'

export class FileMemoryStore implements MemoryStore {
  private entries = new Map<string, MemoryEntry>()
  private file: string

  constructor(filePath: string) {
    this.file = filePath
    this.load()
  }

  /** 启动时从文件恢复。 */
  private load(): void {
    try {
      const raw = readFileSync(this.file, 'utf-8')
      const arr = JSON.parse(raw) as MemoryEntry[]
      for (const e of arr) this.entries.set(e.id, e)
    } catch {
      // 文件不存在或损坏：从空库开始（下次 persist 时自动重建）
      this.entries.clear()
    }
  }

  /** 每次修改后落盘。 */
  private persist(): void {
    mkdirSync(path.dirname(this.file), { recursive: true })
    writeFileSync(this.file, JSON.stringify([...this.entries.values()], null, 2), 'utf-8')
  }

  all(): MemoryEntry[] {
    return [...this.entries.values()]
  }

  get(id: string): MemoryEntry | undefined {
    return this.entries.get(id)
  }

  put(entry: MemoryEntry): void {
    this.entries.set(entry.id, entry)
    this.persist()
  }

  remove(id: string): void {
    this.entries.delete(id)
    this.persist()
  }
}
