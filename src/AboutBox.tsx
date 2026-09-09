import { useState } from 'react'
import './AboutBox.css'

export default function AboutBox() {
  const [open, setOpen] = useState(false)

  return (
    <div className="about-box">
      <button type="button" className="about-box-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <svg className="about-box-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <circle cx="10" cy="10" r="9" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="10" cy="6" r="1.15" fill="currentColor" />
          <rect x="9" y="9" width="2" height="6" rx="1" fill="currentColor" />
        </svg>
        <span>About</span>
      </button>
      {open && (
        <div className="about-box-panel" role="dialog" aria-label="Build information">
          <dl>
            <dt>Version</dt>
            <dd>{__APP_VERSION__}</dd>
            <dt>Commit</dt>
            <dd>{__COMMIT_HASH__}</dd>
            <dt>Built</dt>
            <dd>{new Date(__BUILD_TIME__).toLocaleString()}</dd>
          </dl>
        </div>
      )}
    </div>
  )
}
