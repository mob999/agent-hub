import { useTranslation } from 'react-i18next'

export function PublicFooter() {
  const { t } = useTranslation()

  return (
    <footer className="border-t border-[#dde1e6] bg-[#fafafa] px-6 py-4 text-center text-sm text-[#69707d] max-[671px]:px-4">
      {t('publicFooter.copyright')}
    </footer>
  )
}
