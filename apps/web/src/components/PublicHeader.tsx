import type { MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { BrandLockup } from './BrandLockup'
import {
  changeLocale,
  isSupportedLocale,
  type SupportedLocale,
} from '../i18n'
import type { RoutePath } from '../pages/AuthPage'

interface PublicHeaderProps {
  navigate: (path: RoutePath) => void
}

const docsBaseUrl =
  import.meta.env.VITE_AGENTHUB_DOCS_URL ??
  (import.meta.env.DEV
    ? 'http://localhost:3002'
    : 'https://tavro-docs.vercel.app')

export function PublicHeader({ navigate }: PublicHeaderProps) {
  const { i18n, t } = useTranslation()
  const currentLocale = isSupportedLocale(i18n.resolvedLanguage)
    ? i18n.resolvedLanguage
    : 'en'
  const nextLocale: SupportedLocale = currentLocale === 'zh-CN' ? 'en' : 'zh-CN'
  const docsUrl =
    currentLocale === 'zh-CN' && !import.meta.env.DEV
      ? new URL('/zh-CN/', docsBaseUrl).toString()
      : docsBaseUrl
  const openLogin = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault()
    navigate('/login')
  }

  return (
    <header className="flex h-[4.5rem] w-full items-center justify-between gap-4 border-b border-[#dde1e6] bg-[#fafafa] px-6 max-[671px]:h-[3.6rem] max-[671px]:px-4">
      <a
        className="inline-flex min-w-0 text-[#161616] no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]"
        href="/"
        onClick={(event) => {
          event.preventDefault()
          navigate('/')
        }}
      >
        <BrandLockup compact />
      </a>
      <div className="flex shrink-0 items-center gap-5">
        <button
          className="cursor-pointer border-0 bg-transparent p-0 text-base font-semibold text-[#161616] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]"
          type="button"
          aria-label={t('publicHeader.switchLanguage')}
          onClick={() => {
            void changeLocale(nextLocale)
          }}
        >
          {currentLocale === 'zh-CN' ? 'EN' : '中'}
        </button>
        <a
          className="text-base font-semibold text-[#161616] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]"
          href={docsUrl}
        >
          {t('publicHeader.docs')}
        </a>
        <a
          className="text-base font-semibold text-[#161616] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]"
          href="/login"
          onClick={openLogin}
        >
          {t('publicHeader.signIn')}
        </a>
      </div>
    </header>
  )
}
