import { useCallback, useEffect, useState } from 'react'
import { AuthPage, type RoutePath, type WorkspaceRoutePath } from './pages/AuthPage'
import { WorkspacePage } from './pages/WorkspacePage'

function getRoutePath(): RoutePath {
  const path = window.location.pathname
  if (
    path === '/login' ||
    path === '/register' ||
    path === '/chat' ||
    path === '/runs' ||
    path === '/daemon'
  ) {
    return path
  }
  return '/chat'
}

function isWorkspaceRoute(route: RoutePath): route is WorkspaceRoutePath {
  return route === '/chat' || route === '/runs' || route === '/daemon'
}

function App() {
  const [route, setRoute] = useState<RoutePath>(() => getRoutePath())

  const navigate = useCallback((path: RoutePath) => {
    if (window.location.pathname !== path) {
      window.history.pushState({}, '', path)
    }
    setRoute(path)
  }, [])

  useEffect(() => {
    if (window.location.pathname !== route) {
      window.history.replaceState({}, '', route)
    }

    const onPopState = () => setRoute(getRoutePath())
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [route])

  if (route === '/login' || route === '/register') {
    return <AuthPage mode={route === '/login' ? 'login' : 'register'} navigate={navigate} />
  }

  return <WorkspacePage route={isWorkspaceRoute(route) ? route : '/chat'} navigate={navigate} />
}

export default App
