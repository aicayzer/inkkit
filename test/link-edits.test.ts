import { expect, test } from 'vitest'
import { caretAt, deleted, load, mounted, typed } from './saved-edits'

for (const ending of ['\n', '\r\n']) {
  const lines = (text: string) => text.replaceAll('\n', ending)
  const label = JSON.stringify(ending)
  // Blocks around the edited paragraph, spelt as the writer would not spell
  // them, keep their bytes.
  const around = (paragraph: string) =>
    lines(`Intro *text*  \nhere\n\n${paragraph}\n\n* item __one__\n`)

  // An edit that ended directly before a line break reached no text, so the
  // address before the break kept its old target.
  test(`deleting the end of a bare URL before a line break updates its target (${label})`, async () => {
    const pat = ['https://example.com/pat -> https://example.com/pat']
    await deleted(
      around('See https://example.com/path\nmore'),
      'h',
      around('See https://example.com/pat\nmore'),
      pat,
      'pat',
    )
    // An address before a hard break is written in angle brackets, since the
    // break's spelling or HTML could run into it.
    for (const brk of ['<br>', '  \n'])
      await deleted(
        around(`See https://example.com/path${brk}more`),
        'h',
        around(`See <https://example.com/pat>${brk}more`),
        pat,
        'pat',
      )
    await deleted(
      around('See https://example.com/path\nmore'),
      'ath',
      around('See https://example.com/p\nmore'),
      ['https://example.com/p -> https://example.com/p'],
      'p',
    )
    await deleted(
      around('See www.example.com/path\nmore'),
      'h',
      around('See www.example.com/pat\nmore'),
      ['www.example.com/pat -> http://www.example.com/pat'],
      'pat',
    )
    await deleted(
      lines('- See https://example.com/path\n  more\n'),
      'h',
      lines('- See https://example.com/pat\n  more\n'),
      pat,
      'pat',
    )
  })

  test(`deleting the end of an angle autolink before a line break updates its target (${label})`, async () => {
    const pat = ['https://example.com/pat -> https://example.com/pat']
    for (const brk of ['\\\n', '\n', '<br>'])
      await deleted(
        around(`See <https://example.com/path>${brk}more`),
        'h',
        around(`See <https://example.com/pat>${brk}more`),
        pat,
        'pat',
      )
  })

  test(`edits beside a line break after a bare URL keep its target (${label})`, async () => {
    const url = ['https://example.com/path -> https://example.com/path']
    // Text typed at the end of the address joins it.
    await typed(around('See https://example.com/path\nmore'), '/path', [
      ['s', around('See https://example.com/paths\nmore')],
    ])
    // Text after the break is not part of the address.
    await deleted(
      around('See https://example.com/path\nmore'),
      'm',
      around('See https://example.com/path\nore'),
      url,
      'path\n',
    )
    await typed(
      around('See https://example.com/path\nmore'),
      'more',
      [['x', around('See https://example.com/path\nxmore')]],
      { before: true, targets: url },
    )
  })

  // Undo restores the links the document had, which reading its text again
  // could change: the `&` came from a character reference.
  test(`undo after typing straight after a URL and a character reference restores the document (${label})`, async () => {
    await typed(around('See https://example.com&amp;\nmore'), '&', [
      ['x', around('See https://example.com&x\nmore')],
      ['y', around('See https://example.com&xy\nmore')],
    ])
    await typed(around('See https://example.com&amp;'), '&', [
      ['x', around('See https://example.com&x')],
    ])
    await typed(lines('- See https://example.com&amp;\n  more\n'), '&', [
      ['x', lines('- See https://example.com&x\n  more\n')],
    ])
    await typed(around('See https://example.com&quot;\nmore'), '"', [
      ['x', around('See https://example.com"x\nmore')],
    ])
  })

  // Formatting that runs on past a link after a space was closed at the
  // link and reopened after the space.
  test(`editing text after a link in formatting keeps one run (${label})`, async () => {
    for (const delimiter of ['_', '*', '__', '**', '~~', '~'])
      for (const link of [
        'https://example.com',
        '<https://example.com>',
        '[site](https://example.com)',
      ]) {
        const run = (text: string) =>
          around(`See ${delimiter}${link} ${text}${delimiter} more`)
        await typed(run('and'), 'and', [['x', run('andx')]])
      }
  })

  test(`a space typed after a link in formatting keeps one run (${label})`, async () => {
    for (const link of [
      'https://example.com',
      '<https://example.com>',
      '[site](https://example.com)',
    ]) {
      await typed(
        around(`See **${link} x**`),
        link.startsWith('[') ? 'site' : 'example.com',
        [
          [' ', around(`See **${link}  x**`)],
          ['y', around(`See **${link} y x**`)],
        ],
      )
    }
  })

  test(`formatting around a link keeps its runs as authored (${label})`, async () => {
    // Text before the link in the same run.
    await typed(around('See _and https://example.com_ more'), 'and', [
      ['x', around('See _andx https://example.com_ more')],
    ])
    // Separate runs stay separate.
    await typed(around('See _https://example.com_ _and_ more'), 'and', [
      ['x', around('See _https://example.com_ _andx_ more')],
    ])
    // Nested formatting.
    await typed(around('See **_https://example.com_ and** more'), 'and', [
      ['x', around('See **_https://example.com_ andx** more')],
    ])
    // Two links in one run.
    await typed(
      around('See _https://example.com and https://example.org_ more'),
      'and',
      [
        [
          'x',
          around('See _https://example.com andx https://example.org_ more'),
        ],
      ],
    )
  })

  // The space typed reads back outside the formatting, as it did before.
  test(`spaces at the edge of formatting are still written outside it (${label})`, async () => {
    for (const [source, anchor, expected] of [
      [
        'See _https://example.com and_ more',
        'and',
        'See _https://example.com and_  more',
      ],
      ['See *a* more', 'a', 'See *a*  more'],
      ['See **_a_** more', 'a', 'See ***a***  more'],
      [
        'See [a](https://example.com) more',
        'a',
        'See [a](https://example.com)  more',
      ],
    ] as const)
      await mounted(async (editor) => {
        load(editor, around(source))
        caretAt(editor, anchor)
        expect(editor.insertText(' ', 1)).toBe(true)
        expect(editor.snapshot().text).toBe(around(expected))
        expect(editor.undo()).toBe(true)
        expect(editor.snapshot()).toMatchObject({
          text: around(source),
          dirty: false,
        })
      })
  })
}

test('unedited documents with links in formatting save their bytes', async () => {
  for (const source of [
    'See _https://example.com and_ more\n',
    'See **https://example.com  x**\r\n',
    'See *[site](https://example.com)* *and*\n',
    'See _https://example.com_ _and_ more\n',
    'See https://example.com&amp;\nmore\n',
    'See <https://example.com/path>\\\nmore\n',
  ])
    await mounted(async (editor) => load(editor, source))
})
