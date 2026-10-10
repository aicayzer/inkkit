import { describe, expect, it } from 'vitest'
import { readSetup, setupURL, validateSetup } from '../playground/configuration'
import { serialise } from '../playground/evidence'

describe('playground reproduction data', () => {
  it('retains independent overrides and unrelated URL parameters', () => {
    const setup = readSetup(
      '?fixture=untidy&adapter=hold&imageImport=reject&imageExport=corrupt&fileAdapter=normal&editable=false&editors=2',
    )
    const url = new URL(setupURL(setup, 'http://localhost/?debug=true'))
    expect(readSetup(url.search)).toEqual(setup)
    expect(url.searchParams.get('debug')).toBe('true')
    expect(setup.imageImport).toBe('reject')
    expect(setup.fileAdapter).toBe('normal')
  })
  it('rejects prototype fixture names and unsupported import corruption', () => {
    for (const query of [
      '?fixture=constructor',
      '?fixture=__proto__',
      '?imageImport=corrupt',
      '?adapter=corrupt',
    ])
      expect(() => readSetup(query)).toThrow()
    expect(() => validateSetup({ ...readSetup(''), editors: 3 as 2 })).toThrow(
      'Editors',
    )
  })
  it('serialises the exact byte view and structured errors', () => {
    const bytes = new Uint8Array([0, 255, 128, 42])
    const error = Object.assign(new Error('Refused'), { code: 'read-only' })
    expect(serialise({ bytes: bytes.subarray(1, 3), error })).toEqual({
      bytes: { $binary: 'base64', data: '/4A=', byteLength: 2 },
      error: { code: 'read-only', message: 'Refused' },
    })
    expect(bytes).toEqual(new Uint8Array([0, 255, 128, 42]))
  })
})
