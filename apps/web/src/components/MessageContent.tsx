import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface MessageContentProps {
  className?: string
  content: string
}

const markdownPatterns = [
  /^#{1,6}\s+\S/m,
  /^>\s+\S/m,
  /^\s*[-*+]\s+\S/m,
  /^\s*\d+\.\s+\S/m,
  /```[\s\S]*```/,
  /`[^`\n]+`/,
  /\*\*[^*\n]+\*\*/,
  /__[^_\n]+__/,
  /\[[^\]\n]+\]\([^)]+\)/,
  /^\|.+\|$/m,
]

function looksLikeMarkdown(content: string): boolean {
  return markdownPatterns.some((pattern) => pattern.test(content))
}

export function MessageContent({ className, content }: MessageContentProps) {
  if (!looksLikeMarkdown(content)) {
    return <span className={className}>{content}</span>
  }

  return (
    <div className="agenthub-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  )
}
