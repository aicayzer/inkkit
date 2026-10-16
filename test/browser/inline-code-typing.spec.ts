import type { Page } from '@playwright/test'
import { test, expect, observe, operation, caretAfterMatch } from './fixtures'

test('typing after inline code is switched on at a caret stays in the code until it is switched off @preservation', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await operation(page, 'replaceSource', { text: 'Run now\n' })
  await caretAfterMatch(page, 'Run')
  await operation(page, 'format', { command: 'code' })
  await page.keyboard.type('npm i x')
  let observed = await observe(page)
  expect(observed.diagnostics).toEqual([])
  expect(observed.snapshot!.text).toBe('Run`npm i x` now\n')
  await operation(page, 'format', { command: 'code' })
  await page.keyboard.type('yz')
  observed = await observe(page)
  expect(observed.diagnostics).toEqual([])
  expect(observed.snapshot!.text).toBe('Run`npm i x`yz now\n')
  await expect(
    page
      .getByRole('textbox', { name: 'Formatted Markdown editor', exact: true })
      .locator('code'),
  ).toHaveText('npm i x')
})

test('typing after the end of an existing code span leaves it @preservation', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await operation(page, 'replaceSource', { text: 'Run `npm` now\n' })
  await caretAfterMatch(page, 'npm')
  await page.keyboard.type('xy')
  const observed = await observe(page)
  expect(observed.diagnostics).toEqual([])
  expect(observed.snapshot!.text).toBe('Run `npm`xy now\n')
})

test('Backspace while typing in pending inline code keeps the code going @preservation', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await operation(page, 'replaceSource', { text: 'Run now\n' })
  await caretAfterMatch(page, 'Run')
  await operation(page, 'format', { command: 'code' })
  await page.keyboard.type(' npm instx')
  await page.keyboard.press('Backspace')
  await page.keyboard.type('all')
  const observed = await observe(page)
  expect(observed.diagnostics).toEqual([])
  expect(observed.snapshot!.text).toBe('Run` npm install` now\n')
})

test('Enter ends pending inline code @preservation', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await operation(page, 'replaceSource', { text: 'Run now\n' })
  await caretAfterMatch(page, 'Run')
  await operation(page, 'format', { command: 'code' })
  await page.keyboard.type('ab')
  await page.keyboard.press('Enter')
  await page.keyboard.type('cd')
  const observed = await observe(page)
  expect(observed.diagnostics).toEqual([])
  expect(observed.snapshot!.text).toBe('Run`ab`\n\ncd now\n')
})

// An input method keeps the text it is composing in the page until the person
// commits it, and ProseMirror saves each state as it changes.
test('composed text under a pending code mark lands in the code once @preservation', async ({
  page,
  openFixture,
  browserName,
}) => {
  test.skip(
    browserName !== 'chromium',
    'Only Chromium lets a test drive an input method',
  )
  await openFixture()
  await operation(page, 'replaceSource', { text: 'Run now\n' })
  await caretAfterMatch(page, 'Run')
  await operation(page, 'format', { command: 'code' })
  await page.keyboard.type('ab')
  const session = await page.context().newCDPSession(page)
  for (const composing of ['に', 'にほ']) {
    await session.send('Input.imeSetComposition', {
      text: composing,
      selectionStart: composing.length,
      selectionEnd: composing.length,
    })
  }
  await session.send('Input.insertText', { text: 'にほ' })
  await page.keyboard.type('cd')
  await expect
    .poll(async () => (await observe(page)).snapshot?.text)
    .toBe('Run`abにほcd` now\n')
  // A second composition after the first one, and a correction.
  for (const composing of ['ん', 'んご']) {
    await session.send('Input.imeSetComposition', {
      text: composing,
      selectionStart: composing.length,
      selectionEnd: composing.length,
    })
  }
  await session.send('Input.insertText', { text: 'んご' })
  await page.keyboard.press('Backspace')
  await page.keyboard.type('e')
  await expect
    .poll(async () => (await observe(page)).snapshot?.text)
    .toBe('Run`abにほcdんe` now\n')
  expect((await observe(page)).diagnostics).toEqual([])
  await expect(
    page
      .getByRole('textbox', { name: 'Formatted Markdown editor', exact: true })
      .locator('code'),
  ).toHaveText('abにほcdんe')
})

// The editor puts the code on composed text as the composition ends, without
// waiting on a timer, so no key or paste can come first. These hold back
// timers that name no delay to show that nothing depends on one.
async function composeWithTimerHeld(
  page: Page,
  steps = ['に', 'にほ'],
  committed = 'にほ',
) {
  await operation(page, 'replaceSource', { text: 'Run now\n' })
  await caretAfterMatch(page, 'Run')
  await operation(page, 'format', { command: 'code' })
  await page.keyboard.type('ab')
  await page.evaluate(() => {
    const set = window.setTimeout.bind(window)
    window.setTimeout = ((handler: TimerHandler, delay?: number, ...rest: []) =>
      set(handler, delay ?? 3000, ...rest)) as typeof window.setTimeout
  })
  const session = await page.context().newCDPSession(page)
  for (const composing of steps) {
    await session.send('Input.imeSetComposition', {
      text: composing,
      selectionStart: composing.length,
      selectionEnd: composing.length,
    })
  }
  await session.send('Input.insertText', { text: committed })
}

const text = async (page: Page) => (await observe(page)).snapshot?.text

for (const [name, keys, saved] of [
  ['Backspace', ['Backspace', 'e'], 'Run`abにe` now\n'],
  ['a typed character', ['e'], 'Run`abにほe` now\n'],
] as const)
  test(`${name} right after a composition ends keeps the pending code @preservation`, async ({
    page,
    openFixture,
    browserName,
  }) => {
    test.skip(
      browserName !== 'chromium',
      'Only Chromium lets a test drive an input method',
    )
    await openFixture()
    await composeWithTimerHeld(page)
    for (const key of keys) await page.keyboard.press(key)
    await expect.poll(() => text(page)).toBe(saved)
    expect((await observe(page)).diagnostics).toEqual([])
  })

// Native input of more than a character, such as dictation, after a composition.
test('a longer native input right after a composition ends stays in the code @preservation', async ({
  page,
  openFixture,
  browserName,
}) => {
  test.skip(
    browserName !== 'chromium',
    'Only Chromium lets a test drive an input method',
  )
  await openFixture()
  await composeWithTimerHeld(page)
  await operation(page, 'insertText', { text: 'long' })
  await page.keyboard.type('x')
  await expect.poll(() => text(page)).toBe('Run`abにほlongx` now\n')
  expect((await observe(page)).diagnostics).toEqual([])
})

// An address that the first key completes is in the code, so it is not a link.
test('an address completed right after a composition is code, not a link @preservation', async ({
  page,
  openFixture,
  browserName,
}) => {
  test.skip(
    browserName !== 'chromium',
    'Only Chromium lets a test drive an input method',
  )
  await openFixture()
  await composeWithTimerHeld(page, ['に', 'に a@b.'], 'に a@b.')
  await page.keyboard.type('c')
  await expect.poll(() => text(page)).toBe('Run`abに a@b.c` now\n')
  await expect(
    page
      .getByRole('textbox', { name: 'Formatted Markdown editor', exact: true })
      .locator('a'),
  ).toHaveCount(0)
  expect((await observe(page)).diagnostics).toEqual([])
})

// The composition is finished before any other edit, so a paste brings no code.
test('a paste right after a composition ends does not turn the pasted text into code @preservation', async ({
  page,
  openFixture,
  browserName,
}) => {
  test.skip(
    browserName !== 'chromium',
    'Only Chromium lets a test drive an input method',
  )
  await openFixture()
  await composeWithTimerHeld(page)
  await page.evaluate(() =>
    window.inkkitPlayground.operation('paste', {
      input: { html: '<b>BOLD</b>', text: 'BOLD' },
    }),
  )
  await expect.poll(() => text(page)).toBe('Run`abにほ`**BOLD** now\n')
  expect((await observe(page)).diagnostics).toEqual([])
})

test('Undo right after a composition ends does not bring the pending code back @preservation', async ({
  page,
  openFixture,
  browserName,
}) => {
  test.skip(
    browserName !== 'chromium',
    'Only Chromium lets a test drive an input method',
  )
  await openFixture()
  await composeWithTimerHeld(page)
  await page.keyboard.press('ControlOrMeta+z')
  await page.keyboard.type('x')
  await expect.poll(() => text(page)).toBe('Runx now\n')
  expect((await observe(page)).diagnostics).toEqual([])
})

for (const [name, keys, saved] of [
  ['Enter', ['Enter', 'x'], 'Run`abにほ`\n\nx now\n'],
  ['a caret move', ['ArrowLeft', 'x'], 'Run`abにxほ` now\n'],
] as const)
  test(`${name} right after a composition ends acts on the finished code @preservation`, async ({
    page,
    openFixture,
    browserName,
  }) => {
    test.skip(
      browserName !== 'chromium',
      'Only Chromium lets a test drive an input method',
    )
    await openFixture()
    await composeWithTimerHeld(page)
    for (const key of keys) await page.keyboard.press(key)
    await expect.poll(() => text(page)).toBe(saved)
    expect((await observe(page)).diagnostics).toEqual([])
  })

test('one Undo removes composed code text together with its mark @preservation', async ({
  page,
  openFixture,
  browserName,
}) => {
  test.skip(
    browserName !== 'chromium',
    'Only Chromium lets a test drive an input method',
  )
  await openFixture()
  await operation(page, 'replaceSource', { text: 'Run now\n' })
  await caretAfterMatch(page, 'Run')
  await operation(page, 'format', { command: 'code' })
  const session = await page.context().newCDPSession(page)
  for (const composing of ['に', 'にほ']) {
    await session.send('Input.imeSetComposition', {
      text: composing,
      selectionStart: composing.length,
      selectionEnd: composing.length,
    })
  }
  await session.send('Input.insertText', { text: 'にほ' })
  await expect
    .poll(async () => (await observe(page)).snapshot?.text)
    .toBe('Run`にほ` now\n')
  await page.keyboard.press('ControlOrMeta+z')
  await expect
    .poll(async () => (await observe(page)).snapshot?.text)
    .toBe('Run now\n')
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect
    .poll(async () => (await observe(page)).snapshot?.text)
    .toBe('Run`にほ` now\n')
  expect((await observe(page)).diagnostics).toEqual([])
})
