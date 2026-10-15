import { test, expect, observe, operation, caretAfterMatch } from './fixtures'
import type { Page } from '@playwright/test'

const contexts = [
  { name: 'paragraph', wrap: (s: string) => s, continued: 'Run now\\\nabcd' },
  {
    name: 'list item',
    wrap: (s: string) => `+ ${s}`,
    continued: '+ Run now\\\n  abcd',
  },
  {
    name: 'quote',
    wrap: (s: string) => `> ${s}`,
    continued: '> Run now\\\n> abcd',
  },
  {
    name: 'callout',
    wrap: (s: string) => `> [!NOTE]\n> ${s}`,
    continued: '> [!NOTE]\n> Run now\\\n> abcd',
  },
  {
    name: 'table cell',
    wrap: (s: string) => `| A |\n| - |\n| ${s} |`,
    continued: '| A |\n| - |\n| Run now<br />abcd |',
  },
  {
    name: 'heading',
    wrap: (s: string) => `## ${s}`,
    continued: '## Run now<br />abcd',
  },
]

async function load(page: Page, text: string) {
  await page.evaluate(
    (text) => window.inkkitPlayground.replaceDocument(text, 'md'),
    text,
  )
}

async function caret(page: Page, text: string, offset = text.length) {
  const snapshot = (await observe(page)).textSnapshot!
  const at = snapshot.text.indexOf(text) + offset
  expect(at).toBeGreaterThanOrEqual(offset)
  await operation(page, 'selectTextRange', {
    range: { snapshotId: snapshot.snapshotId, from: at, to: at },
    options: { focus: true },
  })
  await operation(page, 'focus')
}

async function saved(page: Page, text: string) {
  const observation = await observe(page)
  expect(observation.diagnostics).toEqual([])
  expect(observation.snapshot!.text).toBe(text)
}

async function reopen(page: Page, text: string) {
  const before = (await observe(page)).textSnapshot!.text
  await load(page, text)
  await saved(page, text)
  expect((await observe(page)).textSnapshot!.text).toBe(before)
}

for (const ending of ['\n', '\r\n']) {
  for (const context of contexts) {
    test(`Shift-Enter at the end of a ${context.name}, ${ending === '\n' ? 'LF' : 'CRLF'}, saves and undoes each step`, async ({
      page,
      openFixture,
    }) => {
      await openFixture()
      const note = (body: string) =>
        `Untouched __before__.\n\n${body}\n\nUntouched _after_.\n`.replaceAll(
          '\n',
          ending,
        )
      const source = note(context.wrap('Run'))
      const typed = note(context.wrap('Run now'))
      const broken = ['table cell', 'heading'].includes(context.name)
        ? note(context.wrap('Run now<br />'))
        : typed
      const continued = note(context.continued)
      await load(page, source)
      await saved(page, source)
      await caret(page, 'Run')
      await page.keyboard.type(' now')
      await saved(page, typed)
      const typedText = (await observe(page)).textSnapshot!.text
      await page.keyboard.press('Shift+Enter')
      await saved(page, broken)
      expect((await observe(page)).textSnapshot!.text).toContain('Run now\n')
      await page.keyboard.type('abcd')
      await saved(page, continued)
      await page.keyboard.press('ControlOrMeta+z')
      await saved(page, broken)
      await page.keyboard.press('ControlOrMeta+z')
      await saved(page, typed)
      expect((await observe(page)).textSnapshot!.text).toBe(typedText)
      await page.keyboard.press('ControlOrMeta+z')
      await saved(page, source)
      for (let i = 0; i < 3; i++) await operation(page, 'redo')
      await saved(page, continued)
      await reopen(page, continued)
      await load(page, typed)
      await caret(page, 'Run now')
      await page.keyboard.press('Shift+Enter')
      await saved(page, broken)
      await caretAfterMatch(page, 'Untouched _after_'.replaceAll('_', ''))
      await saved(page, broken)
      // A pending trailing break is not part of the saved document.
      await load(page, broken)
      await saved(page, broken)
      if (broken === typed)
        expect((await observe(page)).textSnapshot!.text).toBe(typedText)
    })
  }
}

test('successive breaks stay in the paragraph and each undoes separately', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await load(page, 'Run now\n')
  await caret(page, 'Run now')
  await page.keyboard.press('Shift+Enter')
  await page.keyboard.press('Shift+Enter')
  await page.keyboard.type('abcd')
  await saved(page, 'Run now\\\n\\\nabcd\n')
  await page.keyboard.press('ControlOrMeta+z')
  await saved(page, 'Run now\n')
  expect((await observe(page)).textSnapshot!.text).toBe('Run now\n\n')
  await page.keyboard.press('ControlOrMeta+z')
  await saved(page, 'Run now\n')
  expect((await observe(page)).textSnapshot!.text).toBe('Run now\n')
  await page.keyboard.press('ControlOrMeta+z')
  await saved(page, 'Run now\n')
  expect((await observe(page)).textSnapshot!.text).toBe('Run now')
})

for (const scenario of [
  {
    name: 'in the middle',
    source: 'Run now\n',
    offset: 3,
    broken: 'Run\\\n&#x20;now\n',
    result: 'Run\\\nabcd now\n',
  },
  {
    name: 'in an empty paragraph',
    source: '',
    offset: 0,
    broken: '',
    result: '\\\nabcd\n',
  },
]) {
  test(`a break ${scenario.name} saves and keeps following text`, async ({
    page,
    openFixture,
  }) => {
    await openFixture()
    await load(page, scenario.source)
    await caret(
      page,
      'Run now'.slice(0, scenario.source ? 7 : 0),
      scenario.offset,
    )
    await page.keyboard.press('Shift+Enter')
    await saved(page, scenario.broken)
    await page.keyboard.type('abcd')
    await saved(page, scenario.result)
    await reopen(page, scenario.result)
  })
}

test('deleting text after an authored hard break leaves a saveable line boundary', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await load(page, 'Run now\\\nabcd\n')
  await operation(page, 'find', { text: 'abcd' })
  await page.keyboard.press('Backspace')
  await saved(page, 'Run now\n')
  await load(page, 'Run now\n')
  await saved(page, 'Run now\n')
})

test('Enter after a pending break leaves saveable paragraphs and undoes separately', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await load(page, 'Run now\r\n')
  await caret(page, 'Run now')
  await page.keyboard.press('Shift+Enter')
  await page.keyboard.press('Enter')
  await page.keyboard.type('abcd')
  await saved(page, 'Run now\r\n\r\nabcd\r\n')
  await page.keyboard.press('ControlOrMeta+z')
  await page.keyboard.press('ControlOrMeta+z')
  await saved(page, 'Run now\r\n')
  await page.keyboard.press('ControlOrMeta+z')
  expect((await observe(page)).textSnapshot!.text).toBe('Run now')
})

test('an authored HTML break and untouched soft breaks retain their bytes', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  const source = 'Soft\r\nline\r\n\r\nRun now<br>\r\n'
  await load(page, source)
  await saved(page, source)
  await caret(page, 'Run now', 8)
  await page.keyboard.press('Shift+Enter')
  await saved(page, source)
  await page.keyboard.type('abcd')
  await saved(page, 'Soft\r\nline\r\n\r\nRun now<br>\\\r\nabcd\r\n')
  await reopen(page, (await observe(page)).snapshot!.text)
})

test('breaks in an empty heading save without dropping the line boundary', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await load(page, '##\n')
  await caret(page, '')
  await page.keyboard.press('Shift+Enter')
  await saved(page, '## <br />\n')
  await page.keyboard.type('abcd')
  await saved(page, '## <br />abcd\n')
  await reopen(page, '## <br />abcd\n')
})

test('editing a multiline setext heading keeps its authored soft break', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await load(page, 'One\nTwo\n===\n')
  await caret(page, 'Two')
  await page.keyboard.type('Z')
  await saved(page, 'One\nTwoZ\n===\n')
  await reopen(page, 'One\nTwoZ\n===\n')
})

test('a pending break accepts spaces and Unicode text after formatted text', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await load(page, '**Run now**\n')
  await caret(page, 'Run now')
  await page.keyboard.press('Shift+Enter')
  await saved(page, '**Run now**\n')
  await page.keyboard.type(' ')
  await page.keyboard.insertText('café🙂')
  await saved(page, '**Run now**\\\n&#x20;café🙂\n')
  await reopen(page, '**Run now**\\\n&#x20;café🙂\n')
})

for (const ending of ['\n', '\r\n']) {
  for (const underline of ['=====', '---']) {
    for (const title of ['Title', 'One\nTitle']) {
      test(`setext break ${JSON.stringify([ending, underline, title])} saves and undoes`, async ({
        page,
        openFixture,
      }) => {
        await openFixture()
        const note = (body: string, rule = underline) =>
          `Untouched __before__.\n\n${body}\n${rule}\n\nUntouched _after_.\n`.replaceAll(
            '\n',
            ending,
          )
        await load(page, note(title))
        await caret(page, 'Title')
        const before = (await observe(page)).textSnapshot!.text
        await page.keyboard.press('Shift+Enter')
        await saved(page, note(title))
        await page.keyboard.type('z')
        await saved(page, note(`${title}\\\nz`, underline[0]))
        await page.keyboard.press('ControlOrMeta+z')
        await saved(page, note(title))
        await page.keyboard.press('ControlOrMeta+z')
        await saved(page, note(title))
        expect((await observe(page)).textSnapshot!.text).toBe(before)
        await operation(page, 'redo')
        await operation(page, 'redo')
        await reopen(page, note(`${title}\\\nz`, underline[0]))
      })
    }
  }
}
