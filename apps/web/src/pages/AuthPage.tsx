import {
  InlineNotification,
} from '@carbon/react'
import { useState, type SVGProps } from 'react'
import { BrandLockup } from '../components/BrandLockup'
import { PublicFooter } from '../components/PublicFooter'
import { PublicHeader } from '../components/PublicHeader'
import { apiUrl } from '../lib/api'
import { readPendingAuthRedirect } from '../lib/auth-redirect'
import { useAuthenticatedRedirect } from '../lib/useAuthenticatedRedirect'

export type ChatRoutePath = '/chat' | `/chat/${string}`
export type WorkspaceRoutePath = '/welcome' | ChatRoutePath | '/runs' | '/daemon'
export type EditorRoutePath = `/editor/${string}`
export type PublicRoutePath = '/'
export type AuthRoutePath = '/login'
export type RoutePath = WorkspaceRoutePath | EditorRoutePath | AuthRoutePath
  | PublicRoutePath

interface AuthPageProps {
  navigate: (path: RoutePath) => void
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

export function AuthPage({ navigate }: AuthPageProps) {
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState<string | null>(() => readOAuthError())
  useAuthenticatedRedirect(navigate)

  const startGitHubLogin = () => {
    setSubmitting(true)
    setServerError(null)

    const redirect = readPendingAuthRedirect() ?? '/welcome'
    const url = new URL(apiUrl('/auth/github/start'))
    url.searchParams.set('redirect', redirect)
    url.searchParams.set('web_origin', window.location.origin)
    window.location.assign(url.toString())
  }

  return (
    <main
      className="grid min-h-screen grid-rows-[auto_minmax(0,1fr)_auto] bg-[#fafafa]"
      aria-label="Log in"
    >
      <PublicHeader navigate={navigate} />
      <section className="grid min-h-0 place-items-center px-6 py-12 max-[671px]:px-4">
        <div className="grid w-full max-w-[26rem] justify-items-center gap-8 text-center">
          <BrandLockup />
          <button
            className="inline-flex h-12 w-4/5 cursor-pointer items-center justify-center gap-3 rounded-full border border-[#161616] bg-[#161616] px-5 text-base font-semibold text-white shadow-[0_8px_20px_rgba(15,23,42,0.16)] transition hover:bg-[#393939] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)] disabled:cursor-wait disabled:border-[#525252] disabled:bg-[#525252] max-[420px]:w-full"
            type="button"
            disabled={submitting}
            onClick={startGitHubLogin}
          >
            <span className="grid h-6 w-6 place-items-center rounded-full bg-white">
              <GitHubIcon className="h-4 w-4" />
            </span>
            {submitting ? 'Opening GitHub...' : 'Continue with GitHub'}
          </button>

          {serverError && (
            <InlineNotification
              kind="error"
              title="Login failed"
              subtitle={serverError}
              lowContrast
              aria-label="Close notification"
            />
          )}
        </div>
      </section>
      <PublicFooter />
    </main>
  )
}
