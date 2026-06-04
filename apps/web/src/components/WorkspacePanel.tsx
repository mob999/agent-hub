import type { ReactNode } from 'react'

interface WorkspacePanelProps {
  children: ReactNode
}

export function WorkspacePanel({ children }: WorkspacePanelProps) {
  return (
    <div className="min-h-0 min-w-0 overflow-hidden bg-[#fafafa] p-2 max-[671px]:p-1">
      <div className="h-full min-h-0 min-w-0 overflow-hidden rounded-[18px] border border-[#eef0f3] bg-white shadow-[0_6px_18px_rgba(15,23,42,0.025)] max-[671px]:rounded-xl">
        {children}
      </div>
    </div>
  )
}
