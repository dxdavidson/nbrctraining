import { describe, expect, it } from 'vitest'
import { encodeFitSession, fitCrc16 } from './fitExport'
import type { OtwSession } from './sessionStore'

const session: OtwSession = {
  id: 'test',
  mode: 'just-row',
  workoutId: null,
  workoutName: null,
  startedAt: '2026-01-01T00:00:00.000Z',
  endedAt: '2026-01-01T00:00:02.000Z',
  elapsedSeconds: 2,
  records: [
    { timestamp: Date.parse('2026-01-01T00:00:00Z'), elapsedSeconds: 0, latitude: 51, longitude: -1, speedMps: 3, distanceMeters: 0, cadence: null },
    { timestamp: Date.parse('2026-01-01T00:00:01Z'), elapsedSeconds: 1, latitude: 51.0001, longitude: -1, speedMps: 3.2, distanceMeters: 3, cadence: 30 },
    { timestamp: Date.parse('2026-01-01T00:00:02Z'), elapsedSeconds: 2, latitude: 51.0002, longitude: -1, speedMps: 3.1, distanceMeters: 6, cadence: null },
  ],
  laps: [{ label: 'Session', startElapsedSeconds: 0, endElapsedSeconds: 2, startDistanceMeters: 0, endDistanceMeters: 6 }],
}

function readFitMessages(file: Uint8Array): { globalMessage: number; fields: number[]; values: Map<number, number> }[] {
  const data = file.slice(14, -2)
  const definitions = new Map<number, { globalMessage: number; fields: { number: number; size: number }[] }>()
  const messages: { globalMessage: number; fields: number[]; values: Map<number, number> }[] = []
  let offset = 0

  while (offset < data.length) {
    const header = data[offset++]
    const localMessage = header & 0x0f
    if ((header & 0x40) !== 0) {
      offset += 2
      const view = new DataView(data.buffer, data.byteOffset + offset, 2)
      const globalMessage = view.getUint16(0, true)
      offset += 2
      const fieldCount = data[offset++]
      const fields = Array.from({ length: fieldCount }, () => {
        const field = { number: data[offset], size: data[offset + 1] }
        offset += 3
        return field
      })
      definitions.set(localMessage, { globalMessage, fields })
      continue
    }

    const definition = definitions.get(localMessage)
    if (!definition) throw new Error(`Missing definition for local message ${localMessage}.`)
    const values = new Map<number, number>()
    for (const field of definition.fields) {
      const view = new DataView(data.buffer, data.byteOffset + offset, field.size)
      const value = field.size === 1 ? view.getUint8(0) : field.size === 2 ? view.getUint16(0, true) : view.getUint32(0, true)
      values.set(field.number, value)
      offset += field.size
    }
    messages.push({
      globalMessage: definition.globalMessage,
      fields: definition.fields.map((field) => field.number),
      values,
    })
  }
  return messages
}

describe('FIT export', () => {
  it('uses the FIT CRC-16 algorithm', () => {
    expect(fitCrc16(new TextEncoder().encode('123456789'))).toBe(0xbb3d)
    expect(fitCrc16(new Uint8Array([14, 32, 0, 8, 243, 12, 0, 0, 46, 70, 73, 84]))).toBe(0x1478)
  })

  it('writes a valid FIT header, data length, and CRCs', () => {
    const file = encodeFitSession(session)
    const view = new DataView(file.buffer, file.byteOffset, file.byteLength)
    const dataSize = view.getUint32(4, true)

    expect(file[0]).toBe(14)
    expect(Array.from(file.slice(8, 12))).toEqual([0x2e, 0x46, 0x49, 0x54])
    expect(dataSize).toBe(file.length - 16)
    expect(view.getUint16(12, true)).toBe(fitCrc16(file.slice(0, 12)))
    expect(view.getUint16(file.length - 2, true)).toBe(fitCrc16(file.slice(0, -2)))
    expect(fitCrc16(file)).toBe(0)
  })

  it('emits record definitions with cadence only for records that have a rate', () => {
    const records = readFitMessages(encodeFitSession(session)).filter((message) => message.globalMessage === 20)
    expect(records.map((record) => record.fields.includes(4))).toEqual([false, true, false])
  })

  it('writes one FIT Lap message per completed interval', () => {
    const twoLaps = {
      ...session,
      laps: [
        { label: 'Work 1', startElapsedSeconds: 0, endElapsedSeconds: 1, startDistanceMeters: 0, endDistanceMeters: 3 },
        { label: 'Work 2', startElapsedSeconds: 1, endElapsedSeconds: 2, startDistanceMeters: 3, endDistanceMeters: 6 },
      ],
    }

    const laps = readFitMessages(encodeFitSession(twoLaps)).filter((message) => message.globalMessage === 19)
    expect(laps).toHaveLength(2)
  })

  it('exports work laps only while retaining recovery records and session totals', () => {
    const started = Date.parse(session.startedAt)
    const workoutSession: OtwSession = {
      ...session,
      mode: 'workout',
      endedAt: new Date(started + 9000).toISOString(),
      elapsedSeconds: 9,
      records: [
        session.records[0],
        { ...session.records[1], timestamp: started + 4000, elapsedSeconds: 4, distanceMeters: 8 },
        { ...session.records[2], timestamp: started + 9000, elapsedSeconds: 9, distanceMeters: 18 },
      ],
      laps: [
        { label: 'work recovery', kind: 'work', startElapsedSeconds: 0, endElapsedSeconds: 3, startDistanceMeters: 0, endDistanceMeters: 6 },
        { label: 'work recovery recovery', kind: 'recovery', startElapsedSeconds: 3, endElapsedSeconds: 5, startDistanceMeters: 6, endDistanceMeters: 10 },
        { label: 'second', kind: 'work', startElapsedSeconds: 5, endElapsedSeconds: 7, startDistanceMeters: 10, endDistanceMeters: 14 },
        { label: 'third', kind: 'work', startElapsedSeconds: 7, endElapsedSeconds: 9, startDistanceMeters: 14, endDistanceMeters: 18 },
      ],
    }
    const encoded = encodeFitSession(workoutSession)
    const messages = readFitMessages(encoded)
    const fitStart = started / 1000 - 631_065_600
    const laps = messages.filter((message) => message.globalMessage === 19)
    expect(laps.map((lap) => [lap.values.get(2), lap.values.get(253), lap.values.get(9), lap.values.get(254)])).toEqual([
      [fitStart, fitStart + 3, 600, 0],
      [fitStart + 5, fitStart + 7, 400, 1],
      [fitStart + 7, fitStart + 9, 400, 2],
    ])
    const summary = messages.find((message) => message.globalMessage === 18)
    expect(summary?.values.get(26)).toBe(3)
    expect(summary?.values.get(9)).toBe(1800)
    expect(summary?.values.get(8)).toBe(9000)
    expect(messages.filter((message) => message.globalMessage === 20)).toHaveLength(3)
    expect(fitCrc16(encoded)).toBe(0)
  })

  it('does not create a replacement workout lap for a recovery-only or empty session', () => {
    const recovery = { label: 'recovery', kind: 'recovery' as const, startElapsedSeconds: 0, endElapsedSeconds: 2, startDistanceMeters: 0, endDistanceMeters: 6 }
    for (const laps of [[], [recovery]]) {
      const messages = readFitMessages(encodeFitSession({ ...session, mode: 'workout', laps }))
      expect(messages.filter((message) => message.globalMessage === 19)).toHaveLength(0)
      expect(messages.find((message) => message.globalMessage === 18)?.values.get(26)).toBe(0)
    }
    expect(readFitMessages(encodeFitSession({ ...session, laps: [] })).filter((message) => message.globalMessage === 19)).toHaveLength(1)
  })

  it('rejects workout laps whose kinds are unknown instead of guessing from names', () => {
    expect(() => encodeFitSession({ ...session, mode: 'workout' })).toThrow('identifying work and recovery')
  })

  it('exports pause and resume timer events and separates elapsed from active time', () => {
    const started = Date.parse(session.startedAt)
    const baseRecord = session.records[0]
    const paused: OtwSession = {
      ...session,
      endedAt: new Date(started + 19000).toISOString(),
      elapsedSeconds: 4,
      records: [
        baseRecord,
        { ...baseRecord, timestamp: started + 2000, elapsedSeconds: 2, distanceMeters: 6, timerEvent: 'pause' },
        { ...baseRecord, timestamp: started + 12000, elapsedSeconds: 2, distanceMeters: 6, latitude: null, longitude: null, timerEvent: 'resume' },
        { ...baseRecord, timestamp: started + 14000, elapsedSeconds: 4, distanceMeters: 12, timerEvent: 'pause' },
      ],
      laps: [
        { label: 'First', startElapsedSeconds: 0, endElapsedSeconds: 2, startDistanceMeters: 0, endDistanceMeters: 6 },
        { label: 'Second', startElapsedSeconds: 2, endElapsedSeconds: 4, startDistanceMeters: 6, endDistanceMeters: 12 },
      ],
    }
    const messages = readFitMessages(encodeFitSession(paused))
    const fitStart = started / 1000 - 631_065_600
    expect(messages.filter((message) => message.globalMessage === 21).map((message) =>
      [message.values.get(253), message.values.get(1)],
    )).toEqual([[fitStart, 0], [fitStart + 2, 1], [fitStart + 12, 0], [fitStart + 14, 1]])
    const summary = messages.find((message) => message.globalMessage === 18)
    expect(summary?.values.get(7)).toBe(19000)
    expect(summary?.values.get(8)).toBe(4000)
    const laps = messages.filter((message) => message.globalMessage === 19)
    expect(laps.map((lap) => [lap.values.get(2), lap.values.get(253), lap.values.get(7), lap.values.get(8)])).toEqual([
      [fitStart, fitStart + 2, 2000, 2000],
      [fitStart + 12, fitStart + 14, 2000, 2000],
    ])
    expect(fitCrc16(encodeFitSession(paused))).toBe(0)
  })

  it('ends a resumed timer when an interval session completes automatically', () => {
    const started = Date.parse(session.startedAt)
    const baseRecord = session.records[0]
    const resumed: OtwSession = {
      ...session,
      endedAt: new Date(started + 14000).toISOString(),
      elapsedSeconds: 4,
      records: [
        baseRecord,
        { ...baseRecord, timestamp: started + 2000, elapsedSeconds: 2, timerEvent: 'pause' },
        { ...baseRecord, timestamp: started + 12000, elapsedSeconds: 2, timerEvent: 'resume' },
        { ...baseRecord, timestamp: started + 14000, elapsedSeconds: 4 },
      ],
      laps: [{ label: 'Work', startElapsedSeconds: 0, endElapsedSeconds: 4, startDistanceMeters: 0, endDistanceMeters: 6 }],
    }
    const messages = readFitMessages(encodeFitSession(resumed))
    const timerEvents = messages.filter((message) => message.globalMessage === 21)
    expect(timerEvents.map((event) => event.values.get(1))).toEqual([0, 1, 0, 1])
    expect(timerEvents.at(-1)?.values.get(253)).toBe(started / 1000 - 631_065_600 + 14)
    const lap = messages.find((message) => message.globalMessage === 19)
    expect(lap?.values.get(7)).toBe(14000)
    expect(lap?.values.get(8)).toBe(4000)
  })
})
