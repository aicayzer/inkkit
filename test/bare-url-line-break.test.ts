import { expect, test } from 'vitest'
import { caretAt, deleted, links, load, mounted, typed } from './saved-edits'

// A space before a soft line break is written as `&#x20;`. A bare address
// would take that reference in, so typing a space after one there was refused
// with `preservation` and the keystroke did nothing.

for (const ending of ['\n', '\r\n']) {
  const lines = (text: string) => text.replaceAll('\n', ending)
  const label = JSON.stringify(ending)
  // Blocks around the edited paragraph, spelt as the writer would not spell
  // them, keep their bytes.
  const around = (paragraph: string) =>
    lines(`Intro *text*  \nhere\n\n${paragraph}\n\n* item __one__\n`)

  test(`a space typed after a bare URL before a soft line break is saved (${label})`, async () => {
    await typed(around('See https://example.com\nmore text'), 'example.com', [
      [' ', around('See <https://example.com>&#x20;\nmore text')],
      // Once the space is not the last on its line, the URL is bare again.
      ['and', around('See https://example.com and\nmore text')],
    ])
  })

  test(`a second space after a bare URL before a soft line break is saved (${label})`, async () => {
    await typed(around('See https://example.com\nmore text'), 'example.com', [
      [' ', around('See <https://example.com>&#x20;\nmore text')],
      [' ', around('See https://example.com &#x20;\nmore text')],
    ])
  })

  test(`a space typed after a bare address and punctuation before a soft line break is saved (${label})`, async () => {
    await typed(around('See https://example.com.\nmore text'), 'example.com.', [
      [' ', around('See <https://example.com>.&#x20;\nmore text')],
      [' ', around('See https://example.com. &#x20;\nmore text')],
    ])
    await typed(around('See (https://example.com)\nmore'), 'example.com)', [
      [' ', around('See (<https://example.com>)&#x20;\nmore')],
    ])
  })

  test(`a space typed after a www or email address before a soft line break is saved (${label})`, async () => {
    // A `www.` address cannot be written in angle brackets.
    await typed(around('See www.example.com\nmore text'), 'example.com', [
      [
        ' ',
        around(
          'See [www.example.com](http://www.example.com)&#x20;\nmore text',
        ),
      ],
      [' ', around('See www.example.com &#x20;\nmore text')],
    ])
    // An email address stops at the reference, so it stays bare.
    await typed(around('Mail ada@example.com\nmore text'), 'example.com', [
      [' ', around('Mail ada@example.com&#x20;\nmore text')],
    ])
  })

  test(`a space typed after a formatted bare URL before a soft line break is saved (${label})`, async () => {
    await typed(around('See *https://example.com*\nmore'), 'example.com', [
      [' ', around('See *<https://example.com>*&#x20;\nmore')],
    ])
  })

  test(`a space typed after a bare URL in a list item or quote before a soft line break is saved (${label})`, async () => {
    await typed(lines('- See https://example.com\n  more\n'), 'example.com', [
      [' ', lines('- See <https://example.com>&#x20;\n  more\n')],
    ])
    await typed(lines('> See https://example.com\n> more\n'), 'example.com', [
      [' ', lines('> See <https://example.com>&#x20;\n> more\n')],
    ])
  })

  test(`a space typed after an angle autolink before a soft line break is saved (${label})`, async () => {
    await typed(around('See <https://example.com>\nmore text'), 'example.com', [
      [' ', around('See <https://example.com>&#x20;\nmore text')],
      [' ', around('See <https://example.com> &#x20;\nmore text')],
    ])
  })

  test(`a space typed before a bare URL after a soft line break is saved (${label})`, async () => {
    await typed(
      around('See\nhttps://example.com text'),
      'https://',
      [[' ', around('See\n&#x20;https://example.com text')]],
      { before: true },
    )
  })

  test(`a space typed after a bare URL at the end of a paragraph is not saved (${label})`, async () => {
    await mounted(async (editor) => {
      const source = around('See https://example.com')
      load(editor, source)
      caretAt(editor, 'example.com')
      expect(editor.insertText(' ', 1)).toBe(true)
      expect(editor.insertText(' ', 1)).toBe(true)
      // Spaces at the end of a block are not saved.
      expect(editor.snapshot().text).toBe(source)
    })
  })

  test(`a space typed after a bare URL before a hard line break is saved (${label})`, async () => {
    await typed(around('See https://example.com<br>more'), 'example.com', [
      [' ', around('See https://example.com <br>more')],
    ])
    // Markdown reads spaces before a break written as spaces as part of the
    // break, so the break is written as a backslash.
    await typed(around('See https://example.com  \nmore'), 'example.com', [
      [' ', around('See https://example.com \\\nmore')],
      [' ', around('See https://example.com  \\\nmore')],
    ])
    await typed(around('See example  \nmore'), 'example', [
      ['\t', around('See example\t\\\nmore')],
    ])
  })

  test(`a hard line break typed after a bare URL is saved (${label})`, async () => {
    await mounted(async (editor) => {
      const source = around('See https://example.com more')
      load(editor, source)
      caretAt(editor, 'example.com')
      const snapshot = editor.textSnapshot()
      const at = snapshot.text.indexOf('example.com') + 'example.com'.length
      editor.selectTextRange({
        snapshotId: snapshot.snapshotId,
        from: at,
        to: at + 1,
      })
      expect(editor.keyDown({ key: 'Enter', shiftKey: true }, 1)).toBe(true)
      // A backslash after a bare URL would join it.
      expect(editor.snapshot().text).toBe(
        around('See <https://example.com>\\\nmore'),
      )
      caretAt(editor, 'example.com')
      expect(editor.insertText(' ', 1)).toBe(true)
      expect(editor.snapshot().text).toBe(
        around('See https://example.com \\\nmore'),
      )
    })
  })

  const url = ['https://example.com -> https://example.com']

  test(`a space typed after punctuation that ends a bare URL keeps the link target (${label})`, async () => {
    // `&amp;` keeps the `&` out of the address; a bare `&` would join it.
    await typed(
      around('See https://example.com&amp;\nmore'),
      '&',
      [[' ', around('See <https://example.com>&amp;&#x20;\nmore')]],
      { targets: url },
    )
    await typed(
      around('See https://example.com&amp; x\nmore'),
      '&',
      [[' ', around('See https://example.com&amp;  x\nmore')]],
      { targets: url },
    )
  })

  test(`a space typed after punctuation that ends a bare URL at the end of a paragraph keeps the link target (${label})`, async () => {
    await mounted(async (editor) => {
      const source = around('See https://example.com&amp;')
      load(editor, source)
      caretAt(editor, '&')
      expect(editor.insertText(' ', 1)).toBe(true)
      // Spaces at the end of a block are not saved.
      expect(editor.snapshot().text).toBe(source)
      expect(links(editor)).toEqual(url)
      expect(editor.undo()).toBe(true)
      expect(editor.snapshot()).toMatchObject({ text: source, dirty: false })
      expect(links(editor)).toEqual(url)
    })
  })

  test(`a deletion that leaves a space after a bare URL before a soft line break is saved (${label})`, async () => {
    await deleted(
      around('See https://example.com and\nmore'),
      'and',
      around('See <https://example.com>&#x20;\nmore'),
      url,
    )
    await deleted(
      around('See https://example.com. and\nmore'),
      'and',
      around('See <https://example.com>.&#x20;\nmore'),
      url,
    )
    await deleted(
      around('See www.example.com and\nmore'),
      'and',
      around('See [www.example.com](http://www.example.com)&#x20;\nmore'),
      ['www.example.com -> http://www.example.com'],
    )
    await deleted(
      lines('- See https://example.com and\n  more\n'),
      'and',
      lines('- See <https://example.com>&#x20;\n  more\n'),
      url,
    )
  })

  test(`a space typed before a soft line break that already follows a space is saved (${label})`, async () => {
    // Markdown drops a space or tab before a line ending; a second space
    // beside it would make a hard line break.
    await typed(around('See example \nmore'), 'example', [
      [' ', around('See example&#x20;\nmore')],
    ])
    await typed(around('See example\t\nmore'), 'example', [
      [' ', around('See example&#x20;\nmore')],
    ])
    await typed(
      around('See https://example.com \nmore'),
      'example.com',
      [[' ', around('See <https://example.com>&#x20;\nmore')]],
      { targets: url },
    )
    await deleted(around('See a b \nmore'), 'b', around('See a&#x20;\nmore'))
  })

  test(`a space typed before blanks that end in two spaces keeps them (${label})`, async () => {
    // Inkkit reads blanks holding a tab before a line ending as a soft break,
    // but CommonMark and GFM readers read two final spaces as a hard break.
    // Keeping the blanks keeps the break each reader saw.
    await typed(around('See ex\t  \nmore'), 'See ex', [
      [' ', around('See ex&#x20;\t  \nmore')],
      ['y', around('See ex y\t  \nmore')],
    ])
    await typed(around('See ex \t   \nmore'), 'See ex', [
      [' ', around('See ex&#x20; \t   \nmore')],
      [' ', around('See ex &#x20; \t   \nmore')],
    ])
    await typed(
      around('See https://example.com\t  \nmore'),
      'example.com',
      [
        [' ', around('See <https://example.com>&#x20;\t  \nmore')],
        // A plain space ends the bare address and the reference after it
        // keeps that space out of the line ending.
        [' ', around('See https://example.com &#x20;\t  \nmore')],
      ],
      { targets: url },
    )
    await typed(around('See www.example.com\t  \nmore'), 'example.com', [
      [
        ' ',
        around('See [www.example.com](http://www.example.com)&#x20;\t  \nmore'),
      ],
    ])
    await deleted(
      around('See a b\t  \nmore'),
      'b',
      around('See a&#x20;\t  \nmore'),
    )
    // Blanks that do not end in two spaces read as a soft break everywhere.
    await typed(around('See ex  \t\nmore'), 'See ex', [
      [' ', around('See ex&#x20;\nmore')],
    ])
  })

  test(`a break written as spaces keeps its spelling when its text is edited elsewhere (${label})`, async () => {
    await typed(around('See foo&#x20;  \nbar'), 'See', [
      ['y', around('Seey foo&#x20;  \nbar')],
    ])
    await typed(around('See foo  \nbar'), 'See', [
      ['y', around('Seey foo  \nbar')],
    ])
  })

  test(`a space typed after a bare URL in formatting before a break keeps the formatting delimiters (${label})`, async () => {
    await typed(
      around('See **https://example.com  \nbar**'),
      'example.com',
      [[' ', around('See **https://example.com \\\nbar**')]],
      { targets: url },
    )
  })

  test(`punctuation typed after a bare URL in emphasis keeps the emphasis marker (${label})`, async () => {
    await typed(
      around('_https://example.com_ more'),
      'example.com',
      [['.', around('_<https://example.com>._ more')]],
      { targets: url },
    )
  })
}

test('a deletion that leaves a space before a break written as spaces is saved', async () => {
  await mounted(async (editor) => {
    const source = 'See a b  \nmore\n'
    load(editor, source)
    const snapshot = editor.textSnapshot()
    const at = snapshot.text.indexOf('b')
    expect(
      editor.replaceTextRange(
        { snapshotId: snapshot.snapshotId, from: at, to: at + 1 },
        '',
      ),
    ).toBe(true)
    expect(editor.snapshot().text).toBe('See a \\\nmore\n')
    expect(editor.undo()).toBe(true)
    expect(editor.snapshot()).toMatchObject({ text: source, dirty: false })
  })
})

test('unedited documents with addresses beside line breaks save their bytes', async () => {
  for (const source of [
    'See https://example.com\nmore\n',
    'See https://example.com.\r\nmore\r\n',
    'See <https://example.com>&#x20;\nmore\n',
    'See https://example.com &#x20;\nmore\n',
    'See https://example.com  \nmore\n',
    'See https://example.com\\\nmore\n',
    'See www.example.com\t\nmore',
    'See https://example.com&#x20;\nmore\n',
  ])
    await mounted(async (editor) => load(editor, source))
})
