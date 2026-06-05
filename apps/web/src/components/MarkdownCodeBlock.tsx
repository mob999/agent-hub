import type { ReactNode } from 'react'

interface MarkdownCodeBlockProps {
  children?: unknown
  className?: string
}

const commandTokenPattern =
  /(\$env:[A-Za-z_][A-Za-z0-9_]*|https?:\/\/[^\s'"]+|'[^']*'|--[A-Za-z0-9-]+|@[A-Za-z0-9_/-]+|\b(?:cd|pnpm|dev)\b)/g

function codeText(children: unknown): string {
  if (Array.isArray(children)) {
    return children.map(codeText).join('')
  }

  if (children === null || children === undefined) {
    return ''
  }

  return String(children)
}

function tokenClass(token: string): string {
  if (token.startsWith('$env:')) {
    return 'text-[#78a9ff]'
  }

  if (token.startsWith("'")) {
    return 'text-[#42be65]'
  }

  if (/^https?:\/\//.test(token)) {
    return 'text-[#33b1ff]'
  }

  if (token.startsWith('--')) {
    return 'text-[#ffab91]'
  }

  if (token.startsWith('@')) {
    return 'text-[#be95ff]'
  }

  return 'text-[#f1c21b]'
}

function highlightedCommand(content: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let lastIndex = 0

  for (const match of content.matchAll(commandTokenPattern)) {
    const token = match[0]
    const index = match.index ?? 0

    if (index > lastIndex) {
      nodes.push(content.slice(lastIndex, index))
    }

    nodes.push(
      <span className={tokenClass(token)} key={`${index}-${token}`}>
        {token}
      </span>,
    )
    lastIndex = index + token.length
  }

  if (lastIndex < content.length) {
    nodes.push(content.slice(lastIndex))
  }

  return nodes
}

export function MarkdownCodeBlock({ children, className }: MarkdownCodeBlockProps) {
  const content = codeText(children).replace(/\n$/, '')

  return <code className={className}>{highlightedCommand(content)}</code>
}
