import { test, expect, operation } from './fixtures'

const fence = (source: string) => '```mermaid\n' + source + '\n```\n'

const accepted = [
  'flowchart TD\nA[Click to upload image] --> B[Style guide]',
  'sequenceDiagram\nA->>B: Send link\nNote over A,B: click the style icon',
  'classDiagram\nclass Account {\n+String icon\n}\nAccount --> Account : click',
  'stateDiagram-v2\nS --> T : style guide\nS : image icon href',
  'erDiagram\nA ||--|| B : "Click link"',
  'pie title Style guide\n"click" : 1\n"link" : 2',
  'classDiagram\nclass Shape {\n<<interface>>\ndraw()\n}\nclass Billing\n<<service>> Billing',
  'stateDiagram-v2\nstate Split <<fork>>\nstate Merge <<join>>\nstate Check <<choice>>\n[*] --> Split\nSplit --> Merge\nMerge --> Check',
]

const refused = [
  'flowchart TD\nA --> B\nclassDef c mask-image:image-set("inkkit-probe.png" 1x)\nclass A c',
  'stateDiagram-v2\nA --> B\nA style A fill:#f0e',
  'erDiagram\nA ||--|| B : has\nA classDef c fill:#f0e\nclass A c',
  'sequenceDiagram\nparticipant A\nlinks A: {"Home": "page"}',
  'classDiagram\nclass Shape {\n<<interface>>\n}\nnote for Shape "Shape\n<<img src=inkkit-probe.png>>\n"',
  'stateDiagram-v2\nA --> B\nnote right of A\nstate X <<fork>>\nend note',
]

test('diagram previews render label words and annotations and refuse directives without requests @smoke @diagrams', async ({
  page,
  openFixture,
}) => {
  const probes: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('inkkit-probe')) probes.push(request.url())
  })
  await openFixture('mermaid')
  await operation(page, 'replaceSource', {
    text: [...accepted, ...refused].map(fence).join('\n'),
  })
  const previews = page.locator('.inkkit-mermaid-preview')
  await expect(previews).toHaveCount(accepted.length + refused.length)
  for (let index = 0; index < accepted.length; index++) {
    await expect(previews.nth(index)).toHaveAttribute('data-state', 'ready')
    await expect(previews.nth(index).locator('svg')).toBeVisible()
  }
  for (
    let index = accepted.length;
    index < accepted.length + refused.length;
    index++
  ) {
    await expect(previews.nth(index)).toHaveAttribute('data-state', 'error')
    await expect(previews.nth(index).locator('svg')).toHaveCount(0)
  }
  await page.waitForLoadState('networkidle')
  expect(probes).toEqual([])
})
