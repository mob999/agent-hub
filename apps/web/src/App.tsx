import { useCallback, useEffect, useState } from 'react'
import { AuthPage, type EditorRoutePath, type RoutePath, type WorkspaceRoutePath } from './pages/AuthPage'
import { WorkspacePage } from './pages/WorkspacePage'

interface EditorRouteState {
  artifactId: string | null
  conversationId: string
}

function chatConversationIdFromPath(path: string): string | null {
  const segments = path.split('/').filter(Boolean)

  if (segments[0] !== 'chat') {
    return null
  }

  return segments.length === 2 ? decodeURIComponent(segments[1] ?? '') : null
}

function getRoutePath(): RoutePath {
  const path = window.location.pathname
  const editorRoute = editorStateFromPath(path)
  if (editorRoute !== null) {
    return path as EditorRoutePath
  }

  if (
    path === '/login' ||
    path === '/register' ||
    path === '/chat' ||
    chatConversationIdFromPath(path) !== null ||
    path === '/runs' ||
    path === '/daemon'
  ) {
    return path as RoutePath
  }
  return '/chat'
}

function isWorkspaceRoute(route: RoutePath): route is WorkspaceRoutePath {
  return route === '/chat' || route.startsWith('/chat/') || route === '/runs' || route === '/daemon'
}

function editorStateFromPath(path: string): EditorRouteState | null {
  const segments = path.split('/').filter(Boolean)

  if (segments[0] !== 'editor' || segments.length < 2 || segments.length > 3) {
    return null
  }

  return {
    conversationId: decodeURIComponent(segments[1] ?? ''),
    artifactId: segments[2] === undefined ? null : decodeURIComponent(segments[2]),
  }
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

  return (
    <WorkspacePage
      route={isWorkspaceRoute(route) ? route : '/chat'}
      chatConversationId={route.startsWith('/chat/') ? chatConversationIdFromPath(route) : null}
      editorRoute={route.startsWith('/editor/') ? editorStateFromPath(route) : null}
      navigate={navigate}
    />
  )
}

export default App
