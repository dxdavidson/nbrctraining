import PlanBrowser from './PlanBrowser'
import Estimated2kTimeInput from './Estimated2kTimeInput'
import AdminImport from './AdminImport'
import PlanDescription from './PlanDescription'
import PaceGuidanceTool from './PaceGuidanceTool'
import AboutBox from './AboutBox'

function App() {
  if (window.location.pathname === '/admin/import') {
    return <AdminImport />
  }

  if (window.location.pathname === '/tools/pace-guidance') {
    return <PaceGuidanceTool />
  }

  const planMatch = window.location.pathname.match(/^\/plans\/([^/]+)$/)
  if (planMatch) {
    return <PlanDescription planId={decodeURIComponent(planMatch[1])} />
  }

  return (
    <>
      <Estimated2kTimeInput />
      <PlanBrowser />
      <AboutBox />
    </>
  )
}

export default App

