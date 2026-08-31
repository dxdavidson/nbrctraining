import PlanBrowser from './PlanBrowser'
import Estimated2kTimeInput from './Estimated2kTimeInput'
import AdminImport from './AdminImport'
import PlanDescription from './PlanDescription'
import PaceGuidanceTool from './PaceGuidanceTool'
import AboutBox from './AboutBox'

function App() {
  // Strip the deploy base path (e.g. "/training/") so route matching works when hosted under a sub-path.
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '')
  const routePath = window.location.pathname.startsWith(basePath)
    ? window.location.pathname.slice(basePath.length) || '/'
    : window.location.pathname

  if (routePath === '/admin/import') {
    return <AdminImport />
  }

  if (routePath === '/tools/pace-guidance') {
    return <PaceGuidanceTool />
  }

  const planMatch = routePath.match(/^\/plans\/([^/]+)$/)
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

