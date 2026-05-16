type CenteredLoadingStateProps = {
  label?: string
  subtitle?: string
}

export function CenteredLoadingState({
  label = 'טוען...',
  subtitle = 'מעבד את הבקשה שלך',
}: CenteredLoadingStateProps) {
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/28 px-6 backdrop-blur-[2px]">
      <div className="flex min-w-[220px] max-w-sm flex-col items-center gap-4 rounded-[2rem] bg-white/96 px-7 py-6 text-center shadow-2xl ring-1 ring-slate-200">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-50 ring-1 ring-amber-100">
          <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-slate-200 border-t-amber-500" />
        </div>
        <div className="space-y-1">
          <p className="text-base font-black tracking-tight text-slate-900">
            {label}
          </p>
          <p className="text-sm text-slate-600">{subtitle}</p>
        </div>
      </div>
    </div>
  )
}
