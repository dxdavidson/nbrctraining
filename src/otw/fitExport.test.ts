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

function readFitMessages(file: Uint8Array): { globalMessage: number; fields: number[] }[] {
  const data = file.slice(14, -2)
  const definitions = new Map<number, { globalMessage: number; fields: { number: number; size: number }[] }>()
  const messages: { globalMessage: number; fields: number[] }[] = []
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
    messages.push({
      globalMessage: definition.globalMessage,
      fields: definition.fields.map((field) => field.number),
    })
    offset += definition.fields.reduce((size, field) => size + field.size, 0)
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
})
