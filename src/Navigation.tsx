import './Navigation.css'

interface NavigationProps {
  routePath: string
}

function appPath(path = '') {
  return `${import.meta.env.BASE_URL}${path}`
}

export default function Navigation({ routePath }: NavigationProps) {
  const isAdminRoute = routePath.startsWith('/admin')

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
        <a
          className={routePath === '/round-robin-ergos' ? 'is-active' : undefined}
          href={appPath('round-robin-ergos')}
        >
          Round Robin Ergos
        </a>
        <details className="admin-navigation" open={isAdminRoute}>
          <summary className={isAdminRoute ? 'is-active' : undefined}>Admin</summary>
          <div className="admin-navigation-menu">
            <a className={routePath === '/admin/import' ? 'is-active' : undefined} href={appPath('admin/import')}>
              Import Workouts
            </a>
          </div>
        </details>
      </nav>
    </header>
  )
}
