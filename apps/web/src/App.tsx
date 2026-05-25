import { useCallback, useEffect, useState } from 'react'
import { AuthPage, type RoutePath } from './pages/AuthPage'
import { WorkspacePage } from './pages/WorkspacePage'

function getRoutePath(): RoutePath {
  const path = window.location.pathname
  if (path === '/login' || path === '/register') {
    return path
  }
  return '/'
}

function App() {
  const [route, setRoute] = useState<RoutePath>(() => getRoutePath())

  const navigate = useCallback((path: RoutePath) => {
    window.history.pushState({}, '', path)
    setRoute(path)
  }, [])

  useEffect(() => {
    const onPopState = () => setRoute(getRoutePath())
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  if (route === '/login' || route === '/register') {
    return <AuthPage mode={route === '/login' ? 'login' : 'register'} navigate={navigate} />
  }

  return <WorkspacePage navigate={navigate} />
}

export default App
