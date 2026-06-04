import { Button, InlineLoading, InlineNotification, Tag } from '@carbon/react'
import { ChevronDown, ChevronRight, Code, Document, FileDiff, Folder, FolderOpen, Image, Json, Save, Zip } from '@carbon/react/icons'
import { inferArtifactFileInfo } from '@agent-hub/core'
import Editor, { DiffEditor } from '@monaco-editor/react'
import { useEffect, useMemo, useState } from 'react'
import type {
  AgentDetails,
  Conversation,
  ConversationProjectChange,
  GetProjectChangeFileContentResponse,
  GetProjectFileContentResponse,
  ListConversationProjectChangesResponse,
  ListProjectChangeFilesResponse,
  ListProjectFilesResponse,
  ProjectChangedFile,
  ProjectFileEntry,
  UpdateProjectFileContentResponse,
} from '../lib/api'
import { apiRequest, apiUrl } from '../lib/api'

type ProjectWorkspaceMode = 'code' | 'changes'

type TreeFile = ProjectFileEntry | ProjectChangedFile
const emptyChangedFiles: ProjectChangedFile[] = []

interface ProjectTreeNode {
  children: ProjectTreeNode[]
  file?: TreeFile
  id: string
  name: string
  path: string
  type: 'directory' | 'file'
}

interface ProjectWorkspaceProps {
  agents: AgentDetails[]
  conversation: Conversation
}

function isProjectFileEntry(file: TreeFile): file is ProjectFileEntry {
  return 'type' in file
}

function buildProjectTree(files: TreeFile[]): ProjectTreeNode[] {
  const root: ProjectTreeNode[] = []

  for (const file of files) {
    const filePath = file.path
    const parts = filePath.split('/').filter(Boolean)
    const entryIsDirectory = isProjectFileEntry(file) && file.type === 'directory'
    let current = root
    let currentPath = ''

    parts.forEach((part, index) => {
      currentPath = currentPath.length === 0 ? part : `${currentPath}/${part}`
      const isLastPart = index === parts.length - 1
      const isFile = isLastPart && !entryIsDirectory
      let node = current.find((child) => child.name === part)

      if (node === undefined) {
        node = {
          children: [],
          id: isFile ? filePath : `dir:${currentPath}`,
          name: part,
          path: currentPath,
          type: isFile ? 'file' : 'directory',
        }
        current.push(node)
      }

      if (isFile) {
        node.file = file
        node.id = filePath
        node.type = 'file'
      }

      if (!isFile) {
        node.id = `dir:${currentPath}`
        node.type = 'directory'
        current = node.children
      }
    })
  }

  return sortProjectTree(root)
}

function sortProjectTree(nodes: ProjectTreeNode[]): ProjectTreeNode[] {
  return nodes
    .map((node) => ({ ...node, children: sortProjectTree(node.children) }))
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

function ProjectFileIcon({ path }: { path: string }) {
  const fileInfo = inferArtifactFileInfo({ filename: path })

  switch (fileInfo.category) {
    case 'html':
      return <Code size={16} />
    case 'diff':
      return <FileDiff size={16} />
    case 'image':
      return <Image size={16} />
    case 'markdown':
      return <Document size={16} />
    case 'text':
      return fileInfo.language === 'json' ? <Json size={16} /> : <Code size={16} />
    case 'binary':
      return fileInfo.label === 'Archive' ? <Zip size={16} /> : <Document size={16} />
  }
}

export function ProjectWorkspace({ agents, conversation }: ProjectWorkspaceProps) {
  const [mode, setMode] = useState<ProjectWorkspaceMode>('code')
  const [projectError, setProjectError] = useState<string | null>(null)
  const [files, setFiles] = useState<ProjectFileEntry[]>([])
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null)
  const [expandedCodeDirectories, setExpandedCodeDirectories] = useState<Set<string>>(() => new Set())
  const [fileContentByKey, setFileContentByKey] = useState<Record<string, string>>({})
  const [fileDraftByKey, setFileDraftByKey] = useState<Record<string, string>>({})
  const [isSavingFile, setIsSavingFile] = useState(false)
  const [changes, setChanges] = useState<ConversationProjectChange[]>([])
  const [activeChangeId, setActiveChangeId] = useState<string | null>(null)
  const [changeFilesById, setChangeFilesById] = useState<Record<string, ProjectChangedFile[]>>({})
  const [activeChangeFileById, setActiveChangeFileById] = useState<Record<string, string>>({})
  const [expandedChangeDirectories, setExpandedChangeDirectories] = useState<Set<string>>(() => new Set())
  const [changeContentByKey, setChangeContentByKey] = useState<Record<string, GetProjectChangeFileContentResponse>>({})

  const conversationId = conversation.id
  const fileContentKey = activeFilePath === null ? null : `${conversationId}:${activeFilePath}`
  const activeFileInfo = activeFilePath === null ? null : inferArtifactFileInfo({ filename: activeFilePath })
  const fileContent = fileContentKey === null ? '' : fileContentByKey[fileContentKey] ?? ''
  const fileDraft = fileContentKey === null ? '' : fileDraftByKey[fileContentKey] ?? fileContent
  const fileDirty = fileContentKey !== null && fileDraft !== fileContent
  const codeTree = useMemo(() => buildProjectTree(files), [files])
  const activeChange = changes.find((change) => change.id === activeChangeId) ?? null
  const activeChangeFiles = useMemo(
    () => activeChangeId === null ? emptyChangedFiles : changeFilesById[activeChangeId] ?? emptyChangedFiles,
    [activeChangeId, changeFilesById],
  )
  const activeChangeFilePath = activeChangeId === null ? null : activeChangeFileById[activeChangeId] ?? null
  const activeChangeFile = activeChangeFilePath === null
    ? null
    : activeChangeFiles.find((file) => file.path === activeChangeFilePath || file.oldPath === activeChangeFilePath) ?? null
  const activeChangeContentKey = activeChangeId === null || activeChangeFilePath === null
    ? null
    : `${activeChangeId}:${activeChangeFilePath}`
  const activeChangeContent = activeChangeContentKey === null ? null : changeContentByKey[activeChangeContentKey] ?? null
  const activeChangeFileInfo = activeChangeFile === null ? null : inferArtifactFileInfo({ filename: activeChangeFile.path })
  const changeTree = useMemo(() => buildProjectTree(activeChangeFiles), [activeChangeFiles])

  useEffect(() => {
    let active = true

    void (async () => {
      try {
        const response = await apiRequest<ListProjectFilesResponse>(
          `/conversations/${conversationId}/project/files`,
        )

        if (!active) {
          return
        }

        const firstFilePath = response.files.find((file) => file.type === 'file')?.path ?? null

        setFiles(response.files)
        setActiveFilePath((current) => current ?? firstFilePath)
        if (firstFilePath !== null) {
          setExpandedCodeDirectories(new Set(expandedDirectoriesForPath(firstFilePath)))
        }
        setProjectError(null)
      } catch (error) {
        if (active) {
          setProjectError(error instanceof Error ? error.message : 'Unable to load project files.')
        }
      }
    })()

    return () => {
      active = false
    }
  }, [conversationId])

  useEffect(() => {
    if (activeFilePath === null || activeFileInfo === null || !activeFileInfo.canEdit || fileContentKey === null) {
      return
    }

    if (fileContentByKey[fileContentKey] !== undefined) {
      return
    }

    let active = true
    const params = new URLSearchParams({ path: activeFilePath })

    void (async () => {
      try {
        const response = await apiRequest<GetProjectFileContentResponse>(
          `/conversations/${conversationId}/project/files/content?${params.toString()}`,
        )

        if (!active) {
          return
        }

        setFileContentByKey((current) => ({ ...current, [fileContentKey]: response.content }))
        setFileDraftByKey((current) => ({ ...current, [fileContentKey]: current[fileContentKey] ?? response.content }))
        setProjectError(null)
      } catch (error) {
        if (active) {
          setProjectError(error instanceof Error ? error.message : 'Unable to load project file.')
        }
      }
    })()

    return () => {
      active = false
    }
  }, [activeFileInfo, activeFilePath, conversationId, fileContentByKey, fileContentKey])

  useEffect(() => {
    if (mode !== 'changes') {
      return
    }

    let active = true

    void (async () => {
      try {
        const response = await apiRequest<ListConversationProjectChangesResponse>(
          `/conversations/${conversationId}/project/changes`,
        )

        if (!active) {
          return
        }

        setChanges(response.changes)
        setActiveChangeId((current) => current ?? response.changes[0]?.id ?? null)
        setProjectError(null)
      } catch (error) {
        if (active) {
          setProjectError(error instanceof Error ? error.message : 'Unable to load project changes.')
        }
      }
    })()

    return () => {
      active = false
    }
  }, [conversationId, mode])

  useEffect(() => {
    if (mode !== 'changes' || activeChangeId === null || changeFilesById[activeChangeId] !== undefined) {
      return
    }

    let active = true

    void (async () => {
      try {
        const response = await apiRequest<ListProjectChangeFilesResponse>(
          `/conversations/${conversationId}/project/changes/${activeChangeId}/files`,
        )

        if (!active) {
          return
        }

        const firstFilePath = response.files[0]?.path ?? ''

        setChangeFilesById((current) => ({ ...current, [activeChangeId]: response.files }))
        setActiveChangeFileById((current) => ({
          ...current,
          [activeChangeId]: current[activeChangeId] ?? firstFilePath,
        }))
        if (firstFilePath.length > 0) {
          setExpandedChangeDirectories(new Set(expandedDirectoriesForPath(firstFilePath)))
        }
        setProjectError(null)
      } catch (error) {
        if (active) {
          setProjectError(error instanceof Error ? error.message : 'Unable to load project change files.')
        }
      }
    })()

    return () => {
      active = false
    }
  }, [activeChangeId, changeFilesById, conversationId, mode])

  useEffect(() => {
    if (
      mode !== 'changes' ||
      activeChangeId === null ||
      activeChangeFilePath === null ||
      activeChangeContentKey === null ||
      changeContentByKey[activeChangeContentKey] !== undefined
    ) {
      return
    }

    let active = true
    const params = new URLSearchParams({ path: activeChangeFilePath })

    void (async () => {
      try {
        const response = await apiRequest<GetProjectChangeFileContentResponse>(
          `/conversations/${conversationId}/project/changes/${activeChangeId}/files/content?${params.toString()}`,
        )

        if (!active) {
          return
        }

        setChangeContentByKey((current) => ({ ...current, [activeChangeContentKey]: response }))
        setProjectError(null)
      } catch (error) {
        if (active) {
          setProjectError(error instanceof Error ? error.message : 'Unable to load project diff file.')
        }
      }
    })()

    return () => {
      active = false
    }
  }, [
    activeChangeContentKey,
    activeChangeFilePath,
    activeChangeId,
    changeContentByKey,
    conversationId,
    mode,
  ])

  const toggleCodeDirectory = (directory: string) => {
    setExpandedCodeDirectories((current) => {
      const next = new Set(current)
      if (next.has(directory)) {
        next.delete(directory)
      } else {
        next.add(directory)
      }
      return next
    })
  }

  const toggleChangeDirectory = (directory: string) => {
    setExpandedChangeDirectories((current) => {
      const next = new Set(current)
      if (next.has(directory)) {
        next.delete(directory)
      } else {
        next.add(directory)
      }
      return next
    })
  }

  const saveActiveFile = async () => {
    if (activeFilePath === null || fileContentKey === null || !fileDirty) {
      return
    }

    setIsSavingFile(true)
    try {
      const response = await apiRequest<UpdateProjectFileContentResponse>(
        `/conversations/${conversationId}/project/files/content`,
        {
          body: JSON.stringify({ content: fileDraft, path: activeFilePath }),
          method: 'PUT',
        },
      )

      setFileContentByKey((current) => ({ ...current, [fileContentKey]: response.content }))
      setFileDraftByKey((current) => ({ ...current, [fileContentKey]: response.content }))
      const filesResponse = await apiRequest<ListProjectFilesResponse>(
        `/conversations/${conversationId}/project/files`,
      )
      setFiles(filesResponse.files)
      setProjectError(null)
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : 'Unable to save project file.')
    } finally {
      setIsSavingFile(false)
    }
  }

  const renderTreeNodes = (
    nodes: ProjectTreeNode[],
    input: {
      activePath: string | null
      expandedDirectories: Set<string>
      onSelectFile: (file: TreeFile) => void
      onToggleDirectory: (directory: string) => void
      showChangeStatus?: boolean
    },
    depth = 0,
  ) => nodes.map((node) => {
    const isDirectory = node.type === 'directory'
    const expanded = input.expandedDirectories.has(node.path)
    const selected = node.type === 'file' && node.path === input.activePath
    const changeFile = node.file !== undefined && !isProjectFileEntry(node.file) ? node.file : null

    return (
      <div key={node.id}>
        <button
          type="button"
          className={`grid w-full cursor-pointer grid-cols-[1.15rem_1.25rem_minmax(0,1fr)_auto] items-center gap-1 rounded-lg border-0 p-2 text-left text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)] ${
            selected
              ? 'bg-[#e9eaee] text-[#161616]'
              : 'bg-transparent text-[#69707d] hover:bg-[#eef0f4] hover:text-[#161616]'
          }`}
          style={{ paddingLeft: `${0.5 + depth * 0.875}rem` }}
          onClick={() => {
            if (isDirectory) {
              input.onToggleDirectory(node.path)
              return
            }

            if (node.file !== undefined) {
              input.onSelectFile(node.file)
            }
          }}
        >
          <span className="grid size-5 place-items-center text-[var(--cds-icon-secondary)]">
            {isDirectory ? (expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : null}
          </span>
          <span className="grid size-5 place-items-center text-[var(--cds-icon-secondary)]">
            {isDirectory
              ? expanded
                ? <FolderOpen size={16} />
                : <Folder size={16} />
              : <ProjectFileIcon path={node.path} />}
          </span>
          <span className="truncate font-medium">{node.name}</span>
          {input.showChangeStatus && changeFile !== null && (
            <span className="shrink-0 text-[10px] font-semibold uppercase text-[#69707d]">
              {changeFile.status[0]}
            </span>
          )}
        </button>
        {isDirectory && expanded && node.children.length > 0 && (
          <div>{renderTreeNodes(node.children, input, depth + 1)}</div>
        )}
      </div>
    )
  })

  const renderCodeContent = () => {
    if (activeFilePath === null || activeFileInfo === null) {
      return (
        <div className="grid h-full place-items-center text-sm text-[var(--cds-text-secondary)]">
          Select a file to inspect project code.
        </div>
      )
    }

    if (activeFileInfo.category === 'image') {
      const params = new URLSearchParams({ path: activeFilePath })
      return (
        <div className="grid h-full min-h-0 place-items-center overflow-auto bg-[#f7f8fa] p-3">
          <img
            alt={activeFilePath}
            className="max-h-full max-w-full object-contain"
            src={apiUrl(`/conversations/${conversationId}/project/files/raw?${params.toString()}`)}
          />
        </div>
      )
    }

    if (!activeFileInfo.canEdit) {
      return (
        <div className="grid h-full place-items-center text-sm text-[var(--cds-text-secondary)]">
          This file cannot be previewed inline.
        </div>
      )
    }

    return (
      <Editor
        height="100%"
        language={activeFileInfo.language}
        value={fileDraft}
        options={{ minimap: { enabled: false }, wordWrap: 'on' }}
        onChange={(value) => {
          if (fileContentKey === null) {
            return
          }
          setFileDraftByKey((current) => ({ ...current, [fileContentKey]: value ?? '' }))
        }}
      />
    )
  }

  const renderChangeContent = () => {
    if (activeChange === null) {
      return (
        <div className="grid h-full place-items-center text-sm text-[var(--cds-text-secondary)]">
          Select a change to inspect its files.
        </div>
      )
    }

    if (activeChangeFile === null) {
      return (
        <div className="grid h-full place-items-center text-sm text-[var(--cds-text-secondary)]">
          Select a changed file to inspect its diff.
        </div>
      )
    }

    if (activeChangeContent?.binary) {
      return (
        <div className="grid h-full place-items-center text-sm text-[var(--cds-text-secondary)]">
          Binary file diff cannot be previewed inline.
        </div>
      )
    }

    if (activeChangeContent === null) {
      return <InlineLoading description="Loading diff..." />
    }

    return (
      <DiffEditor
        height="100%"
        language={activeChangeFileInfo?.language ?? 'plaintext'}
        modified={activeChangeContent.newContent}
        original={activeChangeContent.oldContent}
        options={{
          minimap: { enabled: false },
          readOnly: true,
          renderSideBySide: true,
          wordWrap: 'on',
        }}
      />
    )
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-[18rem_minmax(0,1fr)] overflow-hidden rounded-2xl border border-[#e1e5ea] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)] max-[900px]:grid-cols-1">
      <aside className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] border-r border-[#eef0f3] bg-[#f7f8fa] max-[900px]:max-h-80 max-[900px]:border-b max-[900px]:border-r-0">
        <div className="border-b border-[#eef0f3] bg-white p-3">
          <div className="inline-flex h-8 rounded-full bg-[#eef0f4] p-0.5">
            {(['code', 'changes'] as const).map((item) => (
              <button
                key={item}
                type="button"
                className={`h-7 cursor-pointer rounded-full border-0 px-3 text-xs font-semibold capitalize transition-colors ${
                  mode === item
                    ? 'bg-white text-[#161616] shadow-[0_1px_3px_rgba(0,0,0,0.08)]'
                    : 'bg-transparent text-[#69707d] hover:text-[#161616]'
                }`}
                onClick={() => setMode(item)}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
        <div className="min-h-0 overflow-y-auto p-2">
          {projectError && (
            <InlineNotification
              kind="error"
              title="Project unavailable"
              subtitle={projectError}
              lowContrast
              hideCloseButton
            />
          )}
          {mode === 'code' ? (
            codeTree.length === 0 ? (
              <p className="px-2 py-8 text-center text-sm text-[var(--cds-text-secondary)]">No project files yet.</p>
            ) : (
              <div className="grid gap-0.5">
                {renderTreeNodes(codeTree, {
                  activePath: activeFilePath,
                  expandedDirectories: expandedCodeDirectories,
                  onSelectFile: (file) => {
                    setActiveFilePath(file.path)
                    setExpandedCodeDirectories((current) => {
                      const next = new Set(current)
                      expandedDirectoriesForPath(file.path).forEach((directory) => next.add(directory))
                      return next
                    })
                  },
                  onToggleDirectory: toggleCodeDirectory,
                })}
              </div>
            )
          ) : (
            <div className="grid gap-3">
              <section className="grid gap-1">
                <h3 className="px-2 text-xs font-semibold uppercase tracking-wide text-[#69707d]">
                  Changes ({changes.length})
                </h3>
                {changes.length === 0 ? (
                  <p className="px-2 py-6 text-center text-sm text-[var(--cds-text-secondary)]">No internal changes yet.</p>
                ) : (
                  changes.map((change) => {
                    const selected = change.id === activeChangeId
                    const agent = agents.find((item) => item.agent.id === change.agentId)

                    return (
                      <button
                        key={change.id}
                        type="button"
                        className={`grid cursor-pointer gap-1 rounded-lg border-0 px-2 py-2 text-left text-sm ${
                          selected
                            ? 'bg-[#e9eaee] text-[#161616]'
                            : 'bg-transparent text-[#4f5f72] hover:bg-[#eef0f4] hover:text-[#161616]'
                        }`}
                        onClick={() => setActiveChangeId(change.id)}
                      >
                        <span className="flex min-w-0 items-center justify-between gap-2">
                          <span className="min-w-0 truncate font-semibold">{change.summary || change.branchName}</span>
                          <Tag size="sm" type={change.status === 'merged' ? 'green' : change.status === 'failed' ? 'red' : 'gray'}>
                            {change.status}
                          </Tag>
                        </span>
                        <span className="truncate text-xs text-[#69707d]">
                          {agent?.agent.name ?? 'Agent'} · {change.branchName}
                        </span>
                      </button>
                    )
                  })
                )}
              </section>
              {activeChange !== null && (
                <section className="grid gap-1 border-t border-[#e1e5ea] pt-3">
                  <h3 className="px-2 text-xs font-semibold uppercase tracking-wide text-[#69707d]">
                    Files ({activeChangeFiles.length})
                  </h3>
                  {changeTree.length === 0 ? (
                    <InlineLoading description="Loading files..." />
                  ) : (
                    renderTreeNodes(changeTree, {
                      activePath: activeChangeFilePath,
                      expandedDirectories: expandedChangeDirectories,
                      onSelectFile: (file) => {
                        if (activeChangeId === null) {
                          return
                        }
                        setActiveChangeFileById((current) => ({ ...current, [activeChangeId]: file.path }))
                        setExpandedChangeDirectories((current) => {
                          const next = new Set(current)
                          expandedDirectoriesForPath(file.path).forEach((directory) => next.add(directory))
                          return next
                        })
                      },
                      onToggleDirectory: toggleChangeDirectory,
                      showChangeStatus: true,
                    })
                  )}
                </section>
              )}
            </div>
          )}
        </div>
      </aside>
      <section className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)]">
        <div className="flex min-h-12 items-center justify-between gap-3 border-b border-[#eef0f3] bg-white px-4">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-[var(--cds-text-primary)]">
              {mode === 'code'
                ? activeFilePath ?? 'Select a file'
                : activeChangeFile?.path ?? activeChange?.summary ?? 'Select a change'}
            </h3>
            <p className="truncate text-xs text-[var(--cds-text-secondary)]">
              {mode === 'code' ? 'Base repository' : activeChange?.branchName ?? 'Internal project changes'}
            </p>
          </div>
          {mode === 'code' && activeFileInfo?.canEdit && (
            <Button
              disabled={!fileDirty || isSavingFile}
              kind="secondary"
              renderIcon={Save}
              size="sm"
              type="button"
              onClick={saveActiveFile}
            >
              {isSavingFile ? 'Saving' : 'Save'}
            </Button>
          )}
        </div>
        <div className="min-h-0 overflow-hidden">
          {mode === 'code' ? renderCodeContent() : renderChangeContent()}
        </div>
      </section>
    </div>
  )
}
