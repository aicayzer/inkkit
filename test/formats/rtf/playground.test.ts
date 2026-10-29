import { expect, test } from 'vitest'
import { fixtures as golden } from './harness'
import { richTextFixtures as fixtures } from '../../../scripts/interop/consumer/fixtures'

test('the playground RTF fixtures are the golden documents', () => {
  expect(fixtures.rtf).toMatchObject({
    format: 'rtf',
    document: {
      version: 1,
      blocks: [
        'textedit-layout',
        'textedit-marks',
        'textedit-lists',
        'textedit-table',
      ].flatMap((name) => golden[name]!.blocks),
    },
  })
  expect(fixtures['rtf-word']).toMatchObject({
    format: 'rtf',
    document: golden['word-style'],
  })
})
