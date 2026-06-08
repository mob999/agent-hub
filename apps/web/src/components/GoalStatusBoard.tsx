import { useLayoutEffect, useRef } from 'react'
import type { ConversationGoal, ConversationGoalTaskStatus } from '../lib/api'
import type { ReactNode } from 'react'

export const taskStatusOrder = [
  'waiting',
  'ready',
  'assigned',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'interrupted',
  'blocked',
] as const satisfies readonly ConversationGoalTaskStatus[]

export type GoalTask = ConversationGoal['tasks'][number]
export interface GoalTaskEntry {
  goal: ConversationGoal
  task: GoalTask
}

export function taskStatusBoardStyle(status: ConversationGoalTaskStatus): {
  column: string
  dot: string
  count: string
} {
  switch (status) {
    case 'ready':
      return {
        column: 'border-[#d8e6ff] bg-[#f3f7ff]',
        dot: 'border-[#0f62fe] bg-[#0f62fe]',
        count: 'bg-[#d8e6ff] text-[#0f3f9c]',
      }
    case 'running':
      return {
        column: 'border-[#f0dfb4] bg-[#fffaf0]',
        dot: 'border-[#d89400] bg-[#d89400]',
        count: 'bg-[#f9e8b8] text-[#6f5200]',
      }
    case 'succeeded':
      return {
        column: 'border-[#d7eadc] bg-[#f2faf5]',
        dot: 'border-[#24a148] bg-[#24a148]',
        count: 'bg-[#d7eadc] text-[#0e6027]',
      }
    case 'failed':
      return {
        column: 'border-[#f4d4d4] bg-[#fff5f5]',
        dot: 'border-[#da1e28] bg-[#da1e28]',
        count: 'bg-[#f4d4d4] text-[#8a1118]',
      }
    case 'blocked':
      return {
        column: 'border-[#efd6e4] bg-[#fff6fb]',
        dot: 'border-[#d02670] bg-[#d02670]',
        count: 'bg-[#efd6e4] text-[#7f1743]',
      }
    case 'waiting':
    case 'assigned':
    case 'cancelled':
    case 'interrupted':
      return {
        column: 'border-[#e5e5e5] bg-[#f8f8f8]',
        dot: 'border-[#8d8d8d] bg-white',
        count: 'bg-[#e8e8e8] text-[#525252]',
      }
  }
}

interface GoalStatusBoardProps {
  emptyLabel: string
  goals: ConversationGoal[]
  renderTask: (entry: GoalTaskEntry) => ReactNode
  statusLabel: (status: ConversationGoalTaskStatus) => string
}

export function GoalStatusBoard({
  emptyLabel,
  goals,
  renderTask,
  statusLabel,
}: GoalStatusBoardProps) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const runningColumnRef = useRef<HTMLElement | null>(null)
  const goalTasksByStatus = new Map<ConversationGoalTaskStatus, GoalTaskEntry[]>(
    taskStatusOrder.map((status) => [status, []]),
  )

  goals.forEach((goal) => {
    goal.tasks.forEach((task) => {
      goalTasksByStatus.get(task.status)?.push({ goal, task })
    })
  })

  useLayoutEffect(() => {
    const scrollContainer = scrollContainerRef.current
    const runningColumn = runningColumnRef.current

    if (scrollContainer === null || runningColumn === null) {
      return
    }

    const centerRunningColumn = () => {
      const maxScrollLeft = scrollContainer.scrollWidth - scrollContainer.clientWidth
      const nextScrollLeft =
        runningColumn.offsetLeft -
        (scrollContainer.clientWidth - runningColumn.offsetWidth) / 2

      scrollContainer.scrollLeft = Math.min(
        Math.max(0, nextScrollLeft),
        Math.max(0, maxScrollLeft),
      )
    }

    centerRunningColumn()

    let secondFrame: number | null = null
    const firstFrame = window.requestAnimationFrame(() => {
      centerRunningColumn()
      secondFrame = window.requestAnimationFrame(centerRunningColumn)
    })
    const settledLayoutTimeout = window.setTimeout(centerRunningColumn, 120)
    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            centerRunningColumn()
          })

    resizeObserver?.observe(scrollContainer)

    return () => {
      window.cancelAnimationFrame(firstFrame)
      if (secondFrame !== null) {
        window.cancelAnimationFrame(secondFrame)
      }
      window.clearTimeout(settledLayoutTimeout)
      resizeObserver?.disconnect()
    }
  }, [goals])

  return (
    <div ref={scrollContainerRef} className="h-full min-h-0 min-w-0 overflow-x-scroll overflow-y-hidden pb-3">
      <div className="flex h-full min-h-0 w-max min-w-full gap-4 pr-2">
        {taskStatusOrder.map((status) => {
          const statusTasks = goalTasksByStatus.get(status) ?? []
          const style = taskStatusBoardStyle(status)

          return (
            <section
              key={status}
              ref={status === 'running' ? runningColumnRef : undefined}
              className={`grid min-h-0 w-[15.3rem] shrink-0 grid-rows-[auto_minmax(0,1fr)] gap-3 rounded-2xl border p-4 ${style.column}`}
            >
              <div className="flex items-center justify-between gap-3">
                <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-[var(--cds-text-primary)]">
                  <span className={`h-3 w-3 shrink-0 rounded-full border-2 ${style.dot}`} aria-hidden="true" />
                  <span className="truncate capitalize">{statusLabel(status)}</span>
                </h3>
                <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${style.count}`}>
                  {statusTasks.length}
                </span>
              </div>
              {statusTasks.length === 0 ? (
                <div className="grid min-h-0 place-items-center rounded-xl text-sm text-[var(--cds-text-placeholder)]">
                  {emptyLabel}
                </div>
              ) : (
                <div className="grid min-h-0 content-start gap-3 overflow-y-auto overscroll-contain pr-1">
                  {statusTasks.map((entry) => renderTask(entry))}
                </div>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}
