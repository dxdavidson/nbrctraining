import PlanBrowser from './PlanBrowser'
import Estimated2kTimeInput from './Estimated2kTimeInput'
import AdminImport from './AdminImport'
import PlanDescription from './PlanDescription'

function App() {
  if (window.location.pathname === '/admin/import') {
    return <AdminImport />
  }

  const planMatch = window.location.pathname.match(/^\/plans\/([^/]+)$/)
  if (planMatch) {
    return <PlanDescription planId={decodeURIComponent(planMatch[1])} />
  }

  return (
    <>
      <Estimated2kTimeInput />
      <PlanBrowser />
    </>
  )
}

export default App

