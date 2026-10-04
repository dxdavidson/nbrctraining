import { useRegisterSW } from 'virtual:pwa-register/react'
import './ReloadPrompt.css'

// Shown when the service worker has downloaded a newer build in the background.
// The user triggers the swap so we never reload mid-workout.
export default function ReloadPrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  if (!needRefresh) return null

  return (
    <div className="reload-prompt" role="alert">
      <span>A new version is available.</span>
      <div className="reload-prompt-actions">
        <button type="button" className="reload-prompt-update" onClick={() => updateServiceWorker(true)}>
          Update
        </button>
        <button type="button" className="reload-prompt-dismiss" onClick={() => setNeedRefresh(false)}>
          Later
        </button>
      </div>
    </div>
  )
}
