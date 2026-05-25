import type { RunEvent, RunStatus } from './api'

export function formatTime(value: string | null | undefined): string {
  if (!value) {
    return 'Never'
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
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
