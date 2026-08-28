import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import './HeaderTooltip.css'

const PANEL_MAX_WIDTH = 256 // matches --header-tooltip-max-width in HeaderTooltip.css

// Click/tap-to-toggle tooltip so it works without hover on touch devices.
export default function HeaderTooltip({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const [panelPosition, setPanelPosition] = useState<{ top: number; left: number } | null>(null)
  const wrapperRef = useRef<HTMLSpanElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const tooltipId = useId()

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (e: PointerEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    const handleViewportChange = () => setOpen(false)
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    window.addEventListener('scroll', handleViewportChange, true)
    window.addEventListener('resize', handleViewportChange)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('scroll', handleViewportChange, true)
      window.removeEventListener('resize', handleViewportChange)
    }
  }, [open])

  // Anchor the panel to the button's actual position and clamp it within the viewport
  // so it stays readable on narrow screens instead of overflowing off the left edge.
  useLayoutEffect(() => {
    if (!open || !buttonRef.current) {
      setPanelPosition(null)
      return
    }
    const rect = buttonRef.current.getBoundingClientRect()
    const maxWidth = Math.min(PANEL_MAX_WIDTH, window.innerWidth - 16)
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - maxWidth - 8)
    const top = rect.bottom + 6
    setPanelPosition({ top, left })
  }, [open])

  return (
    <span className="header-tooltip" ref={wrapperRef}>
      {label}
      <button
        type="button"
        ref={buttonRef}
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
      {open && panelPosition && (
        <span
          role="tooltip"
          id={tooltipId}
          className="header-tooltip-panel"
          style={{ top: panelPosition.top, left: panelPosition.left }}
        >
          {children}
        </span>
      )}
    </span>
  )
}
