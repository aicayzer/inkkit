import { expect, test } from 'vitest'
import {
  generateDocument,
  generateLimit,
  parseGenerate,
} from '../playground/generate'

test('a generated document has the requested number of blocks and ends in a newline', () => {
  const text = generateDocument(parseGenerate('paragraphs:120'))
  expect(text.endsWith('\n')).toBe(true)
  expect(text.trimEnd().split('\n\n')).toHaveLength(120)
  expect(text.match(/^## Section /gm)).toHaveLength(3)
})

test('the same size always generates the same document', () => {
  expect(generateDocument(parseGenerate('paragraphs:60'))).toBe(
    generateDocument(parseGenerate('paragraphs:60')),
  )
})

test.each([
  'paragraphs:0',
  `paragraphs:${generateLimit + 1}`,
  'paragraphs:-3',
  'paragraphs:ten',
  'paragraphs:',
  'lines:5',
  '',
])('the generator "%s" is refused', (value) => {
  expect(() => parseGenerate(value)).toThrow(/generator|paragraphs/i)
})
