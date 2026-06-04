import { Checkbox } from '@carbon/react'
import { AgentStatusIndicator } from './AgentStatusIndicator'
import type { AgentDetails } from '../lib/api'

interface AgentMemberSelectorProps {
  agents: AgentDetails[]
  disabled: boolean
  helpText?: string
  idPrefix: string
  orchestratorAgentId: string
  selectedAgentIds: string[]
  onSelectOrchestrator: (agentId: string | null) => void
  onToggleAgent: (agentId: string, checked: boolean) => void
}

export function AgentMemberSelector({
  agents,
  disabled,
  helpText,
  idPrefix,
  orchestratorAgentId,
  selectedAgentIds,
  onSelectOrchestrator,
  onToggleAgent,
}: AgentMemberSelectorProps) {
  return (
    <div className="grid gap-2" aria-label="Agents">
      <p className="text-sm font-semibold text-[var(--cds-text-primary)]">
        Agents
      </p>
      <div className="grid rounded-xl border border-[#d8dee6] bg-white">
        {agents.map((agent) => {
          const agentId = agent.agent.id
          const isOrchestrator = orchestratorAgentId === agentId

          return (
            <div
              className="grid min-h-12 grid-cols-[minmax(0,1fr)_auto_1.5rem] items-center gap-3 border-b border-[#eef0f3] px-3 py-2 last:border-b-0 hover:bg-[#f7f8fa]"
              key={agentId}
            >
              <Checkbox
                id={`${idPrefix}-${agentId}`}
                labelText={agent.agent.name}
                checked={selectedAgentIds.includes(agentId)}
                disabled={disabled}
                onChange={(_, data) => onToggleAgent(agentId, data.checked)}
              />
              <button
                type="button"
                aria-pressed={isOrchestrator}
                className={
                  isOrchestrator
                    ? 'rounded-full bg-[#a7f0ba] px-3 py-1 text-xs font-semibold text-[#044317] transition hover:bg-[#6fdc8c]'
                    : 'rounded-full border border-[#d8dee6] px-3 py-1 text-xs font-semibold text-[#69707d] transition hover:border-[#c7d0dc] hover:bg-[#eef0f4] hover:text-[#394150]'
                }
                disabled={disabled}
                onClick={() => onSelectOrchestrator(isOrchestrator ? null : agentId)}
              >
                Orchestrator
              </button>
              <AgentStatusIndicator agent={agent} />
            </div>
          )
        })}
      </div>
      {helpText ? (
        <p className="text-xs text-[#69707d]">
          {helpText}
        </p>
      ) : null}
    </div>
  )
}
