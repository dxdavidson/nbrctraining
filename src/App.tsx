import PlanBrowser from './PlanBrowser'
import Estimated2kTimeInput from './Estimated2kTimeInput'
import AdminImport from './AdminImport'
import PlanDescription from './PlanDescription'
import PaceGuidanceTool from './PaceGuidanceTool'
import AboutBox from './AboutBox'
import Navigation from './Navigation'
import FeaturePlaceholder from './FeaturePlaceholder'

function App() {
  // Strip the deploy base path (e.g. "/training/") so route matching works when hosted under a sub-path.
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '')
  const routePath = window.location.pathname.startsWith(basePath)
    ? window.location.pathname.slice(basePath.length) || '/'
    : window.location.pathname

  let content

  if (routePath === '/admin/import') {
    content = <AdminImport />
  } else if (routePath === '/ramp-test') {
    content = (
      <FeaturePlaceholder
        title="Ramp Test"
        description="The rowing ramp test will be available here."
      />
    )
  } else if (routePath === '/round-robin-ergos') {
    content = (
      <FeaturePlaceholder
        title="Round Robin Ergos"
        description="Round robin erg sessions will be available here."
      />
    )
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
