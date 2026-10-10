import { test, expect, observe, operation, reset } from './fixtures'
import { fixtures, imageData } from '../../scripts/interop/consumer/fixtures'

test('ready controller describes operations and preserves independent URL setup through reset @playground @playground-smoke', async ({
  page,
  openFixture,
}) => {
  await page.addInitScript(() => {
    let published: typeof window.inkkitPlayground | undefined
    Object.defineProperty(window, 'inkkitPlayground', {
      configurable: true,
      get: () => published,
      set: (value: typeof window.inkkitPlayground) => {
        published = value
        Object.assign(window, {
          publicationLifecycle: value.observe().lifecycle,
        })
      },
    })
  })
  await openFixture(
    'images',
    '&adapter=hold&imageImport=reject&imageExport=corrupt&fileAdapter=normal&editable=false&editors=2&files=false',
  )
  const initial = await observe(page)
  expect(initial.lifecycle).toBe('ready')
  expect(
    await page.evaluate(() => Reflect.get(window, 'publicationLifecycle')),
  ).toBe('initialising')
  expect(initial.setup).toEqual({
    fixture: 'images',
    configuration: 'rich',
    adapterMode: 'hold',
    imageImport: 'reject',
    imageExport: 'corrupt',
    fileAdapter: 'normal',
    editable: false,
    editors: 2,
    files: false,
  })
  const description = await page.evaluate(() =>
    window.inkkitPlayground.describe(),
  )
  expect(description.operations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: 'clipboard' }),
      expect.objectContaining({ name: 'replaceTextRange' }),
      expect.objectContaining({ name: 'fileMode' }),
    ]),
  )
  await page.evaluate(() => {
    window.inkkitPlayground.adapter.setMode('import', 'hold')
    window.inkkitPlayground.adapter.setMode('export', 'reject')
  })
  await operation(page, 'fileMode', { mode: 'corrupt' })
  await operation(page, 'editable', { editable: true })
  const changed = await observe(page)
  const url = new URL(page.url())
  expect(url.searchParams.get('imageImport')).toBe('hold')
  expect(url.searchParams.get('imageExport')).toBe('reject')
  expect(url.searchParams.get('fileAdapter')).toBe('corrupt')
  await reset(page)
  const fresh = await observe(page)
  expect(fresh.setup).toEqual(changed.setup)
  expect(fresh.snapshot!.generation).toBeGreaterThan(
    initial.snapshot!.generation,
  )
  expect(fresh.snapshot!.text).toBe(fixtures.images!.text)
  expect(fresh.snapshot!.dirty).toBe(false)
  expect(fresh.operations).toEqual([])
  expect(fresh.diagnostics).toEqual([])
  await page.reload()
  await expect.poll(async () => (await observe(page)).lifecycle).toBe('ready')
  expect((await observe(page)).setup).toEqual(changed.setup)
})

test('invalid initial setup remains observable and can recover @playground', async ({
  page,
}) => {
  for (const query of [
    'fixture=missing',
    'configuration=missing',
    'adapter=missing',
    'imageImport=corrupt',
    'fileAdapter=missing',
  ]) {
    await page.goto(`/?${query}`)
    await expect.poll(async () => (await observe(page)).lifecycle).toBe('error')
    const state = await observe(page)
    expect(state.lifecycleError).toBeTruthy()
    expect(state.snapshot).toBeNull()
    await page.evaluate(() =>
      window.inkkitPlayground.configure({
        fixture: 'everyday',
        configuration: 'rich',
        adapterMode: 'normal',
        imageImport: 'normal',
        imageExport: 'normal',
        fileAdapter: 'normal',
      }),
    )
    await expect.poll(async () => (await observe(page)).lifecycle).toBe('ready')
    expect((await observe(page)).snapshot!.text).toBe(fixtures.everyday!.text)
  }
})

test('rapid resets cancel held output and never contaminate the final session @playground @playground-smoke', async ({
  page,
  openFixture,
}) => {
  await openFixture('images', '&imageExport=hold')
  const original = (await observe(page)).snapshot!
  await page.evaluate(() => {
    const pending = window.inkkitPlayground.operation('clipboard').then(
      () => ({ ok: true }),
      (error: unknown) => ({ ok: false, message: String(error) }),
    )
    Object.assign(window, { playgroundPendingTest: pending })
  })
  await expect
    .poll(
      async () =>
        (await observe(page)).operations.find(
          (entry) => entry.name === 'clipboard',
        )?.status,
    )
    .toBe('pending')
  expect((await observe(page)).lifecycle).toBe('ready')
  await page.evaluate(async () => {
    await Promise.all([
      window.inkkitPlayground.reset('untidy'),
      window.inkkitPlayground.reset('tables'),
      window.inkkitPlayground.reset('images'),
    ])
  })
  const completed = await page.evaluate(
    async () =>
      (
        window as unknown as Window & {
          playgroundPendingTest: Promise<{ ok: boolean; message?: string }>
        }
      ).playgroundPendingTest,
  )
  expect(completed.ok).toBe(false)
  expect(completed.message).toMatch(/changed|stale|disposed|destroyed|cancel/i)
  const fresh = await observe(page)
  expect(fresh.lifecycle).toBe('ready')
  expect(fresh.snapshot!.documentId).toBe('fixture:images')
  expect(fresh.snapshot!.text).toBe(original.text)
  expect(fresh.snapshot!.generation).toBeGreaterThan(original.generation)
  expect(fresh.operations).toEqual([])
  expect(fresh.diagnostics).toEqual([])
  expect(fresh.lastResult).toBeNull()
  expect(fresh.outputs).toEqual({})
})

test('operation history is ordered, bounded and records structured errors @playground', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await page.evaluate(async () => {
    for (let index = 0; index < 205; index++)
      await window.inkkitPlayground.operation('commandState')
  })
  const state = await observe(page)
  expect(state.operations).toHaveLength(200)
  expect(state.droppedOperations).toBe(5)
  expect(state.operations.every((entry) => entry.status === 'success')).toBe(
    true,
  )
  const sequence = state.operations.map((entry) => entry.sequence)
  expect(sequence).toEqual([...sequence].sort((a, b) => a - b))
  expect(new Set(sequence).size).toBe(200)
  await expect(
    operation(page, 'missingOperation', { test: 'untidy input' }),
  ).rejects.toThrow('Unknown public operation')
  expect((await observe(page)).operations.at(-1)).toEqual(
    expect.objectContaining({
      name: 'missingOperation',
      args: { test: 'untidy input' },
      status: 'error',
      error: expect.objectContaining({
        message: expect.stringContaining('Unknown public operation'),
      }),
    }),
  )
  await reset(page)
  expect((await observe(page)).droppedOperations).toBe(0)
})

test('evidence captures exact binary outputs without triggering another export @playground', async ({
  page,
  openFixture,
}) => {
  await openFixture('images')
  expect((await observe(page)).outputs).toEqual({})
  await operation(page, 'clipboard')
  await operation(page, 'printable')
  const before = await observe(page)
  const evidence = await page.evaluate(() =>
    window.inkkitPlayground.captureEvidence(),
  )
  const serialised = JSON.stringify(evidence)
  const values: { $binary: string; data: string; byteLength: number }[] = []
  const collect = (value: unknown) => {
    if (value && typeof value === 'object') {
      if ('$binary' in value) values.push(value as (typeof values)[number])
      else Object.values(value).forEach(collect)
    }
  }
  collect(JSON.parse(serialised))
  expect(values.length).toBeGreaterThan(0)
  expect(values).toContainEqual({
    $binary: 'base64',
    data: imageData,
    byteLength: Buffer.from(imageData, 'base64').byteLength,
  })
  expect((await observe(page)).adapterEvents).toEqual(before.adapterEvents)
  expect((await observe(page)).snapshot).toEqual(before.snapshot)
})

test('source inspection preserves untidy bytes, selection and history @playground', async ({
  page,
  openFixture,
}) => {
  await openFixture('untidy')
  await operation(page, 'find', { text: 'Before' })
  const before = await observe(page)
  expect(before.snapshot!.text).toBe(fixtures.untidy!.text)
  expect(before.selectedText).toBe('Before')
  await expect
    .poll(() => page.locator('#source-snapshot').textContent())
    .toBe(fixtures.untidy!.text)
  await page
    .getByRole('checkbox', { name: 'Escaped source', exact: true })
    .check()
  await expect(page.locator('#source-snapshot')).toContainText('\\r\\n')
  await expect(page.locator('#source-snapshot')).toContainText('\\uFEFF')
  for (const name of ['Operations', 'Adapters', 'Output', 'State']) {
    const tab = page.getByRole('tab', { name, exact: true })
    await tab.click()
    await expect(tab).toHaveAttribute('aria-selected', 'true')
    await expect(
      page.getByRole('tabpanel', { name, exact: true }),
    ).toBeVisible()
  }
  await page
    .getByRole('checkbox', { name: 'Escaped source', exact: true })
    .uncheck()
  const after = await observe(page)
  expect(after.snapshot).toEqual(before.snapshot)
  expect(after.selectedText).toBe(before.selectedText)
  expect(after.commandState!.commands.undo).toBe(
    before.commandState!.commands.undo,
  )
  expect(after.outputs).toEqual({})
  expect(after.operations).toEqual(before.operations)
})

test('UI and automation use the same editing and adapter controls @playground', async ({
  page,
  openFixture,
}) => {
  await openFixture('images')
  await page.getByRole('button', { name: 'Edit source', exact: true }).click()
  expect((await observe(page)).mode).toBe('source')
  expect((await observe(page)).operations).toContainEqual(
    expect.objectContaining({
      name: 'editingMode',
      args: { mode: 'source' },
      status: 'success',
    }),
  )
  await operation(page, 'editingMode', { mode: 'formatted' })
  await expect(
    page.getByRole('button', { name: 'Edit source', exact: true }),
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Make read-only', exact: true })
    .click()
  expect((await observe(page)).editable).toBe(false)
  await operation(page, 'editable', { editable: true })
  await expect(
    page.getByRole('button', { name: 'Make read-only', exact: true }),
  ).toBeVisible()
  await page.getByRole('tab', { name: 'Adapters', exact: true }).click()
  await page
    .getByRole('combobox', { name: 'Image import', exact: true })
    .selectOption('hold')
  await page
    .getByRole('combobox', { name: 'Image export', exact: true })
    .selectOption('corrupt')
  await page
    .getByRole('combobox', { name: 'File adapter', exact: true })
    .selectOption('reject')
  expect((await observe(page)).setup).toEqual(
    expect.objectContaining({
      imageImport: 'hold',
      imageExport: 'corrupt',
      fileAdapter: 'reject',
    }),
  )
  await page.evaluate(() =>
    window.inkkitPlayground.adapter.setMode('import', 'normal'),
  )
  await expect(
    page.getByRole('combobox', { name: 'Image import', exact: true }),
  ).toHaveValue('normal')
  await page.getByRole('button', { name: 'Reset fixture', exact: true }).click()
  await expect.poll(async () => (await observe(page)).operations).toEqual([])
  expect((await observe(page)).setup.imageExport).toBe('corrupt')
})

test('held imports expose settlement and corrupt exports retain readable evidence @playground', async ({
  page,
  openFixture,
}) => {
  await openFixture('images', '&imageImport=hold')
  await operation(page, 'startImagePaste')
  await expect
    .poll(
      async () =>
        (await observe(page)).operations.find(
          (entry) => entry.name === 'startImagePaste',
        )?.status,
    )
    .toBe('pending')
  expect((await observe(page)).lifecycle).toBe('ready')
  await operation(page, 'finishImagePaste')
  expect(
    (await observe(page)).operations.find(
      (entry) => entry.name === 'startImagePaste',
    )?.status,
  ).toBe('success')
  await page.evaluate(() =>
    window.inkkitPlayground.adapter.setMode('import', 'reject'),
  )
  await operation(page, 'startImagePaste')
  await operation(page, 'finishImagePaste')
  expect(
    (await observe(page)).operations
      .filter((entry) => entry.name === 'startImagePaste')
      .at(-1),
  ).toEqual(expect.objectContaining({ status: 'success' }))
  expect((await observe(page)).diagnostics).toContainEqual(
    expect.objectContaining({ code: 'image-unavailable' }),
  )
  expect((await observe(page)).snapshot!.text).toContain('image unavailable')
  await reset(page)
  await page.evaluate(() =>
    window.inkkitPlayground.adapter.setMode('export', 'corrupt'),
  )
  const before = (await observe(page)).snapshot
  const result = (await operation(page, 'clipboard')) as {
    text: string
    images: { image?: { bytes: Uint8Array }; error?: unknown }[]
  }
  expect(result.text).toBe('Images\n\nFixture')
  expect(Object.values(result.images[0]!.image!.bytes)).toEqual(
    Array.from(Buffer.from(imageData, 'base64').subarray(0, 24)),
  )
  await expect(operation(page, 'printable')).rejects.toThrow(
    'could not be decoded',
  )
  expect((await observe(page)).operations.at(-1)).toEqual(
    expect.objectContaining({
      name: 'printable',
      status: 'error',
      error: {
        code: 'image-unavailable',
        message: 'The portable image could not be decoded.',
      },
    }),
  )
  expect((await observe(page)).snapshot).toEqual(before)
  await page.evaluate(() =>
    window.inkkitPlayground.adapter.setMode('export', 'normal'),
  )
  const recovered = (await operation(page, 'printable')) as {
    assets: unknown[]
  }
  expect(recovered.assets).toHaveLength(1)
  expect((await observe(page)).operations.at(-1)?.status).toBe('success')
})

test('concurrent configuration patches preserve the complete requested setup @playground', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  const original = (await observe(page)).snapshot!
  await page.evaluate(async () => {
    await Promise.all([
      window.inkkitPlayground.configure({ files: true }),
      window.inkkitPlayground.configure({ editors: 2 }),
    ])
  })
  const changed = await observe(page)
  expect(changed.lifecycle).toBe('ready')
  expect(changed.setup.files).toBe(true)
  expect(changed.setup.editors).toBe(2)
  expect(changed.snapshot!.generation).toBeGreaterThan(original.generation)
  expect(changed.snapshot!.text).toBe(original.text)
  expect(changed.secondTextSnapshot?.documentId).toBe('second')
  const url = new URL(page.url())
  expect(url.searchParams.get('files')).toBe('true')
  expect(url.searchParams.get('editors')).toBe('2')
})

test('runtime configuration preserves edited content, generation and undo history @playground', async ({
  page,
  openFixture,
}) => {
  await openFixture('untidy')
  const original = (await observe(page)).snapshot!
  await operation(page, 'replaceSource', {
    text: `${original.text}\nChanged through the facade.\n`,
  })
  const edited = (await observe(page)).snapshot!
  expect(edited.dirty).toBe(true)
  await page.evaluate(() =>
    window.inkkitPlayground.configure({
      editable: false,
      imageExport: 'reject',
    }),
  )
  const configured = await observe(page)
  expect(configured.snapshot).toEqual(edited)
  expect(configured.setup.editable).toBe(false)
  expect(configured.setup.imageExport).toBe('reject')
  expect(configured.editable).toBe(false)
  expect(configured.operations).toContainEqual(
    expect.objectContaining({ name: 'replaceSource', status: 'success' }),
  )
  await page.evaluate(() =>
    window.inkkitPlayground.configure({ editable: true }),
  )
  expect((await observe(page)).commandState!.commands.undo).toBe(true)
  await operation(page, 'undo')
  expect((await observe(page)).snapshot!.text).toBe(original.text)
})

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
]) {
  test(`inspection keeps the desktop editor and header visible at ${viewport.width}×${viewport.height} @playground`, async ({
    page,
    openFixture,
  }) => {
    await page.setViewportSize(viewport)
    await openFixture('native-search')
    const editor = page.getByRole('region', {
      name: 'Editor workspace',
      exact: true,
    })
    const header = page.locator('.workspace-header')
    const source = (await observe(page)).snapshot
    const fixtureLabels = await page
      .getByRole('navigation', { name: 'Fixtures', exact: true })
      .getByRole('button')
      .evaluateAll((buttons) =>
        buttons.map((button) => ({
          text: button.textContent,
          width: button.clientWidth,
          contentWidth: button.scrollWidth,
        })),
      )
    for (const label of fixtureLabels)
      expect(
        label.contentWidth,
        label.text ?? 'Fixture label',
      ).toBeLessThanOrEqual(label.width)
    for (const name of ['Operations', 'Adapters', 'Output', 'State']) {
      const tab = page.getByRole('tab', { name, exact: true })
      await tab.click()
      await expect(tab).toHaveAttribute('aria-selected', 'true')
      await expect(header).toBeInViewport({ ratio: 1 })
      await expect(editor).toBeInViewport({ ratio: 1 })
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
    }
    await page.setViewportSize({
      width: viewport.width - 80,
      height: viewport.height - 60,
    })
    await expect
      .poll(async () => {
        const visible = JSON.parse(
          (await page.locator('#observations').textContent())!,
        )
        return visible.viewport.rect.width
      })
      .toBe((await observe(page)).viewport!.rect.width)
    await page.locator('#editor').evaluate((element) => {
      element.scrollTop = 150
    })
    await expect
      .poll(
        async () =>
          JSON.parse((await page.locator('#observations').textContent())!)
            .viewport.scrollTop,
      )
      .toBe(150)
    expect((await observe(page)).snapshot).toEqual(source)
  })
}

test('fixture filtering and configuration dismissal leave the document untouched @playground', async ({
  page,
  openFixture,
}) => {
  await openFixture('untidy')
  const before = await observe(page)
  const search = page.getByRole('searchbox', { name: 'Search fixtures' })
  const fixtures = page.getByRole('navigation', {
    name: 'Fixtures',
    exact: true,
  })
  await search.fill('linked')
  await expect(fixtures.getByRole('button')).toHaveCount(1)
  await expect(page.locator('#fixture-count')).toHaveText('1/10')
  await search.fill('no-such-fixture')
  await expect(
    page.getByText('No matching fixtures.', { exact: true }),
  ).toBeVisible()
  await search.fill('')
  await expect(fixtures.getByRole('button')).toHaveCount(10)
  const toggle = page.locator('#configuration-panel > summary')
  await toggle.click()
  const preset = page.getByRole('combobox', {
    name: 'Configuration',
    exact: true,
  })
  await expect(preset).toBeVisible()
  await preset.press('Escape')
  await expect(preset).toBeHidden()
  await expect(toggle).toBeFocused()
  await toggle.click()
  await page.getByRole('tab', { name: 'Adapters', exact: true }).click()
  await expect(preset).toBeHidden()
  expect((await observe(page)).snapshot).toEqual(before.snapshot)
  expect((await observe(page)).operations).toEqual(before.operations)
})

test('empty inspectors stay concise and long failures preserve usable workspace @playground', async ({
  page,
  openFixture,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await openFixture('everyday')
  await page.getByRole('tab', { name: 'Adapters', exact: true }).click()
  await expect(
    page.getByText('No adapter events', { exact: true }),
  ).toBeVisible()
  await expect(page.locator('#adapter-events')).toBeHidden()
  await page.getByRole('tab', { name: 'Operations', exact: true }).click()
  await expect(page.getByText('No operations', { exact: true })).toBeVisible()
  await expect(page.locator('#operation-history')).toBeHidden()
  const name = 'unknown-' + 'long-diagnostic-'.repeat(200)
  await expect(operation(page, name)).rejects.toThrow(
    'Unknown public operation',
  )
  await expect(page.locator('#failure')).toHaveText(
    `Unknown public operation: ${name}`,
  )
  await expect(page.locator('#status')).toContainText('ready')
  await expect(page.locator('.workspace-header')).toBeInViewport({ ratio: 1 })
  await expect(
    page.getByRole('region', { name: 'Editor workspace', exact: true }),
  ).toBeInViewport({ ratio: 1 })
  await expect(page.locator('#operation-history')).toBeVisible()
  await expect(page.locator('#operation-history')).toContainText(
    '"status": "error"',
  )
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true)
  await page.getByRole('button', { name: 'Reset fixture', exact: true }).click()
  await expect(page.locator('#failure')).toBeHidden()
  await expect(page.getByText('No operations', { exact: true })).toBeVisible()
})

for (const appearance of [
  {
    name: 'narrow',
    viewport: { width: 390, height: 844 },
    colorScheme: 'light' as const,
  },
  {
    name: 'dark',
    viewport: { width: 1280, height: 800 },
    colorScheme: 'dark' as const,
  },
]) {
  test(`${appearance.name} playground exposes usable controls without horizontal document overflow @playground`, async ({
    page,
    openFixture,
  }, testInfo) => {
    await page.setViewportSize(appearance.viewport)
    await page.emulateMedia({ colorScheme: appearance.colorScheme })
    await openFixture('untidy')
    const original = (await observe(page)).snapshot
    if (appearance.name === 'narrow') {
      const boxes = await page
        .getByRole('navigation', { name: 'Fixtures', exact: true })
        .getByRole('button')
        .evaluateAll((buttons) =>
          buttons.map((button) => {
            const bounds = button.getBoundingClientRect()
            return {
              text: button.textContent,
              left: bounds.left,
              right: bounds.right,
              scrollWidth: button.scrollWidth,
              clientWidth: button.clientWidth,
            }
          }),
        )
      expect(boxes.length).toBeGreaterThan(1)
      for (const [index, box] of boxes.entries()) {
        expect(
          box.scrollWidth,
          box.text ?? 'Fixture label',
        ).toBeLessThanOrEqual(box.clientWidth)
        if (index > 0)
          expect(
            box.left,
            'Fixture buttons must not overlap',
          ).toBeGreaterThanOrEqual(boxes[index - 1]!.right)
      }
    }
    const noHorizontalOverflow = () =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth <= window.innerWidth &&
          document.body.scrollWidth <= window.innerWidth,
      )
    await expect.poll(noHorizontalOverflow).toBe(true)
    const mode = page.getByRole('button', { name: 'Edit source', exact: true })
    await expect(mode).toBeVisible()
    await mode.click()
    await expect(
      page.getByRole('textbox', { name: 'Markdown source editor' }),
    ).toBeVisible()
    await page
      .getByRole('button', { name: 'Edit formatted', exact: true })
      .click()
    await page.getByRole('tab', { name: 'Adapters', exact: true }).click()
    await expect(
      page.getByRole('combobox', { name: 'Image import', exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Release image import', exact: true }),
    ).toBeVisible()
    await expect.poll(noHorizontalOverflow).toBe(true)
    expect((await observe(page)).snapshot).toEqual(original)
    const screenshot = testInfo.outputPath(`${appearance.name}-playground.png`)
    await page.screenshot({ path: screenshot, fullPage: true })
    await testInfo.attach(`${appearance.name}-playground`, {
      path: screenshot,
      contentType: 'image/png',
    })
  })
}
