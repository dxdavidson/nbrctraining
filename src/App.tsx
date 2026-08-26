import PlanBrowser from './PlanBrowser'
import Estimated2kTimeInput from './Estimated2kTimeInput'
import AdminImport from './AdminImport'

function App() {
  if (window.location.pathname === '/admin/import') {
    return <AdminImport />
  }

  return (
    <>
      <Estimated2kTimeInput />
      <PlanBrowser />
    </>
  )
}

export default App

