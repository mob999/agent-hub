import {
  Button,
  InlineLoading,
  InlineNotification,
  Stack,
  Tag,
  Theme,
} from '@carbon/react'
import { ChatBot } from '@carbon/react/icons'
import { useState, type SVGProps } from 'react'
import { apiUrl } from '../lib/api'

export type ChatRoutePath = '/chat' | `/chat/${string}`
export type WorkspaceRoutePath = ChatRoutePath | '/runs' | '/daemon'
export type EditorRoutePath = `/editor/${string}`
export type AuthRoutePath = '/login'
export type RoutePath = WorkspaceRoutePath | EditorRoutePath | AuthRoutePath

const authRedirectStorageKey = 'agenthub.auth.redirect'

function getPendingAuthRedirect(): WorkspaceRoutePath | EditorRoutePath | null {
  const value = window.sessionStorage.getItem(authRedirectStorageKey)
  const isChatConversationRoute = value?.startsWith('/chat/') === true &&
    (
      [2, 4, 6].includes(value.split('/').filter(Boolean).length) ||
      (
        value.split('/').filter(Boolean).length === 3 &&
        ['tasks', 'deployments'].includes(value.split('/').filter(Boolean)[2] ?? '')
      )
    )
  const isEditorRoute = value?.startsWith('/editor/') === true &&
    [2, 3].includes(value.split('/').filter(Boolean).length)

  if (
    value === '/chat' ||
    isChatConversationRoute ||
    value === '/runs' ||
    value === '/daemon' ||
    isEditorRoute
  ) {
    return value as WorkspaceRoutePath | EditorRoutePath
  }

  return null
}

function readOAuthError(): string | null {
  const error = new URLSearchParams(window.location.search).get('error')
  if (!error) {
    return null
  }

  const messages: Record<string, string> = {
    github_email_unavailable: 'GitHub did not return a verified primary email.',
    github_invalid_state: 'The GitHub login session expired. Try again.',
    github_profile_unavailable: 'GitHub profile details could not be loaded.',
    github_token_exchange_failed: 'GitHub authorization could not be completed.',
    github_user_create_failed: 'Your Tavro account could not be created.',
  }

  return messages[error] ?? 'GitHub login could not be completed.'
}

function GitHubIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} aria-hidden="true" focusable="false" viewBox="0 0 19 19">
      <use href="/icons.svg#github-icon" />
    </svg>
  )
}

export function AuthPage() {
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState<string | null>(() => readOAuthError())

  const startGitHubLogin = () => {
    setSubmitting(true)
    setServerError(null)

    const redirect = getPendingAuthRedirect() ?? '/chat'
    const url = new URL(apiUrl('/auth/github/start'))
    url.searchParams.set('redirect', redirect)
    url.searchParams.set('web_origin', window.location.origin)
    window.sessionStorage.removeItem(authRedirectStorageKey)
    window.location.assign(url.toString())
  }

  return (
    <main
      className="grid min-h-screen grid-cols-[minmax(24rem,0.95fr)_minmax(28rem,1.05fr)] bg-[var(--cds-background)] max-[1055px]:grid-cols-1"
      aria-label="Log in"
    >
      <Theme
        theme="g100"
        as="section"
        className="flex min-h-screen flex-col justify-between gap-16 p-12 text-[var(--cds-text-primary)] max-[1055px]:min-h-0 max-[1055px]:p-8 max-[671px]:p-4"
        aria-label="Tavro preview"
      >
        <div className="inline-flex items-center gap-3">
          <ChatBot size={32} />
          <span className="font-semibold">Tavro</span>
        </div>
        <div className="grid max-w-[38rem] gap-4">
          <p className="cds--type-label-01">Human + agent workspace</p>
          <h1 className="cds--type-heading-06 max-w-[12ch] max-[671px]:max-w-full">
            Work with agents like teammates.
          </h1>
          <p className="cds--type-body-02 max-w-[34rem] text-[var(--cds-text-secondary)]">
            Keep chats, local daemon runs, task events, and runtime state in one quiet product
            surface.
          </p>
        </div>
        <div
          className="grid max-w-[34rem] gap-4 rounded-lg border border-[var(--cds-border-subtle-01)] bg-[var(--cds-layer-01)] p-4"
          aria-hidden="true"
        >
          <div className="grid gap-3">
            <div className="justify-self-end rounded-lg bg-[var(--cds-background-inverse)] p-3 text-sm leading-snug text-[var(--cds-text-inverse)]">
              Review this API route and open a fix.
            </div>
            <div className="justify-self-start rounded-lg border border-[var(--cds-border-subtle-01)] bg-[var(--cds-layer-02)] p-3 text-sm leading-snug">
              A configured agent accepted the run. Streaming tool calls now.
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Tag type="green">Daemon online</Tag>
            <Tag type="blue">Run active</Tag>
          </div>
        </div>
      </Theme>

      <section className="grid min-h-screen items-center bg-[var(--cds-background)] p-12 max-[1055px]:min-h-0 max-[1055px]:p-8 max-[671px]:p-4">
        <div className="w-full max-w-[28rem]">
          <Stack gap={7}>
            <div>
              <h2 className="cds--type-heading-05">Log in</h2>
              <p className="cds--type-body-01 mt-3 text-[var(--cds-text-secondary)]">
                Continue to your Tavro workspace with GitHub.
              </p>
            </div>

            {serverError && (
              <InlineNotification
                kind="error"
                title="Login failed"
                subtitle={serverError}
                lowContrast
                aria-label="Close notification"
              />
            )}

            {submitting ? (
              <InlineLoading description="Opening GitHub..." status="active" />
            ) : (
              <Button type="button" size="lg" renderIcon={GitHubIcon} onClick={startGitHubLogin}>
                Continue with GitHub
              </Button>
            )}
          </Stack>
        </div>
      </section>
    </main>
  )
}
