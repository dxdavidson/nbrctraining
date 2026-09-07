import PlanBrowser from './PlanBrowser'
import Estimated2kTimeInput from './Estimated2kTimeInput'
import AdminImport from './AdminImport'
import PlanDescription from './PlanDescription'
import PaceGuidanceTool from './PaceGuidanceTool'
import AboutBox from './AboutBox'
import Navigation from './Navigation'
import RampTest from './RampTest'
import RoundRobinErgos from './RoundRobinErgos'

function App() {
  // Strip the deploy base path (e.g. "/training/") so route matching works when hosted under a sub-path.
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '')
  const strippedPath = window.location.pathname.startsWith(basePath)
    ? window.location.pathname.slice(basePath.length) || '/'
    : window.location.pathname
  // Normalize a trailing slash (e.g. "/ramp-test/") so it still matches the exact route strings below.
  const routePath = strippedPath.length > 1 ? strippedPath.replace(/\/$/, '') : strippedPath

  let content

  if (routePath === '/admin/import') {
    content = <AdminImport />
  } else if (routePath === '/ramp-test') {
    content = <RampTest />
  } else if (routePath === '/round-robin-ergos') {
    content = <RoundRobinErgos />
  } else if (routePath === '/tools/pace-guidance') {
    content = <PaceGuidanceTool />
  } else {
    const planMatch = routePath.match(/^\/plans\/([^/]+)$/)
    content = planMatch ? (
      <PlanDescription planId={decodeURIComponent(planMatch[1])} />
    ) : (
      <>
        <Estimated2kTimeInput />
        <PlanBrowser />
        <AboutBox />
      </>
    )
  }

  return (
    <>
      <Navigation routePath={routePath} />
      {content}
    </>
  )
}

export default App
