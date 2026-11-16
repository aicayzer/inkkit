import { test, expect } from './fixtures'

test('local diagnostics observe browser input and declared font configuration without content', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await page.evaluate(async (moduleURL) => {
    const { InkKitEditor } = await import(/* @vite-ignore */ moduleURL)
    const root = document.createElement('div')
    root.id = 'diagnostic-fixture'
    root.style.cssText =
      '--inkkit-font-family: Georgia, serif; --inkkit-font-size: 19px'
    document.body.append(root)
    const editor = await InkKitEditor.mount(root, { changed() {} })
    editor.loadDocument({
      documentId: 'PRIVATE_ID',
      generation: 1,
      format: 'md',
      text: 'PRIVATE_CONTENT\r\n',
    })
    editor.setDiagnosticsEnabled(true)
    ;(window as any).diagnosticEditor = editor
    editor.focus()
  }, `/@fs${process.cwd()}/src/core.ts`)
  const surface = page.locator('#diagnostic-fixture .ProseMirror')
  await surface.click()
  await page.keyboard.type('q')
  const report = await page.evaluate(() =>
    (window as any).diagnosticEditor.diagnosticReport(),
  )
  const inputs = report.events.filter((event: any) => event.kind === 'input')
  expect(
    inputs.some(
      (event: any) => event.phase === 'before' && event.input === 'text',
    ),
  ).toBe(true)
  expect(
    inputs.some(
      (event: any) => event.phase === 'after' && event.input === 'text',
    ),
  ).toBe(true)
  expect(report.presentation.fontFamily).toContain('Georgia')
  expect(report.presentation.fontSize).toBe(19)
  expect(report.presentation.fontWeight).toBe(400)
  expect(report.presentation.fontStyle).toBe('normal')
  expect(report.presentation.viewport.width).toBeGreaterThan(0)
  expect(JSON.stringify(report)).not.toContain('PRIVATE_')
  const heading = await page.evaluate(() => {
    const editor = (window as any).diagnosticEditor
    editor.loadDocument({
      documentId: 'PRIVATE_ID',
      generation: 2,
      format: 'md',
      text: '### PRIVATE_HEADING\n',
    })
    editor.focus()
    return editor.diagnosticReport()
  })
  expect(heading.presentation.block).toBe('heading')
  expect(heading.presentation.headingLevel).toBe(3)
  expect(heading.presentation.fontWeight).toBe(600)
  expect(JSON.stringify(heading)).not.toContain('PRIVATE_')
  await page.evaluate(async () => {
    await (window as any).diagnosticEditor.destroy()
    document.querySelector('#diagnostic-fixture')!.remove()
  })
})

test('diagnostics merge repeated calls and keep the begin of a pending call', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await page.evaluate(async (moduleURL) => {
    const { InkKitEditor } = await import(/* @vite-ignore */ moduleURL)
    const root = document.createElement('div')
    root.id = 'diagnostic-fixture'
    document.body.append(root)
    // A host that follows command state, whose publication must not fill the ring.
    const editor = await InkKitEditor.mount(root, {
      changed() {},
      commandStateChanged() {},
    })
    editor.loadDocument({
      documentId: 'PRIVATE_ID',
      generation: 1,
      format: 'md',
      text: 'PRIVATE_CONTENT\n',
    })
    editor.setDiagnosticsEnabled(true)
    ;(window as any).diagnosticEditor = editor
  }, `/@fs${process.cwd()}/src/core.ts`)
  await page.locator('#diagnostic-fixture .ProseMirror').click()
  await page.keyboard.type('abc')
  const report = await page.evaluate(async () => {
    const editor = (window as any).diagnosticEditor
    for (let index = 0; index < 5; index++) editor.textSnapshot()
    const pending = editor.clipboardSnapshot()
    const during = editor.diagnosticReport()
    await pending
    return { during, after: editor.diagnosticReport() }
  })
  const operations = (events: any[]) =>
    events
      .filter((event) => event.kind === 'operation')
      .map((event) => [event.phase, event.operation, event.count ?? 1])
  expect(operations(report.during.events)).toEqual([
    ['success', 'output', 5],
    ['begin', 'output', 1],
  ])
  expect(operations(report.after.events)).toEqual([
    ['success', 'output', 5],
    ['begin', 'output', 1],
    ['success', 'output', 1],
  ])
  // Every occurrence is numbered, so adjacent events leave no unexplained gap.
  const events = report.after.events
  for (let index = 1; index < events.length; index++)
    expect(events[index].sequence - (events[index].count ?? 1)).toBe(
      events[index - 1].sequence,
    )
  // Typing records its input and selection changes, not the editor's own bookkeeping calls.
  expect(events.filter((event: any) => event.kind === 'input').length).toBe(6)
  expect(JSON.stringify(report)).not.toContain('PRIVATE_')
  await page.evaluate(async () => {
    await (window as any).diagnosticEditor.destroy()
    document.querySelector('#diagnostic-fixture')!.remove()
  })
})
