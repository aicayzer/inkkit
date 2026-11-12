import { expect, test } from '@playwright/test'

const moduleUrl = `/@fs${process.cwd()}/src/core.ts`

declare global {
  interface Window {
    placeholderOpened: string[]
    placeholderText(): string
  }
}

test('a placeholder button is reached by Tab, is named by its text and label, and Return and Space open that file alone', async ({
  page,
  browserName,
}) => {
  await page.goto('/')
  await page.waitForFunction(() => Boolean(window.inkkitPlayground))
  const text = '![[first.png]]\n\n![[second.png]]\n'
  const saved = await page.evaluate(
    async ({ moduleUrl, text }) => {
      const { InkKitEditor } = (await import(
        moduleUrl
      )) as typeof import('../../src/core')
      const before = document.createElement('button')
      before.id = 'before-placeholder'
      before.textContent = 'Before'
      const root = document.createElement('div')
      root.id = 'placeholder-host'
      document.body.append(before, root)
      window.placeholderOpened = []
      const editor = await InkKitEditor.mount(
        root,
        { changed() {} },
        {
          files: {
            resolve: async (reference) => ({
              kind: 'file',
              label: reference.target,
              appearance: 'placeholder',
              action: 'Load',
            }),
            open: (reference) =>
              window.placeholderOpened.push(reference.target),
          },
        },
      )
      editor.loadDocument({
        documentId: 'placeholder',
        generation: 1,
        format: 'md',
        text,
      })
      window.placeholderText = () => editor.snapshot().text
      return editor.snapshot().text
    },
    { moduleUrl, text },
  )
  expect(saved).toBe(text)
  const buttons = page.locator('#placeholder-host .inkkit-file-action')
  await expect(buttons).toHaveCount(2)
  await expect(
    page.getByRole('button', { name: 'Load second.png' }),
  ).toHaveCount(1)
  // The line itself is not a control.
  await expect(
    page.locator('#placeholder-host .inkkit-file[tabindex]'),
  ).toHaveCount(0)
  // Safari uses Option+Tab to include buttons when full keyboard access is off.
  const next = browserName === 'webkit' ? 'Alt+Tab' : 'Tab'
  const previous = browserName === 'webkit' ? 'Alt+Shift+Tab' : 'Shift+Tab'
  // The editing surface can be a tab stop of its own, so allow it before the button.
  const reach = async (key: string, index: number) => {
    for (
      let count = 0;
      count < 3 &&
      !(await buttons
        .nth(index)
        .evaluate((element) => element === document.activeElement));
      count++
    )
      await page.keyboard.press(key)
    await expect(buttons.nth(index)).toBeFocused()
  }
  await page.locator('#before-placeholder').focus()
  await reach(next, 0)
  await reach(next, 1)
  await page.keyboard.press('Enter')
  expect(await page.evaluate(() => window.placeholderOpened)).toEqual([
    'second.png',
  ])
  await page.keyboard.press('Space')
  expect(await page.evaluate(() => window.placeholderOpened)).toEqual([
    'second.png',
    'second.png',
  ])
  await reach(previous, 0)
  await page.keyboard.press('Enter')
  expect(await page.evaluate(() => window.placeholderOpened)).toEqual([
    'second.png',
    'second.png',
    'first.png',
  ])
  // Return and Space belong to the button: neither changed the document.
  expect(await page.evaluate(() => window.placeholderText())).toBe(text)
  await expect(buttons).toHaveCount(2)
})

const tokenNames = [
  'background',
  'radius',
  'min-height',
  'padding',
  'gap',
  'color',
  'font-size',
  'symbol-color',
  'symbol-size',
  'button-background',
  'button-hover-background',
  'button-border-color',
  'button-hover-border-color',
  'button-color',
  'button-font-size',
  'button-font-weight',
  'button-height',
  'button-padding-inline',
  'button-radius',
]

// Mounts one placeholder through the public facade and reads the computed style of its box, line,
// label, symbol and button, with the button at rest and hovered.
async function readPlaceholder(
  page: import('@playwright/test').Page,
  css: string,
) {
  await page.goto('/')
  await page.waitForFunction(() => Boolean(window.inkkitPlayground))
  await page.evaluate(
    async ({ moduleUrl, css }) => {
      const { InkKitEditor } = (await import(
        moduleUrl
      )) as typeof import('../../src/core')
      const style = document.createElement('style')
      style.textContent = css
      document.head.append(style)
      const root = document.createElement('div')
      root.id = 'token-host'
      document.body.append(root)
      const probes = document.createElement('div')
      probes.id = 'token-probes'
      probes.className = 'inkkit-root'
      probes.innerHTML =
        '<span id="probe-muted" style="color: color-mix(in srgb, CanvasText 55%, transparent)"></span>' +
        '<span id="probe-text" style="color: CanvasText"></span>' +
        '<span id="probe-code" style="color: color-mix(in srgb, CanvasText 8%, transparent)"></span>' +
        '<span id="probe-rule" style="color: color-mix(in srgb, CanvasText 14%, transparent)"></span>'
      document.body.append(probes)
      const editor = await InkKitEditor.mount(
        root,
        { changed() {} },
        {
          files: {
            resolve: async (reference) => ({
              kind: 'file',
              label: reference.target,
              appearance: 'placeholder',
              action: 'Load',
            }),
            open() {},
          },
        },
      )
      editor.loadDocument({
        documentId: 'tokens',
        generation: 1,
        format: 'md',
        text: '![[photo.png]]\n',
      })
    },
    { moduleUrl, css },
  )
  const box = page.locator('#token-host .inkkit-file')
  const button = page.locator('#token-host .inkkit-file-action')
  await expect(button).toHaveCount(1)
  const probe = (id: string) =>
    page.locator(`#${id}`).evaluate((el) => getComputedStyle(el).color)
  const of = async <const Name extends string>(
    selector: string,
    names: readonly Name[],
  ) =>
    (await page
      .locator(`#token-host ${selector}`)
      .evaluate(
        (el, names) =>
          Object.fromEntries(
            names.map((name) => [
              name,
              getComputedStyle(el).getPropertyValue(name),
            ]),
          ),
        names,
      )) as Record<Name, string>
  const rest = {
    box: await of('.inkkit-file', [
      'background-color',
      'border-top-left-radius',
      'min-height',
      'padding-top',
      'padding-left',
      'border-top-width',
    ]),
    line: await of('.inkkit-file-quiet', ['column-gap', 'font-size', 'color']),
    symbol: await of('.inkkit-file-symbol', ['width', 'height', 'stroke']),
    button: await of('.inkkit-file-action', [
      'background-color',
      'border-top-color',
      'color',
      'font-size',
      'font-weight',
      'height',
      'padding-left',
      'padding-right',
      'border-top-left-radius',
    ]),
    boxHeight: await box.evaluate((el) => el.getBoundingClientRect().height),
    boxDisplay: await box.evaluate((el) => getComputedStyle(el).display),
  }
  await button.hover()
  const hover = await of('.inkkit-file-action', [
    'background-color',
    'border-top-color',
  ])
  return {
    rest,
    hover,
    probes: {
      muted: await probe('probe-muted'),
      text: await probe('probe-text'),
      code: await probe('probe-code'),
      rule: await probe('probe-rule'),
    },
  }
}

test('a placeholder without tokens keeps the look it had before the tokens', async ({
  page,
}) => {
  const { rest, hover, probes } = await readPlaceholder(page, '')
  expect(rest.box).toEqual({
    'background-color': 'rgba(0, 0, 0, 0)',
    'border-top-left-radius': '6px',
    'min-height': '0px',
    'padding-top': '0px',
    'padding-left': '0px',
    'border-top-width': '0px',
  })
  // The line is the footer's 0.9em of the 15px editor text, and its symbol and gap follow it.
  expect(rest.line['font-size']).toBe('13.5px')
  expect(parseFloat(rest.line['column-gap'])).toBeCloseTo(13.5 * 0.4, 1)
  expect(rest.line.color).toBe(probes.muted)
  // Layout rounds lengths to a fraction of a pixel, so compare sizes with a tolerance.
  expect(parseFloat(rest.symbol.width)).toBeCloseTo(13.5 * 1.15, 1)
  expect(parseFloat(rest.symbol.height)).toBeCloseTo(13.5 * 1.15, 1)
  expect(rest.symbol.stroke).toBe(probes.muted)
  expect(rest.button['background-color']).toBe(probes.code)
  expect(rest.button['border-top-color']).toBe(probes.rule)
  expect(rest.button.color).toBe(probes.text)
  expect(rest.button['font-size']).toBe('13.5px')
  expect(rest.button['font-weight']).toBe('400')
  expect(parseFloat(rest.button['padding-left'])).toBeCloseTo(13.5 * 0.65, 1)
  expect(parseFloat(rest.button['padding-right'])).toBeCloseTo(13.5 * 0.65, 1)
  expect(rest.button['border-top-left-radius']).toBe('999px')
  // The button at rest is 1.5 lines of text, 0.05em above and below and a 1px border.
  expect(parseFloat(rest.button.height)).toBeCloseTo(13.5 * 1.6 + 2, 0)
  // Hovering changes only the border, as before.
  expect(hover['background-color']).toBe(probes.code)
  expect(hover['border-top-color']).toBe(probes.muted)
  // The box still takes the width of its content, not the column's.
  expect(rest.boxDisplay).toBe('inline-flex')
})

test('a host sets the placeholder box, label, symbol and button with tokens', async ({
  page,
}) => {
  const tokens = {
    background: 'rgb(10, 20, 30)',
    radius: '8px',
    'min-height': '30px',
    padding: '0 4px 0 9px',
    gap: '7px',
    color: 'rgb(40, 41, 42)',
    'font-size': '16px',
    'symbol-color': 'rgb(50, 51, 52)',
    'symbol-size': '20px',
    'button-background': 'rgb(60, 61, 62)',
    'button-hover-background': 'rgb(70, 71, 72)',
    'button-border-color': 'rgb(80, 81, 82)',
    'button-hover-border-color': 'rgb(90, 91, 92)',
    'button-color': 'rgb(100, 101, 102)',
    'button-font-size': '12px',
    'button-font-weight': '500',
    'button-height': '22px',
    'button-padding-inline': '11px',
    'button-radius': '5px',
  }
  expect(Object.keys(tokens).sort()).toEqual([...tokenNames].sort())
  const css = `#token-host { ${Object.entries(tokens)
    .map(([name, value]) => `--inkkit-file-placeholder-${name}: ${value};`)
    .join(' ')} }`
  const { rest, hover } = await readPlaceholder(page, css)
  expect(rest.box).toEqual({
    'background-color': 'rgb(10, 20, 30)',
    'border-top-left-radius': '8px',
    'min-height': '30px',
    'padding-top': '0px',
    'padding-left': '9px',
    'border-top-width': '0px',
  })
  expect(rest.boxHeight).toBe(30)
  expect(rest.line).toEqual({
    'column-gap': '7px',
    'font-size': '16px',
    color: 'rgb(40, 41, 42)',
  })
  expect(rest.symbol).toEqual({
    width: '20px',
    height: '20px',
    stroke: 'rgb(50, 51, 52)',
  })
  expect(rest.button).toEqual({
    'background-color': 'rgb(60, 61, 62)',
    'border-top-color': 'rgb(80, 81, 82)',
    color: 'rgb(100, 101, 102)',
    'font-size': '12px',
    'font-weight': '500',
    height: '22px',
    'padding-left': '11px',
    'padding-right': '11px',
    'border-top-left-radius': '5px',
  })
  expect(hover).toEqual({
    'background-color': 'rgb(70, 71, 72)',
    'border-top-color': 'rgb(90, 91, 92)',
  })
})

test('the symbol follows the label color and the hover fill follows the button fill until each is set', async ({
  page,
}) => {
  const { rest, hover } = await readPlaceholder(
    page,
    `#token-host {
      --inkkit-file-placeholder-color: rgb(1, 2, 3);
      --inkkit-file-placeholder-button-background: rgb(4, 5, 6);
    }`,
  )
  expect(rest.line.color).toBe('rgb(1, 2, 3)')
  expect(rest.symbol.stroke).toBe('rgb(1, 2, 3)')
  expect(rest.button['background-color']).toBe('rgb(4, 5, 6)')
  expect(hover['background-color']).toBe('rgb(4, 5, 6)')
})
