import { useTranslation } from 'react-i18next'

const githubRepositoryUrl = 'https://github.com/mob999/agent-hub'

function GitHubIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 16 16">
      <use href="/icons.svg#github-icon" />
    </svg>
  )
}

export function PublicFooter() {
  const { t } = useTranslation()

  return (
    <footer className="border-t border-[#dde1e6] bg-[#fafafa] px-6 py-4 text-sm text-[#69707d] max-[671px]:px-4">
      <div className="flex items-center justify-center gap-2">
        <span>{t('publicFooter.copyright')}</span>
        <a
          className="inline-grid h-7 w-7 place-items-center rounded-lg text-[#69707d] hover:bg-[#eef0f4] hover:text-[#161616] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]"
          href={githubRepositoryUrl}
          aria-label="GitHub"
        >
          <GitHubIcon />
        </a>
      </div>
    </footer>
  )
}
