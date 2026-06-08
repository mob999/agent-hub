import {
  InlineLoading,
  InlineNotification,
  SkeletonText,
  Tag,
  TextInput,
} from '@carbon/react'
import {
  ArrowLeft,
  ArrowRight,
  ChatBot,
  CheckmarkFilled,
  CircleDash,
  Copy,
  Devices,
  Folder,
  Task,
} from '@carbon/react/icons'
import type { FormEvent } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  apiRequest,
  type AgentDetails,
  type Conversation,
  type ConversationGoal,
  type DaemonDevice,
  type DaemonRegistrationCommandResponse,
  type RuntimeKind,
  type WelcomeSummary,
} from '../lib/api'
import { GoalStatusBoard, type GoalTask } from '../components/GoalStatusBoard'
import { formatMessageTime } from '../lib/format'
import { getProjectIcon } from '../lib/projectIcon'

interface WelcomePageProps {
  agents: AgentDetails[]
  devices: DaemonDevice[]
  error: string | null
  isLoading: boolean
  summary: WelcomeSummary | null
  onOpenConversation: (conversationId: string) => void
  onOpenCreateAgent: (daemonDeviceId?: string) => void
  onOpenCreateGroup: () => void
  onOpenCreateProject: () => void
  onOpenDaemon: () => void
  onOpenGoal: (conversationId: string, goalId: string, taskIndex?: number | null) => void
  onRefreshData: () => void
  onWelcomeUpdated: (summary: WelcomeSummary) => void
  tutorialRequestId: number
}

const dashboardPanelClass =
  'grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-lg border border-[#dde3ea] bg-white/[0.94] shadow-[0_24px_70px_rgba(15,23,42,0.11),0_8px_24px_rgba(15,23,42,0.06),0_1px_0_rgba(255,255,255,0.92)_inset] backdrop-blur transition-[box-shadow,border-color,background-color] duration-200 ease-out hover:border-[#c8d2de] hover:bg-white hover:shadow-[0_28px_82px_rgba(15,23,42,0.14),0_10px_28px_rgba(15,23,42,0.075),0_1px_0_rgba(255,255,255,0.96)_inset]'
const dashboardRowClass =
  'grid w-full cursor-pointer border-0 border-b border-[#eef1f5] bg-transparent text-left transition-[background-color,transform] duration-150 last:border-b-0 hover:-translate-y-px hover:bg-[#f5f7fb] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--cds-focus)]'
const subtleButton =
  'inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-xl border border-[#d8dee6] bg-white px-3 text-sm font-semibold text-[#344054] shadow-[0_1px_2px_rgba(15,23,42,0.06)] transition hover:border-[#c7d0dc] hover:bg-[#f7f8fa] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)] disabled:cursor-not-allowed disabled:border-[#e1e5ea] disabled:bg-[#f4f4f4] disabled:text-[#a2a9b0] disabled:shadow-none'
const primaryButton =
  'inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-xl border border-[#0f62fe] bg-[#0f62fe] px-3 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(15,23,42,0.12)] transition hover:border-[#0353e9] hover:bg-[#0353e9] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)] disabled:cursor-not-allowed disabled:border-[#a6c8ff] disabled:bg-[#a6c8ff] disabled:text-white disabled:shadow-none'
const roundedFieldStyles = `
  .welcome-rounded-fields .cds--text-input,
  .welcome-rounded-fields .cds--text-area,
  .welcome-rounded-fields .cds--select-input {
    border: 1px solid #d8dee6;
    border-radius: 0.75rem;
    background: #fff;
    box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
  }

  .welcome-rounded-fields .cds--text-input:focus,
  .welcome-rounded-fields .cds--text-area:focus,
  .welcome-rounded-fields .cds--select-input:focus {
    border-color: #b9c3cf;
    outline: 2px solid var(--cds-focus);
    outline-offset: 2px;
  }

  .welcome-rounded-fields .cds--text-input:disabled,
  .welcome-rounded-fields .cds--text-area:disabled,
  .welcome-rounded-fields .cds--select-input:disabled {
    border-color: #e1e5ea;
    background: #f4f4f4;
    box-shadow: none;
  }

  .welcome-card-deck {
    height: clamp(34rem, calc(100vh - 12rem), 44rem);
    min-height: 34rem;
  }

  .welcome-onboarding-card {
    transition:
      left 280ms cubic-bezier(0.2, 0.8, 0.2, 1),
      opacity 280ms cubic-bezier(0.2, 0.8, 0.2, 1),
      transform 280ms cubic-bezier(0.2, 0.8, 0.2, 1),
      box-shadow 280ms cubic-bezier(0.2, 0.8, 0.2, 1);
    will-change: left, transform, opacity;
  }

  .welcome-dashboard-deck {
    height: clamp(31rem, calc(100vh - 13rem), 43rem);
    min-height: 31rem;
  }

  .welcome-dashboard-card {
    transition:
      opacity 280ms cubic-bezier(0.2, 0.8, 0.2, 1),
      transform 280ms cubic-bezier(0.2, 0.8, 0.2, 1),
      box-shadow 280ms cubic-bezier(0.2, 0.8, 0.2, 1);
    will-change: transform, opacity;
  }

  @media (prefers-reduced-motion: reduce) {
    .welcome-onboarding-card,
    .welcome-dashboard-card {
      transition: none;
    }
  }

  @media (max-width: 900px) {
    .welcome-card-deck {
      height: auto;
      min-height: 0;
    }

    .welcome-dashboard-deck {
      height: clamp(30rem, calc(100vh - 12rem), 40rem);
      min-height: 30rem;
    }

    .welcome-onboarding-card {
      position: relative !important;
      left: auto !important;
      top: auto !important;
      transform: none !important;
      width: 100%;
      min-height: 0;
      margin-top: -0.75rem;
    }
  }
`

function detectDaemonCommandPlatform(): 'windows' | 'posix' {
  if (typeof navigator === 'undefined') {
    return 'posix'
  }

  return /Win/i.test(navigator.platform) ? 'windows' : 'posix'
}

function isAgentReady(agent: AgentDetails): boolean {
  return agent.agent.status === 'active' &&
    agent.runtimeBinding.status === 'ready' &&
    agent.workspace.status === 'ready'
}

function isAgentProvisioning(agent: AgentDetails): boolean {
  return agent.agent.status === 'active' &&
    (agent.runtimeBinding.status === 'pending' || agent.workspace.status === 'pending')
}

function readyRuntimeDevices(devices: DaemonDevice[]): DaemonDevice[] {
  return devices
    .filter((device) => device.status === 'online')
    .map((device) => ({
      ...device,
      runtimes: device.runtimes.filter((runtime) => runtime.status === 'ready'),
    }))
    .filter((device) => device.runtimes.length > 0)
}

function onlineDaemonDevices(devices: DaemonDevice[]): DaemonDevice[] {
  return devices.filter((device) => device.status === 'online')
}

function compactPreview(value: string): string {
  const compacted = value.replace(/\s+/g, ' ').trim()
  if (compacted.length === 0) {
    return ''
  }

  return compacted.length > 110 ? `${compacted.slice(0, 107)}...` : compacted
}

function conversationLabel(conversation: Conversation): string {
  if (conversation.type === 'group') {
    return `#${conversation.title}`
  }

  if (conversation.type === 'project') {
    return conversation.title
  }

  return conversation.title
}

function directConversationAgent(conversation: Conversation, agents: AgentDetails[]): AgentDetails | null {
  return conversation.directAgentId === undefined
    ? null
    : agents.find((item) => item.agent.id === conversation.directAgentId) ?? null
}

function dashboardConversationTitle(conversation: Conversation, agents: AgentDetails[]): string {
  if (conversation.type === 'direct') {
    return directConversationAgent(conversation, agents)?.agent.name ?? conversation.title
  }

  return conversationLabel(conversation)
}

function dashboardConversationPreview(content: string | undefined, fallback: string): string {
  if (content === undefined) {
    return fallback
  }

  return compactPreview(content) || fallback
}

function formatDashboardDate(locale: string): string {
  const normalizedLocale = locale === 'zh-CN' ? 'zh-CN' : 'en'
  const date = new Date()

  if (normalizedLocale === 'zh-CN') {
    const day = new Intl.DateTimeFormat(normalizedLocale, {
      day: 'numeric',
      month: 'long',
    }).format(date)
    const weekday = new Intl.DateTimeFormat(normalizedLocale, {
      weekday: 'long',
    }).format(date)

    return `${day} · ${weekday}`
  }

  return new Intl.DateTimeFormat(normalizedLocale, {
    day: 'numeric',
    month: 'long',
    weekday: 'long',
  }).format(date)
}

function ConversationAvatar({
  agents,
  conversation,
}: {
  agents: AgentDetails[]
  conversation: Conversation
}) {
  if (conversation.type === 'direct') {
    const agent = directConversationAgent(conversation, agents)

    if (agent?.agent.avatar) {
      return (
        <img
          src={agent.agent.avatar}
          alt=""
          className="h-10 w-10 rounded-xl border border-[#dde1e6] bg-white object-cover"
        />
      )
    }

    const initial = (agent?.agent.name ?? conversation.title).trim().charAt(0).toUpperCase() || 'A'

    return (
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[#dde1e6] bg-white text-sm font-semibold text-[#161616]">
        {initial}
      </span>
    )
  }

  if (conversation.type === 'project') {
    const projectIcon = getProjectIcon(conversation)

    return (
      <span
        className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border text-sm font-semibold"
        style={projectIcon.style}
        aria-hidden="true"
      >
        {projectIcon.initial}
      </span>
    )
  }

  return (
    <span
      className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[#dde1e6] bg-[#f7f8fa] text-base font-semibold text-[#161616]"
      aria-hidden="true"
    >
      #
    </span>
  )
}

function StepIcon({ complete }: { complete: boolean }) {
  return complete ? (
    <CheckmarkFilled className="text-[#24a148]" size={22} />
  ) : (
    <CircleDash className="text-[#8d8d8d]" size={22} />
  )
}

function RuntimeStatusDot({ status }: { status: DaemonDevice['runtimes'][number]['status'] }) {
  const { t } = useTranslation()
  const meta = runtimeStatusMeta(status, t)

  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${meta.dot}`} aria-hidden="true" />
      <strong className="truncate text-sm font-semibold text-[#161616]">{meta.label}</strong>
    </span>
  )
}

function RuntimeIdentity({ runtimeKind }: { runtimeKind: RuntimeKind }) {
  const runtimeLabel = runtimeDisplayName(runtimeKind)

  return (
    <div className="flex min-w-0 items-center gap-3">
      <span
        className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl border ${runtimeIconFrameClass(runtimeKind)}`}
        aria-hidden="true"
      >
        <RuntimeBrandIcon runtimeKind={runtimeKind} />
      </span>
      <span className="min-w-0 truncate font-semibold text-[#161616]">{runtimeLabel}</span>
    </div>
  )
}

function RuntimeBrandIcon({ runtimeKind }: { runtimeKind: RuntimeKind }) {
  if (runtimeKind === 'codex') {
    return (
      <svg className="h-5 w-5" role="img" viewBox="0 0 24 24" aria-label="OpenAI">
        <path d={openAiIconPath} fill="currentColor" />
      </svg>
    )
  }

  if (runtimeKind === 'claude-code') {
    return (
      <svg className="h-5 w-5" role="img" viewBox="0 0 24 24" aria-label="Claude">
        <path d={claudeIconPath} fill="currentColor" />
      </svg>
    )
  }

  if (runtimeKind === 'opencode') {
    return <span className="text-[0.65rem] font-bold tracking-tight">OC</span>
  }

  return <span className="text-[0.65rem] font-bold tracking-tight">AI</span>
}

function WelcomeRuntimeList({ devices }: { devices: DaemonDevice[] }) {
  const { t } = useTranslation()

  if (devices.length === 0) {
    return (
      <p className="rounded-xl border border-[#dde1e6] bg-white px-3 py-2 text-sm text-[#69707d]">
        {t('welcome.runtimeRefreshing')}
      </p>
    )
  }

  return (
    <div className="grid gap-4">
      {devices.map((device) => (
        <div className="grid gap-2" key={device.id}>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <strong className="truncate text-sm text-[#161616]">{device.name}</strong>
            <Tag size="sm" type="green">{t('daemon.online')}</Tag>
          </div>
          {device.runtimes.length === 0 ? (
            <p className="rounded-xl border border-[#dde1e6] bg-white px-3 py-2 text-sm text-[#69707d]">
              {t('daemon.emptyRuntime')}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-[#dde1e6] bg-white">
              <div
                className="grid min-w-[34rem] grid-cols-[minmax(10rem,1fr)_minmax(8rem,0.8fr)_minmax(6rem,0.45fr)] gap-3 border-b border-[#eef0f3] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[#69707d] max-[760px]:hidden"
                aria-hidden="true"
              >
                <span>{t('daemon.runtimes')}</span>
                <span>{t('daemon.version')}</span>
                <span>{t('daemon.status')}</span>
              </div>
              {device.runtimes.map((runtime) => (
                <div
                  className="grid min-h-12 min-w-[34rem] grid-cols-[minmax(10rem,1fr)_minmax(8rem,0.8fr)_minmax(6rem,0.45fr)] items-center gap-3 border-b border-[#eef0f3] px-3 py-2 last:border-b-0 max-[760px]:min-w-0 max-[760px]:grid-cols-1"
                  key={`${runtime.daemonDeviceId}-${runtime.runtimeKind}`}
                >
                  <RuntimeIdentity runtimeKind={runtime.runtimeKind} />
                  <span className="min-w-0 truncate text-[#596171]" title={runtime.runtimeVersion ?? t('daemon.noVersionReported')}>
                    {runtime.runtimeVersion ?? t('daemon.notReported')}
                  </span>
                  <RuntimeStatusDot status={runtime.status} />
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function runtimeIconFrameClass(runtimeKind: RuntimeKind): string {
  if (runtimeKind === 'claude-code') {
    return 'border-[#eadfd2] bg-[#f8f2ec] text-[#d97757]'
  }

  return 'border-[#dde1e6] bg-[#f7f8fa] text-[#161616]'
}

function runtimeDisplayName(runtimeKind: RuntimeKind): string {
  if (runtimeKind === 'claude-code') {
    return 'Claude Code'
  }

  if (runtimeKind === 'codex') {
    return 'Codex'
  }

  if (runtimeKind === 'opencode') {
    return 'OpenCode'
  }

  return 'Custom runtime'
}

const openAiIconPath =
  'M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z'

const claudeIconPath =
  'm4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z'

type Translate = (key: string, options?: Record<string, unknown>) => string

function runtimeStatusMeta(status: DaemonDevice['runtimes'][number]['status'], t: Translate): {
  dot: string
  label: string
} {
  if (status === 'ready') {
    return {
      dot: 'bg-[var(--cds-support-success)]',
      label: t('common.ready'),
    }
  }

  if (status === 'disabled') {
    return {
      dot: 'bg-[#8d8d8d]',
      label: t('common.disabled'),
    }
  }

  return {
    dot: 'bg-[var(--cds-support-error)]',
    label: t('common.unavailable'),
  }
}

type OnboardingStepId = 'daemon' | 'agent' | 'workspace'
const onboardingSteps: Array<{
  description: string;
  id: OnboardingStepId;
  title: string;
}> = [
  {
    description: 'Run a local daemon so Tavro can detect Codex, Claude Code, or other runtimes.',
    id: 'daemon',
    title: 'Connect a daemon',
  },
  {
    description: 'Pick a ready runtime and create your first local coding agent.',
    id: 'agent',
    title: 'Create an agent',
  },
  {
    description: 'Groups are shared chat rooms where agents can receive tasks and report progress.',
    id: 'workspace',
    title: 'Create your first group',
  },
]

export function WelcomePage({
  agents,
  devices,
  error,
  isLoading,
  summary,
  onOpenConversation,
  onOpenCreateAgent,
  onOpenCreateGroup,
  onOpenCreateProject,
  onOpenDaemon,
  onOpenGoal,
  onRefreshData,
  onWelcomeUpdated,
  tutorialRequestId,
}: WelcomePageProps) {
  const { i18n, t } = useTranslation()
  const [deviceName, setDeviceName] = useState('My computer')
  const [daemonCommand, setDaemonCommand] = useState<DaemonRegistrationCommandResponse | null>(null)
  const [daemonError, setDaemonError] = useState<string | null>(null)
  const [daemonLoading, setDaemonLoading] = useState(false)
  const [commandCopied, setCommandCopied] = useState(false)
  const [completeError, setCompleteError] = useState<string | null>(null)
  const [completeLoading, setCompleteLoading] = useState(false)
  const [forceOnboardingTutorial, setForceOnboardingTutorial] = useState(false)
  const [freshOnboardingPreview, setFreshOnboardingPreview] = useState(false)
  const [activeOnboardingStep, setActiveOnboardingStep] = useState<OnboardingStepId>('daemon')
  const [activeDashboardCard, setActiveDashboardCard] = useState<'conversations' | 'goals'>('conversations')

  const devMode = import.meta.env.DEV
  const onboardingDevices = useMemo(
    () =>
      freshOnboardingPreview
        ? devices.filter((device) => device.id === daemonCommand?.deviceId)
        : devices,
    [daemonCommand?.deviceId, devices, freshOnboardingPreview],
  )
  const connectedDaemonDevices = useMemo(
    () => onlineDaemonDevices(onboardingDevices),
    [onboardingDevices],
  )
  const availableDevices = useMemo(
    () => readyRuntimeDevices(onboardingDevices),
    [onboardingDevices],
  )
  const readyAgents = useMemo(
    () => freshOnboardingPreview ? [] : agents.filter(isAgentReady),
    [agents, freshOnboardingPreview],
  )
  const provisioningAgents = useMemo(
    () => freshOnboardingPreview ? [] : agents.filter(isAgentProvisioning),
    [agents, freshOnboardingPreview],
  )
  const onboarding = summary?.onboarding ?? null
  const hasConnectedDaemon =
    connectedDaemonDevices.length > 0 ||
    (!freshOnboardingPreview && onboarding?.prerequisites.hasOnlineDaemon === true)
  const hasReadyRuntime =
    availableDevices.length > 0 ||
    (!freshOnboardingPreview && onboarding?.prerequisites.hasReadyRuntime === true)
  const daemonStepComplete =
    hasConnectedDaemon &&
    hasReadyRuntime
  const agentStepComplete =
    !freshOnboardingPreview &&
    (readyAgents.length > 0 || onboarding?.prerequisites.hasReadyAgent === true)
  const workspaceStepComplete =
    !freshOnboardingPreview && onboarding?.prerequisites.hasWorkspaceConversation === true
  const showDashboard =
    !forceOnboardingTutorial &&
    (summary?.onboarding.completed === true || summary?.onboarding.readyToComplete === true)
  const activeOnboardingStepIndex = onboardingSteps.findIndex((step) => step.id === activeOnboardingStep)
  const isOnboardingStepComplete = (stepId: OnboardingStepId): boolean =>
    stepId === 'daemon'
      ? daemonStepComplete
      : stepId === 'agent'
        ? agentStepComplete
        : workspaceStepComplete
  const activeOnboardingStepComplete = isOnboardingStepComplete(activeOnboardingStep)
  const canAdvanceOnboarding = devMode || activeOnboardingStepComplete
  const previousOnboardingStep =
    activeOnboardingStepIndex > 0
      ? onboardingSteps[activeOnboardingStepIndex - 1]!
      : null
  const nextOnboardingStep =
    activeOnboardingStepIndex >= 0 && activeOnboardingStepIndex < onboardingSteps.length - 1
      ? onboardingSteps[activeOnboardingStepIndex + 1]!
      : null
  const dashboardDate = formatDashboardDate(i18n.resolvedLanguage ?? i18n.language)
  const dashboardConversations = summary?.dashboard.conversations ?? []
  const dashboardGoals = summary?.dashboard.goals ?? []
  const dashboardRecentGoals = dashboardGoals.map(({ goal }) => goal)
  const renderDashboardTaskCard = (goal: ConversationGoal, task: GoalTask) => (
    <button
      key={`${goal.id}:${task.id}`}
      className="grid cursor-pointer gap-2 rounded-lg border border-[#e0e0e0] bg-white p-3 text-left text-sm text-[var(--cds-text-primary)] shadow-[0_1px_2px_rgba(0,0,0,0.08)] transition-[box-shadow,transform,border-color] duration-150 hover:-translate-y-0.5 hover:border-[#c6c6c6] hover:shadow-[0_6px_16px_rgba(0,0,0,0.10)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]"
      type="button"
      onClick={() => onOpenGoal(goal.conversationId, goal.id, task.index)}
    >
      <span className="w-fit rounded-md border border-[#e5e5e5] bg-[#fafafa] px-2 py-1 text-xs font-semibold text-[var(--cds-text-secondary)]">
        Goal: {goal.id.slice(0, 8)} #{task.index}
      </span>
      <h4 className="min-w-0 overflow-hidden text-sm font-semibold leading-5 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">
        {task.title}
      </h4>
      <p className="truncate text-xs leading-4 text-[var(--cds-text-secondary)]">
        {goal.title}
      </p>
    </button>
  )

  const completeOnboarding = useCallback(async (conversationId: string | null) => {
    setCompleteLoading(true)
    setCompleteError(null)
    try {
      const response = await apiRequest<{ welcome: WelcomeSummary }>('/welcome/onboarding/complete', {
        method: 'POST',
      })
      onWelcomeUpdated(response.welcome)
      if (conversationId !== null) {
        onOpenConversation(conversationId)
      }
    } catch (error) {
      setCompleteError(error instanceof Error ? error.message : 'Unable to complete onboarding.')
    } finally {
      setCompleteLoading(false)
    }
  }, [onOpenConversation, onWelcomeUpdated])

  const goToNextOnboardingStep = () => {
    if (nextOnboardingStep !== null) {
      setActiveOnboardingStep(nextOnboardingStep.id)
      return
    }

    if (summary?.onboarding.completed === true) {
      setFreshOnboardingPreview(false)
      setForceOnboardingTutorial(false)
      return
    }

    if (summary?.onboarding.readyToComplete === true) {
      void completeOnboarding(null)
      return
    }

    if (devMode) {
      setActiveOnboardingStep('daemon')
    }
  }

  useEffect(() => {
    if (
      forceOnboardingTutorial ||
      onboarding?.completed === true ||
      onboarding?.readyToComplete !== true ||
      completeLoading
    ) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      void completeOnboarding(null)
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [
    completeLoading,
    completeOnboarding,
    forceOnboardingTutorial,
    onboarding?.completed,
    onboarding?.readyToComplete,
  ])

  useEffect(() => {
    if (tutorialRequestId <= 0) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setActiveOnboardingStep('daemon')
      setFreshOnboardingPreview(false)
      setForceOnboardingTutorial(true)
      setCompleteError(null)
      onRefreshData()
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [onRefreshData, tutorialRequestId])

  useEffect(() => {
    if (!forceOnboardingTutorial && (onboarding?.completed === true || onboarding?.readyToComplete === true)) {
      return
    }

    const intervalId = window.setInterval(onRefreshData, 5000)
    return () => window.clearInterval(intervalId)
  }, [forceOnboardingTutorial, onRefreshData, onboarding?.completed, onboarding?.readyToComplete])

  const generateDaemonCommand = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = deviceName.trim().replace(/\s+/g, ' ')

    if (name.length === 0 || name.length > 80) {
      setDaemonError(t('daemon.deviceNameInvalid'))
      return
    }

    setDaemonLoading(true)
    setDaemonError(null)
    setCommandCopied(false)
    try {
      const response = await apiRequest<DaemonRegistrationCommandResponse>('/daemon/devices', {
        method: 'POST',
        body: JSON.stringify({
          name,
          platform: detectDaemonCommandPlatform(),
        }),
      })
      setDaemonCommand(response)
      onRefreshData()
    } catch (error) {
      setDaemonError(error instanceof Error ? error.message : t('daemon.unableGenerate'))
    } finally {
      setDaemonLoading(false)
    }
  }

  const copyDaemonCommand = async () => {
    if (daemonCommand?.command === undefined) {
      return
    }

    try {
      await navigator.clipboard.writeText(daemonCommand.command)
      setCommandCopied(true)
    } catch {
      setDaemonError(t('daemon.copyFailed'))
    }
  }

  if (isLoading || summary === null) {
    return (
      <section className="h-full min-h-0 overflow-y-auto bg-white p-6" aria-label="Welcome">
        <div className="mx-auto grid max-w-5xl gap-5">
          <SkeletonText heading width="180px" />
          <SkeletonText paragraph lineCount={6} width="100%" />
        </div>
      </section>
    )
  }

  if (error !== null) {
    return (
      <section className="h-full min-h-0 overflow-y-auto bg-white p-6" aria-label="Welcome">
        <InlineNotification
          kind="error"
          title={t('welcome.unavailableTitle')}
          subtitle={error}
          lowContrast
          hideCloseButton
        />
      </section>
    )
  }

  if (showDashboard) {
    const conversationsActive = activeDashboardCard === 'conversations'
    const goalsActive = activeDashboardCard === 'goals'
    const dashboardCardBase =
      `${dashboardPanelClass} welcome-dashboard-card absolute top-0 h-full w-[88%] max-[671px]:w-[92%]`
    const dashboardArrowButton =
      'grid h-11 max-h-11 min-h-11 w-11 min-w-11 max-w-11 shrink-0 cursor-pointer place-items-center rounded-xl border-0 bg-transparent p-0 text-[#344054] transition hover:bg-[#f7f8fa] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)] [&>svg]:block [&>svg]:h-5 [&>svg]:w-5'

    return (
      <section
        className="relative grid h-full min-h-0 overflow-hidden bg-[#f5f6f8] p-5 text-[#161616] max-[960px]:overflow-y-auto max-[671px]:p-4"
        style={{
          backgroundImage: 'linear-gradient(135deg, #ffffff 0%, #f5f6f8 38%, #d9dde4 72%, #111827 100%)',
        }}
        aria-label="Welcome dashboard"
      >
        <div className="relative mx-auto grid h-full min-h-0 w-full max-w-6xl grid-rows-[auto_minmax(0,1fr)] gap-5 max-[960px]:h-auto max-[960px]:min-h-full">
          <header className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4 max-[760px]:grid-cols-1">
            <div className="grid max-w-3xl gap-3">
              <div className="flex flex-wrap items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-[#6b7280]">
                <span>{dashboardDate}</span>
              </div>
              <div className="grid gap-2">
                <div className="flex min-w-0 items-start gap-3">
                  <img
                    src="/favicon.svg"
                    alt=""
                    className="mt-1 h-11 w-11 shrink-0 max-[671px]:h-9 max-[671px]:w-9"
                  />
                  <h1 className="max-w-3xl text-[clamp(1.8rem,3.4vw,3.2rem)] font-semibold leading-[1.05] tracking-normal text-[#161616]">
                    {t('welcome.dashboardTitle')}
                  </h1>
                </div>
                <p className="max-w-2xl text-sm leading-6 text-[#5f6877]">
                  {t('welcome.dashboardSubtitle')}
                </p>
              </div>
            </div>
            {devMode && (
              <div className="flex flex-wrap justify-end gap-1 self-start text-xs">
                <button
                  className="inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md border-0 bg-transparent px-2 font-semibold text-[#69707d] hover:bg-white/70 hover:text-[#161616] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]"
                  type="button"
                  onClick={() => {
                    setActiveOnboardingStep('daemon')
                    setFreshOnboardingPreview(false)
                    setForceOnboardingTutorial(true)
                  }}
                >
                  <ArrowLeft size={16} />
                  {t('welcome.tutorial')}
                </button>
                <button
                  className="inline-flex h-8 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent px-2 font-semibold text-[#69707d] hover:bg-white/70 hover:text-[#161616] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]"
                  type="button"
                  onClick={() => {
                    setActiveOnboardingStep('daemon')
                    setFreshOnboardingPreview(true)
                    setForceOnboardingTutorial(true)
                  }}
                >
                  {t('welcome.freshStart')}
                </button>
              </div>
            )}
          </header>

          <div className="welcome-dashboard-deck relative min-h-0 overflow-hidden">
            <style>{roundedFieldStyles}</style>
            <section
              className={`${dashboardCardBase} left-0 ${conversationsActive ? 'pointer-events-auto' : 'pointer-events-none'}`}
              aria-label={t('welcome.recentConversations')}
              aria-hidden={!conversationsActive}
              inert={!conversationsActive}
              style={{
                opacity: conversationsActive ? 1 : 0.88,
                transform: conversationsActive
                  ? 'translateX(0) translateY(0) scale(1)'
                  : 'translateX(-82%) translateY(1.15rem) scale(0.94)',
                zIndex: conversationsActive ? 30 : 20,
              }}
            >
              <div className="grid gap-1 border-b border-[#e8edf3] px-4 py-3.5">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#69707d]">{t('welcome.latestMessage')}</p>
                  <ChatBot size={19} />
                </div>
                <h2 className="text-lg font-semibold leading-6 text-[#161616]">{t('welcome.recentConversations')}</h2>
                <p className="text-sm leading-5 text-[#69707d]">{t('welcome.conversationsPanelSubtitle')}</p>
              </div>
              {dashboardConversations.length === 0 ? (
                <div className="grid min-h-0 place-items-center px-8 py-12 text-center">
                  <div className="grid max-w-sm justify-items-center gap-3">
                    <span className="grid h-11 w-11 place-items-center rounded-lg border border-[#dde3ea] bg-[#f7f9fc] text-[#596171]">
                      <ChatBot size={20} />
                    </span>
                    <div className="grid gap-1">
                      <h3 className="text-base font-semibold text-[#161616]">{t('welcome.noRecentConversationsTitle')}</h3>
                      <p className="text-sm leading-6 text-[#69707d]">{t('welcome.noRecentConversationsSubtitle')}</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="min-h-0 overflow-y-auto">
                  {dashboardConversations.map(({ conversation, latestMessage }, index) => (
                    <button
                      key={conversation.id}
                      type="button"
                      className={`${dashboardRowClass} min-h-[4.75rem] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 max-[671px]:grid-cols-[auto_minmax(0,1fr)] ${index === 0 ? 'bg-[#f8fbff]' : ''}`}
                      onClick={() => onOpenConversation(conversation.id)}
                    >
                      <ConversationAvatar agents={agents} conversation={conversation} />
                      <span className="grid min-w-0 gap-1">
                        <span className="flex min-w-0 flex-wrap items-center gap-2">
                          <strong className="truncate text-base leading-6 text-[#161616]">
                            {dashboardConversationTitle(conversation, agents)}
                          </strong>
                          <span className="rounded-full border border-[#e1e6ee] bg-white/85 px-2 py-0.5 text-[0.68rem] font-semibold uppercase tracking-wide text-[#69707d]">
                            {t(`welcome.conversationType.${conversation.type}`)}
                          </span>
                        </span>
                        <span className="mt-1 block truncate text-sm text-[#596171]">
                          {dashboardConversationPreview(latestMessage?.content, t('welcome.noMessagePreview'))}
                        </span>
                      </span>
                      <time
                        className="whitespace-nowrap text-xs font-medium text-[#8a94a6] max-[671px]:col-start-2 max-[671px]:justify-self-start"
                        dateTime={latestMessage?.updatedAt ?? conversation.lastMessageAt ?? conversation.updatedAt}
                      >
                        {formatMessageTime(latestMessage?.updatedAt ?? conversation.lastMessageAt ?? conversation.updatedAt)}
                      </time>
                    </button>
                  ))}
                </div>
              )}
              <footer className="flex min-h-16 shrink-0 items-center justify-end border-t border-[#e8edf3] px-4 py-3">
                <button
                  className={dashboardArrowButton}
                  type="button"
                  aria-label={t('welcome.next')}
                  onClick={() => setActiveDashboardCard('goals')}
                >
                  <ArrowRight size={20} />
                </button>
              </footer>
            </section>

            <section
              className={`${dashboardCardBase} right-0 ${goalsActive ? 'pointer-events-auto' : 'pointer-events-none'}`}
              aria-label={t('welcome.recentGoals')}
              aria-hidden={!goalsActive}
              inert={!goalsActive}
              style={{
                opacity: goalsActive ? 1 : 0.88,
                transform: goalsActive
                  ? 'translateX(0) translateY(0) scale(1)'
                  : 'translateX(82%) translateY(1.15rem) scale(0.94)',
                zIndex: goalsActive ? 30 : 20,
              }}
            >
              <div className="grid gap-1 border-b border-[#e8edf3] px-4 py-3.5">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#69707d]">{t('welcome.latestGoal')}</p>
                  <Task size={19} />
                </div>
                <h2 className="text-lg font-semibold leading-6 text-[#161616]">{t('welcome.goalsPanelTitle')}</h2>
                <p className="text-sm leading-5 text-[#69707d]">{t('welcome.goalsPanelSubtitle')}</p>
              </div>
              {dashboardGoals.length === 0 ? (
                <div className="grid min-h-0 place-items-center px-8 py-12 text-center">
                  <div className="grid max-w-sm justify-items-center gap-3">
                    <span className="grid h-11 w-11 place-items-center rounded-lg border border-[#dde3ea] bg-[#f7f9fc] text-[#596171]">
                      <Task size={20} />
                    </span>
                    <div className="grid gap-1">
                      <h3 className="text-base font-semibold text-[#161616]">{t('welcome.noGoalsTitle')}</h3>
                      <p className="text-sm leading-6 text-[#69707d]">{t('welcome.noGoalsSubtitle')}</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="min-h-0 overflow-hidden px-4 py-4">
                  <GoalStatusBoard
                    emptyLabel={t('chat.noTasks')}
                    goals={dashboardRecentGoals}
                    renderTask={({ goal, task }) => renderDashboardTaskCard(goal, task)}
                    statusLabel={(status) => t(`status.task.${status}`, { defaultValue: status })}
                  />
                </div>
              )}
              <footer className="flex min-h-16 shrink-0 items-center justify-start border-t border-[#e8edf3] px-4 py-3">
                <button
                  className={dashboardArrowButton}
                  type="button"
                  aria-label={t('welcome.back')}
                  onClick={() => setActiveDashboardCard('conversations')}
                >
                  <ArrowLeft size={20} />
                </button>
              </footer>
            </section>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="h-full min-h-0 overflow-y-auto bg-[#fafafa] p-6 max-[671px]:p-4" aria-label="Welcome onboarding">
      <div className="flex min-h-full w-full flex-col gap-5">
        <header className="flex items-start justify-between gap-4 max-[671px]:grid">
          <div className="grid gap-1">
            <h1 className="text-2xl font-semibold leading-8 text-[#161616]">{t('welcome.onboardingTitle')}</h1>
            <p className="text-sm text-[#69707d]">{t('welcome.onboardingSubtitle')}</p>
          </div>
          {devMode && forceOnboardingTutorial && (
            <button
              className={subtleButton}
              type="button"
              onClick={() => {
                setFreshOnboardingPreview(false)
                setActiveOnboardingStep('daemon')
                setForceOnboardingTutorial(false)
              }}
            >
              {t('welcome.backToDashboard')}
            </button>
          )}
        </header>

        {completeError && (
          <InlineNotification
            kind="error"
            title={t('welcome.onboardingErrorTitle')}
            subtitle={completeError}
            lowContrast
            hideCloseButton
          />
        )}

        <div className="welcome-card-deck relative overflow-visible max-[900px]:grid max-[900px]:gap-0">
          <style>{roundedFieldStyles}</style>
          {onboardingSteps.map((step, stepIndex) => {
            const isActive = step.id === activeOnboardingStep
            const stepComplete = isOnboardingStepComplete(step.id)
            const stepTitle = t(`welcome.steps.${step.id}.title`)
            const stepDescription = t(`welcome.steps.${step.id}.description`)
            const distanceFromActive = Math.abs(stepIndex - activeOnboardingStepIndex)
            const horizontalOffset =
              stepIndex < activeOnboardingStepIndex
                ? `-${distanceFromActive * 0.35}rem`
                : stepIndex > activeOnboardingStepIndex
                  ? `${distanceFromActive * 0.35}rem`
                  : '0'
            const positionClass =
              stepIndex === 0
                ? 'left-0'
                : stepIndex === 1
                  ? 'left-[26%]'
                  : 'left-[52%]'
            const toneClass = isActive
              ? 'border-[#e4e7ec] bg-white shadow-[0_18px_42px_rgba(15,23,42,0.14)]'
              : distanceFromActive > 1
                ? 'border-[#c7d0dc] bg-[#d8dee6] shadow-[0_8px_18px_rgba(15,23,42,0.08)]'
                : 'border-[#d8dee6] bg-[#eef0f4] shadow-[0_12px_26px_rgba(15,23,42,0.1)]'

            return (
              <section
                key={step.id}
                aria-hidden={!isActive}
                aria-label={stepTitle}
                className={`welcome-onboarding-card welcome-rounded-fields absolute top-0 flex h-full max-h-[calc(100vh-12rem)] min-h-[34rem] w-[48%] flex-col overflow-hidden rounded-2xl border p-5 ${positionClass} ${toneClass} ${isActive ? 'pointer-events-auto' : 'pointer-events-none'} max-[900px]:h-auto max-[900px]:max-h-none max-[900px]:min-h-0 max-[900px]:w-full`}
                style={{
                  opacity: isActive ? 1 : distanceFromActive > 1 ? 0.82 : 0.92,
                  transform: isActive
                    ? 'translateX(0) translateY(0) scale(1)'
                    : `translateX(${horizontalOffset}) translateY(${distanceFromActive * 1.15}rem) scale(${distanceFromActive > 1 ? 0.92 : 0.95})`,
                  zIndex: isActive ? 30 : 20 - distanceFromActive,
                }}
              >
                {isActive ? (
                  <>
          <div className="flex shrink-0 items-start gap-4 border-b border-[#edf0f4] pb-5 max-[671px]:grid">
            <div className="flex min-w-0 items-start gap-3">
              <StepIcon complete={stepComplete} />
              <div className="min-w-0">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#69707d]">
                  {t('welcome.stepOf', { current: stepIndex + 1, total: onboardingSteps.length })}
                </p>
                <h2 className="text-xl font-semibold leading-7 text-[#161616]">{stepTitle}</h2>
                <p className="mt-1 text-sm text-[#69707d]">{stepDescription}</p>
              </div>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col justify-start overflow-y-auto py-8 pr-2">
            {activeOnboardingStep === 'daemon' && (
              hasConnectedDaemon ? (
                <div className="grid max-w-3xl gap-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <button className={subtleButton} type="button" onClick={onOpenDaemon}>
                      <Devices size={16} />
                      {t('daemon.title')}
                    </button>
                  </div>
                  <p className="text-sm text-[#69707d]">
                    {daemonStepComplete
                      ? t('welcome.daemonReadySubtitle')
                      : t('welcome.daemonWaitingRuntimeSubtitle')}
                  </p>
                  <div>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#69707d]">
                      {t('welcome.detectedRuntimes')}
                    </h3>
                    <WelcomeRuntimeList devices={connectedDaemonDevices} />
                  </div>
                </div>
              ) : (
                <form className="grid max-w-3xl gap-3" onSubmit={(event) => void generateDaemonCommand(event)}>
                  {daemonError && (
                    <InlineNotification kind="error" title={t('welcome.daemonCommandFailed')} subtitle={daemonError} lowContrast hideCloseButton />
                  )}
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2 max-[671px]:grid-cols-1">
                    <TextInput
                      id="welcome-daemon-name"
                      labelText={t('daemon.deviceName')}
                      value={deviceName}
                      maxLength={80}
                      onChange={(event) => setDeviceName(event.target.value)}
                    />
                    <button className={primaryButton} type="submit" disabled={daemonLoading}>
                      {daemonLoading ? <InlineLoading description={t('daemon.generatingCommand')} /> : t('welcome.generateCommand')}
                    </button>
                  </div>
                  {daemonCommand && (
                    <div className="grid gap-2">
                      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                        <pre className="min-w-0 overflow-auto rounded-xl border border-[#dde1e6] bg-[#161616] p-3 text-xs leading-relaxed text-white">
                          {daemonCommand.command}
                        </pre>
                        <button className={subtleButton} type="button" onClick={() => void copyDaemonCommand()} aria-label={t('daemon.copyCommand')}>
                          {commandCopied ? <CheckmarkFilled size={16} /> : <Copy size={16} />}
                        </button>
                      </div>
                      <InlineNotification
                        kind="warning"
                        title={t('daemon.registrationWaitingTitle')}
                        subtitle={t('daemon.registrationWaitingSubtitle')}
                        lowContrast
                        hideCloseButton
                      />
                    </div>
                  )}
                </form>
              )
            )}

            {activeOnboardingStep === 'agent' && (
              agentStepComplete ? (
                <div className="grid max-w-2xl gap-4">
                  <p className="text-sm text-[#69707d]">{t('welcome.agentReadySubtitle')}</p>
                </div>
              ) : (
                <div className="grid max-w-2xl gap-4">
                  {provisioningAgents.length > 0 && (
                    <div className="grid gap-2 rounded-xl border border-[#d8dee6] bg-white p-3">
                      <InlineLoading description={t('welcome.agentProvisioningTitle')} status="active" />
                      <p className="text-sm leading-6 text-[#69707d]">
                        {t('welcome.agentProvisioningSubtitle')}
                      </p>
                    </div>
                  )}
                  <div className="grid max-w-xs gap-2">
                    <button
                      className={primaryButton}
                      type="button"
                      disabled={availableDevices.length === 0 || provisioningAgents.length > 0}
                      onClick={() => onOpenCreateAgent(availableDevices[0]?.id)}
                    >
                      <ChatBot size={16} />
                      {t('modals.agentCreate.heading')}
                    </button>
                  </div>
                  {availableDevices.length === 0 && (
                    <p className="text-sm text-[#69707d]">{t('welcome.noRuntimeBeforeAgent')}</p>
                  )}
                </div>
              )
            )}

            {activeOnboardingStep === 'workspace' && (
              workspaceStepComplete ? (
                <div className="grid max-w-2xl gap-4">
                  <p className="text-sm text-[#69707d]">{t('welcome.workspaceReadySubtitle')}</p>
                  {completeLoading && <InlineLoading description={t('welcome.finishingOnboarding')} />}
                </div>
              ) : (
                <div className="grid max-w-2xl gap-4">
                  <p className="text-sm leading-6 text-[#69707d]">
                    {t('welcome.workspaceStepSubtitle')}
                  </p>
                  <div className="grid max-w-xs gap-2">
                    <button
                      className={primaryButton}
                      type="button"
                      disabled={readyAgents.length === 0}
                      onClick={onOpenCreateGroup}
                    >
                      <ChatBot size={16} />
                      {t('modals.groupCreate.heading')}
                    </button>
                    <button
                      className={subtleButton}
                      type="button"
                      disabled={readyAgents.length === 0}
                      onClick={onOpenCreateProject}
                    >
                      <Folder size={16} />
                      {t('modals.projectCreate.heading')}
                    </button>
                  </div>
                  {readyAgents.length === 0 && (
                    <p className="text-sm text-[#69707d]">{t('welcome.waitForAgentBeforeWorkspace')}</p>
                  )}
                </div>
              )
            )}
          </div>

          <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-[#edf0f4] pt-5 max-[671px]:grid">
            <button
              className={subtleButton}
              type="button"
              disabled={previousOnboardingStep === null}
              onClick={() => {
                if (previousOnboardingStep !== null) {
                  setActiveOnboardingStep(previousOnboardingStep.id)
                }
              }}
            >
              {t('welcome.back')}
            </button>
            <span className="text-center text-sm text-[#69707d]">
              {activeOnboardingStepComplete
                ? t('welcome.stepComplete')
                : devMode
                  ? t('welcome.devPreviewStep')
                  : t('welcome.completeStep')}
            </span>
            <button
              className={primaryButton}
              type="button"
              disabled={!canAdvanceOnboarding || completeLoading}
              onClick={goToNextOnboardingStep}
            >
              {nextOnboardingStep !== null
                ? t('welcome.next')
                : completeLoading
                  ? <InlineLoading description={t('welcome.finishing')} />
                  : t('welcome.finish')}
            </button>
          </footer>
                  </>
                ) : (
                  <div className="flex h-full min-h-0 flex-col gap-4">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <StepIcon complete={stepComplete} />
                        <div className="min-w-0">
                          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#69707d]">
                            {t('welcome.stepOf', { current: stepIndex + 1, total: onboardingSteps.length })}
                          </p>
                          <h3 className="truncate text-lg font-semibold leading-7 text-[#161616]">{stepTitle}</h3>
                        </div>
                      </div>
                    </div>
                    <p className="line-clamp-3 text-sm leading-6 text-[#596171]">{stepDescription}</p>
                    <div className="mt-auto border-t border-black/10 pt-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-[#69707d]">
                        {stepComplete ? t('welcome.ready') : t('welcome.upcoming')}
                      </p>
                      <p className="mt-1 line-clamp-2 text-sm leading-6 text-[#596171]">
                        {stepComplete
                          ? t('welcome.previewComplete')
                          : t('welcome.previewContinue')}
                      </p>
                    </div>
                  </div>
                )}
              </section>
            )
          })}
        </div>
      </div>
    </section>
  )
}
