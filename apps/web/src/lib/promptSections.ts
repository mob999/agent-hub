export type PromptSectionKind = 'tag' | 'text' | 'raw'

export interface PromptSection {
  content: string
  id: string
  kind: PromptSectionKind
  tagName?: string
  title: string
}

const tagTitleByName: Record<string, string> = {
  agenthub_active_runs: 'Active runs',
  agenthub_agent_groups: 'Agent groups',
  agenthub_agent_identity: 'Agent identity',
  agenthub_assigned_task: 'Assigned task',
  agenthub_group_chat_protocol: 'Group chat protocol',
  agenthub_group_task_protocol: 'Task protocol',
  agenthub_memory: 'Memory',
  agenthub_task_checkpoint: 'Task checkpoint',
  agenthub_user_message_attachments: 'Attachments',
  compressed_older_context: 'Compressed older context',
  conversation_history: 'Conversation history',
  mentioned_message: 'Mentioned message',
  older_conversation_history: 'Older conversation history',
  orchestrator_dispatch_message: 'Orchestrator dispatch message',
  recent_private_chat_history: 'Recent private chat history',
  task_graph: 'Task graph',
  transcript: 'Transcript',
  user_request: 'User request',
}

const promptTagNames = Object.keys(tagTitleByName)
const promptTagPattern = new RegExp(
  `<\\/?(${promptTagNames.join('|')})(?:\\s+[^>]*)?>`,
  'g',
)

function titleFromTagName(tagName: string): string {
  return tagTitleByName[tagName] ?? tagName
    .replace(/^agenthub_/, '')
    .split(/[_-]+/)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

function compactContent(content: string): string {
  return content.replace(/^\s+|\s+$/g, '')
}

function textSection(content: string, index: number): PromptSection | null {
  const compacted = compactContent(content)

  if (compacted.length === 0) {
    return null
  }

  return {
    id: `text-${index}`,
    kind: 'text',
    title: 'Prompt text',
    content: compacted,
  }
}

function rawSection(prompt: string): PromptSection[] {
  return [
    {
      id: 'raw',
      kind: 'raw',
      title: 'Prompt text',
      content: prompt,
    },
  ]
}

export function parsePromptSections(prompt: string): PromptSection[] {
  const sections: PromptSection[] = []
  let cursor = 0
  let sectionIndex = 0
  let match: RegExpExecArray | null

  promptTagPattern.lastIndex = 0

  while ((match = promptTagPattern.exec(prompt)) !== null) {
    const fullTag = match[0]
    const tagName = match[1]

    if (fullTag.startsWith('</')) {
      return rawSection(prompt)
    }

    const openStart = match.index
    const openEnd = promptTagPattern.lastIndex
    const closingTag = `</${tagName}>`
    const closeStart = prompt.indexOf(closingTag, openEnd)

    if (closeStart === -1) {
      return rawSection(prompt)
    }

    const prefix = textSection(prompt.slice(cursor, openStart), sectionIndex)
    if (prefix !== null) {
      sections.push(prefix)
      sectionIndex += 1
    }

    sections.push({
      id: `${tagName}-${sectionIndex}`,
      kind: 'tag',
      tagName,
      title: titleFromTagName(tagName),
      content: compactContent(prompt.slice(openEnd, closeStart)),
    })
    sectionIndex += 1
    cursor = closeStart + closingTag.length
    promptTagPattern.lastIndex = cursor
  }

  const suffix = textSection(prompt.slice(cursor), sectionIndex)
  if (suffix !== null) {
    sections.push(suffix)
  }

  return sections.length > 0 ? sections : rawSection(prompt)
}
