import { ArrowRight, CheckmarkFilled, Terminal } from '@carbon/react/icons'
import { PublicFooter } from '../components/PublicFooter'
import { PublicHeader } from '../components/PublicHeader'
import { useAuthenticatedRedirect } from '../lib/useAuthenticatedRedirect'
import type { RoutePath } from './AuthPage'

interface PublicHomePageProps {
  navigate: (path: RoutePath) => void
}

const previewMessages = [
  {
    avatar: 'M',
    name: 'Mia',
    text: '@Codex can you inspect the deployment diff and open a task for the failing route?',
    time: '10:31',
  },
  {
    avatar: 'C',
    name: 'Codex',
    text: 'Found the preview proxy issue. I queued a run, patched the route, and attached the diff.',
    time: '10:32',
  },
  {
    avatar: 'O',
    name: 'Ops Bot',
    text: 'Daemon online. Workspace ready. Tool call completed in 4.2s.',
    time: '10:33',
  },
]

function ChatPreview() {
  return (
    <div className="relative mx-auto w-full max-w-[34rem]" aria-hidden="true">
      <div className="absolute -left-5 top-10 grid h-16 w-16 rotate-[-8deg] place-items-center rounded-2xl border border-[#d8dee6] bg-white shadow-[0_10px_30px_rgba(15,23,42,0.12)] max-[671px]:hidden">
        <Terminal size={24} />
      </div>
      <div className="absolute -right-4 bottom-14 grid h-14 w-14 rotate-[10deg] place-items-center rounded-2xl border border-[#d8dee6] bg-[#f2faf5] text-[#24a148] shadow-[0_10px_30px_rgba(15,23,42,0.10)] max-[671px]:hidden">
        <CheckmarkFilled size={24} />
      </div>

      <div className="overflow-hidden rounded-[1.75rem] border border-[#d8dee6] bg-white shadow-[0_24px_80px_rgba(15,23,42,0.12)]">
        <header className="flex items-center justify-between gap-3 border-b border-[#eef0f3] bg-[#fafafa] px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-[#dde1e6] bg-[#f7f8fa] text-base font-semibold text-[#161616]">
              #
            </span>
            <div className="min-w-0">
              <strong className="block truncate text-sm text-[#161616]">engineering</strong>
              <span className="block truncate text-xs text-[#69707d]">3 agents connected</span>
            </div>
          </div>
          <span className="rounded-full border border-[#d8e6ff] bg-[#f3f7ff] px-3 py-1 text-xs font-semibold text-[#0f3f9c]">
            Run active
          </span>
        </header>

        <div className="grid gap-4 px-5 py-5">
          {previewMessages.map((message) => (
            <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-3" key={`${message.name}-${message.time}`}>
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[#dde1e6] bg-[#f7f8fa] text-sm font-semibold text-[#161616]">
                {message.avatar}
              </span>
              <div className="min-w-0">
                <div className="flex min-w-0 items-baseline gap-2">
                  <strong className="truncate text-sm text-[#161616]">{message.name}</strong>
                  <time className="text-xs text-[#8d8d8d]">{message.time}</time>
                </div>
                <p className="mt-1 text-sm leading-5 text-[#525252]">{message.text}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="grid gap-2 border-t border-[#eef0f3] bg-[#fafafa] px-5 py-4">
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full bg-[#defbe6] px-3 py-1 text-xs font-semibold text-[#0e6027]">
              Codex ready
            </span>
            <span className="rounded-full bg-[#edf5ff] px-3 py-1 text-xs font-semibold text-[#0f62fe]">
              Daemon online
            </span>
            <span className="rounded-full bg-[#f4f0ff] px-3 py-1 text-xs font-semibold text-[#6929c4]">
              Tool output saved
            </span>
          </div>
          <div className="rounded-xl border border-[#dde1e6] bg-white px-3 py-2 font-mono text-xs text-[#525252]">
            tool.call.completed command_execution
          </div>
        </div>
      </div>
    </div>
  )
}

export function PublicHomePage({ navigate }: PublicHomePageProps) {
  useAuthenticatedRedirect(navigate)

  const openLogin = () => navigate('/login')

  return (
    <main className="grid min-h-screen grid-rows-[auto_minmax(0,1fr)_auto] bg-[#fafafa] text-[#161616]" aria-label="Tavro AI">
      <PublicHeader navigate={navigate} />

      <section className="mx-auto grid min-h-0 w-full max-w-7xl grid-cols-[minmax(0,1.15fr)_minmax(24rem,0.85fr)] items-center gap-8 px-6 py-10 max-[1055px]:grid-cols-1 max-[1055px]:items-start max-[671px]:px-4 max-[671px]:py-8">
        <ChatPreview />

        <div className="grid max-w-[48rem] gap-7">
          <div className="grid gap-4">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#69707d]">
              Agent-native IM workspace
            </p>
            <h1 className="max-w-[15ch] text-6xl font-semibold leading-[1.02] tracking-normal text-[#161616] max-[1055px]:max-w-[14ch] max-[671px]:text-4xl">
              Agent-Hub for Human and Agent Collabrate.
            </h1>
            <p className="max-w-[34rem] text-lg leading-8 text-[#596171] max-[671px]:text-base max-[671px]:leading-7">
              Tavro AI keeps chats, local daemon runs, tasks, files, and agent outputs in one shared workspace.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              className="inline-flex h-12 cursor-pointer items-center justify-center gap-2 rounded-full border border-[#161616] bg-[#161616] px-6 text-base font-semibold text-white shadow-[0_8px_20px_rgba(15,23,42,0.16)] transition hover:bg-[#393939] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]"
              type="button"
              onClick={openLogin}
            >
              Get started
              <ArrowRight size={18} />
            </button>
          </div>
        </div>
      </section>
      <PublicFooter />
    </main>
  )
}
