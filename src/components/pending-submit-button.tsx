'use client'

import { useFormStatus } from 'react-dom'
import { CenteredLoadingState } from './centered-loading-state'

type PendingSubmitButtonProps = {
  label: string
  pendingLabel?: string
  overlayLabel?: string
  overlaySubtitle?: string
  className?: string
  disabled?: boolean
}

export function PendingSubmitButton({
  label,
  pendingLabel = 'טוען...',
  overlayLabel = 'מתחבר...',
  overlaySubtitle = 'בודק את הפרטים ומעביר אותך למסך המתאים',
  className,
  disabled = false,
}: PendingSubmitButtonProps) {
  const { pending } = useFormStatus()
  const isDisabled = disabled || pending

  return (
    <>
      <button
        type="submit"
        disabled={isDisabled}
        className={className}
        aria-busy={pending}
      >
        {pending ? pendingLabel : label}
      </button>
      {pending && !disabled ? (
        <CenteredLoadingState
          label={overlayLabel}
          subtitle={overlaySubtitle}
        />
      ) : null}
    </>
  )
}
