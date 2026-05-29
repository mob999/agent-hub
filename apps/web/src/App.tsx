import { useCallback, useEffect, useState } from 'react'
import { AuthPage, type EditorRoutePath, type RoutePath, type WorkspaceRoutePath } from './pages/AuthPage'
import { WorkspacePage } from './pages/WorkspacePage'

interface EditorRouteState {
  artifactId: string | null
  conversationId: string
}

export interface GoalRouteState {
  conversationId: string
  goalId: string
  taskIndex: number | null
}

function chatStateFromPath(path: string): { conversationId: string | null; goalRoute: GoalRouteState | null } {
  const segments = path.split('/').filter(Boolean)

  if (segments[0] !== 'chat') {
    return { conversationId: null, goalRoute: null }
  }

  const conversationId = segments[1] === undefined ? null : decodeURIComponent(segments[1])

  if (conversationId === null) {
    return { conversationId: null, goalRoute: null }
  }

  if (segments.length === 2) {
    return { conversationId, goalRoute: null }
  }

  if (segments.length === 3 && segments[2] === 'tasks') {
    return { conversationId, goalRoute: null }
  }

  if (segments[2] !== 'goals' || segments[3] === undefined) {
    return { conversationId: null, goalRoute: null }
  }

  const taskIndexSegment = segments.length === 6 && segments[4] === 'tasks'
    ? decodeURIComponent(segments[5] ?? '')
    : null
  const taskIndex =
    taskIndexSegment !== null && /^\d+$/.test(taskIndexSegment)
      ? Number.parseInt(taskIndexSegment, 10)
      : null

  if (segments.length !== 4 && (segments.length !== 6 || taskIndex === null)) {
    return { conversationId: null, goalRoute: null }
  }

  return {
    conversationId,
    goalRoute: {
      conversationId,
      goalId: decodeURIComponent(segments[3]),
      taskIndex,
    },
  }
}

function chatConversationIdFromPath(path: string): string | null {
  return chatStateFromPath(path).conversationId
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
    chatStateFromPath(path).conversationId !== null ||
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
      goalRoute={route.startsWith('/chat/') ? chatStateFromPath(route).goalRoute : null}
      editorRoute={route.startsWith('/editor/') ? editorStateFromPath(route) : null}
      navigate={navigate}
    />
  )
}

export default App
