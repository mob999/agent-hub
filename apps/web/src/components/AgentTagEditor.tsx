import { Checkmark, Close } from '@carbon/react/icons'
import { useId, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'

interface AgentTagEditorProps {
  disabled?: boolean
  tags: string[]
  onChange: (tags: string[]) => void
}

const addButtonClass =
  'grid h-7 w-7 shrink-0 cursor-pointer place-items-center rounded-md border border-[#d8dee6] bg-white text-sm font-semibold text-[#344054] shadow-[0_1px_2px_rgba(15,23,42,0.06)] transition hover:border-[#c7d0dc] hover:bg-[#f7f8fa] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)] disabled:cursor-not-allowed disabled:border-[#e1e5ea] disabled:bg-[#f4f4f4] disabled:text-[#a2a9b0] disabled:shadow-none'
const agentTagMaxCount = 6
const agentTagMaxLength = 20

function normalizeUiAgentTags(input: string[]): { error?: 'too-many' | 'too-long'; tags: string[] } {
  const tags: string[] = []
  const seen = new Set<string>()

  for (const item of input) {
    const tag = item.trim().replace(/\s+/g, ' ')

    if (tag.length === 0) {
      continue
    }

    if (tag.length > agentTagMaxLength) {
      return { error: 'too-long', tags: [] }
    }

    const key = tag.toLocaleLowerCase()
    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    tags.push(tag)

    if (tags.length > agentTagMaxCount) {
      return { error: 'too-many', tags: [] }
    }
  }

  return { tags }
}

export function AgentTagEditor({ disabled = false, tags, onChange }: AgentTagEditorProps) {
  const { t } = useTranslation()
  const inputId = useId()
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const canAddMore = tags.length < agentTagMaxCount

  const removeTag = (tag: string) => {
    onChange(tags.filter((item) => item !== tag))
  }

  const cancelDraft = () => {
    setAdding(false)
    setDraft('')
    setError(null)
  }

  const commitDraft = () => {
    const result = normalizeUiAgentTags([...tags, draft])

    if (result.error === 'too-many') {
      setError(t('agentTags.tooMany', { count: agentTagMaxCount }))
      return
    }

    if (result.error === 'too-long') {
      setError(t('agentTags.tooLong', { count: agentTagMaxLength }))
      return
    }

    if (result.error !== undefined) {
      setError(t('agentTags.invalid'))
      return
    }

    onChange(result.tags)
    cancelDraft()
  }

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      commitDraft()
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      cancelDraft()
    }
  }

  return (
    <div className="grid gap-2">
      <span className="text-sm font-medium text-[#525252]">{t('agentTags.label')}</span>
      {tags.length > 0 && (
        <div className="flex min-w-0 gap-1.5 overflow-x-auto pb-1" aria-label={t('agentTags.current')}>
          {tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex h-7 max-w-[14rem] shrink-0 items-center gap-1 rounded-md border border-[#d8dee6] bg-[#f7f8fa] px-2 text-xs font-medium text-[#344054]"
            >
              <span className="truncate">{tag}</span>
              <button
                className="grid h-4 w-4 cursor-pointer place-items-center rounded-[4px] border-0 bg-transparent text-[#69707d] hover:bg-[#e8edf3] hover:text-[#161616] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--cds-focus)] disabled:cursor-not-allowed disabled:text-[#c6c6c6]"
                type="button"
                aria-label={t('agentTags.remove', { tag })}
                disabled={disabled}
                onClick={() => removeTag(tag)}
              >
                <Close size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      {!adding ? (
        <button
          className={addButtonClass}
          type="button"
          aria-label={t('agentTags.add')}
          disabled={disabled || !canAddMore}
          onClick={() => {
            setAdding(true)
            setError(null)
          }}
        >
          +
        </button>
      ) : (
        <div className="flex min-w-0 items-start gap-2">
          <label className="sr-only" htmlFor={inputId}>{t('agentTags.add')}</label>
          <input
            id={inputId}
            className="h-7 min-w-0 flex-1 rounded-md border border-[#d8dee6] bg-white px-2.5 text-xs text-[#161616] shadow-[0_1px_2px_rgba(15,23,42,0.04)] outline-none focus:border-[#b9c3cf] focus:outline-2 focus:outline-offset-2 focus:outline-[var(--cds-focus)] disabled:border-[#e1e5ea] disabled:bg-[#f4f4f4]"
            value={draft}
            disabled={disabled}
            maxLength={agentTagMaxLength}
            placeholder={t('agentTags.placeholder')}
            onChange={(event) => {
              setDraft(event.target.value)
              setError(null)
            }}
            onKeyDown={onInputKeyDown}
          />
          <button
            className={addButtonClass}
            type="button"
            aria-label={t('agentTags.confirm')}
            disabled={disabled}
            onClick={commitDraft}
          >
            <Checkmark size={16} />
          </button>
        </div>
      )}
      {error && <p className="text-xs leading-5 text-[#da1e28]">{error}</p>}
    </div>
  )
}
