import { Loading } from '@carbon/react'
import type { AgentDetails } from '../lib/api'

interface AgentStatusIndicatorProps {
  agent: AgentDetails
}

function isAgentReady(agent: AgentDetails): boolean {
  return agent.runtimeBinding.status === 'ready' && agent.workspace.status === 'ready'
}

function isAgentPending(agent: AgentDetails): boolean {
  return agent.runtimeBinding.status === 'pending' || agent.workspace.status === 'pending'
}

const statusSlotClassName = 'grid h-6 w-6 place-items-center justify-self-end'

export function AgentStatusIndicator({ agent }: AgentStatusIndicatorProps) {
  if (isAgentPending(agent)) {
    return (
      <span className={statusSlotClassName} title="Creating agent">
        <Loading
          small
          withOverlay={false}
          description="Creating agent"
          className="h-4 w-4"
        />
      </span>
    )
  }

  if (isAgentReady(agent)) {
    return (
      <span className={statusSlotClassName} title="Ready">
        <span
          className="h-2 w-2 rounded-full bg-[var(--cds-support-success)]"
          aria-hidden="true"
        />
        <span className="sr-only">Ready</span>
      </span>
    )
  }

  return (
    <span className={statusSlotClassName} title="Offline">
      <span
        className="h-2 w-2 rounded-full bg-[var(--cds-icon-secondary)] opacity-70"
        aria-hidden="true"
      />
      <span className="sr-only">Offline</span>
    </span>
  )
}
