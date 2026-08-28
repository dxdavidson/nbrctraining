// Empirically measured Wolverine L4 target pace reference table (data/imports/workouts/WolverineL4PacesGuidance.csv).
// Keyed by 2K pace (seconds/500m) and stroke rate; values interpolated for inputs between measured rows/columns.

const SPM_COLUMNS = [16, 18, 20, 22, 24, 26] as const

// [2K pace (m:ss), target pace at 16/18/20/22/24/26 spm (m:ss)]
const RAW_ROWS: string[][] = [
  ['1:35', '1:59', '1:55', '1:51', '1:47', '1:43', '1:39'],
  ['1:36', '2:00', '1:56', '1:52', '1:48', '1:44', '1:40'],
  ['1:37', '2:01', '1:57', '1:53', '1:49', '1:45', '1:41'],
  ['1:38', '2:02', '1:58', '1:54', '1:50', '1:46', '1:42'],
  ['1:39', '2:04', '2:00', '1:56', '1:51', '1:47', '1:43'],
  ['1:40', '2:05', '2:01', '1:57', '1:52', '1:48', '1:44'],
  ['1:41', '2:06', '2:02', '1:58', '1:54', '1:49', '1:45'],
  ['1:42', '2:07', '2:03', '1:59', '1:55', '1:50', '1:46'],
  ['1:43', '2:09', '2:04', '2:00', '1:56', '1:52', '1:47'],
  ['1:44', '2:10', '2:06', '2:01', '1:57', '1:53', '1:48'],
  ['1:45', '2:11', '2:07', '2:03', '1:58', '1:54', '1:49'],
  ['1:46', '2:13', '2:08', '2:04', '1:59', '1:55', '1:50'],
  ['1:47', '2:14', '2:09', '2:05', '2:00', '1:56', '1:51'],
  ['1:48', '2:15', '2:10', '2:06', '2:01', '1:57', '1:53'],
  ['1:49', '2:16', '2:12', '2:07', '2:03', '1:58', '1:54'],
  ['1:50', '2:18', '2:13', '2:08', '2:04', '1:59', '1:55'],
  ['1:51', '2:19', '2:14', '2:10', '2:05', '2:00', '1:56'],
  ['1:52', '2:20', '2:15', '2:11', '2:06', '2:01', '1:57'],
  ['1:53', '2:21', '2:17', '2:12', '2:07', '2:02', '1:58'],
  ['1:54', '2:22', '2:18', '2:13', '2:08', '2:03', '1:59'],
  ['1:55', '2:24', '2:19', '2:14', '2:09', '2:05', '2:00'],
  ['1:56', '2:25', '2:20', '2:15', '2:10', '2:06', '2:01'],
  ['1:57', '2:26', '2:21', '2:17', '2:12', '2:07', '2:02'],
  ['1:58', '2:28', '2:23', '2:18', '2:13', '2:08', '2:03'],
  ['1:59', '2:29', '2:24', '2:19', '2:14', '2:09', '2:04'],
  ['2:00', '2:30', '2:25', '2:20', '2:15', '2:10', '2:05'],
  ['2:01', '2:31', '2:26', '2:21', '2:16', '2:11', '2:06'],
  ['2:02', '2:32', '2:27', '2:22', '2:17', '2:12', '2:07'],
  ['2:03', '2:34', '2:29', '2:24', '2:18', '2:13', '2:08'],
  ['2:04', '2:35', '2:30', '2:25', '2:20', '2:14', '2:09'],
  ['2:05', '2:36', '2:31', '2:26', '2:21', '2:15', '2:10'],
  ['2:06', '2:38', '2:32', '2:27', '2:22', '2:16', '2:11'],
  ['2:07', '2:39', '2:33', '2:28', '2:23', '2:18', '2:12'],
  ['2:08', '2:40', '2:35', '2:29', '2:24', '2:19', '2:13'],
  ['2:09', '2:41', '2:36', '2:31', '2:25', '2:20', '2:14'],
  ['2:10', '2:42', '2:37', '2:32', '2:26', '2:21', '2:15'],
  ['2:11', '2:44', '2:38', '2:33', '2:27', '2:22', '2:17'],
  ['2:12', '2:45', '2:39', '2:34', '2:29', '2:23', '2:18'],
  ['2:13', '2:46', '2:41', '2:35', '2:30', '2:24', '2:19'],
  ['2:14', '2:48', '2:42', '2:36', '2:31', '2:25', '2:20'],
  ['2:15', '2:49', '2:43', '2:38', '2:32', '2:26', '2:21'],
  ['2:16', '2:50', '2:44', '2:39', '2:33', '2:27', '2:22'],
  ['2:17', '2:51', '2:45', '2:40', '2:34', '2:28', '2:23'],
  ['2:18', '2:53', '2:47', '2:41', '2:35', '2:29', '2:24'],
  ['2:19', '2:54', '2:48', '2:42', '2:36', '2:31', '2:25'],
  ['2:20', '2:55', '2:49', '2:43', '2:38', '2:32', '2:26'],
  ['2:21', '2:56', '2:50', '2:45', '2:39', '2:33', '2:27'],
  ['2:22', '2:58', '2:52', '2:46', '2:40', '2:34', '2:28'],
  ['2:23', '2:59', '2:53', '2:47', '2:41', '2:35', '2:29'],
  ['2:24', '3:00', '2:54', '2:48', '2:42', '2:36', '2:30'],
  ['2:25', '3:01', '2:55', '2:49', '2:43', '2:37', '2:31'],
  ['2:26', '3:03', '2:56', '2:50', '2:44', '2:38', '2:32'],
  ['2:27', '3:04', '2:58', '2:52', '2:45', '2:39', '2:33'],
  ['2:28', '3:05', '2:59', '2:53', '2:46', '2:40', '2:34'],
  ['2:29', '3:06', '3:00', '2:54', '2:48', '2:41', '2:35'],
  ['2:30', '3:08', '3:01', '2:55', '2:49', '2:42', '2:36'],
]

function parseMinutesSeconds(value: string): number {
  const [minutes, seconds] = value.split(':').map(Number)
  return minutes * 60 + seconds
}

interface TableRow {
  paceSeconds: number
  targets: number[] // aligned with SPM_COLUMNS
}

const TABLE: TableRow[] = RAW_ROWS.map(([pace, ...targets]) => ({
  paceSeconds: parseMinutesSeconds(pace),
  targets: targets.map(parseMinutesSeconds),
}))

function lerp(x: number, x0: number, x1: number, y0: number, y1: number): number {
  if (x1 === x0) return y0
  return y0 + ((x - x0) * (y1 - y0)) / (x1 - x0)
}

function interpolateColumn(row: TableRow, spm: number): number {
  const clampedSpm = Math.min(SPM_COLUMNS[SPM_COLUMNS.length - 1], Math.max(SPM_COLUMNS[0], spm))
  for (let i = 0; i < SPM_COLUMNS.length - 1; i++) {
    if (clampedSpm <= SPM_COLUMNS[i + 1]) {
      return lerp(clampedSpm, SPM_COLUMNS[i], SPM_COLUMNS[i + 1], row.targets[i], row.targets[i + 1])
    }
  }
  return row.targets[row.targets.length - 1]
}

// Bilinear lookup over the reference table; inputs outside the measured range are clamped to its edges.
export function lookupWolverineL4Pace(paceSeconds: number, spm: number): number {
  const first = TABLE[0]
  const last = TABLE[TABLE.length - 1]
  const clampedPace = Math.min(last.paceSeconds, Math.max(first.paceSeconds, paceSeconds))

  let lowerIndex = 0
  for (let i = 0; i < TABLE.length - 1; i++) {
    lowerIndex = i
    if (clampedPace <= TABLE[i + 1].paceSeconds) break
  }

  const lowerRow = TABLE[lowerIndex]
  const upperRow = TABLE[Math.min(lowerIndex + 1, TABLE.length - 1)]
  const lowerTarget = interpolateColumn(lowerRow, spm)
  const upperTarget = interpolateColumn(upperRow, spm)
  return lerp(clampedPace, lowerRow.paceSeconds, upperRow.paceSeconds, lowerTarget, upperTarget)
}
