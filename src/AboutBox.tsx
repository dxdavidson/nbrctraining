import { useState } from 'react'
import './AboutBox.css'

export default function AboutBox() {
  const [open, setOpen] = useState(false)

  return (
    <div className="about-box">
      <button type="button" className="about-box-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        ⓘ About
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
