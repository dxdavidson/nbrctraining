import './Navigation.css'

interface NavigationProps {
  routePath: string
}

function appPath(path = '') {
  return `${import.meta.env.BASE_URL}${path}`
}

export default function Navigation({ routePath }: NavigationProps) {
  const isAdminRoute = routePath.startsWith('/admin')
  const isTechniqueRoute = routePath.startsWith('/technique')
  const isInstallRoute = routePath.startsWith('/install')

  return (
    <header className="site-header">
      <a className="site-brand" href={appPath()} aria-label="NBRC Training home">
        NBRC Training
      </a>
      <nav className="site-navigation" aria-label="Main navigation">
        <a className={routePath === '/' ? 'is-active' : undefined} href={appPath()}>
          Rowing Plans
        </a>
        <a className={routePath === '/ramp-test' ? 'is-active' : undefined} href={appPath('ramp-test')}>
          Ramp Test
        </a>
        <details className="technique-navigation" open={isTechniqueRoute}>
          <summary className={isTechniqueRoute ? 'is-active' : undefined}>Technique</summary>
          <div className="technique-navigation-menu">
            <a
              className={routePath === '/technique/rowing-machine' ? 'is-active' : undefined}
              href={appPath('technique/rowing-machine')}
            >
              Rowing Machine
            </a>
            <a
              className={routePath === '/technique/on-the-water' ? 'is-active' : undefined}
              href={appPath('technique/on-the-water')}
            >
              On The Water
            </a>
          </div>
        </details>
        <a
          className={routePath === '/round-robin-ergos' ? 'is-active' : undefined}
          href={appPath('round-robin-ergos')}
        >
          Round Robin Ergos
        </a>
        <details className="admin-navigation" open={isAdminRoute}>
          <summary className={isInstallRoute ? 'is-active' : undefined}>Install App</summary>
          <div className="admin-navigation-menu">
            <a className={routePath === '/install' ? 'is-active' : undefined} href={appPath('install')}>
              Overview
            </a>
            <a className={routePath === '/install/android' ? 'is-active' : undefined} href={appPath('install/android')}>
              Android
            </a>
            <a className={routePath === '/install/apple' ? 'is-active' : undefined} href={appPath('install/apple')}>
              Apple
            </a>
          </div>
        </details>
        <details className="admin-navigation" open={isAdminRoute}>
          <summary className={isAdminRoute ? 'is-active' : undefined}>Admin</summary>
          <div className="admin-navigation-menu">
            <a className={routePath === '/admin/import' ? 'is-active' : undefined} href={appPath('admin/import')}>
              Import Workouts
            </a>
            <a className={routePath === '/admin/settings' ? 'is-active' : undefined} href={appPath('admin/settings')}>
              Settings
            </a>
          </div>
        </details>
      </nav>
    </header>
  )
}
