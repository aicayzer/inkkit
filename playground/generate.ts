export const generateLimit = 100_000

const words = [
  'alpha',
  'bravo',
  'charlie',
  'delta',
  'echo',
  'foxtrot',
  'golf',
  'hotel',
  'india',
  'juliet',
]

// Deterministic, so two runs of one size are comparable. Every 50th block is
// a heading and the paragraphs carry inline marks, so the document is not
// plain text throughout.
export function generateParagraphs(count: number): string {
  const blocks: string[] = []
  for (let index = 0; index < count; index++) {
    const word = (offset: number) => words[(index + offset) % words.length]!
    if (index % 50 === 0) {
      blocks.push(`## Section ${index / 50 + 1}`)
      continue
    }
    const marks = [
      `Paragraph ${index + 1}: ${word(0)} ${word(1)} ${word(2)} text for timing.`,
      `Paragraph ${index + 1}: a **${word(3)}** word and some \`${word(4)}\` code.`,
      `Paragraph ${index + 1}: an [${word(5)} link](https://example.com/${index}) here.`,
    ]
    blocks.push(marks[index % marks.length]!)
  }
  return `${blocks.join('\n\n')}\n`
}

export type GenerateSpec = { kind: 'paragraphs'; count: number }

export function parseGenerate(value: string): GenerateSpec {
  const match = /^paragraphs:(\d+)$/.exec(value)
  if (!match)
    throw Error(
      `Unknown generator: ${value}. Use paragraphs:<count>, for example paragraphs:4000.`,
    )
  const count = Number(match[1])
  if (count < 1 || count > generateLimit)
    throw Error(
      `Generator size ${count} is outside 1 to ${generateLimit} paragraphs.`,
    )
  return { kind: 'paragraphs', count }
}

export const generateDocument = (spec: GenerateSpec) =>
  generateParagraphs(spec.count)
