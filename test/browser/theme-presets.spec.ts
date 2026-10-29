import { readFileSync } from 'node:fs'
import { test, expect, observe, operation } from './fixtures'
import type { Page } from '@playwright/test'

const themes = ['standard', 'calm', 'essential'] as const
const presets = themes
  .map((theme) =>
    readFileSync(
      new URL(`../../src/themes/${theme}.css`, import.meta.url),
      'utf8',
    ),
  )
  .join('\n')
const source = [
  '# A little room',
  '',
  'Text with a [link](https://example.test) and `inline code`. Café ☕.',
  '',
  '> A quote with rounded ends.',
  '> Another line.',
  '',
  '+ [ ] An unfinished task',
  '+ [x] A finished task',
  '',
  '| Name | Detail |',
  '| :--- | ---: |',
  '| Unicode | Café |',
  '',
  '```js',
  '// A comment',
  "const greeting = 'hello'",
  'function greet() { return 42 }',
  '```',
  '',
  '```json',
  '{"name": 1}',
  '```',
  '',
  '```mermaid',
  'pie title A balanced week',
  '"Writing" : 1',
  '"Reading" : 1',
  '"Making" : 1',
  '"Rest" : 1',
  '```',
  '',
  'Last paragraph',
].join('\r\n')

async function open(
  page: Page,
  openFixture: (fixture?: string, query?: string) => Promise<void>,
) {
  await openFixture('mermaid', '&theme=default')
  await operation(page, 'replaceSource', { text: source })
  await page.addStyleTag({ content: presets })
  await page.locator('.inkkit-mermaid-preview').scrollIntoViewIfNeeded()
  await expect(page.locator('.inkkit-mermaid-preview')).toHaveAttribute(
    'data-state',
    'ready',
  )
}

const apply = (page: Page, theme: string, scheme: string) =>
  page.locator('#editor').evaluate(
    (root, { theme, scheme }) => {
      root.dataset.inkkitTheme = theme
      root.style.setProperty('--inkkit-color-scheme', scheme)
    },
    { theme, scheme },
  )

// Read actual painted colors, including translucent surfaces and selections.
const colors = (page: Page) =>
  page.locator('#editor').evaluate((root) => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const context = canvas.getContext('2d', { willReadFrequently: true })!
    const rgba = (color: string) => {
      context.clearRect(0, 0, 1, 1)
      context.fillStyle = color
      context.fillRect(0, 0, 1, 1)
      const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data
      return [r!, g!, b!, a! / 255]
    }
    const over = (top: number[], bottom: number[]) =>
      top.slice(0, 3).map((c, i) => c * top[3]! + bottom[i]! * (1 - top[3]!))
    const luminance = (rgb: number[]) => {
      const [r, g, b] = rgb.map((c) => {
        const v = c / 255
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
    }
    const ratio = (a: number[], b: number[]) => {
      const [x, y] = [luminance(a), luminance(b)]
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
    }
    const background = (element: Element) => {
      const layers: number[][] = []
      for (
        let node: Element | null = element;
        node;
        node = node.parentElement
      ) {
        const layer = rgba(getComputedStyle(node).backgroundColor)
        layers.push(layer)
        if (layer[3] === 1) break
      }
      return layers.reduceRight(
        (below, layer) => over(layer, below),
        [255, 255, 255],
      )
    }
    const read = (selector: string) => {
      const element = root.querySelector(selector)!
      const style = getComputedStyle(element)
      const bg = background(element)
      return {
        color: style.color,
        contrast: ratio(over(rgba(style.color), bg), bg),
      }
    }
    const body = root.querySelector('.ProseMirror > p')!
    const bodyStyle = getComputedStyle(body)
    const selection = getComputedStyle(
      body,
      '::highlight(inkkit-selection)',
    ).backgroundColor
    const bg = background(body)
    const selected = over(rgba(selection), bg)
    const tasks = root.querySelector('[data-checked="false"]')!
    const task = getComputedStyle(tasks, '::before')
    const diagram = root.querySelector('.inkkit-mermaid-preview')!
    const diagramStyle = getComputedStyle(diagram)
    const copy = root.querySelector('.inkkit-copy')!
    return {
      body: read('.ProseMirror > p'),
      link: read('.ProseMirror a'),
      inline: read('.ProseMirror > p code'),
      header: read('th'),
      copy: read('.inkkit-copy'),
      language: read('.inkkit-code-language'),
      completedTask: read('[data-checked="true"] p'),
      code: Object.fromEntries(
        ['comment', 'keyword', 'string', 'number', 'title', 'attr'].map(
          (kind) => [kind, read(`.inkkit-hljs-${kind}`)],
        ),
      ),
      selection: {
        color: selection,
        contrast: ratio(rgba(bodyStyle.color), selected),
      },
      checkboxContrast: ratio(
        over(rgba(task.borderLeftColor), background(tasks)),
        background(tasks),
      ),
      diagramContrast: ratio(
        rgba(diagramStyle.color),
        rgba(diagramStyle.backgroundColor),
      ),
      focusContrast: ratio(
        rgba(getComputedStyle(copy).outlineColor),
        background(copy),
      ),
      slices: [...root.querySelectorAll('.pele-slice')].map((slice) =>
        rgba(getComputedStyle(slice).fill).slice(0, 3),
      ),
    }
  })

for (const theme of themes)
  for (const scheme of ['light', 'dark'])
    test(`${theme} ${scheme} keeps readable text, component geometry and keyboard focus @themes`, async ({
      page,
      openFixture,
    }, testInfo) => {
      await page.emulateMedia({
        colorScheme: scheme === 'light' ? 'dark' : 'light',
      })
      await open(page, openFixture)
      await apply(page, theme, scheme)
      const root = page.locator('#editor')
      await expect(root).toHaveCSS('font-size', '15px')
      await expect(root.locator('pre').first()).toHaveCSS(
        'border-radius',
        theme === 'essential' ? '4px' : '8px',
      )
      await expect(root.locator('table')).toHaveCSS(
        'border-top-left-radius',
        theme === 'essential' ? '4px' : '8px',
      )
      await expect(root.locator('p code').first()).toHaveCSS(
        'border-radius',
        '5px',
      )
      expect(
        await root.locator('blockquote').evaluate((quote) => {
          const line = getComputedStyle(quote, '::before')
          return {
            width: line.width,
            radius: line.borderRadius,
            color: line.backgroundColor,
          }
        }),
      ).toEqual({
        width: '3px',
        radius: '2px',
        color: scheme === 'light' ? 'rgb(166, 166, 166)' : 'rgb(119, 119, 119)',
      })

      const palette = await colors(page)
      await testInfo.attach('contrast', {
        body: JSON.stringify(palette, null, 2),
        contentType: 'application/json',
      })
      for (const [name, value] of Object.entries({
        ...palette.code,
        body: palette.body,
        link: palette.link,
        inline: palette.inline,
        header: palette.header,
        copy: palette.copy,
        language: palette.language,
        completedTask: palette.completedTask,
        selection: palette.selection,
      }))
        expect(
          value.contrast,
          `${name}: ${JSON.stringify(palette)}`,
        ).toBeGreaterThanOrEqual(4.5)
      expect(palette.checkboxContrast).toBeGreaterThanOrEqual(3)
      expect(palette.diagramContrast).toBeGreaterThanOrEqual(4.5)
      if (theme === 'essential')
        for (const slice of palette.slices) expect(slice[0]).toBe(slice[1])
      await page.keyboard.press('Shift')
      await root.locator('.inkkit-copy').first().focus()
      await expect(root.locator('.inkkit-copy').first()).toBeFocused()
      await expect(root.locator('.inkkit-copy').first()).toHaveCSS(
        'opacity',
        '1',
      )
      expect(
        await root
          .locator('.inkkit-copy')
          .first()
          .evaluate((button) => {
            const style = getComputedStyle(button)
            return {
              width: style.outlineWidth,
              kind: style.outlineStyle,
              visible: style.opacity,
            }
          }),
      ).toEqual({ width: '2px', kind: 'solid', visible: '1' })
      expect((await colors(page)).focusContrast).toBeGreaterThanOrEqual(3)
      const readable = (await observe(page)).textSnapshot!
      await operation(page, 'selectTextRange', {
        range: { snapshotId: readable.snapshotId, from: 0, to: 5 },
        options: { focus: true, reveal: true },
      })
      expect((await colors(page)).selection.contrast).toBeGreaterThanOrEqual(
        4.5,
      )
      await root.evaluate((element) => {
        element.scrollTop = 0
      })
      await root.screenshot({
        path: testInfo.outputPath(`${theme}-${scheme}.png`),
      })
      await root
        .locator('.inkkit-mermaid-preview')
        .screenshot({ path: testInfo.outputPath(`${theme}-${scheme}-pie.png`) })
      await root
        .locator('pre')
        .first()
        .screenshot({
          path: testInfo.outputPath(`${theme}-${scheme}-code.png`),
        })
      await page.setViewportSize({ width: 390, height: 844 })
      await page.addStyleTag({
        content: '#editors { display:block } #editor { width:100%; }',
      })
      expect(
        await root.evaluate(
          (element) => element.scrollWidth - element.clientWidth,
        ),
      ).toBeLessThanOrEqual(1)
      await root.evaluate((element) => {
        element.scrollTop = 0
      })
      await root.screenshot({
        path: testInfo.outputPath(`${theme}-${scheme}-narrow.png`),
      })
      expect((await observe(page)).snapshot?.text).toBe(source)
    })

test('loading presets is opt in and host tokens can override geometry @themes', async ({
  page,
  openFixture,
}) => {
  await openFixture('mermaid', '&theme=default')
  await operation(page, 'replaceSource', { text: source })
  const probe = () =>
    page.locator('#editor').evaluate((root) => {
      const pre = getComputedStyle(root.querySelector('pre')!)
      const quote = root.querySelector('blockquote')!
      const line = getComputedStyle(quote, '::before')
      return {
        code: pre.borderRadius,
        background: pre.backgroundColor,
        quote: [line.width, line.borderRadius, line.backgroundColor],
        padding: getComputedStyle(quote).paddingLeft,
      }
    })
  const original = await probe()
  await page.addStyleTag({ content: presets })
  expect(await probe()).toEqual(original)
  expect(original).toMatchObject({
    code: '8px',
    quote: ['2px', '0px', expect.any(String)],
    padding: '14px',
  })
  await apply(page, 'essential', 'light')
  await page.addStyleTag({
    content:
      '#editor { --inkkit-code-radius:12px; --inkkit-quote-rule-width:5px; --inkkit-quote-rule-radius:4px; --inkkit-quote-rule-color:rgb(10,20,30); }',
  })
  expect(await probe()).toMatchObject({
    code: '12px',
    quote: ['5px', '4px', 'rgb(10, 20, 30)'],
    padding: '17px',
  })
})

test('switching presets updates existing pies and preserves bytes, revision and undo history @themes', async ({
  page,
  openFixture,
}) => {
  await open(page, openFixture)
  const initial = (await observe(page)).snapshot
  const geometry = await page
    .locator('.pele-slices')
    .evaluate((node) => node.outerHTML)
  const palettes = []
  for (const theme of themes) {
    await apply(page, theme, 'light')
    palettes.push((await colors(page)).slices)
    expect((await observe(page)).snapshot).toEqual(initial)
    expect(
      await page.locator('.pele-slices').evaluate((node) => node.outerHTML),
    ).toBe(geometry)
  }
  expect(palettes[0]).not.toEqual(palettes[1])
  expect(palettes[1]).not.toEqual(palettes[2])
  const readable = (await observe(page)).textSnapshot!
  await operation(page, 'selectTextRange', {
    range: {
      snapshotId: readable.snapshotId,
      from: readable.text.length,
      to: readable.text.length,
    },
    options: { focus: true, reveal: true },
  })
  await page.keyboard.type('!')
  expect((await observe(page)).snapshot?.text).toBe(source + '!')
  await apply(page, 'calm', 'dark')
  expect(await operation(page, 'undo')).toBe(true)
  expect((await observe(page)).snapshot?.text).toBe(source)
  expect(await operation(page, 'redo')).toBe(true)
  expect((await observe(page)).snapshot?.text).toBe(source + '!')
  await operation(page, 'reload')
  expect((await observe(page)).snapshot?.text).toBe(source + '!')
})

test('presets retain long content and mode-specific layout at narrow widths @themes', async ({
  page,
  openFixture,
}) => {
  await open(page, openFixture)
  const long = [
    source,
    ...Array.from(
      { length: 100 },
      (_, index) =>
        `Paragraph ${index}: ${'A long line with Café ☕ and ordinary spaces. '.repeat(12)}`,
    ),
  ].join('\r\n\r\n')
  await operation(page, 'replaceSource', { text: long })
  const saved = (await observe(page)).snapshot
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addStyleTag({
    content: '#editors { display:block } #editor { width:100%; }',
  })
  for (const theme of themes) {
    await apply(page, theme, 'dark')
    expect((await observe(page)).snapshot).toEqual(saved)
    expect(
      await page
        .locator('#editor')
        .evaluate((root) => root.scrollWidth - root.clientWidth),
    ).toBeLessThanOrEqual(1)
    await operation(page, 'editingMode', { mode: 'source' })
    await expect(page.locator('#editor textarea')).toHaveCSS(
      'line-height',
      '22.5px',
    )
    expect((await observe(page)).snapshot?.text).toBe(long)
    await operation(page, 'editingMode', { mode: 'formatted' })
  }
  await operation(page, 'reload')
  expect((await observe(page)).snapshot?.text).toBe(long)
})

test('quote rules remain visible in forced colors with default styles and presets @themes', async ({
  page,
  openFixture,
  browserName,
}) => {
  test.skip(
    browserName !== 'chromium',
    'Playwright WebKit does not emulate forced colors',
  )
  await page.emulateMedia({ forcedColors: 'active' })
  await open(page, openFixture)
  for (const theme of ['default', ...themes]) {
    await page.locator('#editor').evaluate((root, theme) => {
      if (theme === 'default') delete root.dataset.inkkitTheme
      else root.dataset.inkkitTheme = theme
    }, theme)
    expect(
      await page.locator('#editor blockquote').evaluate((quote) => {
        const line = getComputedStyle(quote, '::before')
        const probe = document.createElement('span')
        probe.style.cssText = 'background:Canvas;color:CanvasText'
        document.body.append(probe)
        const canvas = getComputedStyle(probe)
        const result = {
          line: line.backgroundColor,
          text: canvas.color,
          page: canvas.backgroundColor,
          width: line.width,
        }
        probe.remove()
        return result
      }),
    ).toMatchObject({
      line: 'rgb(0, 0, 0)',
      text: 'rgb(0, 0, 0)',
      page: 'rgb(255, 255, 255)',
      width: theme === 'default' ? '2px' : '3px',
    })
  }
  expect((await observe(page)).snapshot?.text).toBe(source)
})
