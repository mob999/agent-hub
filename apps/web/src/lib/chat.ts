export const groupChatId = 'all'

export type ChatTarget =
  | {
      type: 'group'
      id: typeof groupChatId
    }
  | {
      type: 'agent'
      id: string
    }

export function getChatTargetId(target: ChatTarget): string {
  return target.type === 'agent' ? `agent:${target.id}` : target.id
}
