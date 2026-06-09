import {
  InlineNotification,
} from '@carbon/react'
import { useState, type SVGProps } from 'react'
import { useTranslation } from 'react-i18next'
import { BrandLockup } from '../components/BrandLockup'
import { PublicFooter } from '../components/PublicFooter'
import { PublicHeader } from '../components/PublicHeader'
import { apiRequest, apiUrl, type AuthResponse } from '../lib/api'
import { readPendingAuthRedirect } from '../lib/auth-redirect'
import { useAuthenticatedRedirect } from '../lib/useAuthenticatedRedirect'

const isCapacitor = !!window.Capacitor?.isNativePlatform

export type ChatRoutePath = '/chat' | `/chat/${string}`
export type WorkspaceRoutePath = '/welcome' | ChatRoutePath | '/runs' | '/daemon'
export type EditorRoutePath = `/editor/${string}`
export type PublicRoutePath = '/' | '/download'
export type AuthRoutePath = '/login'
export type RoutePath = WorkspaceRoutePath | EditorRoutePath | AuthRoutePath
  | PublicRoutePath

interface AuthPageProps {
  navigate: (path: RoutePath) => void
}

function readOAuthErrorCode(): string | null {
  return new URLSearchParams(window.location.search).get('error')
}

function GitHubIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} aria-hidden="true" focusable="false" viewBox="0 0 19 19">
      <use href="/icons.svg#github-icon" />
    </svg>
  )
}

export function AuthPage({ navigate }: AuthPageProps) {
  const { t } = useTranslation()
  const [submitting, setSubmitting] = useState(false)
  const [devSubmitting, setDevSubmitting] = useState(false)
  const [serverErrorCode, setServerErrorCode] = useState<string | null>(() => readOAuthErrorCode())
  useAuthenticatedRedirect(navigate)
  const showDevelopmentLogin = import.meta.env.DEV
  const isSubmitting = submitting || devSubmitting

  const startGitHubLogin = async () => {
    setSubmitting(true)
    setServerErrorCode(null)

    const redirect = readPendingAuthRedirect() ?? '/welcome'
    const desktopStartGitHubLogin = window.tavroDesktop?.startGitHubLogin
    if (desktopStartGitHubLogin) {
      try {
        await desktopStartGitHubLogin({
          redirectPath: redirect,
          startUrl: apiUrl('/auth/desktop/github/start'),
          webOrigin: window.location.origin,
        })
      } catch {
        setServerErrorCode('desktop_auth_start_failed')
      } finally {
        setSubmitting(false)
      }
      return
    }

    if (isCapacitor) {
      try {
        // The Capacitor Browser plugin opens Chrome Custom Tabs for the
        // GitHub OAuth flow.  After authorization GitHub redirects to the
        // API callback URL, which stores a one-time login code and returns
        // an HTML page with a "Return to Tavro" link.  Tapping that link
        // fires the tavro:// custom-scheme intent, Android opens the app,
        // and the appUrlOpen listener below completes the login.
        const startUrl = apiUrl('/auth/desktop/github/start')
        const body = JSON.stringify({
          redirectPath: redirect,
          webOrigin: window.location.origin,
        })

        // Use XHR instead of fetch – Capacitor's CapacitorHttp plugin
        // patches window.fetch and routes through the native HTTP stack.
        // XHR works reliably on Android with android:usesCleartextTraffic.
        const response = await new Promise<{ ok: boolean; json: () => Promise<unknown> }>((resolve, reject) => {
          const xhr = new XMLHttpRequest()
          xhr.open('POST', startUrl)
          xhr.setRequestHeader('Content-Type', 'application/json')
          xhr.withCredentials = true
          xhr.onload = () => {
            resolve({
              ok: xhr.status >= 200 && xhr.status < 300,
              json: () => Promise.resolve(JSON.parse(xhr.responseText)),
            })
          }
          xhr.onerror = () => reject(new Error('XHR network error'))
          xhr.ontimeout = () => reject(new Error('XHR timeout'))
          xhr.send(body)
        })

        if (!response.ok) {
          setServerErrorCode('desktop_auth_start_failed')
          setSubmitting(false)
          return
        }

        const { authorizeUrl } = (await response.json()) as { authorizeUrl: string }

        // Access Capacitor plugins via the runtime bridge (no ES import
        // so @capacitor/core won't patch window.fetch).
        const plugins = window.Capacitor?.Plugins as Record<string, unknown> | undefined
        const CapApp = plugins?.App as {
          addListener: (event: string, fn: (data: { url: string }) => void) => Promise<{ remove: () => void }>
        } | undefined
        const Browser = plugins?.Browser as {
          open: (opts: { url: string }) => Promise<void>
          close: () => Promise<void>
        } | undefined

        if (!CapApp || !Browser) {
          setServerErrorCode('desktop_auth_start_failed')
          setSubmitting(false)
          return
        }

        const listener = await CapApp.addListener('appUrlOpen', async (event) => {
          const url = new URL(event.url)
          const code = url.searchParams.get('code')
          const error = url.searchParams.get('error')

          await Browser.close()
          listener.remove()

          if (code) {
            // The Capacitor server.allowNavigation config permits the
            // WebView to load API URLs in-app.  We navigate to the
            // API which sets the session cookie and returns an HTML page
            // (redirect=html) whose JavaScript navigates back to the
            // Capacitor welcome page — all inside the same WebView.
            window.location.href = apiUrl(
              `/auth/desktop/complete?code=${encodeURIComponent(code)}&redirect=html`,
            )
          } else {
            setServerErrorCode(error ?? 'desktop_auth_expired')
            setSubmitting(false)
          }
        })

        await Browser.open({ url: authorizeUrl })
      } catch {
        setServerErrorCode('desktop_auth_start_failed')
        setSubmitting(false)
      }
      return
    }

    const url = new URL(apiUrl('/auth/github/start'))
    url.searchParams.set('redirect', redirect)
    url.searchParams.set('web_origin', window.location.origin)
    window.location.assign(url.toString())
  }

  const startDevelopmentLogin = async () => {
    setDevSubmitting(true)
    setServerErrorCode(null)

    try {
      await apiRequest<AuthResponse>('/auth/dev/login', {
        method: 'POST',
      })
      navigate((readPendingAuthRedirect() ?? '/welcome') as RoutePath)
    } catch {
      setServerErrorCode('dev_login_failed')
    } finally {
      setDevSubmitting(false)
    }
  }

  return (
    <main
      className="grid min-h-screen grid-rows-[auto_minmax(0,1fr)_auto] bg-[#fafafa]"
      aria-label={t('auth.ariaLabel')}
    >
      <PublicHeader navigate={navigate} />
      <section className="grid min-h-0 place-items-center px-6 py-12 max-[671px]:px-4">
        <div className="grid w-full max-w-[26rem] justify-items-center gap-8 text-center">
          <BrandLockup />
          <button
            className="inline-flex h-12 w-4/5 cursor-pointer items-center justify-center gap-3 rounded-full border border-[#161616] bg-[#161616] px-5 text-base font-semibold text-white shadow-[0_8px_20px_rgba(15,23,42,0.16)] transition hover:bg-[#393939] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)] disabled:cursor-wait disabled:border-[#525252] disabled:bg-[#525252] max-[420px]:w-full"
            type="button"
            disabled={isSubmitting}
            onClick={startGitHubLogin}
          >
            <span className="grid h-6 w-6 place-items-center rounded-full bg-white">
              <GitHubIcon className="h-4 w-4" />
            </span>
            {submitting ? t('auth.opening') : t('auth.button')}
          </button>

          {showDevelopmentLogin && (
            <button
              className="inline-flex h-11 w-4/5 cursor-pointer items-center justify-center rounded-full border border-[#d0d7de] bg-white px-5 text-sm font-semibold text-[#161616] shadow-[0_6px_16px_rgba(15,23,42,0.08)] transition hover:border-[#8d8d8d] hover:bg-[#f4f4f4] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)] disabled:cursor-wait disabled:text-[#6f6f6f] max-[420px]:w-full"
              type="button"
              disabled={isSubmitting}
              onClick={startDevelopmentLogin}
            >
              {devSubmitting ? t('auth.devOpening') : t('auth.devButton')}
            </button>
          )}

          {serverErrorCode && (
            <InlineNotification
              kind="error"
              title={t('auth.errorTitle')}
              subtitle={t(`auth.errors.${serverErrorCode}`, { defaultValue: t('auth.errors.fallback') })}
              lowContrast
              aria-label={t('common.closeNotification')}
            />
          )}
        </div>
      </section>
      <PublicFooter />
    </main>
  )
}
