import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, utimes, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { cleanupOldLogs } from '../fileLogger'

// cleanupOldLogs 通过 baseDir 参数注入临时目录测试，不触碰项目真实 logs/

const DAY_MS = 24 * 60 * 60 * 1000

let baseDir: string

/** 创建文件并把 mtime 设为 N 天前 */
async function createLogFile(dir: string, name: string, ageDays: number): Promise<string> {
  const filePath = join(dir, name)
  await writeFile(filePath, 'log line\n', 'utf-8')
  const past = new Date(Date.now() - ageDays * DAY_MS)
  await utimes(filePath, past, past)
  return filePath
}

beforeEach(async () => {
  baseDir = await mkdtemp(join(tmpdir(), 'log-cleanup-test-'))
})

afterEach(async () => {
  await rm(baseDir, { recursive: true, force: true })
})

describe('cleanupOldLogs - 过期文件日志清理', () => {
  it('删除超期 .log，保留未超期 .log', async () => {
    const apiDir = join(baseDir, 'api')
    await mkdir(apiDir, { recursive: true })
    await createLogFile(apiDir, '2026-06-01.log', 40) // 超期
    await createLogFile(apiDir, '2026-07-25.log', 3) // 未超期

    await cleanupOldLogs(30, baseDir)

    const remaining = await readdir(apiDir)
    expect(remaining).toEqual(['2026-07-25.log'])
  })

  it('跨多个 source 子目录清理，非 .log 文件不删除', async () => {
    const apiDir = join(baseDir, 'api')
    const errorDir = join(baseDir, 'error')
    await mkdir(apiDir, { recursive: true })
    await mkdir(errorDir, { recursive: true })
    await createLogFile(apiDir, '2026-05-01.log', 60)
    await createLogFile(errorDir, '2026-05-02.log', 60)
    await createLogFile(errorDir, 'keep.txt', 60) // 非 .log 不动

    await cleanupOldLogs(30, baseDir)

    expect(await readdir(apiDir)).toEqual([])
    expect(await readdir(errorDir)).toEqual(['keep.txt'])
  })

  it('根目录下的散落文件不处理（只遍历子目录）', async () => {
    await createLogFile(baseDir, 'stray.log', 60)
    await cleanupOldLogs(30, baseDir)
    expect(await readdir(baseDir)).toEqual(['stray.log'])
  })

  it('baseDir 不存在时静默不抛错', async () => {
    await expect(cleanupOldLogs(30, join(baseDir, 'not-exist'))).resolves.toBeUndefined()
  })

  it('非法天数（0 / 负数 / NaN）兜底为 30 天，不误删未超期文件', async () => {
    const apiDir = join(baseDir, 'api')
    await mkdir(apiDir, { recursive: true })
    await createLogFile(apiDir, 'recent.log', 3)
    await createLogFile(apiDir, 'old.log', 40)

    await cleanupOldLogs(-1, baseDir)

    const remaining = await readdir(apiDir)
    expect(remaining).toEqual(['recent.log']) // 40 天前的按兜底 30 天被删，3 天前的保留
  })
})
