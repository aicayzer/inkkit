import type { InkKitEditor } from '../../src/index'
import { wrappedSearchText } from '../../scripts/interop/consumer/fixtures'
import { test, expect, observe, operation } from './fixtures'

type TextSnapshot = ReturnType<InkKitEditor['textSnapshot']>
type TextRange = Parameters<InkKitEditor['selectTextRange']>[0]
const rangeFor = (snapshot: TextSnapshot, text: string): TextRange => {
  const from = snapshot.text.indexOf(text)
  expect(from).toBeGreaterThanOrEqual(0)
  return { snapshotId: snapshot.snapshotId, from, to: from + text.length }
}
const readText = async (page: Parameters<typeof operation>[0]) =>
  (await operation(page, 'textSnapshot')) as TextSnapshot

for (const mode of ['formatted', 'source', 'txt'] as const) {
  test(`UTF-16 ranges, replacement and shared undo (${mode}) @native-search`, async ({
    page,
    openFixture,
  }) => {
    await openFixture('native-search')
    if (mode === 'txt')
      await page.evaluate(() =>
        window.inkkitPlayground.replaceDocument(
          'A😀B é 中文\r\nSecond line\r\n',
          'txt',
        ),
      )
    else if (mode === 'source') await operation(page, 'editingMode', { mode })
    const original = (await observe(page)).snapshot!
    const text = await readText(page)
    if (mode === 'txt') expect(text.text).toBe('A😀B é 中文\nSecond line\n')
    const range = rangeFor(text, '😀')
    expect(range.to - range.from).toBe(2)
    await operation(page, 'selectTextRange', { range })
    expect((await readText(page)).selection).toMatchObject({ ...range })
    expect((await observe(page)).snapshot).toEqual(original)
    await operation(page, 'replaceTextRange', { range, text: '界' })
    expect((await readText(page)).text).toContain('A界B é')
    await expect(operation(page, 'selectTextRange', { range })).rejects.toThrow(
      /changed|stale/i,
    )
    await operation(page, 'undo')
    expect((await observe(page)).snapshot!.text).toBe(original.text)
    const restored = await readText(page)
    const emoji = rangeFor(restored, '😀')
    await expect(
      operation(page, 'selectTextRange', {
        range: { ...emoji, to: emoji.from + 1 },
      }),
    ).rejects.toThrow(/range|surrogate/i)
    const accent = rangeFor(restored, 'é')
    await operation(page, 'selectTextRange', { range: accent })
    expect((await readText(page)).selection).toMatchObject({ ...accent })
  })
}

test('ranges reject reload, mode round trips and another instance @native-search', async ({
  page,
  openFixture,
}) => {
  await openFixture('native-search', '&editors=2')
  const before = await readText(page)
  const range = rangeFor(before, 'Formatted match')
  await expect(
    operation(page, 'selectTextRange', { instance: 'second', range }),
  ).rejects.toThrow(/changed|stale/i)
  const secondBefore = await operation(page, 'textSnapshot', {
    instance: 'second',
  })
  await operation(page, 'reload', { sameGeneration: true })
  await expect(
    operation(page, 'replaceTextRange', { range, text: 'NO' }),
  ).rejects.toThrow(/changed|stale/i)
  const afterReload = await readText(page)
  const current = rangeFor(afterReload, 'Formatted match')
  await operation(page, 'editingMode', { mode: 'source' })
  await operation(page, 'editingMode', { mode: 'formatted' })
  await expect(
    operation(page, 'textRangeRects', { range: current }),
  ).rejects.toThrow(/changed|stale/i)
  expect(await operation(page, 'textSnapshot', { instance: 'second' })).toEqual(
    secondBefore,
  )
})

test('composition guards and protected structured content @native-search', async ({
  page,
  openFixture,
}) => {
  await openFixture('native-search')
  const text = await readText(page)
  expect(text.text).not.toContain('hidden author comment')
  expect(text.text).toContain('Hidden body match')
  const folded = rangeFor(text, 'Hidden body match')
  expect(await operation(page, 'textRangeRects', { range: folded })).toEqual([])
  await operation(page, 'revealTextRange', { range: folded })
  expect(
    await operation(page, 'textRangeRects', { range: folded }),
  ).not.toEqual([])
  const image = rangeFor(text, 'Opaque image')
  await expect(
    operation(page, 'replaceTextRange', { range: image, text: 'NO' }),
  ).rejects.toThrow(/range|protected|structured/i)
  const acrossBlocks = {
    snapshotId: text.snapshotId,
    from: 0,
    to: text.text.indexOf('Unicode:') + 3,
  }
  await expect(
    operation(page, 'replaceTextRange', { range: acrossBlocks, text: 'NO' }),
  ).rejects.toThrow(/range|structured/i)
  const surface = page.getByRole('textbox', {
    name: 'Formatted Markdown editor',
    exact: true,
  })
  await surface.dispatchEvent('compositionstart', { data: '中' })
  await expect(operation(page, 'textSnapshot')).rejects.toThrow(/composition/i)
  await expect(
    operation(page, 'selectTextRange', {
      range: rangeFor(text, 'Formatted match'),
    }),
  ).rejects.toThrow(/composition/i)
  await surface.dispatchEvent('compositionend', { data: '' })
  expect((await readText(page)).text).toBe(text.text)
  await operation(page, 'editingMode', { mode: 'source' })
  const sourceText = await readText(page)
  const sourceRange = rangeFor(sourceText, '😀')
  const sourceSurface = page.getByRole('textbox', {
    name: 'Markdown source editor',
    exact: true,
  })
  await sourceSurface.dispatchEvent('compositionstart', { data: '中' })
  await expect(
    operation(page, 'replaceTextRange', { range: sourceRange, text: 'NO' }),
  ).rejects.toThrow(/composition/i)
  await expect(
    operation(page, 'textRangeRects', { range: sourceRange }),
  ).rejects.toThrow(/composition/i)
  await sourceSurface.dispatchEvent('compositionend', { data: '' })
  await operation(page, 'editingMode', { mode: 'formatted' })
  await operation(page, 'editable', { editable: false })
  const current = await readText(page)
  const range = rangeFor(current, 'Formatted match')
  await operation(page, 'selectTextRange', { range })
  await expect(
    operation(page, 'replaceTextRange', { range, text: 'NO' }),
  ).rejects.toThrow(/read-only/i)
})

for (const mode of ['formatted', 'source', 'txt'] as const) {
  test(`viewport insets, explicit reveal, reload and resize (${mode}) @native-search`, async ({
    page,
    openFixture,
  }, testInfo) => {
    await openFixture('native-search', '&editors=2')
    if (mode === 'txt') {
      const source = (await observe(page)).snapshot!.text
      await page.evaluate(
        (source) => window.inkkitPlayground.replaceDocument(source, 'txt'),
        source,
      )
    } else if (mode === 'source') await operation(page, 'editingMode', { mode })
    const host = page.getByRole('textbox', { name: 'Host text', exact: true })
    await host.focus()
    const text = await readText(page)
    const target = rangeFor(text, 'Final navigation target.')
    const before = (await observe(page)).snapshot!
    const second = (await operation(page, 'viewport', {
      instance: 'second',
    })) as ReturnType<InkKitEditor['viewport']>
    await operation(page, 'setViewport', {
      insets: { top: 36, bottom: 28, left: 12, right: 10 },
    })
    await operation(page, 'selectTextRange', { range: target })
    await expect(host).toBeFocused()
    expect((await observe(page)).snapshot).toEqual(before)
    await operation(page, 'selectTextRange', {
      range: target,
      options: { focus: true, reveal: true },
    })
    const rects = (await operation(page, 'textRangeRects', {
      range: target,
    })) as ReturnType<InkKitEditor['textRangeRects']>
    const viewport = (await operation(page, 'viewport')) as ReturnType<
      InkKitEditor['viewport']
    >
    expect(rects.length).toBeGreaterThan(0)
    for (const rect of rects) {
      expect(rect.top).toBeGreaterThanOrEqual(viewport.rect.top - 1)
      expect(rect.bottom).toBeLessThanOrEqual(viewport.rect.bottom + 1)
    }
    const visible = (await operation(page, 'visibleTextRanges', {
      snapshotId: text.snapshotId,
    })) as TextRange[]
    expect(
      visible.some(
        (range) => range.from <= target.from && range.to >= target.to,
      ),
    ).toBe(true)
    await operation(page, 'find', { text: 'Paragraph 18' })
    const found = rangeFor(text, 'Paragraph 18')
    const findRects = (await operation(page, 'textRangeRects', {
      range: found,
    })) as ReturnType<InkKitEditor['textRangeRects']>
    const findViewport = (await operation(page, 'viewport')) as ReturnType<
      InkKitEditor['viewport']
    >
    expect(findRects.length).toBeGreaterThan(0)
    expect(
      findRects.every(
        (rect) =>
          rect.top >= findViewport.rect.top - 1 &&
          rect.bottom <= findViewport.rect.bottom + 1,
      ),
    ).toBe(true)
    await testInfo.attach(`viewport-${mode}`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
    await operation(page, 'selectTextRange', { range: target })
    await page.locator('#editor').evaluate((root) => {
      root.style.height = '260px'
      root.style.width = '360px'
      root.style.flex = 'none'
    })
    await operation(page, 'revealTextRange', { range: target })
    const resized = (await operation(page, 'viewport')) as ReturnType<
      InkKitEditor['viewport']
    >
    const root = await page.locator('#editor').boundingBox()
    expect(resized.rect.height).toBeLessThanOrEqual(root!.height - 64)
    await page.locator('#editor').evaluate((root) => {
      root.scrollTop = 0
      const plain = root.querySelector('textarea')
      if (plain) plain.scrollTop = 0
    })
    const wrapped = rangeFor(text, wrappedSearchText)
    await operation(page, 'selectTextRange', {
      range: wrapped,
      options: { reveal: true },
    })
    const wrappedRects = (await operation(page, 'textRangeRects', {
      range: wrapped,
    })) as ReturnType<InkKitEditor['textRangeRects']>
    const wrappedViewport = (await operation(page, 'viewport')) as ReturnType<
      InkKitEditor['viewport']
    >
    expect(
      new Set(wrappedRects.map((rect) => Math.round(rect.top))).size,
    ).toBeGreaterThan(1)
    expect(
      Math.max(...wrappedRects.map((rect) => rect.bottom)) -
        Math.min(...wrappedRects.map((rect) => rect.top)),
    ).toBeLessThan(wrappedViewport.rect.height)
    expect(
      wrappedRects.every(
        (rect) =>
          rect.top >= wrappedViewport.rect.top - 1 &&
          rect.bottom <= wrappedViewport.rect.bottom + 1,
      ),
    ).toBe(true)
    await operation(page, 'selectTextRange', {
      range: target,
      options: { reveal: true },
    })
    expect(
      await operation(page, 'viewport', { instance: 'second' }),
    ).toMatchObject({
      insets: second.insets,
      scrollTop: second.scrollTop,
      scrollLeft: second.scrollLeft,
    })
    await host.focus()
    const scroll = (
      (await operation(page, 'viewport')) as ReturnType<
        InkKitEditor['viewport']
      >
    ).scrollTop
    await operation(page, 'reload')
    await expect(host).toBeFocused()
    expect(
      (
        (await operation(page, 'viewport')) as ReturnType<
          InkKitEditor['viewport']
        >
      ).scrollTop,
    ).toBeCloseTo(scroll, 0)
    const restored = await readText(page)
    expect(
      restored.text.slice(restored.selection.from, restored.selection.to),
    ).toBe('Final navigation target.')
    await page.evaluate(() =>
      window.inkkitPlayground.replaceDocument('Replacement document', 'md'),
    )
    await expect(host).toBeFocused()
  })
}
