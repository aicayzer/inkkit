import { expect, test } from 'vitest'
import { fixtures as golden } from './harness'
import {
  allFixtures,
  fixtures as textFixtures,
  richTextFixtures as fixtures,
} from '../../../scripts/interop/consumer/fixtures'

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

test('the playground offers every fixture', () => {
  for (const name of [...Object.keys(textFixtures), ...Object.keys(fixtures)])
    expect(allFixtures, name).toHaveProperty([name])
  expect(allFixtures).toHaveProperty(['linked-files'])
})
