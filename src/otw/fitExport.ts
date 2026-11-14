import type { OtwRecord, OtwSession } from './sessionStore'

type FitBaseType = 'enum' | 'uint8' | 'uint16' | 'uint32' | 'sint32'

interface FitField {
  number: number
  size: number
  type: FitBaseType
}

const UINT8_INVALID = 0xff
const UINT16_INVALID = 0xffff
const UINT32_INVALID = 0xffffffff
const SINT32_INVALID = 0x7fffffff
const FIT_EPOCH_UNIX_SECONDS = 631_065_600

const BASE_TYPE_IDS: Record<FitBaseType, number> = {
  enum: 0x00,
  uint8: 0x02,
  uint16: 0x84,
  uint32: 0x86,
  sint32: 0x85,
}

const FILE_ID_FIELDS: FitField[] = [
  { number: 0, size: 1, type: 'enum' },
  { number: 1, size: 2, type: 'uint16' },
  { number: 2, size: 2, type: 'uint16' },
  { number: 3, size: 4, type: 'uint32' },
  { number: 4, size: 4, type: 'uint32' },
]

const RECORD_FIELDS: FitField[] = [
  { number: 253, size: 4, type: 'uint32' },
  { number: 0, size: 4, type: 'sint32' },
  { number: 1, size: 4, type: 'sint32' },
  { number: 5, size: 4, type: 'uint32' },
  { number: 6, size: 2, type: 'uint16' },
]

const RECORD_CADENCE_FIELDS = [...RECORD_FIELDS, { number: 4, size: 1, type: 'uint8' as const }]

const LAP_FIELDS: FitField[] = [
  { number: 253, size: 4, type: 'uint32' },
  { number: 0, size: 1, type: 'enum' },
  { number: 1, size: 1, type: 'enum' },
  { number: 2, size: 4, type: 'uint32' },
  { number: 3, size: 4, type: 'sint32' },
  { number: 4, size: 4, type: 'sint32' },
  { number: 5, size: 4, type: 'sint32' },
  { number: 6, size: 4, type: 'sint32' },
  { number: 7, size: 4, type: 'uint32' },
  { number: 8, size: 4, type: 'uint32' },
  { number: 9, size: 4, type: 'uint32' },
  { number: 13, size: 2, type: 'uint16' },
  { number: 14, size: 2, type: 'uint16' },
  { number: 25, size: 1, type: 'enum' },
  { number: 26, size: 1, type: 'enum' },
  { number: 254, size: 2, type: 'uint16' },
]

const SESSION_FIELDS: FitField[] = [
  { number: 253, size: 4, type: 'uint32' },
  { number: 0, size: 1, type: 'enum' },
  { number: 1, size: 1, type: 'enum' },
  { number: 2, size: 4, type: 'uint32' },
  { number: 3, size: 4, type: 'sint32' },
  { number: 4, size: 4, type: 'sint32' },
  { number: 5, size: 1, type: 'enum' },
  { number: 6, size: 1, type: 'enum' },
  { number: 7, size: 4, type: 'uint32' },
  { number: 8, size: 4, type: 'uint32' },
  { number: 9, size: 4, type: 'uint32' },
  { number: 14, size: 2, type: 'uint16' },
  { number: 15, size: 2, type: 'uint16' },
  { number: 25, size: 2, type: 'uint16' },
  { number: 26, size: 2, type: 'uint16' },
  { number: 254, size: 2, type: 'uint16' },
]

const ACTIVITY_FIELDS: FitField[] = [
  { number: 253, size: 4, type: 'uint32' },
  { number: 0, size: 4, type: 'uint32' },
  { number: 1, size: 2, type: 'uint16' },
  { number: 3, size: 1, type: 'enum' },
  { number: 4, size: 1, type: 'enum' },
  { number: 5, size: 1, type: 'enum' },
  { number: 6, size: 1, type: 'uint8' },
]

function appendUnsigned(bytes: number[], value: number, size: number): void {
  const safeValue = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0
  for (let index = 0; index < size; index += 1) bytes.push((safeValue >>> (index * 8)) & 0xff)
}

function appendSigned32(bytes: number[], value: number): void {
  const view = new DataView(new ArrayBuffer(4))
  view.setInt32(0, Number.isFinite(value) ? Math.round(value) : SINT32_INVALID, true)
  bytes.push(...new Uint8Array(view.buffer))
}

function invalidValue(field: FitField): number {
  if (field.type === 'sint32') return SINT32_INVALID
  if (field.size === 1) return UINT8_INVALID
  if (field.size === 2) return UINT16_INVALID
  return UINT32_INVALID
}

function appendValue(bytes: number[], field: FitField, value: number | null): void {
  if (field.type === 'sint32') {
    appendSigned32(bytes, value === null ? SINT32_INVALID : value)
    return
  }
  appendUnsigned(bytes, value === null ? invalidValue(field) : value, field.size)
}

function appendDefinition(bytes: number[], localMessage: number, globalMessage: number, fields: FitField[]): void {
  bytes.push(0x40 | localMessage, 0, 0)
  appendUnsigned(bytes, globalMessage, 2)
  bytes.push(fields.length)
  for (const field of fields) {
    bytes.push(field.number, field.size, BASE_TYPE_IDS[field.type])
  }
}

function appendMessage(bytes: number[], localMessage: number, fields: FitField[], values: number[]): void {
  bytes.push(localMessage)
  fields.forEach((field, index) => appendValue(bytes, field, Number.isFinite(values[index]) ? values[index] : null))
}

export function fitCrc16(bytes: Uint8Array): number {
  let crc = 0
  for (const byte of bytes) {
    let value = (crc ^ byte) & 0xff
    value = (value ^ (value << 4)) & 0xff
    crc = ((crc >>> 8) ^ (value << 8) ^ (value << 3) ^ (value >>> 4)) & 0xffff
  }
  return crc
}

function fitTimestamp(unixMilliseconds: number): number {
  return Math.max(0, Math.floor(unixMilliseconds / 1000) - FIT_EPOCH_UNIX_SECONDS)
}

function semicircles(degrees: number | null): number {
  return degrees === null ? SINT32_INVALID : Math.round((degrees * 2 ** 31) / 180)
}

function firstPosition(records: OtwRecord[]): OtwRecord | undefined {
  return records.find((record) => record.latitude !== null && record.longitude !== null)
}

function lastPosition(records: OtwRecord[]): OtwRecord | undefined {
  return [...records].reverse().find((record) => record.latitude !== null && record.longitude !== null)
}

function sessionLaps(session: OtwSession) {
  if (session.laps.length > 0) return session.laps
  return [{
    label: 'Session',
    startElapsedSeconds: 0,
    endElapsedSeconds: session.elapsedSeconds,
    startDistanceMeters: 0,
    endDistanceMeters: session.records.at(-1)?.distanceMeters ?? 0,
  }]
}

export function encodeFitSession(session: OtwSession): Uint8Array {
  const data: number[] = []
  const startedAt = new Date(session.startedAt).getTime()
  const endedAt = session.endedAt ? new Date(session.endedAt).getTime() : startedAt + session.elapsedSeconds * 1000
  const totalDistanceMeters = session.records.at(-1)?.distanceMeters ?? 0
  const durationMilliseconds = Math.max(0, session.elapsedSeconds * 1000)
  const speeds = session.records.map((record) => record.speedMps).filter((speed): speed is number => speed !== null)
  const averageSpeed = durationMilliseconds > 0 ? totalDistanceMeters / (durationMilliseconds / 1000) : null
  const maximumSpeed = speeds.length > 0 ? Math.max(...speeds) : null
  const first = firstPosition(session.records)

  appendDefinition(data, 0, 0, FILE_ID_FIELDS)
  appendMessage(data, 0, FILE_ID_FIELDS, [4, 1, 0, 0, fitTimestamp(startedAt)])

  for (const record of session.records) {
    const withCadence = record.cadence !== null
    const fields = withCadence ? RECORD_CADENCE_FIELDS : RECORD_FIELDS
    const localMessage = withCadence ? 1 : 0
    appendDefinition(data, localMessage, 20, fields)
    const values = [
      fitTimestamp(record.timestamp),
      semicircles(record.latitude),
      semicircles(record.longitude),
      Math.round(record.distanceMeters * 100),
      record.speedMps === null ? Number.NaN : Math.round(record.speedMps * 1000),
    ]
    if (withCadence) values.push(Math.round(record.cadence as number))
    appendMessage(data, localMessage, fields, values)
  }

  const laps = sessionLaps(session)
  laps.forEach((lap, index) => {
    const lapRecords = session.records.filter(
      (record) => record.elapsedSeconds >= lap.startElapsedSeconds && record.elapsedSeconds <= lap.endElapsedSeconds,
    )
    const startPosition = firstPosition(lapRecords)
    const endPosition = lastPosition(lapRecords)
    const lapDuration = Math.max(0, lap.endElapsedSeconds - lap.startElapsedSeconds)
    const lapDistance = Math.max(0, lap.endDistanceMeters - lap.startDistanceMeters)
    const lapSpeeds = lapRecords.map((record) => record.speedMps).filter((speed): speed is number => speed !== null)
    const lapAverageSpeed = lapDuration > 0 ? lapDistance / lapDuration : null
    const lapMaximumSpeed = lapSpeeds.length > 0 ? Math.max(...lapSpeeds) : null
    const lapTimestamp = startedAt + lap.endElapsedSeconds * 1000

    if (index === 0) appendDefinition(data, 2, 19, LAP_FIELDS)
    appendMessage(data, 2, LAP_FIELDS, [
      fitTimestamp(lapTimestamp),
      9,
      1,
      fitTimestamp(startedAt + lap.startElapsedSeconds * 1000),
      semicircles(startPosition?.latitude ?? null),
      semicircles(startPosition?.longitude ?? null),
      semicircles(endPosition?.latitude ?? null),
      semicircles(endPosition?.longitude ?? null),
      Math.round(lapDuration * 1000),
      Math.round(lapDuration * 1000),
      Math.round(lapDistance * 100),
      lapAverageSpeed === null ? Number.NaN : Math.round(lapAverageSpeed * 1000),
      lapMaximumSpeed === null ? Number.NaN : Math.round(lapMaximumSpeed * 1000),
      15,
      0,
      index,
    ])
  })

  appendDefinition(data, 3, 18, SESSION_FIELDS)
  appendMessage(data, 3, SESSION_FIELDS, [
    fitTimestamp(endedAt),
    8,
    1,
    fitTimestamp(startedAt),
    semicircles(first?.latitude ?? null),
    semicircles(first?.longitude ?? null),
    15,
    0,
    Math.round(durationMilliseconds),
    Math.round(durationMilliseconds),
    Math.round(totalDistanceMeters * 100),
    averageSpeed === null ? Number.NaN : Math.round(averageSpeed * 1000),
    maximumSpeed === null ? Number.NaN : Math.round(maximumSpeed * 1000),
    0,
    laps.length,
    0,
  ])

  appendDefinition(data, 4, 34, ACTIVITY_FIELDS)
  appendMessage(data, 4, ACTIVITY_FIELDS, [fitTimestamp(endedAt), Math.round(durationMilliseconds), 1, 0, 26, 1, 0])

  const header = [14, 0x20, 0x00, 0x08]
  appendUnsigned(header, data.length, 4)
  header.push(0x2e, 0x46, 0x49, 0x54)
  appendUnsigned(header, fitCrc16(new Uint8Array(header)), 2)

  const file = [...header, ...data]
  appendUnsigned(file, fitCrc16(new Uint8Array(data)), 2)
  return new Uint8Array(file)
}

export function downloadFitSession(session: OtwSession): void {
  const bytes = encodeFitSession(session)
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  const blob = new Blob([buffer], { type: 'application/vnd.ant.fit' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `nbrc-otw-${session.startedAt.slice(0, 10)}.fit`
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
