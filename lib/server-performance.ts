import 'server-only'
import { AsyncLocalStorage } from 'node:async_hooks'

export type ServerPerformanceMetric = {
  event: string
  durationMs: number
  outcome: 'ok' | 'error'
}

const performanceMetrics = new AsyncLocalStorage<ServerPerformanceMetric[]>()

export async function collectServerPerformance<T>(operation: () => PromiseLike<T>) {
  const metrics: ServerPerformanceMetric[] = []
  const value = await performanceMetrics.run(metrics, operation)

  return { value, metrics }
}

export async function measureServerPerformance<T>(
  event: string,
  operation: () => PromiseLike<T>
) {
  const isVercelPreview = process.env.VERCEL_ENV === 'preview'
  const isVercelRuntime = process.env.VERCEL === '1'

  if (process.env.VERCEL_ENV === 'production' || (!isVercelPreview && !isVercelRuntime)) {
    return operation()
  }

  const startedAt = performance.now()
  let outcome: 'ok' | 'error' = 'ok'

  try {
    return await operation()
  } catch (error) {
    outcome = 'error'
    throw error
  } finally {
    const metric = {
      event,
      durationMs: Math.round(performance.now() - startedAt),
      outcome,
    } satisfies ServerPerformanceMetric
    performanceMetrics.getStore()?.push(metric)
    console.log('[app-performance]', JSON.stringify(metric))
  }
}
