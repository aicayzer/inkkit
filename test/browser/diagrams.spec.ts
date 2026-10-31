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
    await previews.nth(index).scrollIntoViewIfNeeded()
    await expect(previews.nth(index)).toHaveAttribute('data-state', 'ready')
    await expect(previews.nth(index).locator('svg')).toBeVisible()
  }
  for (
    let index = accepted.length;
    index < accepted.length + refused.length;
    index++
  ) {
    await previews.nth(index).scrollIntoViewIfNeeded()
    await expect(previews.nth(index)).toHaveAttribute('data-state', 'error')
    await expect(previews.nth(index).locator('svg')).toHaveCount(0)
  }
  await page.waitForLoadState('networkidle')
  expect(probes).toEqual([])
})

const probeModule = `/@fs${process.cwd()}/test/browser/diagram-probe.ts`

const installProbe = (page: import('@playwright/test').Page) =>
  page.evaluate(async (url) => {
    const probe = (await import(url)) as typeof import('./diagram-probe')
    probe.install()
  }, probeModule)
const layoutCount = (page: import('@playwright/test').Page) =>
  page.evaluate(async (url) => {
    const probe = (await import(url)) as typeof import('./diagram-probe')
    return probe.count()
  }, probeModule)

test('duplicate diagram previews retain unique accessible IDs @diagrams', async ({
  page,
  openFixture,
}) => {
  await openFixture('everyday')
  const diagram =
    'flowchart LR\naccTitle: Order process\naccDescr: Start leads to finish\nStart --> Finish'
  const authored = [diagram, diagram].map(fence).join('\n')
  await operation(page, 'replaceSource', { text: authored })
  const previews = page.locator('.inkkit-mermaid-preview')
  for (let index = 0; index < 2; index++) {
    await previews.nth(index).scrollIntoViewIfNeeded()
    await expect(previews.nth(index)).toHaveAttribute('data-state', 'ready')
  }
  const accessible = await previews.evaluateAll((nodes) =>
    nodes.map((preview) => {
      const svg = preview.querySelector('svg')!
      return {
        ids: [...svg.querySelectorAll('[id]')].map((node) => node.id),
        title: svg.querySelector('title')?.textContent,
        description: svg.querySelector('desc')?.textContent,
        labels: ['aria-labelledby', 'aria-describedby']
          .flatMap((name) =>
            (svg.getAttribute(name) ?? '').split(/\s+/).filter(Boolean),
          )
          .map((id) => Boolean(svg.querySelector(`[id="${id}"]`))),
      }
    }),
  )
  const ids = accessible.flatMap((entry) => entry.ids)
  expect(ids.length).toBeGreaterThanOrEqual(4)
  expect(new Set(ids).size).toBe(ids.length)
  for (const entry of accessible) {
    expect(entry.title).toBe('Order process')
    expect(entry.description).toBe('Start leads to finish')
    expect(entry.labels.length).toBeGreaterThan(0)
    expect(entry.labels.every(Boolean)).toBe(true)
  }
  expect(
    await page.evaluate(() => window.inkkitPlayground.observe().snapshot?.text),
  ).toBe(authored)
})

test('a hidden editor defers previews until shown and offscreen diagrams until scrolled @diagrams', async ({
  page,
  openFixture,
}) => {
  await openFixture('everyday')
  await installProbe(page)
  await page.locator('#editor').evaluate((root) => {
    root.style.display = 'none'
  })
  await operation(page, 'replaceSource', {
    text: Array.from({ length: 20 }, (_, index) =>
      fence(`flowchart LR\nNode${index} --> Finish${index}`),
    ).join('\n'),
  })
  // Let observer delivery and queued preview tasks run while the host is hidden.
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)))
  expect(await layoutCount(page)).toBe(0)
  const previews = page.locator('.inkkit-mermaid-preview')
  await expect(previews).toHaveCount(20)
  await expect(previews.locator('svg')).toHaveCount(0)
  await page.locator('#editor').evaluate((root) => {
    root.style.display = ''
  })
  await previews.first().scrollIntoViewIfNeeded()
  await expect(previews.first()).toHaveAttribute('data-state', 'ready')
  await expect(previews.last().locator('svg')).toHaveCount(0)
  expect(await layoutCount(page)).toBeLessThan(20)
  await previews.last().scrollIntoViewIfNeeded()
  await expect(previews.last()).toHaveAttribute('data-state', 'ready')
})

test('printing 100 settled previews reuses every layout @diagrams', async ({
  page,
  openFixture,
}, testInfo) => {
  test.setTimeout(60_000)
  await openFixture('everyday')
  await installProbe(page)
  const authored = Array.from({ length: 100 }, (_, index) =>
    fence(`flowchart LR\nStart${index} --> Finish${index}`),
  ).join('\n')
  await operation(page, 'replaceSource', { text: authored })
  const previews = page.locator('.inkkit-mermaid-preview')
  await expect(previews).toHaveCount(100)
  for (let index = 0; index < 100; index++) {
    await previews.nth(index).scrollIntoViewIfNeeded()
    await expect(previews.nth(index)).toHaveAttribute('data-state', 'ready')
  }
  expect(await layoutCount(page)).toBe(100)
  const print = await page.evaluate(async () => {
    const started = performance.now()
    const result = (await window.inkkitPlayground.operation(
      'printable',
    )) as import('../../src/types').PrintableDocument
    const elapsedMs = performance.now() - started
    const doc = new DOMParser().parseFromString(result.html, 'text/html')
    return {
      elapsedMs,
      diagrams: doc.querySelectorAll('figure img').length,
      warnings: result.warnings,
    }
  })
  expect(await layoutCount(page)).toBe(100)
  expect(print.diagrams).toBe(100)
  expect(print.warnings).toEqual([])
  expect(
    await page.evaluate(() => window.inkkitPlayground.observe().snapshot?.text),
  ).toBe(authored)
  await testInfo.attach('diagram-print-measurement', {
    body: JSON.stringify({
      diagrams: 100,
      elapsedMs: print.elapsedMs,
      additionalLayouts: 0,
    }),
    contentType: 'application/json',
  })
})

interface DiagramInputSample {
  elapsedMs: number
  pendingPreviews: number
  layoutsAtInput: number
  trusted: boolean
}

declare global {
  interface Window {
    diagramInputSamples: DiagramInputSample[]
    diagramSettledNodes: SVGSVGElement[]
    diagramEditors: import('../../src/core').InkKitEditor[]
  }
}

for (const scenario of ['shown', 'scrolling'] as const)
  test(`keyboard input reaches the next frame while 100 diagram previews are pending: ${scenario} @diagrams`, async ({
    page,
    openFixture,
  }, testInfo) => {
    await openFixture('everyday')
    await installProbe(page)
    const authored = Array.from(
      { length: 100 },
      (_, index) =>
        `Typing ${index}\n\n${fence(`flowchart LR\nNode${index} --> End${index}`)}`,
    ).join('\n')
    await page.locator('#editor').evaluate((root) => {
      root.style.display = 'none'
    })
    await operation(page, 'replaceSource', { text: authored })
    expect(await layoutCount(page)).toBe(0)
    await expect(page.locator('.inkkit-mermaid-preview')).toHaveCount(100)
    await page.evaluate(async (url) => {
      const probe = (await import(url)) as typeof import('./diagram-probe')
      window.diagramInputSamples = []
      const root = document.getElementById('editor')!
      root.addEventListener(
        'beforeinput',
        (event) => {
          const input = event as InputEvent
          if (input.inputType !== 'insertText' || input.data !== 'x') return
          const started = performance.now()
          const pendingPreviews = root.querySelectorAll(
            '.inkkit-mermaid-preview:not([data-state="ready"]):not([data-state="error"])',
          ).length
          const layoutsAtInput = probe.count()
          requestAnimationFrame(() =>
            window.diagramInputSamples.push({
              elapsedMs: performance.now() - started,
              pendingPreviews,
              layoutsAtInput,
              trusted: input.isTrusted,
            }),
          )
        },
        { capture: true },
      )
      root.style.display = ''
    }, probeModule)
    const target = scenario === 'shown' ? 'Typing 0' : 'Typing 50'
    expect(await operation(page, 'find', { text: target })).toBe(true)
    await page.keyboard.press('ArrowRight')
    for (let index = 0; index < 3; index++) {
      await page.keyboard.type('x')
      await expect
        .poll(() => page.evaluate(() => window.diagramInputSamples.length))
        .toBe(index + 1)
    }
    const samples = await page.evaluate(() => window.diagramInputSamples)
    await testInfo.attach(`diagram-input-${scenario}`, {
      body: JSON.stringify({ scenario, diagrams: 100, samples }),
      contentType: 'application/json',
    })
    for (const sample of samples) {
      expect(sample.trusted).toBe(true)
      expect(sample.pendingPreviews).toBeGreaterThan(0)
      expect(sample.layoutsAtInput).toBeLessThan(100)
    }
    expect(
      await page.evaluate(
        () => window.inkkitPlayground.observe().snapshot?.text,
      ),
    ).toBe(authored.replace(target, `${target}xxx`))
  })

const coreModule = `/@fs${process.cwd()}/src/core.ts`

async function mountDiagramEditors(
  page: import('@playwright/test').Page,
  texts: string[],
) {
  await page.evaluate(
    async ({ coreModule, texts }) => {
      const { InkKitEditor } = (await import(
        coreModule
      )) as typeof import('../../src/core')
      const container = document.createElement('section')
      container.id = 'diagram-test-editors'
      container.style.cssText =
        'position:fixed;inset:0;overflow:auto;background:white;z-index:10000'
      document.body.append(container)
      window.diagramEditors = []
      for (const [index, text] of texts.entries()) {
        const root = document.createElement('div')
        root.id = `diagram-editor-${index}`
        root.style.display = 'none'
        container.append(root)
        const editor = await InkKitEditor.mount(root, { changed() {} })
        editor.loadDocument({
          documentId: `diagram-${index}`,
          generation: 1,
          format: 'md',
          text,
        })
        window.diagramEditors.push(editor)
      }
    },
    { coreModule, texts },
  )
}

async function destroyDiagramEditors(page: import('@playwright/test').Page) {
  await page.evaluate(async () => {
    for (const editor of window.diagramEditors) await editor.destroy()
    document.getElementById('diagram-test-editors')?.remove()
    window.diagramEditors = []
  })
}

test('replacing or destroying a document cancels queued diagram work @diagrams', async ({
  page,
  openFixture,
}) => {
  await openFixture('everyday')
  await installProbe(page)
  const obsolete = Array.from({ length: 100 }, (_, index) =>
    fence(`flowchart LR\nObsolete${index} --> Old${index}`),
  ).join('\n')
  await mountDiagramEditors(page, [obsolete, obsolete])
  const replacement = fence('flowchart LR\nCurrent --> Kept')
  await page.evaluate(
    async ({ replacement }) => {
      window.diagramEditors[0]!.loadDocument({
        documentId: 'replacement',
        generation: 2,
        format: 'md',
        text: replacement,
      })
      document.getElementById('diagram-editor-0')!.style.display = ''
      document.getElementById('diagram-editor-1')!.style.display = ''
      await window.diagramEditors[1]!.destroy()
      window.diagramEditors.splice(1, 1)
    },
    { replacement },
  )
  const preview = page.locator('#diagram-editor-0 .inkkit-mermaid-preview')
  await expect(preview).toHaveAttribute('data-state', 'ready')
  await expect(preview).toContainText('Current')
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)))
  expect(await layoutCount(page)).toBe(1)
  await expect(
    page.locator('#diagram-editor-1 .inkkit-mermaid-preview'),
  ).toHaveCount(0)
  expect(
    await page.evaluate(() => window.diagramEditors[0]!.snapshot().text),
  ).toBe(replacement)
  await destroyDiagramEditors(page)
})

test('two editors own separate diagram geometry and survive independent destruction @diagrams', async ({
  page,
  openFixture,
}) => {
  await openFixture('everyday')
  await installProbe(page)
  const authored = fence('flowchart LR\nShared --> Geometry')
  await mountDiagramEditors(page, [authored, authored])
  await page.evaluate(() => {
    document.getElementById('diagram-editor-0')!.style.display = ''
    document.getElementById('diagram-editor-1')!.style.display = ''
  })
  for (let index = 0; index < 2; index++) {
    const preview = page.locator(
      `#diagram-editor-${index} .inkkit-mermaid-preview`,
    )
    await preview.scrollIntoViewIfNeeded()
    await expect(preview).toHaveAttribute('data-state', 'ready')
  }
  expect(await layoutCount(page)).toBe(2)
  const printed = await page.evaluate(async () => {
    await window.diagramEditors[0]!.destroy()
    window.diagramEditors.splice(0, 1)
    const editor = window.diagramEditors[0]!
    const print = await editor.printableSnapshot()
    return {
      text: editor.snapshot().text,
      warnings: print.warnings,
      images: print.assets.length,
    }
  })
  expect(printed).toEqual({ text: authored, warnings: [], images: 1 })
  expect(await layoutCount(page)).toBe(2)
  await expect(
    page.locator('#diagram-editor-1 .inkkit-mermaid-preview'),
  ).toHaveAttribute('data-state', 'ready')
  await destroyDiagramEditors(page)
})

test('typing before settled duplicate diagrams preserves their SVG nodes @diagrams', async ({
  page,
  openFixture,
}) => {
  await openFixture('everyday')
  await installProbe(page)
  const diagram = fence('flowchart LR\nUnchanged --> Diagram')
  const authored = `Before\n\n${diagram}\n${diagram}`
  await operation(page, 'replaceSource', { text: authored })
  const previews = page.locator('.inkkit-mermaid-preview')
  for (let index = 0; index < 2; index++) {
    await previews.nth(index).scrollIntoViewIfNeeded()
    await expect(previews.nth(index)).toHaveAttribute('data-state', 'ready')
  }
  expect(await layoutCount(page)).toBe(1)
  await page.evaluate(() => {
    window.diagramSettledNodes = [
      ...document.querySelectorAll<SVGSVGElement>(
        '#editor .inkkit-mermaid-preview svg',
      ),
    ]
  })
  expect(await operation(page, 'find', { text: 'Before' })).toBe(true)
  await page.keyboard.press('ArrowRight')
  await page.keyboard.type(' edited')
  expect(
    await page.evaluate(() => {
      const current = [
        ...document.querySelectorAll('#editor .inkkit-mermaid-preview svg'),
      ]
      return (
        current.length === 2 &&
        current.every(
          (node, index) => node === window.diagramSettledNodes[index],
        )
      )
    }),
  ).toBe(true)
  expect(await layoutCount(page)).toBe(1)
  expect(
    await page.evaluate(() => window.inkkitPlayground.observe().snapshot?.text),
  ).toBe(authored.replace('Before', 'Before edited'))
})
