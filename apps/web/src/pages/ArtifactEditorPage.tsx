import { InlineLoading, InlineNotification } from '@carbon/react'
import { useCallback, useEffect, useState } from 'react'
import { ArtifactWorkspace } from '../components/ArtifactWorkspace'
import {
  ApiRequestError,
  apiRequest,
  type ConversationArtifact,
  type ConversationArtifactDetails,
} from '../lib/api'
import type { RoutePath } from './AuthPage'

interface ArtifactEditorPageProps {
  artifactId: string
  navigate: (path: RoutePath) => void
}

async function fetchArtifactWorkspace(artifactId: string): Promise<ConversationArtifact[]> {
  const details = await apiRequest<ConversationArtifactDetails>(`/artifacts/${artifactId}`)
  const artifactResponse = await apiRequest<{ artifacts: ConversationArtifact[] }>(
    `/conversations/${details.artifact.conversationId}/artifacts`,
  )

  return artifactResponse.artifacts.some((artifact) => artifact.id === artifactId)
    ? artifactResponse.artifacts
    : [details.artifact, ...artifactResponse.artifacts]
}

export function ArtifactEditorPage({ artifactId, navigate }: ArtifactEditorPageProps) {
  const [artifacts, setArtifacts] = useState<ConversationArtifact[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const loadArtifacts = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const artifactList = await fetchArtifactWorkspace(artifactId)
      setArtifacts(artifactList)
    } catch (loadError) {
      setError(loadError instanceof ApiRequestError ? loadError.message : 'Unable to load artifact.')
      setArtifacts([])
    } finally {
      setLoading(false)
    }
  }, [artifactId])

  useEffect(() => {
    let active = true

    const load = async () => {
      try {
        const artifactList = await fetchArtifactWorkspace(artifactId)
        if (!active) {
          return
        }
        setError(null)
        setArtifacts(artifactList)
      } catch (loadError) {
        if (!active) {
          return
        }
        setError(loadError instanceof ApiRequestError ? loadError.message : 'Unable to load artifact.')
        setArtifacts([])
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    void load()

    return () => {
      active = false
    }
  }, [artifactId])

  if (loading) {
    return (
      <section className="grid h-screen min-w-0 place-items-center bg-[var(--cds-background)]">
        <InlineLoading description="Loading artifact..." status="active" />
      </section>
    )
  }

  if (error !== null) {
    return (
      <section className="grid h-screen min-w-0 content-center gap-3 bg-[var(--cds-background)] p-6">
        <InlineNotification
          kind="error"
          title="Artifact unavailable"
          subtitle={error}
          lowContrast
          hideCloseButton
        />
      </section>
    )
  }

  return (
    <section className="grid h-screen min-w-0 bg-[var(--cds-background)] p-3">
      <ArtifactWorkspace
        artifacts={artifacts}
        activeArtifactId={artifactId}
        onActiveArtifactChange={(nextArtifactId) =>
          navigate(`/editor/${encodeURIComponent(nextArtifactId)}` as RoutePath)
        }
        onRefreshArtifacts={() => {
          void loadArtifacts()
        }}
      />
    </section>
  )
}
