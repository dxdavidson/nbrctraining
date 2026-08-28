import { useEffect, useId, useRef, useState } from 'react'
import './HeaderTooltip.css'

// Click/tap-to-toggle tooltip so it works without hover on touch devices.
export default function HeaderTooltip({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLSpanElement>(null)
  const tooltipId = useId()

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (e: PointerEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  return (
    <span className="header-tooltip" ref={wrapperRef}>
      {label}
      <button
        type="button"
        className="header-tooltip-button"
        aria-expanded={open}
        aria-describedby={open ? tooltipId : undefined}
        onClick={() => setOpen((prev) => !prev)}
      >
        <svg className="header-tooltip-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <circle cx="10" cy="10" r="9" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="10" cy="6" r="1.15" fill="currentColor" />
          <rect x="9" y="9" width="2" height="6" rx="1" fill="currentColor" />
        </svg>
        <span className="sr-only">More info about {label}</span>
      </button>
      {open && (
        <span role="tooltip" id={tooltipId} className="header-tooltip-panel">
          {children}
        </span>
      )}
    </span>
  )
}
