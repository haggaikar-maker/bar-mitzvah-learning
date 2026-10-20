import type { ServerPerformanceMetric } from '@/lib/server-performance'

export function PerformanceDiagnostics({ metrics }: { metrics: ServerPerformanceMetric[] }) {
  if (metrics.length === 0) {
    return null
  }

  return (
    <details
      open
      dir="ltr"
      className="rounded-xl border border-cyan-300 bg-cyan-50 p-3 text-left text-xs text-slate-800"
    >
      <summary className="cursor-pointer font-bold">אבחון ביצועים זמני · Preview בלבד</summary>
      <div className="mt-2 grid gap-1 font-mono">
        {metrics.map((metric, index) => (
          <div key={`${metric.event}-${index}`} className="flex justify-between gap-4">
            <span>{metric.event}{metric.outcome === 'error' ? ' (error)' : ''}</span>
            <strong>{metric.durationMs} ms</strong>
          </div>
        ))}
      </div>
    </details>
  )
}
