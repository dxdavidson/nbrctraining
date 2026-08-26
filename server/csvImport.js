const REQUIRED_COLUMNS = [
  'plan_code',
  'block_code',
  'workout_code',
  'interval_code',
  'interval_order',
  'repeat_count',
  'work_kind',
  'work_value',
  'recovery_kind',
  'recovery_value',
]

const INTEGER_COLUMNS = ['interval_order', 'repeat_count', 'work_value', 'spm']
const NUMBER_COLUMNS = ['recovery_value', 'target_value']
const ALLOWED_WORK_KINDS = new Set(['distance', 'time'])

function parseCsvLine(line) {
  const values = []
  let value = ''
  let quoted = false

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    const nextCharacter = line[index + 1]

    if (character === '"' && quoted && nextCharacter === '"') {
      value += '"'
      index += 1
    } else if (character === '"') {
      quoted = !quoted
    } else if (character === ',' && !quoted) {
      values.push(value)
      value = ''
    } else {
      value += character
    }
  }

  if (quoted) {
    throw new Error('CSV contains an unterminated quoted field.')
  }

  values.push(value)
  return values
}

function clean(value) {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function parseNumber(value, column, rowNumber, integer) {
  if (value === null) return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || (integer && !Number.isInteger(parsed))) {
    throw new Error(`Row ${rowNumber}: ${column} must be a valid ${integer ? 'integer' : 'number'}.`)
  }
  return parsed
}

export function parseWorkoutCsv(csvText) {
  if (typeof csvText !== 'string' || csvText.trim() === '') {
    throw new Error('CSV file is empty.')
  }

  const lines = csvText.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim() !== '')
  const headers = parseCsvLine(lines[0]).map((header) => header.trim())
  const missingColumns = REQUIRED_COLUMNS.filter((column) => !headers.includes(column))
  if (missingColumns.length > 0) {
    throw new Error(`CSV is missing required columns: ${missingColumns.join(', ')}.`)
  }
  if (new Set(headers).size !== headers.length) {
    throw new Error('CSV contains duplicate column names.')
  }

  const rows = lines.slice(1).map((line, lineIndex) => {
    const values = parseCsvLine(line)
    if (values.length !== headers.length) {
      throw new Error(`Row ${lineIndex + 2}: expected ${headers.length} columns but found ${values.length}.`)
    }

    const row = Object.fromEntries(headers.map((header, index) => [header, clean(values[index])]))
    for (const column of INTEGER_COLUMNS) {
      row[column] = parseNumber(row[column], column, lineIndex + 2, true)
    }
    for (const column of NUMBER_COLUMNS) {
      row[column] = parseNumber(row[column], column, lineIndex + 2, false)
    }

    if (!row.plan_code || !row.block_code || !row.workout_code || !row.interval_code) {
      throw new Error(`Row ${lineIndex + 2}: plan_code, block_code, workout_code, and interval_code are required.`)
    }
    if (!Number.isInteger(row.interval_order) || row.interval_order < 1) {
      throw new Error(`Row ${lineIndex + 2}: interval_order must be a positive integer.`)
    }
    if (!Number.isInteger(row.repeat_count) || row.repeat_count < 1) {
      throw new Error(`Row ${lineIndex + 2}: repeat_count must be a positive integer.`)
    }
    if (!row.work_kind || !ALLOWED_WORK_KINDS.has(row.work_kind)) {
      throw new Error(`Row ${lineIndex + 2}: work_kind must be distance or time.`)
    }

    return row
  })

  if (rows.length === 0) {
    throw new Error('CSV contains a header but no data rows.')
  }

  const workoutFields = ['plan_code', 'block_code', 'week_commencing', 'description', 'sort_order', 'level']
  const workoutValues = new Map()
  const intervalKeys = new Set()
  for (const row of rows) {
    const workoutKey = `${row.plan_code}\u0000${row.block_code}\u0000${row.workout_code}`
    const currentWorkout = Object.fromEntries(workoutFields.map((field) => [field, row[field] ?? null]))
    const previousWorkout = workoutValues.get(workoutKey)
    if (previousWorkout && JSON.stringify(previousWorkout) !== JSON.stringify(currentWorkout)) {
      throw new Error(`Workout ${row.workout_code} has inconsistent repeated workout fields.`)
    }
    workoutValues.set(workoutKey, currentWorkout)

    const intervalKey = `${workoutKey}\u0000${row.interval_code}`
    if (intervalKeys.has(intervalKey)) {
      throw new Error(`Workout ${row.workout_code} contains duplicate interval_code ${row.interval_code}.`)
    }
    intervalKeys.add(intervalKey)
  }

  return rows
}

export function groupWorkouts(rows) {
  const workouts = new Map()
  for (const row of rows) {
    const key = `${row.plan_code}\u0000${row.block_code}\u0000${row.workout_code}`
    if (!workouts.has(key)) {
      workouts.set(key, { key, workout: row, intervals: [] })
    }
    workouts.get(key).intervals.push(row)
  }
  return [...workouts.values()]
}
