/**
 * 路径安全：限制所有文件类工具只能在 rootDir 内操作。
 */
import path from 'node:path'

/** 将相对路径解析为绝对路径，并确保不逃逸 rootDir。 */
export function resolveSafePath(rootDir: string, input: string): string {
  const root = path.resolve(rootDir)
  const abs = path.resolve(root, input || '.')
  const rel = path.relative(root, abs)

  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`路径不允许访问项目外: ${input}`)
  }
  return abs
}

/** 相对 rootDir 的路径（用于返回给模型）。 */
export function toRelativePath(rootDir: string, abs: string): string {
  return path.relative(path.resolve(rootDir), abs) || '.'
}

/** 遍历时跳过的目录名。 */
export const SKIP_DIR_NAMES = new Set(['node_modules', '.git', 'dist', 'build', 'out'])
