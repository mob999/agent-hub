import type { RunEvent, RunStatus } from './api'

export function formatTime(value: string | null | undefined): string {
  if (!value) {
    return 'Never'
  }

  const date = new Date(value)
  const pad = (part: number) => String(part).padStart(2, '0')

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function formatMessageTime(value: string | null | undefined): string {
  if (!value) {
    return 'Never'
  }

  const date = new Date(value)
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const messageDayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const pad = (part: number) => String(part).padStart(2, '0')
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`

  if (todayStart - messageDayStart === 24 * 60 * 60 * 1000) {
    return `昨天 ${time}`
  }

  return `${date.getMonth() + 1}月${date.getDate()}日 ${time}`
}

export function runTagType(status: RunStatus): 'gray' | 'blue' | 'green' | 'red' | 'warm-gray' {
  switch (status) {
    case 'queued':
      return 'gray'
    case 'running':
      return 'blue'
    case 'succeeded':
      return 'green'
    case 'failed':
      return 'red'
    case 'cancelled':
      return 'warm-gray'
  }
}

export function runStatusLabel(status: RunStatus): string {
  switch (status) {
    case 'queued':
      return 'Queued'
    case 'running':
      return 'Running'
    case 'succeeded':
      return 'Succeeded'
    case 'failed':
      return 'Failed'
    case 'cancelled':
      return 'Cancelled'
  }
}

export function eventTitle(event: RunEvent): string {
  switch (event.type) {
    case 'run.queued':
      return 'Run queued'
    case 'run.started':
      return 'Run started'
    case 'message.delta':
      return 'Message delta'
    case 'log.line':
      return event.stream === 'stderr' ? 'Error log' : 'Log line'
    case 'runtime.event':
      return event.raw?.nativeType ?? 'Runtime event'
    case 'tool.call.started':
      return `Tool started${event.name ? `: ${event.name}` : ''}`
    case 'tool.call.completed':
      return `Tool ${event.status ?? 'completed'}${event.name ? `: ${event.name}` : ''}`
    case 'agenthub.tool.call':
      return `AgentHub tool${event.name ? `: ${event.name}` : ''}`
    case 'artifact.created':
      return 'Artifact created'
    case 'run.completed':
      return `Run ${event.status ?? 'completed'}`
    default:
      return event.type
  }
}

export function isDisplayRunEvent(event: RunEvent): boolean {
  return event.type !== 'runtime.event'
}

export function eventMessageContent(event: RunEvent): string {
  if (event.type === 'message.delta') {
    return event.content ?? ''
  }

  return ''
}

export function eventLogLine(event: RunEvent): string {
  if (event.type === 'log.line') {
    return event.line ?? ''
  }

  return ''
}
