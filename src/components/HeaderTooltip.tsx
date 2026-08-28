import { useEffect, useId, useState } from 'react'
import './HeaderTooltip.css'

// Tap-to-open modal so detailed info remains readable and scrollable on mobile
// instead of a floating tooltip that dismissed itself when the user tried to scroll it.
export default function HeaderTooltip({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const titleId = useId()

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open])

  return (
    <span className="header-tooltip">
      {label}
      <button
        type="button"
        className="header-tooltip-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <svg className="header-tooltip-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <circle cx="10" cy="10" r="9" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="10" cy="6" r="1.15" fill="currentColor" />
          <rect x="9" y="9" width="2" height="6" rx="1" fill="currentColor" />
        </svg>
        <span className="sr-only">More info about {label}</span>
      </button>
      {open && (
        <div className="header-tooltip-overlay" onClick={() => setOpen(false)}>
          <div
            className="header-tooltip-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="header-tooltip-dialog-header">
              <span id={titleId}>{label}</span>
              <button type="button" className="header-tooltip-close" aria-label="Close" onClick={() => setOpen(false)}>
                <span aria-hidden="true">&times;</span>
              </button>
            </div>
            <div className="header-tooltip-dialog-content">{children}</div>
          </div>
        </div>
      )}
    </span>
  )
}
