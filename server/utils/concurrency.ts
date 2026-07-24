// server/utils/concurrency.ts
// 轻量并发控制（零依赖）：对数组元素并行执行异步任务，但限制同时进行的任务数。
// 用于把「逐个 await」的串行网络 I/O（如批量词汇 TTS + OSS 上传）改为受控并发，
// 既避免打满下游（Edge TTS / OSS）或本地资源，又大幅缩短总耗时。

/**
 * 以受限并发对 items 执行 fn，返回与输入顺序一致的结果数组。
 * 任一任务抛错会使整体 reject（与 Promise.all 语义一致）。
 * @param items       输入元素
 * @param concurrency 最大并发数（自动下限为 1）
 * @param fn          异步任务，接收元素与其索引
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  const limit = Math.max(1, Math.floor(concurrency))
  let cursor = 0

  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await fn(items[index]!, index)
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker())
  await Promise.all(workers)
  return results
}
