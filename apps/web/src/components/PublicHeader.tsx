import type { MouseEvent } from 'react'
import { BrandLockup } from './BrandLockup'
import type { RoutePath } from '../pages/AuthPage'

interface PublicHeaderProps {
  navigate: (path: RoutePath) => void
}

export function PublicHeader({ navigate }: PublicHeaderProps) {
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
      <a
        className="text-base font-semibold text-[#161616] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]"
        href="/login"
        onClick={openLogin}
      >
        Sign In
      </a>
    </header>
  )
}
