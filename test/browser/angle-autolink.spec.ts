import { test, expect, observe, operation } from './fixtures'
import { angleAutolinkCases } from '../angle-autolink-cases'

for (const [name, source, typed, expected] of angleAutolinkCases)
  test(`typing angle brackets around ${name} preserves the authored source @preservation`, async ({
    page,
    openFixture,
  }, testInfo) => {
    await openFixture()
    await operation(page, 'reload', { text: source })
    expect((await observe(page)).snapshot!.text).toBe(source)
    await operation(page, 'textSnapshot')
    const readable = (await observe(page)).lastResult as {
      snapshotId: string
      text: string
    }
    const from = readable.text.indexOf('x')
    await operation(page, 'selectTextRange', {
      range: { snapshotId: readable.snapshotId, from, to: from + 1 },
      options: { focus: true },
    })
    await page.keyboard.type(typed)
    const before = await observe(page)
    const content = (await operation(page, 'clipboard', {
      scope: 'document',
    })) as { text: string; html: string }
    const saved = before.snapshot!.text
    await operation(page, 'reload', { text: saved })
    const reopened = (await operation(page, 'clipboard', {
      scope: 'document',
    })) as { text: string; html: string }
    const semanticHTML = (html: string) =>
      html.replace(/ data-inkkit-link-form="[^"]*"/g, '')
    const same =
      reopened.text === content.text &&
      semanticHTML(reopened.html) === semanticHTML(content.html)
    const result = { name, saved, same, diagnostics: before.diagnostics }
    console.log(JSON.stringify(result))
    await testInfo.attach('saved-bytes', {
      body: JSON.stringify(result, null, 2),
      contentType: 'application/json',
    })
    expect(before.diagnostics).toEqual([])
    expect(same).toBe(true)
    expect((await observe(page)).snapshot!.text).toBe(saved)
    expect(saved).toBe(expected)
  })

for (const source of ['\\<https://x.com\\>\n', '&lt;https://x.com&gt;\n'])
  test(`undo restores literal delimiters in ${JSON.stringify(source)} @preservation`, async ({
    page,
    openFixture,
  }) => {
    await openFixture()
    await operation(page, 'reload', { text: source })
    const readable = (await operation(page, 'textSnapshot')) as {
      snapshotId: string
      text: string
    }
    const end = readable.text.indexOf('>') + 1
    expect(end).toBeGreaterThan(0)
    await operation(page, 'selectTextRange', {
      range: { snapshotId: readable.snapshotId, from: end, to: end },
      options: { focus: true },
    })
    await page.keyboard.press('Backspace')
    const deleted = (await observe(page)).snapshot!.text
    await page.keyboard.press('ControlOrMeta+z')
    expect((await observe(page)).snapshot!.text).toBe(source)
    await operation(page, 'redo')
    const observed = await observe(page)
    expect(observed.diagnostics).toEqual([])
    expect(observed.snapshot!.text).toBe(deleted)
  })

// The marker is replaced through the public facade; the edit itself uses real keys.
for (const [name, source, marker, typed, expected] of [
  [
    'before a loaded angle link',
    '<https://x.com>\n',
    '',
    '(',
    '(<https://x.com>\n',
  ],
  ['after a loaded email link', '<a@b.co>\n', 'a@b.co', ')', '<a@b.co>)\n'],
  [
    'after a loaded angle link',
    '<https://x.com>\n',
    'https://x.com',
    ')',
    '<https://x.com>)\n',
  ],
  [
    'completion before a suffix',
    '\\<https://x.comfoo\n',
    'https://x.com',
    '>',
    '<https://x.com>foo\n',
  ],
  [
    'a typed code wrapper',
    'x\n',
    'x',
    '`<https://x.com>` tail',
    '`<https://x.com>` tail\n',
  ],
  [
    'a typed bold wrapper',
    'x\n',
    'x',
    '**<https://x.com>** tail',
    '**<https://x.com>** tail\n',
  ],
] as const)
  test(`${name} respects the angle link boundary @preservation`, async ({
    page,
    openFixture,
  }) => {
    await openFixture()
    await operation(page, 'reload', { text: source })
    expect((await observe(page)).snapshot!.text).toBe(source)
    const readable = (await operation(page, 'textSnapshot')) as {
      snapshotId: string
      text: string
    }
    const end = readable.text.indexOf(marker) + marker.length
    await operation(page, 'selectTextRange', {
      range: {
        snapshotId: readable.snapshotId,
        from: marker === 'x' ? end - 1 : end,
        to: end,
      },
      options: { focus: true },
    })
    await page.keyboard.type(typed)
    const before = await observe(page)
    expect(before.diagnostics).toEqual([])
    expect(before.snapshot!.text).toBe(expected)
    const { text, html, markdown } = (await operation(page, 'clipboard', {
      scope: 'document',
    })) as { text: string; html: string; markdown: string }
    await operation(page, 'reload', { text: expected })
    expect(
      await operation(page, 'clipboard', { scope: 'document' }),
    ).toMatchObject({ text, html, markdown })
    expect((await observe(page)).snapshot!.text).toBe(expected)
  })

for (const key of ['Backspace', 'ControlOrMeta+z'])
  test(`${key} immediately after completion preserves the edit history @preservation`, async ({
    page,
    openFixture,
  }) => {
    await openFixture()
    await operation(page, 'reload', { text: 'x\n' })
    const readable = (await operation(page, 'textSnapshot')) as {
      snapshotId: string
      text: string
    }
    await operation(page, 'selectTextRange', {
      range: { snapshotId: readable.snapshotId, from: 0, to: 1 },
      options: { focus: true },
    })
    await page.keyboard.type('<https://x.com>')
    expect((await observe(page)).snapshot!.text).toBe('<https://x.com>\n')
    await page.keyboard.press(key)
    const expected = key === 'Backspace' ? '<https://x.co>\n' : 'x\n'
    expect((await observe(page)).snapshot!.text).toBe(expected)
    if (key !== 'Backspace') {
      await operation(page, 'redo')
      expect((await observe(page)).snapshot!.text).toBe('<https://x.com>\n')
    }
    expect((await observe(page)).diagnostics).toEqual([])
  })
