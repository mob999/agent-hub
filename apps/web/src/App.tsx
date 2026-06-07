import { useCallback, useEffect, useState } from 'react'
import { AuthPage, type EditorRoutePath, type RoutePath, type WorkspaceRoutePath } from './pages/AuthPage'
import { PublicHomePage } from './pages/PublicHomePage'
import { WorkspacePage } from './pages/WorkspacePage'

interface EditorRouteState {
  artifactId: string | null
  conversationId: string
}

export type ChatPanelRoute = 'tasks' | 'deployments' | null

export interface GoalRouteState {
  conversationId: string
  goalId: string
  taskIndex: number | null
}

function chatStateFromPath(path: string): {
  conversationId: string | null
  goalRoute: GoalRouteState | null
  messageId: string | null
  panelRoute: ChatPanelRoute
} {
  const segments = path.split('/').filter(Boolean)

  if (segments[0] !== 'chat') {
    return { conversationId: null, goalRoute: null, messageId: null, panelRoute: null }
  }

  if (segments[1] === 'search') {
    return { conversationId: null, goalRoute: null, messageId: null, panelRoute: null }
  }

  const conversationId = segments[1] === undefined ? null : decodeURIComponent(segments[1])

  if (conversationId === null) {
    return { conversationId: null, goalRoute: null, messageId: null, panelRoute: null }
  }

  if (segments.length === 2) {
    return { conversationId, goalRoute: null, messageId: null, panelRoute: null }
  }

  if (segments.length === 3 && (segments[2] === 'tasks' || segments[2] === 'deployments')) {
    return { conversationId, goalRoute: null, messageId: null, panelRoute: segments[2] }
  }

  if (segments.length === 4 && segments[2] === 'messages') {
    return {
      conversationId,
      goalRoute: null,
      messageId: decodeURIComponent(segments[3]),
      panelRoute: null,
    }
  }

  if (segments[2] !== 'goals' || segments[3] === undefined) {
    return { conversationId: null, goalRoute: null, messageId: null, panelRoute: null }
  }

  const taskIndexSegment = segments.length === 6 && segments[4] === 'tasks'
    ? decodeURIComponent(segments[5] ?? '')
    : null
  const taskIndex =
    taskIndexSegment !== null && /^\d+$/.test(taskIndexSegment)
      ? Number.parseInt(taskIndexSegment, 10)
      : null

  if (segments.length !== 4 && (segments.length !== 6 || taskIndex === null)) {
    return { conversationId: null, goalRoute: null, messageId: null, panelRoute: null }
  }

  return {
    conversationId,
    goalRoute: {
      conversationId,
      goalId: decodeURIComponent(segments[3]),
      taskIndex,
    },
    messageId: null,
    panelRoute: null,
  }
}

function getRoutePath(): RoutePath {
  const path = window.location.pathname
  const editorRoute = editorStateFromPath(path)
  if (editorRoute !== null) {
    return path as EditorRoutePath
  }

  if (
    path === '/' ||
    path === '/welcome' ||
    path === '/login' ||
    path === '/chat' ||
    path === '/chat/search' ||
    chatStateFromPath(path).conversationId !== null ||
    path === '/runs' ||
    path === '/daemon'
  ) {
    return path as RoutePath
  }
  if (path === '/register') {
    return '/login'
  }
  return '/'
}

function isWorkspaceRoute(route: RoutePath): route is WorkspaceRoutePath {
  return route === '/welcome' || route === '/chat' || route.startsWith('/chat/') || route === '/runs' || route === '/daemon'
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
  const chatState = route.startsWith('/chat/')
    ? chatStateFromPath(route)
    : { conversationId: null, goalRoute: null, messageId: null, panelRoute: null }

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

  if (route === '/') {
    return <PublicHomePage navigate={navigate} />
  }

  if (route === '/login') {
    return <AuthPage navigate={navigate} />
  }

  return (
    <WorkspacePage
      route={isWorkspaceRoute(route) ? route : '/chat'}
      chatConversationId={chatState.conversationId}
      goalRoute={chatState.goalRoute}
      focusedMessageId={chatState.messageId}
      chatPanelRoute={chatState.panelRoute}
      editorRoute={route.startsWith('/editor/') ? editorStateFromPath(route) : null}
      navigate={navigate}
    />
  )
}

export default App
