import type { ReactNode } from 'react'

interface WorkspacePanelProps {
  children: ReactNode
}

export function WorkspacePanel({ children }: WorkspacePanelProps) {
  return (
    <div className="min-h-0 min-w-0 overflow-hidden bg-[#f7f8fa] p-2 max-[671px]:p-1">
      <div className="h-full min-h-0 min-w-0 overflow-hidden rounded-[18px] border border-[#e1e5ea] bg-white shadow-[0_8px_24px_rgba(15,23,42,0.05)] max-[671px]:rounded-xl">
        {children}
      </div>
    </div>
  )
}
