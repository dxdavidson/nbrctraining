import { useEffect, useState } from 'react'
import DataTable, { type Column } from './components/DataTable'
import HeaderTooltip from './components/HeaderTooltip'
import { useUrlSelection } from './hooks/useUrlSelection'
import { useMediaQuery } from './hooks/useMediaQuery'
import { useEstimated2kSeconds } from './hooks/useEstimated2kSeconds'
import {
  toPlanRow,
  toBlockRow,
  toWorkoutRow,
  toIntervalRow,
  type PlanRow,
  type BlockRow,
  type WorkoutRow,
  type IntervalRow,
} from './rowModels'
import {
  fetchPlans,
  fetchBlocks,
  fetchWorkouts,
  fetchIntervals,
  type Plan,
  type Block,
  type Workout,
  type Interval,
} from './api'
import Pm5WorkoutSender from './Pm5WorkoutSender'
import './PlanBrowser.css'

const planColumns: Column<PlanRow>[] = [
  { key: 'title', header: 'Title', render: (p) => p.title, sortValue: (p) => p.title },
  { key: 'start_date', header: 'Start Date', render: (p) => p.startDateDisplay, sortValue: (p) => p.start_date },
]

const blockColumns: Column<BlockRow>[] = [
  { key: 'title', header: 'Title', render: (b) => b.title, sortValue: (b) => b.title },
  { key: 'start_date', header: 'Start Date', render: (b) => b.startDateDisplay, sortValue: (b) => b.start_date },
  { key: 'description', header: 'Description', render: (b) => b.description ?? '—' },
]

const workoutColumns: Column<WorkoutRow>[] = [
  { key: 'week_commencing', header: 'w/c', render: (w) => w.weekCommencingDisplay, sortValue: (w) => w.week_commencing },
  { key: 'workout_code', header: 'Workout', render: (w) => w.workout_code, sortValue: (w) => w.workout_code },
  {
    key: 'level',
    header: (
      <HeaderTooltip label="Intensity">
        L1, L2, L3, L4 are Wolverine Plan intensity levels. (Placeholder text — to be refined.)
      </HeaderTooltip>
    ),
    render: (w) => w.level ?? '—',
  },
  { key: 'description', header: 'Description', render: (w) => w.description ?? '—' },
]

const intervalColumns: Column<IntervalRow>[] = [
  { key: 'interval_order', header: '#', render: (i) => i.interval_order, sortValue: (i) => i.interval_order },
  { key: 'work', header: 'Work', render: (i) => i.workDisplay },
  { key: 'spm', header: 'SPM', render: (i) => i.spm ?? '—', sortValue: (i) => i.spm, width: '5rem' },
  { key: 'target', header: 'Target Pace', render: (i) => i.targetDisplay },
  { key: 'recovery', header: 'Recovery', render: (i) => i.recoveryDisplay },
  { key: 'repeat_count', header: 'Repeat', render: (i) => i.repeat_count, sortValue: (i) => i.repeat_count },
]

function IntervalsTable({ intervals, estimated2kSeconds, loading }: { intervals: Interval[]; estimated2kSeconds: number | null; loading: boolean }) {
  return (
    <DataTable
      caption="Intervals"
      columns={intervalColumns}
      rows={intervals.map((i) => toIntervalRow(i, estimated2kSeconds))}
      getRowId={(i) => i.id}
      selectedId={null}
      onSelectRow={() => {}}
      loading={loading}
      emptyMessage="No intervals in this workout."
    />
  )
}

export default function PlanBrowser() {
  const [selection, setSelection] = useUrlSelection()
  const isWide = useMediaQuery('(min-width: 900px)')
  const [estimated2kSeconds] = useEstimated2kSeconds()

  const [plans, setPlans] = useState<Plan[]>([])
  const [blocks, setBlocks] = useState<Block[]>([])
  const [workouts, setWorkouts] = useState<Workout[]>([])
  const [intervals, setIntervals] = useState<Interval[]>([])

  const [loadingPlans, setLoadingPlans] = useState(true)
  const [loadingBlocks, setLoadingBlocks] = useState(false)
  const [loadingWorkouts, setLoadingWorkouts] = useState(false)
  const [loadingIntervals, setLoadingIntervals] = useState(false)

  const [error, setError] = useState<string | null>(null)

  const { planId, blockId, workoutId } = selection

  useEffect(() => {
    setLoadingPlans(true)
    fetchPlans()
      .then(setPlans)
      .catch((err) => setError(err.message))
      .finally(() => setLoadingPlans(false))
  }, [])

  useEffect(() => {
    if (!planId) {
      setBlocks([])
      return
    }
    setLoadingBlocks(true)
    fetchBlocks(planId)
      .then(setBlocks)
      .catch((err) => setError(err.message))
      .finally(() => setLoadingBlocks(false))
  }, [planId])

  useEffect(() => {
    if (!blockId) {
      setWorkouts([])
      return
    }
    setLoadingWorkouts(true)
    fetchWorkouts(blockId)
      .then(setWorkouts)
      .catch((err) => setError(err.message))
      .finally(() => setLoadingWorkouts(false))
  }, [blockId])

  useEffect(() => {
    if (!workoutId) {
      setIntervals([])
      return
    }
    setLoadingIntervals(true)
    fetchIntervals(workoutId)
      .then(setIntervals)
      .catch((err) => setError(err.message))
      .finally(() => setLoadingIntervals(false))
  }, [workoutId])

  const selectedPlan = plans.find((p) => p.id === planId) ?? null
  const selectedBlock = blocks.find((b) => b.id === blockId) ?? null
  const selectedWorkout = workouts.find((w) => w.id === workoutId) ?? null

  // Depth of the current selection: 0 = Plans, 1 = Blocks, 2 = Workouts.
  const depth = blockId ? 2 : planId ? 1 : 0

  const goBack = () => {
    if (workoutId) setSelection({ workoutId: null })
    else if (depth === 2) setSelection({ blockId: null, workoutId: null })
    else if (depth === 1) setSelection({ planId: null, blockId: null, workoutId: null })
  }

  const breadcrumbItems = [
    { label: 'Plans', onClick: () => setSelection({ planId: null, blockId: null, workoutId: null }) },
    selectedPlan && { label: selectedPlan.title, onClick: () => setSelection({ blockId: null, workoutId: null }) },
    selectedBlock && { label: selectedBlock.title, onClick: () => setSelection({ workoutId: null }) },
    selectedWorkout && { label: selectedWorkout.workout_code, onClick: undefined },
  ].filter((item): item is { label: string; onClick?: () => void } => Boolean(item))

  const plansTable = (
    <DataTable
      caption="Plans"
      columns={planColumns}
      rows={plans.map(toPlanRow)}
      getRowId={(p) => p.id}
      selectedId={planId}
      onSelectRow={(p) => setSelection({ planId: p.id, blockId: null, workoutId: null })}
      loading={loadingPlans}
      emptyMessage="No plans found."
    />
  )

  const blocksTable = (
    <DataTable
      caption="Blocks"
      columns={blockColumns}
      rows={blocks.map(toBlockRow)}
      getRowId={(b) => b.id}
      selectedId={blockId}
      onSelectRow={(b) => setSelection({ blockId: b.id, workoutId: null })}
      loading={loadingBlocks}
      emptyMessage="No blocks in this plan."
    />
  )

  const workoutsTable = (
    <DataTable
      caption="Workouts"
      columns={workoutColumns}
      rows={[...workouts].sort((a, b) => (a.sort_order ?? Infinity) - (b.sort_order ?? Infinity)).map(toWorkoutRow)}
      getRowId={(w) => w.id}
      selectedId={workoutId}
      onSelectRow={(w) => setSelection({ workoutId: w.id })}
      expandedRowId={workoutId}
      renderExpandedRow={() => (
        <IntervalsTable intervals={intervals} estimated2kSeconds={estimated2kSeconds} loading={loadingIntervals} />
      )}
      loading={loadingWorkouts}
      emptyMessage="No workouts in this block."
    />
  )

  const panesByDepth = [plansTable, blocksTable, workoutsTable]

  return (
    <section className="plan-browser" aria-label="Training plan browser">
      <h2>Plan Browser</h2>
      {error && (
        <p className="plan-browser-error" role="alert">
          {error}
        </p>
      )}

      <nav aria-label="Breadcrumb" className="plan-browser-breadcrumb">
        <ol>
          {breadcrumbItems.map((item, index) => {
            const isLast = index === breadcrumbItems.length - 1
            return (
              <li key={item.label + index}>
                {item.onClick && !isLast ? (
                  <button type="button" onClick={item.onClick}>
                    {item.label}
                  </button>
                ) : (
                  <span aria-current={isLast ? 'page' : undefined}>{item.label}</span>
                )}
                {!isLast && <span aria-hidden="true"> / </span>}
              </li>
            )
          })}
        </ol>
      </nav>

      {!isWide && (
        <>
          {depth > 0 && (
            <button type="button" className="plan-browser-back" onClick={goBack}>
              ← Back
            </button>
          )}
          {panesByDepth[depth]}
        </>
      )}

      {isWide && (
        <div className="plan-browser-panes">
          {depth === 1 && <div className="plan-browser-pane">{panesByDepth[depth - 1]}</div>}
          <div className="plan-browser-pane">{panesByDepth[depth]}</div>
        </div>
      )}

      {selectedWorkout && (
        <Pm5WorkoutSender workout={selectedWorkout} intervals={intervals} />
      )}
    </section>
  )
}
