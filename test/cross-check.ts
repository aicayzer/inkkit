// A setup file of its own: importing the editor's modules reads the platform,
// which `setup.ts` sets first.
import { appendFileSync } from 'node:fs'
import { afterAll, afterEach, expect } from 'vitest'
import { crossCheck } from '../src/preserve'

// Every save that does not take the whole-document path is saved through it
// too, and must give the same bytes or the same refusal. Set
// INKKIT_CROSS_CHECK=0 to time the suite without it.
crossCheck.enabled = process.env.INKKIT_CROSS_CHECK !== '0'
afterEach(() => {
  const differences = crossCheck.differences.splice(0)
  expect(differences, 'saves that differ from the whole-document path').toEqual(
    [],
  )
})
// Set INKKIT_CROSS_CHECK_REPORT to a file to count the saves compared.
afterAll(() => {
  const report = process.env.INKKIT_CROSS_CHECK_REPORT
  if (report) appendFileSync(report, `${crossCheck.compared}\n`)
})
