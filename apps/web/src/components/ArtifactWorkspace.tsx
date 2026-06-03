import { Button, IconButton, InlineLoading, InlineNotification } from '@carbon/react'
import { ChevronDown, ChevronRight, Close, Code, Document, FileDiff, Folder, FolderOpen, Html, Image, Json, Zip, Download, Launch, Play, Rocket, Save } from '@carbon/react/icons'
import Editor, { DiffEditor } from '@monaco-editor/react'
import type { editor as MonacoEditor } from 'monaco-editor'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ConversationArtifact,
  ConversationArtifactFile,
  ConversationArtifactActionType,
  ConversationArtifactDetails,
  CreateConversationArtifactFileRevisionResponse,
  CreateConversationArtifactActionResponse,
  CreateConversationArtifactRevisionResponse,
  GetConversationArtifactFileContentResponse,
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
  onRefreshDeployments?: () => void
}

type ArtifactFileCategory = 'html' | 'markdown' | 'diff' | 'image' | 'text' | 'binary'

interface ArtifactFileInfo {
  category: ArtifactFileCategory
  label: string
  language: string
  canEdit: boolean
  canPreview: boolean
}

interface SiteTreeNode {
  children: SiteTreeNode[]
  file?: ConversationArtifactFile
  id: string
  name: string
  path: string
  type: 'directory' | 'file'
}

const imageExtensions = new Set(['avif', 'gif', 'jpeg', 'jpg', 'png', 'svg', 'webp'])
const textLanguages: Record<string, string> = {
  bash: 'shell',
  c: 'c',
  cc: 'cpp',
  cjs: 'javascript',
  cpp: 'cpp',
  cs: 'csharp',
  css: 'css',
  csv: 'plaintext',
  env: 'plaintext',
  go: 'go',
  h: 'c',
  hpp: 'cpp',
  ini: 'ini',
  java: 'java',
  js: 'javascript',
  json: 'json',
  jsx: 'javascript',
  mjs: 'javascript',
  py: 'python',
  rs: 'rust',
  sh: 'shell',
  sql: 'sql',
  toml: 'toml',
  ts: 'typescript',
  tsx: 'typescript',
  txt: 'plaintext',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  zsh: 'shell',
}

function extensionFromFilename(filename: string): string {
  const extension = filename.split('.').pop()?.toLowerCase()

  return extension && extension !== filename.toLowerCase() ? extension : ''
}

function inferArtifactFileInfo(filename: string): ArtifactFileInfo {
  const extension = extensionFromFilename(filename)

  switch (extension) {
    case 'html':
    case 'htm':
      return {
        category: 'html',
        label: 'HTML',
        language: 'html',
        canEdit: true,
        canPreview: true,
      }
    case 'md':
    case 'markdown':
    case 'mdx':
      return {
        category: 'markdown',
        label: 'Markdown',
        language: 'markdown',
        canEdit: true,
        canPreview: true,
      }
    case 'diff':
    case 'patch':
      return {
        category: 'diff',
        label: 'Diff',
        language: 'diff',
        canEdit: false,
        canPreview: true,
      }
  }

  if (imageExtensions.has(extension)) {
    return {
      category: 'image',
      label: 'Image',
      language: 'plaintext',
      canEdit: false,
      canPreview: true,
    }
  }

  const language = textLanguages[extension]

  return language === undefined
    ? {
        category: 'binary',
        label: 'File',
        language: 'plaintext',
        canEdit: false,
        canPreview: false,
      }
    : {
        category: 'text',
        label: 'File',
        language,
        canEdit: true,
        canPreview: false,
      }
}

function shouldLoadArtifactContent(filename: string): boolean {
  const fileInfo = inferArtifactFileInfo(filename)

  return fileInfo.category === 'markdown' || fileInfo.category === 'diff' || fileInfo.category === 'text'
}

function shouldLoadSiteFileContent(filename: string): boolean {
  const fileInfo = inferArtifactFileInfo(filename)

  return (
    fileInfo.category === 'html' ||
    fileInfo.category === 'markdown' ||
    fileInfo.category === 'diff' ||
    fileInfo.category === 'text'
  )
}

function parseUnifiedDiff(content: string): {
  language: string
  modified: string
  original: string
} {
  const originalLines: string[] = []
  const modifiedLines: string[] = []
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const targetFile = lines
    .find((line) => line.startsWith('+++ ') && !line.startsWith('+++ /dev/null'))
    ?.replace(/^\+\+\+\s+(?:b\/)?/, '')
    .trim()
  let sawHunk = false

  for (const line of lines) {
    if (
      line.startsWith('diff --git ') ||
      line.startsWith('index ') ||
      line.startsWith('new file mode ') ||
      line.startsWith('deleted file mode ') ||
      line.startsWith('similarity index ') ||
      line.startsWith('rename from ') ||
      line.startsWith('rename to ') ||
      line.startsWith('--- ') ||
      line.startsWith('+++ ')
    ) {
      continue
    }

    if (line.startsWith('@@')) {
      sawHunk = true
      continue
    }

    if (!sawHunk || line.startsWith('\\ No newline')) {
      continue
    }

    if (line.startsWith('+')) {
      modifiedLines.push(line.slice(1))
      continue
    }

    if (line.startsWith('-')) {
      originalLines.push(line.slice(1))
      continue
    }

    const contextLine = line.startsWith(' ') ? line.slice(1) : line
    originalLines.push(contextLine)
    modifiedLines.push(contextLine)
  }

  if (!sawHunk || (originalLines.length === 0 && modifiedLines.length === 0)) {
    return {
      language: 'diff',
      modified: content,
      original: '',
    }
  }

  return {
    language: inferArtifactFileInfo(targetFile ?? '').language,
    modified: modifiedLines.join('\n'),
    original: originalLines.join('\n'),
  }
}

function ArtifactFileIcon({ fileInfo }: { fileInfo: ArtifactFileInfo }) {
  switch (fileInfo.category) {
    case 'html':
      return <Html size={18} />
    case 'markdown':
      return <Document size={18} />
    case 'diff':
      return <FileDiff size={18} />
    case 'image':
      return <Image size={18} />
    case 'text':
      return fileInfo.language === 'json'
        ? <Json size={18} />
        : <Code size={18} />
    case 'binary':
      return fileInfo.label === 'Archive'
        ? <Zip size={18} />
        : <Document size={18} />
  }
}

function buildSiteFileTree(files: ConversationArtifactFile[]): SiteTreeNode[] {
  const root: SiteTreeNode[] = []

  for (const file of files) {
    const parts = file.path.split('/').filter(Boolean)
    let current = root
    let currentPath = ''

    parts.forEach((part, index) => {
      currentPath = currentPath.length === 0 ? part : `${currentPath}/${part}`
      const isFile = index === parts.length - 1
      let node = current.find((child) => child.name === part)

      if (node === undefined) {
        node = {
          children: [],
          id: isFile ? file.id : `dir:${currentPath}`,
          name: part,
          path: currentPath,
          type: isFile ? 'file' : 'directory',
        }
        current.push(node)
      }

      if (isFile) {
        node.file = file
        node.id = file.id
        node.type = 'file'
      } else {
        current = node.children
      }
    })
  }

  return sortSiteTreeNodes(root)
}

function sortSiteTreeNodes(nodes: SiteTreeNode[]): SiteTreeNode[] {
  return nodes
    .map((node) => ({
      ...node,
      children: sortSiteTreeNodes(node.children),
    }))
    .sort((left, right) => {
      if (left.type !== right.type) {
        return left.type === 'directory' ? -1 : 1
      }

      return left.name.localeCompare(right.name)
    })
}

function expandedDirectoriesForPath(filePath: string): string[] {
  const parts = filePath.split('/').filter(Boolean)

  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'))
}

export function ArtifactWorkspace({
  artifacts,
  activeArtifactId,
  onActiveArtifactChange,
  onRefreshArtifacts,
  onRefreshDeployments,
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
  const [actionNotice, setActionNotice] = useState<{
    kind: 'success' | 'info'
    title: string
    subtitle: string
    url?: string
  } | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [runningAction, setRunningAction] = useState<ConversationArtifactActionType | null>(null)
  const [leftInfoPanel, setLeftInfoPanel] = useState<'details' | 'history' | null>(null)
  const [activeSiteFilePath, setActiveSiteFilePath] = useState<string | null>(null)
  const [activeSiteFile, setActiveSiteFile] = useState<ConversationArtifactFile | null>(null)
  const [expandedSiteDirectories, setExpandedSiteDirectories] = useState<Set<string>>(() => new Set())
  const activeSiteFilePathRef = useRef<string | null>(null)
  const markdownEditorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const markdownScrollDisposableRef = useRef<{ dispose: () => void } | null>(null)
  const markdownContentDisposableRef = useRef<{ dispose: () => void } | null>(null)
  const markdownPreviewRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    activeSiteFilePathRef.current = activeSiteFilePath
  }, [activeSiteFilePath])

  useEffect(() => {
    if (selectedArtifact === null) {
      return
    }

    let cancelled = false

    const contentRequest = selectedArtifact.kind !== 'site' && shouldLoadArtifactContent(selectedArtifact.filename)
      ? apiRequest<GetConversationArtifactContentResponse>(`/artifacts/${selectedArtifact.id}/content`)
      : Promise.resolve({ content: '' })

    Promise.all([
      apiRequest<ConversationArtifactDetails>(`/artifacts/${selectedArtifact.id}`),
      contentRequest,
    ])
      .then(([detailsResponse, contentResponse]) => {
        if (cancelled) {
          return
        }

        setDetails(detailsResponse)
        setActionNotice(null)
        if (detailsResponse.artifact.kind === 'site') {
          const currentPath = activeSiteFilePathRef.current
          const nextPath = detailsResponse.files?.some((file) => file.path === currentPath)
            ? currentPath
            : detailsResponse.artifact.entrypoint ?? detailsResponse.files?.[0]?.path ?? null
          setActiveSiteFilePath(nextPath)
          if (nextPath !== null) {
            setExpandedSiteDirectories((current) => {
              const next = new Set(current)
              for (const directory of expandedDirectoriesForPath(nextPath)) {
                next.add(directory)
              }

              return next
            })
          }
          if (nextPath !== currentPath) {
            setActiveSiteFile(null)
            setContent('')
            setDraft('')
          }
        } else {
          setActiveSiteFilePath(null)
          setActiveSiteFile(null)
          setContent(contentResponse.content)
          setDraft(contentResponse.content)
        }
        setError(null)
      })
      .catch((loadError: unknown) => {
        if (cancelled) {
          return
        }

        setError(loadError instanceof ApiRequestError ? loadError.message : 'Unable to load file.')
      })

    return () => {
      cancelled = true
    }
  }, [selectedArtifact?.filename, selectedArtifact?.id, selectedArtifact?.kind])

  const isLoading = selectedArtifact !== null && details?.artifact.id !== selectedArtifact.id && error === null
  const artifact = isLoading ? selectedArtifact : details?.artifact ?? selectedArtifact

  useEffect(() => {
    if (artifact?.kind !== 'site' || activeSiteFilePath === null) {
      return
    }

    if (!shouldLoadSiteFileContent(activeSiteFilePath)) {
      return
    }

    let cancelled = false

    apiRequest<GetConversationArtifactFileContentResponse>(
      `/artifacts/${artifact.id}/files/content?path=${encodeURIComponent(activeSiteFilePath)}`,
    )
      .then((response) => {
        if (cancelled) {
          return
        }

        setActiveSiteFile(response.file)
        setContent(response.content)
        setDraft(response.content)
        setError(null)
      })
      .catch((loadError: unknown) => {
        if (cancelled) {
          return
        }

        setError(loadError instanceof ApiRequestError ? loadError.message : 'Unable to load site file.')
      })

    return () => {
      cancelled = true
    }
  }, [activeSiteFilePath, artifact?.id, artifact?.kind, details?.files])

  const availableActions = details?.availableActions ?? []
  const activeFilename = artifact?.kind === 'site'
    ? activeSiteFilePath ?? artifact.filename
    : artifact?.filename ?? ''
  const fileInfo = inferArtifactFileInfo(activeFilename)
  const siteFiles = useMemo(
    () => artifact?.kind === 'site' ? details?.files ?? [] : [],
    [artifact?.kind, details?.files],
  )
  const siteFileTree = useMemo(() => buildSiteFileTree(siteFiles), [siteFiles])
  const selectedSiteFile = useMemo(
    () =>
      artifact?.kind === 'site' && activeSiteFilePath !== null
        ? siteFiles.find((file) => file.path === activeSiteFilePath) ?? null
        : null,
    [activeSiteFilePath, artifact?.kind, siteFiles],
  )
  const displayedSiteFile = activeSiteFile ?? selectedSiteFile
  const siteFileRawUrl = artifact?.kind === 'site' && activeSiteFilePath !== null
    ? apiUrl(`/artifacts/${artifact.id}/files/raw?path=${encodeURIComponent(activeSiteFilePath)}`)
    : undefined
  const previewUrl = artifact !== null && artifact.kind !== 'site' && fileInfo.canPreview
    ? apiUrl(`/artifacts/${artifact.id}/preview/`)
    : undefined
  const canEdit = artifact !== null && fileInfo.canEdit
  const isMarkdown = fileInfo.category === 'markdown'
  const parsedDiff = useMemo(
    () => (fileInfo.category === 'diff' ? parseUnifiedDiff(draft) : null),
    [draft, fileInfo.category],
  )

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
      if (artifact.kind === 'site') {
        if (activeSiteFilePath === null) {
          return
        }

        await apiRequest<CreateConversationArtifactFileRevisionResponse>(`/artifacts/${artifact.id}/files/revisions`, {
          method: 'POST',
          body: JSON.stringify({
            content: draft,
            path: activeSiteFilePath,
            summary: 'Saved from Files workspace',
          }),
        })
      } else {
        await apiRequest<CreateConversationArtifactRevisionResponse>(`/artifacts/${artifact.id}/revisions`, {
          method: 'POST',
          body: JSON.stringify({
            content: draft,
            summary: 'Saved from Files workspace',
          }),
        })
      }
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
    setActionNotice(null)
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
      if (response.action.status === 'failed') {
        setError(response.action.error ?? `Unable to complete ${type}.`)
        return
      }
      if (type === 'publish') {
        const detailsResponse = await apiRequest<ConversationArtifactDetails>(`/artifacts/${artifact.id}`)
        setDetails(detailsResponse)
        onRefreshDeployments?.()
        if (response.deployment?.url) {
          setActionNotice({
            kind: 'success',
            title: 'Site published',
            subtitle: `Published ${response.deployment.title}.`,
            url: response.deployment.url,
          })
        } else {
          setActionNotice({
            kind: 'info',
            title: 'Publish queued',
            subtitle: 'The publish action has been queued.',
          })
        }
      } else {
        setActionNotice({
          kind: 'info',
          title: 'Action queued',
          subtitle: `${type} has been queued.`,
        })
      }
    } catch (actionError) {
      setError(actionError instanceof ApiRequestError ? actionError.message : `Unable to start ${type}.`)
    } finally {
      setRunningAction(null)
    }
  }

  const selectSiteFile = (filePath: string) => {
    setActiveSiteFilePath(filePath)
    if (!shouldLoadSiteFileContent(filePath)) {
      setActiveSiteFile(siteFiles.find((file) => file.path === filePath) ?? null)
      setContent('')
      setDraft('')
      setError(null)
    } else {
      setActiveSiteFile(null)
    }
    setExpandedSiteDirectories((current) => {
      const next = new Set(current)
      for (const directory of expandedDirectoriesForPath(filePath)) {
        next.add(directory)
      }

      return next
    })
  }

  const toggleSiteDirectory = (directoryPath: string) => {
    setExpandedSiteDirectories((current) => {
      const next = new Set(current)

      if (next.has(directoryPath)) {
        next.delete(directoryPath)
      } else {
        next.add(directoryPath)
      }

      return next
    })
  }

  const renderSiteTreeNodes = (nodes: SiteTreeNode[], depth = 0) =>
    nodes.map((node) => {
      const isDirectory = node.type === 'directory'
      const expanded = expandedSiteDirectories.has(node.path)
      const selected = node.type === 'file' && node.path === activeSiteFilePath
      const itemFileInfo = node.file === undefined ? null : inferArtifactFileInfo(node.file.path)

      return (
        <div key={node.id}>
          <button
            type="button"
            className={`grid w-full cursor-pointer grid-cols-[1.25rem_1.25rem_minmax(0,1fr)] items-center gap-1 border p-2 text-left text-xs focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--cds-focus)] ${
              selected
                ? 'border-[var(--cds-border-strong-01)] bg-[var(--cds-layer-selected-01)] text-[var(--cds-text-primary)]'
                : 'border-transparent bg-transparent text-[var(--cds-text-secondary)] hover:bg-[var(--cds-layer-hover-01)] hover:text-[var(--cds-text-primary)]'
            }`}
            style={{ paddingLeft: `${0.5 + depth * 0.875}rem` }}
            onClick={() => {
              if (isDirectory) {
                toggleSiteDirectory(node.path)
              } else {
                selectSiteFile(node.path)
              }
            }}
          >
            <span className="grid size-5 place-items-center text-[var(--cds-icon-secondary)]">
              {isDirectory ? (expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : null}
            </span>
            <span className="grid size-5 place-items-center text-[var(--cds-icon-secondary)]">
              {isDirectory
                ? expanded
                  ? <FolderOpen size={18} />
                  : <Folder size={18} />
                : itemFileInfo !== null
                  ? <ArtifactFileIcon fileInfo={itemFileInfo} />
                  : <Document size={18} />}
            </span>
            <span className="truncate font-medium">{node.name}</span>
          </button>
          {isDirectory && expanded && node.children.length > 0 && (
            <div>{renderSiteTreeNodes(node.children, depth + 1)}</div>
          )}
        </div>
      )
    })

  if (artifacts.length === 0) {
    return (
      <div className="grid min-h-80 place-items-center content-center gap-2 text-center text-[var(--cds-text-primary)]">
        <Launch size={32} />
        <h2 className="cds--type-heading-compact-02">No files yet</h2>
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
            Files ({artifacts.length})
          </h2>
        </div>
        <div className="grid content-start overflow-y-auto p-2 max-[1055px]:max-h-56">
          {artifacts.map((item) => {
            const selected = item.id === artifact?.id
            const itemFileInfo = item.kind === 'site'
              ? inferArtifactFileInfo(item.entrypoint ?? 'index.html')
              : inferArtifactFileInfo(item.filename)

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
                <span className="flex min-w-0 items-center gap-2">
                  <span className="grid size-5 shrink-0 place-items-center text-[var(--cds-icon-secondary)]">
                    <ArtifactFileIcon fileInfo={itemFileInfo} />
                  </span>
                  <span className="truncate font-semibold">{item.filename}</span>
                </span>
                {item.kind === 'site' && (
                  <span className="truncate pl-7 text-xs">
                    Site project · {item.fileCount ?? 0} files
                  </span>
                )}
                {item.title !== item.filename && (
                  <span className="truncate pl-7 text-xs">{item.title}</span>
                )}
              </button>
            )
          })}
          {artifact?.kind === 'site' && siteFileTree.length > 0 && (
            <div className="mt-3 border-t border-[var(--cds-border-subtle-01)] pt-3">
              <h3 className="mb-2 px-2 text-xs font-semibold uppercase text-[var(--cds-text-secondary)]">
                Site files
              </h3>
              <div className="grid gap-0.5">
                {renderSiteTreeNodes(siteFileTree)}
              </div>
            </div>
          )}
        </div>
        <div className="grid self-end border-t border-[var(--cds-border-subtle-01)]">
          {leftInfoPanel === 'details' && (
            <section className="grid max-h-72 gap-1 overflow-y-auto border-b border-[var(--cds-border-subtle-01)] p-3 text-sm">
              <h3 className="text-xs font-semibold uppercase text-[var(--cds-text-secondary)]">Details</h3>
              <p className="truncate text-[var(--cds-text-primary)]">{artifact?.kind === 'site' ? 'Site' : fileInfo.label}</p>
              <p className="truncate text-[var(--cds-text-secondary)]">{artifact?.kind === 'site' ? activeSiteFilePath ?? artifact.filename : artifact?.filename}</p>
              {artifact?.kind === 'site' && (
                <p className="text-[var(--cds-text-secondary)]">
                  {artifact.fileCount ?? 0} files · entry {artifact.entrypoint ?? 'index.html'}
                </p>
              )}
              <p className="text-[var(--cds-text-secondary)]">{artifact ? Math.max(1, Math.ceil((displayedSiteFile?.sizeBytes ?? artifact.sizeBytes) / 1024)) : 0} KB</p>
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
            {(['details', 'history'] as const).map((panel) => (
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
              {artifact?.title ?? 'File'}
            </h2>
            <p className="truncate text-sm text-[var(--cds-text-secondary)]">
              {artifact?.kind === 'site'
                ? activeSiteFilePath ?? artifact.filename
                : artifact?.filename}
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
              disabled
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
            {runningAction && (
              <InlineLoading
                description={runningAction === 'publish' ? 'Publishing site...' : `Queueing ${runningAction}...`}
                status="active"
              />
            )}
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
              title="File action failed"
              subtitle={error}
              lowContrast
              hideCloseButton
            />
          )}
          {actionNotice && (
            actionNotice.url ? (
              <div className="flex items-start justify-between gap-4 border-b border-[var(--cds-border-subtle-01)] bg-[var(--cds-layer-01)] px-4 py-3 text-sm">
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-semibold text-[var(--cds-text-primary)]">{actionNotice.title}</span>
                    <a
                      className="font-semibold text-[var(--cds-link-primary)] underline"
                      href={actionNotice.url}
                      rel="noreferrer"
                      target="_blank"
                    >
                      Open deployment
                    </a>
                  </div>
                  <p className="mt-1 text-[var(--cds-text-secondary)]">{actionNotice.subtitle}</p>
                </div>
                <button
                  type="button"
                  className="grid size-8 shrink-0 cursor-pointer place-items-center border-0 bg-transparent text-[var(--cds-icon-secondary)] hover:bg-[var(--cds-layer-hover-01)] hover:text-[var(--cds-icon-primary)]"
                  aria-label="Dismiss notification"
                  onClick={() => setActionNotice(null)}
                >
                  <Close size={16} />
                </button>
              </div>
            ) : (
              <InlineNotification
                kind={actionNotice.kind}
                title={actionNotice.title}
                subtitle={actionNotice.subtitle}
                lowContrast
                onClose={() => setActionNotice(null)}
              />
            )
          )}
          {isLoading ? (
            <div className="grid h-full place-items-center">
              <InlineLoading description="Loading file..." status="active" />
            </div>
          ) : artifact === null ? (
            <div className="grid h-full min-h-0 place-items-center text-[var(--cds-text-secondary)]">
              Select a file.
            </div>
          ) : fileInfo.category === 'html' && artifact.kind !== 'site' ? (
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
          ) : fileInfo.category === 'image' ? (
            previewUrl || siteFileRawUrl ? (
              <div className="grid h-full min-h-0 place-items-center overflow-auto bg-[var(--cds-layer-01)] p-3">
                <img
                  alt={artifact.kind === 'site' ? activeSiteFilePath ?? artifact.title : artifact.title}
                  className="max-h-full max-w-full object-contain"
                  src={siteFileRawUrl ?? previewUrl}
                />
              </div>
            ) : (
              <div className="grid h-full min-h-0 place-items-center text-[var(--cds-text-secondary)]">
                Preview is not available.
              </div>
            )
          ) : fileInfo.category === 'diff' ? (
            <DiffEditor
              height="100%"
              original={parsedDiff?.original ?? ''}
              modified={parsedDiff?.modified ?? draft}
              language={parsedDiff?.language ?? 'plaintext'}
              options={{
                automaticLayout: true,
                minimap: { enabled: false },
                readOnly: true,
                renderSideBySide: true,
                wordWrap: 'on',
              }}
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
            fileInfo.category === 'text' || (artifact.kind === 'site' && fileInfo.category === 'html') ? (
              <Editor
                height="100%"
                language={fileInfo.language}
                value={draft}
                options={{ minimap: { enabled: false }, readOnly: !canEdit, wordWrap: 'on' }}
                onChange={(value) => setDraft(value ?? '')}
              />
            ) : (
              <div className="grid h-full min-h-0 place-items-center content-center gap-2 text-center text-[var(--cds-text-secondary)]">
                <Download size={32} />
                <p>This file cannot be previewed inline.</p>
              </div>
            )
          )}
        </div>
      </main>
    </div>
  )
}
