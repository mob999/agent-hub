import { Apple, ArrowRight, Laptop } from '@carbon/react/icons'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PublicFooter } from '../components/PublicFooter'
import { PublicHeader } from '../components/PublicHeader'
import type { RoutePath } from './AuthPage'

interface DownloadPageProps {
  navigate: (path: RoutePath) => void
}

interface ReleaseAsset {
  browser_download_url: string
  name: string
  size: number
}

interface LatestRelease {
  assets: ReleaseAsset[]
  name: string | null
  tag_name: string
}

type ReleaseState =
  | { status: 'loading' }
  | { release: LatestRelease; status: 'ready' }
  | { status: 'error' }

const latestReleaseApiUrl =
  import.meta.env.VITE_AGENTHUB_DESKTOP_RELEASE_API_URL ??
  'https://api.github.com/repos/mob999/agent-hub/releases/latest'

function formatBytes(bytes: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: 1,
    style: 'unit',
    unit: 'megabyte',
    unitDisplay: 'short',
  }).format(bytes / 1024 / 1024)
}

function versionFromRelease(release: LatestRelease): string {
  const version = release.tag_name.match(/^tavro-desktop-v(.+)$/)?.[1]
  return version === undefined ? release.name?.trim() || release.tag_name : `v${version}`
}

function findAsset(assets: ReleaseAsset[], extension: 'dmg' | 'exe'): ReleaseAsset | null {
  const lowerExtension = `.${extension}`
  return assets.find((asset) => asset.name.toLowerCase().endsWith(lowerExtension)) ?? null
}

export function DownloadPage({ navigate }: DownloadPageProps) {
  const { i18n, t } = useTranslation()
  const [releaseState, setReleaseState] = useState<ReleaseState>({ status: 'loading' })
  const locale = i18n.resolvedLanguage === 'zh-CN' ? 'zh-CN' : 'en'

  useEffect(() => {
    let active = true

    async function loadRelease() {
      try {
        const response = await fetch(latestReleaseApiUrl, {
          headers: {
            Accept: 'application/vnd.github+json',
          },
        })

        if (!response.ok) {
          throw new Error(`GitHub release request failed: ${response.status}`)
        }

        const release = await response.json() as LatestRelease
        if (active) {
          setReleaseState({ release, status: 'ready' })
        }
      } catch {
        if (active) {
          setReleaseState({ status: 'error' })
        }
      }
    }

    void loadRelease()

    return () => {
      active = false
    }
  }, [])

  const release = releaseState.status === 'ready' ? releaseState.release : null
  const releaseVersion = release === null ? null : versionFromRelease(release)
  const platforms = useMemo(() => {
    const assets = release?.assets ?? []

    return [
      {
        asset: findAsset(assets, 'exe'),
        icon: <Laptop size={28} />,
        key: 'windows',
      },
      {
        asset: findAsset(assets, 'dmg'),
        icon: <Apple size={28} />,
        key: 'macos',
      },
    ]
  }, [release])

  return (
    <main className="grid min-h-screen grid-rows-[auto_minmax(0,1fr)_auto] bg-[#fafafa] text-[#161616]" aria-label={t('publicDownload.ariaLabel')}>
      <PublicHeader navigate={navigate} />

      <section className="mx-auto grid min-h-0 w-full max-w-7xl grid-cols-[minmax(0,0.9fr)_minmax(25rem,1.1fr)] items-center gap-10 px-6 py-10 max-[1055px]:grid-cols-1 max-[671px]:px-4 max-[671px]:py-8">
        <div className="grid max-w-[46rem] gap-7">
          <div className="grid gap-4">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#69707d]">
              {t('publicDownload.hero.eyebrow')}
            </p>
            <h1 className="max-w-[13ch] text-6xl font-semibold leading-[1.02] tracking-normal text-[#161616] max-[1055px]:max-w-[14ch] max-[671px]:text-4xl">
              {t('publicDownload.hero.title')}
            </h1>
            <p className="max-w-[35rem] text-lg leading-8 text-[#596171] max-[671px]:text-base max-[671px]:leading-7">
              {t('publicDownload.hero.subtitle')}
            </p>
          </div>

          <p className="text-sm font-semibold text-[#69707d]">
            {t('publicDownload.hero.latestOnly')}
          </p>
        </div>

        <div className="grid gap-4">
          {platforms.map((platform) => {
            const title = t(`publicDownload.platforms.${platform.key}.title`)
            const asset = platform.asset
            const assetMeta = asset === null
              ? null
              : t('publicDownload.platforms.assetMeta', {
                name: asset.name,
                size: formatBytes(asset.size, locale),
              })

            return (
              <article
                className="grid gap-5 overflow-hidden rounded-[1.5rem] border border-[#d8dee6] bg-white p-5 shadow-[0_18px_55px_rgba(15,23,42,0.10)]"
                key={platform.key}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-4">
                    <span className="grid h-14 w-14 place-items-center rounded-2xl border border-[#dde1e6] bg-[#f7f8fa] text-[#161616]">
                      {platform.icon}
                    </span>
                    <div className="min-w-0">
                      <h2 className="text-2xl font-semibold leading-7 text-[#161616]">{title}</h2>
                      <p className="mt-2 max-w-[34rem] text-base leading-7 text-[#596171]">
                        {t(`publicDownload.platforms.${platform.key}.description`)}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="grid gap-2 rounded-2xl border border-[#eef0f3] bg-[#fafafa] px-4 py-3">
                  {asset !== null && releaseVersion !== null ? (
                    <a
                      className="inline-flex w-fit items-center gap-2 text-base font-semibold text-[#161616] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]"
                      href={asset.browser_download_url}
                    >
                      {releaseVersion}
                      <ArrowRight size={16} />
                    </a>
                  ) : (
                    <span className="text-base font-semibold text-[#525252]">
                      {releaseState.status === 'loading'
                        ? t('publicDownload.platforms.loading')
                        : t('publicDownload.platforms.unavailable')}
                    </span>
                  )}
                  {assetMeta !== null && (
                    <p className="truncate text-sm text-[#69707d]">{assetMeta}</p>
                  )}
                </div>

                {asset !== null && (
                  <a
                    className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border border-[#161616] bg-[#161616] px-6 text-base font-semibold text-white no-underline shadow-[0_8px_20px_rgba(15,23,42,0.16)] transition hover:bg-[#393939] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]"
                    href={asset.browser_download_url}
                  >
                    {t(`publicDownload.platforms.${platform.key}.download`)}
                    <ArrowRight size={18} />
                  </a>
                )}
              </article>
            )
          })}
        </div>
      </section>
      <PublicFooter />
    </main>
  )
}
