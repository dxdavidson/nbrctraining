import { useEffect, useState } from 'react'
import DataTable, { type Column } from './components/DataTable'
import HeaderTooltip from './components/HeaderTooltip'
import { useUrlSelection } from './hooks/useUrlSelection'
import { useEstimated2kSeconds } from './hooks/useEstimated2kSeconds'
import formatDate from './formatDate'
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
  {
    key: 'description_link',
    header: 'Plan Description',
    render: (p) => {
      if (!p.description?.trim()) return <span className="plan-description-unavailable">Not available</span>
      const returnUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`
      // Prefix with the deploy base path so the link works when hosted under a sub-path.
      const href = `${import.meta.env.BASE_URL}plans/${encodeURIComponent(p.id)}?from=${encodeURIComponent(returnUrl)}`
      return (
        <a href={href} onClick={(event) => event.stopPropagation()}>
          Plan Description
        </a>
      )
    },
  },
]

const blockColumns: Column<BlockRow>[] = [
  { key: 'title', header: 'Title', render: (b) => b.title, sortValue: (b) => b.title },
  { key: 'start_date', header: 'Start Date', render: (b) => b.startDateDisplay, sortValue: (b) => b.start_date },
  { key: 'description', header: 'Description', render: (b) => b.description ?? '—' },
]

const LEVEL_INFO: Record<string, { label: string; className: string }> = {
  L4: { label: 'Easy', className: 'level-badge-l4' },
  L3: { label: 'Steady', className: 'level-badge-l3' },
  L2: { label: 'Hard', className: 'level-badge-l2' },
  L1: { label: 'Max', className: 'level-badge-l1' },
}

function LevelBadge({ level }: { level: string | null }) {
  if (!level) return <>—</>
  const codes = level.split(',').map((c) => c.trim()).filter(Boolean)
  if (codes.length > 1) {
    // Mixed-level workout: show bare level codes only, no label text
    return (
      <span className="level-badge-group">
        {codes.map((code, i) => {
          const info = LEVEL_INFO[code]
          return (
            <span key={i} className={`level-badge ${info?.className ?? ''}`}>
              {code}
            </span>
          )
        })}
      </span>
    )
  }
  const info = LEVEL_INFO[level]
  if (!info) return <>{level}</>
  return (
    <span className={`level-badge ${info.className}`}>
      {level} · {info.label}
    </span>
  )
}

const workoutColumns: Column<WorkoutRow>[] = [
  { key: 'week_commencing', header: 'w/c', render: (w) => w.weekCommencingDisplay, sortValue: (w) => w.week_commencing },
  { key: 'workout_code', header: 'Workout', render: (w) => w.workout_code, sortValue: (w) => w.workout_code },
  {
    key: 'level',
    header: (
      <HeaderTooltip label="Intensity">
        The Wolverine Plan categorizes training into four intensity levels, defined by energy systems, stroke rates, and target split paces derived from your baseline 2K performance.
        
          <br/><br/>
          L4 - Aerobic Base / Rate‑Restricted.
            <ul>
              <li>Purpose: Aerobic development, technique, efficiency.</li>
              <li>Stick to the stroke rates, this is primary goal (pace is a rough guide)</li>
              <li>Intensity: Steady, sustainable</li>
              <li>Stroke Rate: Strictly R18–20</li>
              <li>Examples: 30–40 min continuous, countdowns, long intervals</li>
            </ul>
          L3 - Threshold / Hard Steady.
          <ul>
            <li>Purpose: Build sustainable race‑pace endurance</li>
            <li>Pace <b>80%</b> of your 2K estimate, hitting this pace is primary goal (stroke rate is purely a rough guide)</li>
            <li>Intensity: Controlled discomfort; “comfortably hard”</li>
            <li>Stroke Rate: R20–24</li>
            <li>Examples: 3 × 10 min, 2 × 12 min, 20 min continuous</li>
          </ul>
          L2 - High‑Rate Power / VO2.
            <ul>
              <li>Purpose: Develop race‑pace power, high‑rate control, and oxygen uptake</li>
              <li>Pace <b>95%</b> of your 2K estimate, hitting this pace is primary goal (stroke rate is purely a rough guide)</li>
              <li>Intensity: Very hard but repeatable</li>
              <li>Stroke Rate: R26–32 (depending on block)</li>
              <li>Examples: 4 × 4 min, 6 × 3 min, 10 × 1 min</li>
            </ul>

          L1 - Maximal Effort.
            <ul>
              <li>Purpose: Measure performance; sharpen top‑end speed</li>
              <li>Intensity: All‑out</li>
              <li>Examples: 2k test, 5k test, 1‑min max, 500m max</li>
            </ul>

      </HeaderTooltip>
    ),
    render: (w) => <LevelBadge level={w.level} />,
  },
  { key: 'description', header: 'Description', render: (w) => w.description ?? '—' },
]

const intervalColumns: Column<IntervalRow>[] = [
  { key: 'interval_order', header: '#', render: (i) => i.interval_order, sortValue: (i) => i.interval_order },
  { key: 'work', header: 'Work', render: (i) => i.workDisplay },
  {
    key: 'spm',
    header: 'SPM',
    render: (i) => (i.target_mode === 'L4' ? <strong className="pace-guidance-highlight">{i.spm ?? '—'}</strong> : (i.spm ?? '—')),
    sortValue: (i) => i.spm,
    width: '5rem',
  },
  {
    key: 'target',
    header: 'Target Pace',
    render: (i) =>
      i.target_mode === 'L2' || i.target_mode === 'L3' ? (
        <strong className="pace-guidance-highlight">{i.targetDisplay}</strong>
      ) : (
        i.targetDisplay
      ),
  },
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

// Picks the week containing today, or the earliest future week if none has started yet.
function findCurrentWeek(sortedWeeks: string[]): string | null {
  const todayIso = new Date().toISOString().slice(0, 10)
  const pastOrCurrent = sortedWeeks.filter((w) => w <= todayIso)
  if (pastOrCurrent.length > 0) return pastOrCurrent[pastOrCurrent.length - 1]
  return sortedWeeks[0] ?? null
}

export default function PlanBrowser() {
  const [selection, setSelection] = useUrlSelection()
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

  const { planId, blockId, workoutId, week } = selection

  const requireEstimated2kTime = () => {
    if (estimated2kSeconds && estimated2kSeconds > 0) return true
    window.alert('Enter an estimated 2K time before viewing workout intervals.')
    return false
  }

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

  const breadcrumbItems = [
    { label: 'Plans', onClick: () => setSelection({ planId: null, blockId: null, workoutId: null, week: null }) },
    selectedPlan && { label: selectedPlan.title, onClick: () => setSelection({ blockId: null, workoutId: null, week: null }) },
    selectedBlock && { label: selectedBlock.title, onClick: () => setSelection({ workoutId: null }) },
    selectedWorkout && { label: selectedWorkout.workout_code, onClick: undefined },
  ].filter((item): item is { label: string; onClick?: () => void } => Boolean(item))

  const sortedWorkouts = [...workouts].sort((a, b) => {
    const weekCompare = (a.week_commencing ?? '').localeCompare(b.week_commencing ?? '')
    if (weekCompare !== 0) return weekCompare
    return a.workout_code.localeCompare(b.workout_code)
  })

  const distinctWeeks = [...new Set(sortedWorkouts.map((w) => w.week_commencing).filter((w): w is string => Boolean(w)))].sort()
  const currentWeek = findCurrentWeek(distinctWeeks)
  const effectiveWeek = week === 'all' ? null : (week ?? currentWeek)
  const visibleWorkouts = effectiveWeek ? sortedWorkouts.filter((w) => w.week_commencing === effectiveWeek) : sortedWorkouts

  const weekPicker = distinctWeeks.length > 0 && (
    <label className="plan-browser-week-picker">
      Week
      <select value={week ?? ''} onChange={(e) => setSelection({ week: e.target.value || null })}>
        <option value="">{currentWeek ? `w/c ${formatDate(currentWeek)}` : 'This week'}</option>
        {distinctWeeks.map((w) => (
          <option key={w} value={w}>
            w/c {formatDate(w)}
          </option>
        ))}
        <option value="all">All weeks</option>
      </select>
    </label>
  )

  const workoutsTable = (
    <>
      {weekPicker}
      <DataTable
        caption="Workouts"
        columns={workoutColumns}
        rows={visibleWorkouts.map(toWorkoutRow)}
        getRowId={(w) => w.id}
        selectedId={workoutId}
        onSelectRow={(w) => {
          if (workoutId === w.id || requireEstimated2kTime()) setSelection({ workoutId: w.id })
        }}
        expandedRowId={workoutId}
        renderExpandedRow={() => (
          <IntervalsTable intervals={intervals} estimated2kSeconds={estimated2kSeconds} loading={loadingIntervals} />
        )}
        onToggleRow={(w, isExpanded) => {
          if (isExpanded || requireEstimated2kTime()) setSelection(isExpanded ? { workoutId: null } : { workoutId: w.id })
        }}
        getRowLabel={(w) => w.workout_code}
        loading={loadingWorkouts}
        emptyMessage="No workouts in this block."
      />
    </>
  )

  const blocksTable = (
    <DataTable
      caption="Blocks"
      columns={blockColumns}
      rows={blocks.map(toBlockRow)}
      getRowId={(b) => b.id}
      selectedId={blockId}
      onSelectRow={(b) => setSelection({ blockId: b.id, workoutId: null, week: null })}
      expandedRowId={blockId}
      renderExpandedRow={() => workoutsTable}
      onToggleRow={(b, isExpanded) => setSelection(
        isExpanded ? { blockId: null, workoutId: null, week: null } : { blockId: b.id, workoutId: null, week: null }
      )}
      getRowLabel={(b) => b.title}
      loading={loadingBlocks}
      emptyMessage="No blocks in this plan."
    />
  )

  const plansTable = (
    <DataTable
      caption="Plans"
      columns={planColumns}
      rows={plans.map(toPlanRow)}
      getRowId={(p) => p.id}
      selectedId={planId}
      onSelectRow={(p) => setSelection({ planId: p.id, blockId: null, workoutId: null, week: null })}
      expandedRowId={planId}
      renderExpandedRow={() => blocksTable}
      onToggleRow={(p, isExpanded) => setSelection(
        isExpanded ? { planId: null, blockId: null, workoutId: null, week: null } : { planId: p.id, blockId: null, workoutId: null, week: null }
      )}
      getRowLabel={(p) => p.title}
      loading={loadingPlans}
      emptyMessage="No plans found."
    />
  )

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

      {plansTable}

      {selectedWorkout && (
        <Pm5WorkoutSender workout={selectedWorkout} intervals={intervals} />
      )}
    </section>
  )
}
