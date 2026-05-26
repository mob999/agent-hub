import { Button, IconButton, InlineLoading, InlineNotification } from '@carbon/react'
import { Download, Launch, Play, Rocket, Save } from '@carbon/react/icons'
import Editor, { DiffEditor } from '@monaco-editor/react'
import type { editor as MonacoEditor } from 'monaco-editor'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ConversationArtifact,
  ConversationArtifactAction,
  ConversationArtifactActionType,
  ConversationArtifactDetails,
  CreateConversationArtifactActionResponse,
  CreateConversationArtifactRevisionResponse,
  GetConversationArtifactContentResponse,
} from '../lib/api'
import { ApiRequestError, apiRequest, apiUrl } from '../lib/api'
import { formatTime } from '../lib/format'
import { MessageContent } from './MessageContent'

interface ArtifactWorkspaceProps {
  artifacts: ConversationArtifact[]
  activeArtifactId?: string | null
  onActiveArtifactChange?: (artifactId: string) => void
  onRefreshArtifacts?: () => void
}

function languageFromFilename(filename: string): string {
  const extension = filename.split('.').pop()?.toLowerCase()

  switch (extension) {
    case 'css':
      return 'css'
    case 'html':
      return 'html'
    case 'js':
    case 'mjs':
    case 'cjs':
      return 'javascript'
    case 'json':
      return 'json'
    case 'md':
    case 'markdown':
      return 'markdown'
    case 'ts':
      return 'typescript'
    case 'tsx':
      return 'typescript'
    case 'jsx':
      return 'javascript'
    case 'yml':
    case 'yaml':
      return 'yaml'
    default:
      return 'plaintext'
  }
}

function readMetadataString(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = metadata?.[key]

  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function previewUrlFromActions(actions: ConversationArtifactAction[]): string | undefined {
  const action = actions.find(
    (candidate) =>
      candidate.type === 'preview' &&
      candidate.status === 'succeeded' &&
      typeof candidate.result?.previewUrl === 'string',
  )

  return action?.result?.previewUrl as string | undefined
}

export function ArtifactWorkspace({
  artifacts,
  activeArtifactId,
  onActiveArtifactChange,
  onRefreshArtifacts,
}: ArtifactWorkspaceProps) {
  const selectedArtifactId = activeArtifactId ?? artifacts[0]?.id ?? null
  const selectedArtifact = useMemo(
    () => artifacts.find((artifact) => artifact.id === selectedArtifactId) ?? artifacts[0] ?? null,
    [artifacts, selectedArtifactId],
  )
  const [details, setDetails] = useState<ConversationArtifactDetails | null>(null)
  const [content, setContent] = useState('')
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [runningAction, setRunningAction] = useState<ConversationArtifactActionType | null>(null)
  const [leftInfoPanel, setLeftInfoPanel] = useState<'metadata' | 'history' | null>(null)
  const markdownEditorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const markdownScrollDisposableRef = useRef<{ dispose: () => void } | null>(null)
  const markdownContentDisposableRef = useRef<{ dispose: () => void } | null>(null)
  const markdownPreviewRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (selectedArtifact === null) {
      return
    }

    let cancelled = false

    Promise.all([
      apiRequest<ConversationArtifactDetails>(`/artifacts/${selectedArtifact.id}`),
      apiRequest<GetConversationArtifactContentResponse>(`/artifacts/${selectedArtifact.id}/content`),
    ])
      .then(([detailsResponse, contentResponse]) => {
        if (cancelled) {
          return
        }

        setDetails(detailsResponse)
        setContent(contentResponse.content)
        setDraft(contentResponse.content)
        setError(null)
      })
      .catch((loadError: unknown) => {
        if (cancelled) {
          return
        }

        setError(loadError instanceof ApiRequestError ? loadError.message : 'Unable to load artifact.')
      })

    return () => {
      cancelled = true
    }
  }, [selectedArtifact])

  const isLoading = selectedArtifact !== null && details?.artifact.id !== selectedArtifact.id && error === null
  const artifact = isLoading ? selectedArtifact : details?.artifact ?? selectedArtifact
  const availableActions = details?.availableActions ?? []
  const rawPreviewUrl =
    previewUrlFromActions(details?.actions ?? []) ??
    readMetadataString(artifact?.metadata, 'previewUrl')
  const previewUrl = artifact !== null && (artifact.kind === 'web_preview' || rawPreviewUrl !== undefined)
    ? apiUrl(`/artifacts/${artifact.id}/preview/`)
    : undefined
  const canEdit =
    artifact !== null &&
    (artifact.kind === 'file' || artifact.kind === 'report' || artifact.kind === 'document')
  const isMarkdown = artifact?.kind === 'report' || artifact?.kind === 'document' || languageFromFilename(artifact?.filename ?? '') === 'markdown'
  const originalDiff = readMetadataString(artifact?.metadata, 'originalContent') ?? ''

  const syncMarkdownPreviewScroll = useCallback(() => {
    const editor = markdownEditorRef.current
    const preview = markdownPreviewRef.current

    if (editor === null || preview === null) {
      return
    }

    const editorScrollMax = Math.max(0, editor.getScrollHeight() - editor.getLayoutInfo().height)
    const previewScrollMax = Math.max(0, preview.scrollHeight - preview.clientHeight)

    if (editorScrollMax === 0 || previewScrollMax === 0) {
      preview.scrollTop = 0
      return
    }

    preview.scrollTop = (editor.getScrollTop() / editorScrollMax) * previewScrollMax
  }, [])

  const handleMarkdownEditorMount = useCallback(
    (editor: MonacoEditor.IStandaloneCodeEditor) => {
      markdownScrollDisposableRef.current?.dispose()
      markdownContentDisposableRef.current?.dispose()
      markdownEditorRef.current = editor
      markdownScrollDisposableRef.current = editor.onDidScrollChange(syncMarkdownPreviewScroll)
      markdownContentDisposableRef.current = editor.onDidContentSizeChange(syncMarkdownPreviewScroll)
      requestAnimationFrame(syncMarkdownPreviewScroll)
    },
    [syncMarkdownPreviewScroll],
  )

  useEffect(() => {
    if (!isMarkdown) {
      markdownScrollDisposableRef.current?.dispose()
      markdownContentDisposableRef.current?.dispose()
      markdownScrollDisposableRef.current = null
      markdownContentDisposableRef.current = null
      markdownEditorRef.current = null
      return
    }

    const preview = markdownPreviewRef.current

    if (preview === null) {
      return
    }

    requestAnimationFrame(syncMarkdownPreviewScroll)
    const resizeObserver = new ResizeObserver(syncMarkdownPreviewScroll)
    resizeObserver.observe(preview)

    return () => {
      resizeObserver.disconnect()
    }
  }, [draft, isMarkdown, selectedArtifactId, syncMarkdownPreviewScroll])

  useEffect(
    () => () => {
      markdownScrollDisposableRef.current?.dispose()
      markdownContentDisposableRef.current?.dispose()
    },
    [],
  )

  const saveRevision = async () => {
    if (artifact === null || draft === content) {
      return
    }

    setIsSaving(true)
    setError(null)
    try {
      await apiRequest<CreateConversationArtifactRevisionResponse>(`/artifacts/${artifact.id}/revisions`, {
        method: 'POST',
        body: JSON.stringify({
          content: draft,
          summary: 'Saved from Artifact workspace',
        }),
      })
      const detailsResponse = await apiRequest<ConversationArtifactDetails>(`/artifacts/${artifact.id}`)
      setDetails(detailsResponse)
      setContent(draft)
      onRefreshArtifacts?.()
    } catch (saveError) {
      setError(saveError instanceof ApiRequestError ? saveError.message : 'Unable to save revision.')
    } finally {
      setIsSaving(false)
    }
  }

  const createAction = async (type: ConversationArtifactActionType) => {
    if (artifact === null) {
      return
    }

    setRunningAction(type)
    setError(null)
    try {
      const response = await apiRequest<CreateConversationArtifactActionResponse>(
        `/artifacts/${artifact.id}/actions/${type}`,
        {
          method: 'POST',
          body: JSON.stringify({}),
        },
      )
      setDetails((current) =>
        current === null
          ? current
          : {
              ...current,
              actions: [response.action, ...current.actions],
            },
      )
    } catch (actionError) {
      setError(actionError instanceof ApiRequestError ? actionError.message : `Unable to start ${type}.`)
    } finally {
      setRunningAction(null)
    }
  }

  if (artifacts.length === 0) {
    return (
      <div className="grid min-h-80 place-items-center content-center gap-2 text-center text-[var(--cds-text-primary)]">
        <Launch size={32} />
        <h2 className="cds--type-heading-compact-02">No artifacts yet</h2>
        <p className="max-w-[28rem] text-[var(--cds-text-secondary)]">
          Agent reports, diffs, previews, and deployment records will appear here.
        </p>
      </div>
    )
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-[18rem_minmax(0,1fr)] overflow-hidden border border-[var(--cds-border-subtle-01)] bg-[var(--cds-background)] max-[1055px]:grid-cols-1">
      <aside className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] border-r border-[var(--cds-border-subtle-01)] bg-[var(--cds-layer-01)] max-[1055px]:border-b max-[1055px]:border-r-0">
        <div className="border-b border-[var(--cds-border-subtle-01)] p-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--cds-text-secondary)]">
            Artifacts ({artifacts.length})
          </h2>
        </div>
        <div className="grid content-start overflow-y-auto p-2 max-[1055px]:max-h-56">
          {artifacts.map((item) => {
            const selected = item.id === artifact?.id

            return (
              <button
                key={item.id}
                type="button"
                className={`grid cursor-pointer gap-1 border p-2 text-left text-sm focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--cds-focus)] ${
                  selected
                    ? 'border-[var(--cds-border-strong-01)] bg-[var(--cds-layer-selected-01)] text-[var(--cds-text-primary)]'
                    : 'border-transparent bg-transparent text-[var(--cds-text-secondary)] hover:bg-[var(--cds-layer-hover-01)]'
                }`}
                onClick={() => onActiveArtifactChange?.(item.id)}
              >
                <span className="truncate font-semibold">{item.title}</span>
                <span className="truncate text-xs">{item.filename}</span>
                <span className="w-fit border border-[var(--cds-border-subtle-01)] px-1.5 py-0.5 text-[0.7rem] uppercase">
                  {item.kind}
                </span>
              </button>
            )
          })}
        </div>
        <div className="grid self-end border-t border-[var(--cds-border-subtle-01)]">
          {leftInfoPanel === 'metadata' && (
            <section className="grid max-h-72 gap-1 overflow-y-auto border-b border-[var(--cds-border-subtle-01)] p-3 text-sm">
              <h3 className="text-xs font-semibold uppercase text-[var(--cds-text-secondary)]">Metadata</h3>
              <p className="truncate text-[var(--cds-text-primary)]">{artifact?.kind}</p>
              <p className="text-[var(--cds-text-secondary)]">{artifact ? Math.max(1, Math.ceil(artifact.sizeBytes / 1024)) : 0} KB</p>
              {artifact && <p className="text-[var(--cds-text-secondary)]">Updated {formatTime(artifact.updatedAt)}</p>}
            </section>
          )}
          {leftInfoPanel === 'history' && (
            <section className="grid max-h-72 gap-2 overflow-y-auto border-b border-[var(--cds-border-subtle-01)] p-3">
              <h3 className="text-xs font-semibold uppercase text-[var(--cds-text-secondary)]">History</h3>
              {(details?.actions ?? []).length === 0 ? (
                <p className="text-sm text-[var(--cds-text-secondary)]">No actions yet.</p>
              ) : (
                <div className="grid gap-2">
                  {(details?.actions ?? []).map((action) => (
                    <div key={action.id} className="grid gap-1 border border-[var(--cds-border-subtle-01)] p-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold uppercase text-[var(--cds-text-primary)]">{action.type}</span>
                        <span className="text-[var(--cds-text-secondary)]">{action.status}</span>
                      </div>
                      <time className="text-[var(--cds-text-secondary)]" dateTime={action.updatedAt}>
                        {formatTime(action.updatedAt)}
                      </time>
                      {action.error && <p className="text-[var(--cds-text-error)]">{action.error}</p>}
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
          <div className="grid grid-cols-2">
            {(['metadata', 'history'] as const).map((panel) => (
              <button
                key={panel}
                type="button"
                className={`min-h-10 cursor-pointer border-0 border-r border-[var(--cds-border-subtle-01)] px-3 text-left text-xs font-semibold uppercase focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--cds-focus)] last:border-r-0 ${
                  leftInfoPanel === panel
                    ? 'bg-[var(--cds-layer-selected-01)] text-[var(--cds-text-primary)]'
                    : 'bg-transparent text-[var(--cds-text-secondary)] hover:bg-[var(--cds-layer-hover-01)] hover:text-[var(--cds-text-primary)]'
                }`}
                onClick={() =>
                  setLeftInfoPanel((current) => current === panel ? null : panel)
                }
              >
                {panel}
              </button>
            ))}
          </div>
        </div>
      </aside>

      <main className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)]">
        <div className="flex min-w-0 items-center justify-between gap-3 border-b border-[var(--cds-border-subtle-01)] p-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-[var(--cds-text-primary)]">
              {artifact?.title ?? 'Artifact'}
            </h2>
            <p className="truncate text-sm text-[var(--cds-text-secondary)]">
              {artifact?.filename}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <IconButton
              kind="ghost"
              label="Apply"
              size="md"
              align="bottom"
              disabled={!availableActions.includes('apply') || runningAction !== null}
              onClick={() => createAction('apply')}
            >
              <Play size={16} />
            </IconButton>
            <IconButton
              kind="ghost"
              label="Preview"
              size="md"
              align="bottom"
              disabled={!availableActions.includes('preview') || runningAction !== null}
              onClick={() => createAction('preview')}
            >
              <Launch size={16} />
            </IconButton>
            <IconButton
              kind="ghost"
              label="Publish"
              size="md"
              align="bottom"
              disabled={!availableActions.includes('publish') || runningAction !== null}
              onClick={() => createAction('publish')}
            >
              <Rocket size={16} />
            </IconButton>
            {runningAction && <InlineLoading description={`Queueing ${runningAction}...`} status="active" />}
            <IconButton
              kind="ghost"
              label="Download"
              size="md"
              align="bottom"
              disabled={!artifact?.downloadUrl}
              onClick={() => {
                if (artifact?.downloadUrl) {
                  window.location.assign(artifact.downloadUrl)
                }
              }}
            >
              <Download size={16} />
            </IconButton>
            <Button
              kind="primary"
              size="sm"
              renderIcon={Save}
              disabled={!canEdit || draft === content || isSaving}
              onClick={saveRevision}
            >
              Save revision
            </Button>
          </div>
        </div>

        <div className="min-h-0 overflow-hidden">
          {error && (
            <InlineNotification
              kind="error"
              title="Artifact action failed"
              subtitle={error}
              lowContrast
              hideCloseButton
            />
          )}
          {isLoading ? (
            <div className="grid h-full place-items-center">
              <InlineLoading description="Loading artifact..." status="active" />
            </div>
          ) : artifact?.kind === 'web_preview' ? (
            previewUrl ? (
              <iframe
                className="h-full min-h-0 w-full border-0 bg-white"
                src={previewUrl}
                title={artifact.title}
              />
            ) : (
              <div className="grid h-full min-h-0 place-items-center text-[var(--cds-text-secondary)]">
                Start Preview to create a preview URL.
              </div>
            )
          ) : artifact?.kind === 'diff' ? (
            <DiffEditor
              height="100%"
              original={originalDiff}
              modified={draft}
              language={languageFromFilename(artifact.filename)}
              options={{ readOnly: true, minimap: { enabled: false } }}
            />
          ) : isMarkdown ? (
            <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] overflow-hidden max-[1055px]:grid-cols-1">
              <div className="min-h-0 min-w-0 overflow-hidden">
                <Editor
                  height="100%"
                  language="markdown"
                  value={draft}
                  options={{ minimap: { enabled: false }, readOnly: !canEdit, wordWrap: 'on' }}
                  onMount={handleMarkdownEditorMount}
                  onChange={(value) => setDraft(value ?? '')}
                />
              </div>
              <div className="min-h-0 min-w-0 overflow-hidden border-l border-[var(--cds-border-subtle-01)] max-[1055px]:border-l-0 max-[1055px]:border-t">
                <div ref={markdownPreviewRef} className="h-full min-h-0 overflow-y-auto p-3">
                  <MessageContent className="block text-sm leading-5" content={draft} />
                </div>
              </div>
            </div>
          ) : (
            <Editor
              height="100%"
              language={languageFromFilename(artifact?.filename ?? '')}
              value={draft}
              options={{ minimap: { enabled: false }, readOnly: !canEdit, wordWrap: 'on' }}
              onChange={(value) => setDraft(value ?? '')}
            />
          )}
        </div>
      </main>
    </div>
  )
}
