import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import '../src/index'
import { renderDiagram } from '../src/mermaid'

interface Trial {
  id: string
  source: string
  accepted: boolean
  texts: string[]
}
const corpus = JSON.parse(
  readFileSync('test/fixtures/diagram-trial.json', 'utf8'),
) as Trial[]

test('the complete migration corpus retains all 185 trial examples', () => {
  expect(corpus).toHaveLength(185)
  expect(corpus.filter((example) => example.accepted)).toHaveLength(84)
})

for (const example of corpus)
  test(`integrated diagram renderer preserves trial ${example.id}`, async () => {
    if (!example.accepted) {
      await expect(renderDiagram(example.source)).rejects.toThrow()
      return
    }
    const svg = await renderDiagram(example.source)
    const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml')
    expect(parsed.querySelector('parsererror')).toBeNull()
    expect(parsed.querySelector('svg.pele')).not.toBeNull()
    const labels = [...parsed.querySelectorAll('text')].map(
      (node) => node.textContent ?? '',
    )
    expect(labels.sort()).toEqual([...example.texts].sort())
  })
