export interface OtwRecord {
  timestamp: number
  elapsedSeconds: number
  latitude: number | null
  longitude: number | null
  speedMps: number | null
  distanceMeters: number
  cadence: number | null
}

export interface OtwLap {
  label: string
  startElapsedSeconds: number
  endElapsedSeconds: number
  startDistanceMeters: number
  endDistanceMeters: number
}

export interface OtwSession {
  id: string
  mode: 'just-row' | 'workout'
  workoutId: string | null
  workoutName: string | null
  startedAt: string
  endedAt: string | null
  elapsedSeconds: number
  records: OtwRecord[]
  laps: OtwLap[]
}

const DATABASE_NAME = 'nbrc-otw'
const DATABASE_VERSION = 3
const SESSIONS_STORE = 'sessions'
const WORKOUTS_STORE = 'workouts'
const RECORDS_STORE = 'records'

interface StoredOtwRecord {
  sessionId: string
  sequence: number
  record: OtwRecord
}

type StoredOtwSession = Omit<OtwSession, 'records'>

export interface CachedOtwWorkout {
  id: string
  workout_code: string
  description: string | null
  plan_title: string
  block_title: string
  intervals: import('../api').Interval[]
}

let databasePromise: Promise<IDBDatabase> | null = null

function openDatabase(): Promise<IDBDatabase> {
  if (!('indexedDB' in window)) return Promise.reject(new Error('IndexedDB is not available in this browser.'))
  if (databasePromise) return databasePromise

  databasePromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = (event) => {
      const database = request.result
      if (!database.objectStoreNames.contains(SESSIONS_STORE)) database.createObjectStore(SESSIONS_STORE, { keyPath: 'id' })
      if (!database.objectStoreNames.contains(WORKOUTS_STORE)) database.createObjectStore(WORKOUTS_STORE, { keyPath: 'id' })
      if (!database.objectStoreNames.contains(RECORDS_STORE)) {
        const records = database.createObjectStore(RECORDS_STORE, { keyPath: ['sessionId', 'sequence'] })
        records.createIndex('sessionId', 'sessionId')
      }

      if (event.oldVersion > 0 && event.oldVersion < 3) {
        const transaction = request.transaction
        if (!transaction) throw new Error('Unable to migrate OTW sessions during database upgrade.')
        const sessions = transaction.objectStore(SESSIONS_STORE)
        const records = transaction.objectStore(RECORDS_STORE)
        const cursorRequest = sessions.openCursor()
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result
          if (!cursor) return
          const previous = cursor.value as OtwSession
          if (Array.isArray(previous.records)) {
            previous.records.forEach((record, sequence) => {
              records.put({ sessionId: previous.id, sequence, record } satisfies StoredOtwRecord)
            })
            const metadata: StoredOtwSession = {
              id: previous.id,
              mode: previous.mode,
              workoutId: previous.workoutId,
              workoutName: previous.workoutName,
              startedAt: previous.startedAt,
              endedAt: previous.endedAt,
              elapsedSeconds: previous.elapsedSeconds,
              laps: previous.laps,
            }
            cursor.update(metadata)
          }
          cursor.continue()
        }
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => {
      databasePromise = null
      reject(request.error ?? new Error('Unable to open the OTW session database.'))
    }
    request.onblocked = () => reject(new Error('The OTW session database is blocked by another open tab.'))
  })
  return databasePromise
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('The OTW session database transaction failed.'))
    transaction.onabort = () => reject(transaction.error ?? new Error('The OTW session database transaction was aborted.'))
  })
}

export async function saveOtwSession(session: OtwSession): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction(SESSIONS_STORE, 'readwrite')
  const metadata: StoredOtwSession = {
    id: session.id,
    mode: session.mode,
    workoutId: session.workoutId,
    workoutName: session.workoutName,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    elapsedSeconds: session.elapsedSeconds,
    laps: session.laps,
  }
  transaction.objectStore(SESSIONS_STORE).put(metadata)
  await transactionDone(transaction)
}

export async function appendOtwRecord(sessionId: string, sequence: number, record: OtwRecord): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction(RECORDS_STORE, 'readwrite')
  const stored: StoredOtwRecord = { sessionId, sequence, record }
  transaction.objectStore(RECORDS_STORE).put(stored)
  await transactionDone(transaction)
}

export async function deleteOtwSession(id: string): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction([SESSIONS_STORE, RECORDS_STORE], 'readwrite')
  transaction.objectStore(SESSIONS_STORE).delete(id)
  const records = transaction.objectStore(RECORDS_STORE)
  const request = records.index('sessionId').openKeyCursor(IDBKeyRange.only(id))
  request.onsuccess = () => {
    const cursor = request.result
    if (!cursor) return
    records.delete(cursor.primaryKey)
    cursor.continue()
  }
  await transactionDone(transaction)
}

export async function getLatestCompletedOtwSession(): Promise<OtwSession | null> {
  const database = await openDatabase()
  const transaction = database.transaction(SESSIONS_STORE, 'readonly')
  const request = transaction.objectStore(SESSIONS_STORE).getAll() as IDBRequest<StoredOtwSession[]>
  const sessions = await new Promise<StoredOtwSession[]>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Unable to read OTW sessions.'))
  })
  await transactionDone(transaction)
  const latest = sessions
    .filter((session) => session.endedAt !== null)
    .sort((first, second) => second.startedAt.localeCompare(first.startedAt))[0]
  if (!latest) return null

  const recordsTransaction = database.transaction(RECORDS_STORE, 'readonly')
  const recordRequest = recordsTransaction.objectStore(RECORDS_STORE).index('sessionId').getAll(latest.id) as IDBRequest<StoredOtwRecord[]>
  const records = await new Promise<StoredOtwRecord[]>((resolve, reject) => {
    recordRequest.onsuccess = () => resolve(recordRequest.result)
    recordRequest.onerror = () => reject(recordRequest.error ?? new Error('Unable to read OTW session records.'))
  })
  await transactionDone(recordsTransaction)
  return { ...latest, records: records.sort((first, second) => first.sequence - second.sequence).map(({ record }) => record) }
}

export async function getCompletedOtwSessions(): Promise<OtwSession[]> {
  const database = await openDatabase()
  const sessionsTransaction = database.transaction(SESSIONS_STORE, 'readonly')
  const request = sessionsTransaction.objectStore(SESSIONS_STORE).getAll() as IDBRequest<StoredOtwSession[]>
  const sessions = await new Promise<StoredOtwSession[]>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Unable to read OTW session history.'))
  })
  await transactionDone(sessionsTransaction)
  const completed = sessions
    .filter((session) => session.endedAt !== null)
    .sort((first, second) => second.startedAt.localeCompare(first.startedAt))
  if (completed.length === 0) return []

  const recordsTransaction = database.transaction(RECORDS_STORE, 'readonly')
  const recordsStore = recordsTransaction.objectStore(RECORDS_STORE).index('sessionId')
  const recordRequests = completed.map((session) => {
    const recordsRequest = recordsStore.getAll(session.id) as IDBRequest<StoredOtwRecord[]>
    return new Promise<StoredOtwRecord[]>((resolve, reject) => {
      recordsRequest.onsuccess = () => resolve(recordsRequest.result)
      recordsRequest.onerror = () => reject(recordsRequest.error ?? new Error('Unable to read OTW session records.'))
    })
  })
  const recordsBySession = await Promise.all(recordRequests)
  await transactionDone(recordsTransaction)
  return completed.map((session, index) => ({
    ...session,
    records: recordsBySession[index]
      .sort((first, second) => first.sequence - second.sequence)
      .map(({ record }) => record),
  }))
}

export async function saveOtwWorkouts(workouts: CachedOtwWorkout[]): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction(WORKOUTS_STORE, 'readwrite')
  const store = transaction.objectStore(WORKOUTS_STORE)
  store.clear()
  for (const workout of workouts) store.put(workout)
  await transactionDone(transaction)
}

export async function getCachedOtwWorkouts(): Promise<CachedOtwWorkout[]> {
  const database = await openDatabase()
  const transaction = database.transaction(WORKOUTS_STORE, 'readonly')
  const request = transaction.objectStore(WORKOUTS_STORE).getAll() as IDBRequest<CachedOtwWorkout[]>
  const result = await new Promise<CachedOtwWorkout[]>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Unable to read cached OTW workouts.'))
  })
  await transactionDone(transaction)
  return result
}

export function createOtwSession(mode: OtwSession['mode'] = 'just-row'): OtwSession {
  return {
    id: crypto.randomUUID(),
    mode,
    workoutId: null,
    workoutName: null,
    startedAt: new Date().toISOString(),
    endedAt: null,
    elapsedSeconds: 0,
    records: [],
    laps: [],
  }
}
