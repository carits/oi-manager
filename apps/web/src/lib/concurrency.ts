export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('concurrency must be a positive integer')
  const results = new Array<R>(items.length)
  let nextIndex = 0

  async function runWorker() {
    while (true) {
      const index = nextIndex
      nextIndex += 1
      if (index >= items.length) return
      results[index] = await worker(items[index], index)
    }
  }

  const workerCount = Math.min(concurrency, items.length)
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()))
  return results
}
