/**
 * 服务端文件日志工具（server-only）
 *
 * 设计要点：
 * - 按「来源子文件夹 + 按天」分文件：logs/{source}/{YYYY-MM-DD}.log（日期按 Asia/Shanghai）
 * - 追加写入，首次写入时自动创建对应 source 子目录
 * - 统一格式：[2026-07-19 14:30:05][LEVEL][source] message
 * - error 级别额外双写 logs/error/{date}.log，便于集中查错
 * - 写失败静默吞错，绝不影响业务主流程
 *
 * 使用约定：在控制台 logger 打印之后调用——控制台输出简要，文件日志详细。
 */
import { appendFile, mkdir, readdir, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'

/** 日志来源白名单：作为路径子目录名的唯一合法取值，杜绝 join(LOG_DIR, source) 的路径穿越隐患 */
export const LOG_SOURCES = ['oss', 'tts', 'ai', 'nls', 'api', 'auth', 'db', 'error'] as const
/** 日志来源约定：oss | tts | ai | nls | api | auth | db | error */
export type LogSource = (typeof LOG_SOURCES)[number]

const LOG_SOURCE_SET = new Set<string>(LOG_SOURCES)

const LOG_DIR = join(process.cwd(), 'logs')

/**
 * 测试环境短路开关：Vitest 会自动注入 process.env.VITEST='true'。
 * 测试运行时不写文件日志，避免测试用例的 mock 数据污染 logs/（曾导致 nls 用量被误读）。
 * 生产运行（Nitro）不存在该变量，日志照常写入。
 */
const IS_TEST = process.env.VITEST === 'true'

/** 已创建目录缓存（每个 source 只 mkdir 一次） */
const readyDirs = new Set<string>()

/** 当前日期（Asia/Shanghai）→ 2026-07-19 */
function dateStr(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
}

/** 时间戳（Asia/Shanghai，24 小时制）→ 2026-07-19 14:30:05 */
function timestamp(): string {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' })
}

/** 序列化日志参数：字符串原样、Error 取 stack、其余 JSON.stringify */
function serialize(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === 'string') return a
      if (a instanceof Error) return a.stack ?? a.message
      try {
        return JSON.stringify(a)
      } catch {
        return String(a)
      }
    })
    .join(' ')
}

/**
 * 追加写入文件日志（吞错降级，绝不抛错）
 * @param source 来源标识，决定文件名前缀
 * @param level  日志级别（info / warn / error / ...）
 * @param args   日志内容
 */
export async function fileLog(source: LogSource, level: string, ...args: unknown[]): Promise<void> {
  if (IS_TEST) return
  try {
    // 运行时兜底：非白名单来源回退到 'error'，杜绝 join 路径穿越（纵深防御）
    const safeSource: LogSource = LOG_SOURCE_SET.has(source) ? source : 'error'
    const sourceDir = join(LOG_DIR, safeSource)
    if (!readyDirs.has(safeSource)) {
      await mkdir(sourceDir, { recursive: true })
      readyDirs.add(safeSource)
    }
    const line = `[${timestamp()}][${level.toUpperCase()}][${safeSource}] ${serialize(args)}\n`
    const date = dateStr()
    await appendFile(join(sourceDir, `${date}.log`), line, 'utf-8')
    // error 级别双写集中错误日志（来源已是 error 时不重复写）
    if (level.toLowerCase() === 'error' && safeSource !== 'error') {
      const errorDir = join(LOG_DIR, 'error')
      if (!readyDirs.has('error')) {
        await mkdir(errorDir, { recursive: true })
        readyDirs.add('error')
      }
      await appendFile(join(errorDir, `${date}.log`), line, 'utf-8')
    }
  } catch {
    // 文件日志失败绝不影响业务
  }
}

/** 便捷方法：错误日志（自动双写 error-*.log） */
export function fileLogError(source: LogSource, ...args: unknown[]): Promise<void> {
  return fileLog(source, 'error', ...args)
}

/**
 * 清理过期文件日志：遍历 logs/ 下各 source 子目录，删除 mtime 早于 N 天前的 .log 文件。
 * 启动时由 apiCallLogger 插件 fire-and-forget 调用一次；全程吞错，绝不影响业务。
 * @param days    保留天数（默认 30，可由 runtimeConfig.logRetentionDays 覆盖）
 * @param baseDir 日志根目录（默认 logs/，测试注入用）
 */
export async function cleanupOldLogs(days = 30, baseDir = LOG_DIR): Promise<void> {
  try {
    // 非法/非正天数兜底为 30，防误配置（如负数）导致全量误删
    const safeDays = Number.isFinite(days) && days > 0 ? days : 30
    const cutoff = Date.now() - safeDays * 24 * 60 * 60 * 1000
    const entries = await readdir(baseDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const sourceDir = join(baseDir, entry.name)
      let files: string[]
      try {
        files = await readdir(sourceDir)
      } catch {
        continue // 单个子目录读取失败不影响其余目录
      }
      for (const file of files) {
        if (!file.endsWith('.log')) continue
        const filePath = join(sourceDir, file)
        try {
          const info = await stat(filePath)
          if (info.mtimeMs < cutoff) {
            await unlink(filePath)
          }
        } catch {
          // 单文件 stat/删除失败跳过（可能被占用），下次启动再清
        }
      }
    }
  } catch {
    // logs/ 不存在或遍历失败均静默：清理是旁路能力
  }
}
