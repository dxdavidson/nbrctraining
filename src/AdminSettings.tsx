import { useLocalStorageState } from './hooks/useLocalStorageState'
import { C2_LOGBOOK_ENABLED_STORAGE_KEY } from './settings'
import './AdminSettings.css'

export default function AdminSettings() {
  const [connectToC2Logbook, setConnectToC2Logbook] = useLocalStorageState(
    C2_LOGBOOK_ENABLED_STORAGE_KEY,
    false
  )

  return (
    <main className="admin-settings" aria-labelledby="admin-settings-title">
      <p className="admin-settings-kicker">NBRC Training administration</p>
      <h1 id="admin-settings-title">Settings</h1>
      <form>
        <label className="admin-settings-checkbox">
          <input
            type="checkbox"
            checked={connectToC2Logbook}
            onChange={(event) => setConnectToC2Logbook(event.target.checked)}
          />
          Connect to C2 Logbook
        </label>
      </form>
    </main>
  )
}
