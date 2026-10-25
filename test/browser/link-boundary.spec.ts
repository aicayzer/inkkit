import { test, expect, observe, operation } from './fixtures'

for (const [name, link, label, suffix] of [
  ['inline', '[docs](docs)', 'docs', ''],
  ['reference', '[docs][ref]', 'docs', '\r\n\r\n[ref]: docs'],
  ['angle', '<https://example.com>', 'https://example.com', ''],
  ['bare', 'https://example.com', 'https://example.com', ''],
] as const)
  for (const typed of ['s', ' ', 'é 文'])
    test(`${name} end typing ${JSON.stringify(typed)} agrees with reopened links`, async ({
      page,
      openFixture,
    }) => {
      await openFixture()
      const source = `Untouched &copy;\r\n\r\nSee ${link} tail${suffix}\r\n`
      await operation(page, 'reload', { text: source })
      const text = (await operation(page, 'textSnapshot')) as {
        snapshotId: string
        text: string
      }
      const end = text.text.indexOf(label) + label.length
      await operation(page, 'selectTextRange', {
        range: { snapshotId: text.snapshotId, from: end, to: end },
        options: { focus: true },
      })
      await page.keyboard.insertText(typed)
      const before = await observe(page)
      const saved = before.snapshot!.text
      const expected = source.replace(link, link + typed)
      expect(saved).toBe(expected)
      expect(before.diagnostics).toEqual([])
      const anchors = await page.locator('.ProseMirror a').allTextContents()
      expect(anchors).toEqual([
        name === 'bare' ? label + typed.split(' ')[0] : label,
      ])
      await operation(page, 'undo')
      expect((await observe(page)).snapshot!.text).toBe(source)
      await operation(page, 'redo')
      expect((await observe(page)).snapshot!.text).toBe(saved)
      await operation(page, 'reload', { text: saved })
      expect(await page.locator('.ProseMirror a').allTextContents()).toEqual(
        anchors,
      )
      expect((await observe(page)).snapshot!.text).toBe(saved)
    })

for (const [link, label, expected] of [
  ['[docs](docs)', 'docs', '[doécs](docs)'],
  ['[docs][ref]\n\n[ref]: docs', 'docs', '[doécs][ref]\n\n[ref]: docs'],
  ['<https://example.com>', 'https://example.com', '<https://exampleé.com>'],
] as const)
  test(`editing inside ${link} keeps its link`, async ({
    page,
    openFixture,
  }) => {
    await openFixture()
    await operation(page, 'reload', { text: link + '\n' })
    const text = (await operation(page, 'textSnapshot')) as {
      snapshotId: string
      text: string
    }
    const from =
      text.text.indexOf(label) + (label === 'docs' ? 2 : label.indexOf('.com'))
    await operation(page, 'selectTextRange', {
      range: { snapshotId: text.snapshotId, from, to: from },
      options: { focus: true },
    })
    await page.keyboard.insertText('é')
    expect((await observe(page)).snapshot!.text).toBe(expected + '\n')
    expect(await page.locator('.ProseMirror a').allTextContents()).toEqual([
      label.slice(0, from) + 'é' + label.slice(from),
    ])
  })

test('deliberate link formatting at a caret still links subsequent typing', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await operation(page, 'reload', { text: 'Start here\n' })
  const text = (await operation(page, 'textSnapshot')) as {
    snapshotId: string
    text: string
  }
  await operation(page, 'selectTextRange', {
    range: { snapshotId: text.snapshotId, from: 10, to: 10 },
    options: { focus: true },
  })
  await operation(page, 'format', {
    command: 'link',
    options: { destination: 'docs' },
  })
  await page.keyboard.type('new')
  expect((await observe(page)).snapshot!.text).toBe('Start here[new](docs)\n')
  expect(await page.locator('.ProseMirror a').allTextContents()).toEqual([
    'new',
  ])
  await page.keyboard.type(' tail')
  expect((await observe(page)).snapshot!.text).toBe(
    'Start here[new](docs) tail\n',
  )
  expect(await page.locator('.ProseMirror a').allTextContents()).toEqual([
    'new',
  ])
})

test('a pasted authored link ends before subsequent typing', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await operation(page, 'reload', { text: 'x\n' })
  const text = (await operation(page, 'textSnapshot')) as {
    snapshotId: string
    text: string
  }
  await operation(page, 'selectTextRange', {
    range: { snapshotId: text.snapshotId, from: 0, to: 1 },
    options: { focus: true },
  })
  await operation(page, 'paste', {
    input: { text: 'docs', html: '<a href="docs">docs</a>' },
  })
  await page.keyboard.type('s')
  expect((await observe(page)).snapshot!.text).toBe('[docs](docs)s\n')
  expect(await page.locator('.ProseMirror a').allTextContents()).toEqual([
    'docs',
  ])
})

for (const source of ['[docs](docs)\n', '<https://example.com>\n'])
  test(`continuous keys after ${source.trim()} stay outside its link`, async ({
    page,
    openFixture,
  }) => {
    await openFixture()
    await operation(page, 'reload', { text: source })
    const text = (await operation(page, 'textSnapshot')) as {
      snapshotId: string
      text: string
    }
    const end = text.text.trimEnd().length
    await operation(page, 'selectTextRange', {
      range: { snapshotId: text.snapshotId, from: end, to: end },
      options: { focus: true },
    })
    const label = (await page.locator('.ProseMirror a').allTextContents())[0]
    await page.keyboard.type('s and more')
    const saved = source.trimEnd() + 's and more\n'
    expect((await observe(page)).snapshot!.text).toBe(saved)
    expect(await page.locator('.ProseMirror a').allTextContents()).toEqual([
      label,
    ])
    await operation(page, 'reload', { text: saved })
    expect(await page.locator('.ProseMirror a').allTextContents()).toEqual([
      label,
    ])
  })

for (const movement of ['ArrowLeft', 'Backspace'])
  test(`${movement} clears deliberate stored link intent`, async ({
    page,
    openFixture,
  }) => {
    await openFixture()
    await operation(page, 'reload', { text: 'x\n' })
    const text = (await operation(page, 'textSnapshot')) as {
      snapshotId: string
      text: string
    }
    await operation(page, 'selectTextRange', {
      range: { snapshotId: text.snapshotId, from: 1, to: 1 },
      options: { focus: true },
    })
    await operation(page, 'format', {
      command: 'link',
      options: { destination: 'docs' },
    })
    await page.keyboard.type('new')
    await page.keyboard.press(movement)
    if (movement === 'ArrowLeft') await page.keyboard.press('ArrowRight')
    await page.keyboard.type('s')
    expect((await observe(page)).snapshot!.text).toBe(
      movement === 'ArrowLeft' ? 'x[new](docs)s\n' : 'x[ne](docs)s\n',
    )
  })

for (const typed of ['new tail', 'new\u00a0tail'])
  test(`batched explicit link typing ends at first whitespace ${JSON.stringify(typed)}`, async ({
    page,
    openFixture,
  }) => {
    await openFixture()
    await operation(page, 'reload', { text: 'Start here\n' })
    const text = (await operation(page, 'textSnapshot')) as {
      snapshotId: string
      text: string
    }
    await operation(page, 'selectTextRange', {
      range: { snapshotId: text.snapshotId, from: 10, to: 10 },
      options: { focus: true },
    })
    await operation(page, 'format', {
      command: 'link',
      options: { destination: 'docs' },
    })
    await page.keyboard.insertText(typed)
    expect(await page.locator('.ProseMirror a').allTextContents()).toEqual([
      'new',
    ])
    await page.keyboard.insertText('s')
    const saved = (await observe(page)).snapshot!.text
    expect(saved).toBe('Start here[new](docs)' + typed.slice(3) + 's\n')
    expect((await observe(page)).diagnostics).toEqual([])
    await operation(page, 'undo')
    await operation(page, 'redo')
    expect((await observe(page)).snapshot!.text).toBe(saved)
    await operation(page, 'reload', { text: saved })
    expect((await observe(page)).snapshot!.text).toBe(saved)
    expect(await page.locator('.ProseMirror a').allTextContents()).toEqual([
      'new',
    ])
  })
