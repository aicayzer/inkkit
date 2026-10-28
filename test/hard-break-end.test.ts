import { ctxOf } from './editor-access'
import { expect, test } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import { InkKitEditor } from '../src/index'
import { semanticSignature } from '../src/preserve'
import { cleanSourceDoc } from '../src/source'

async function session(
  source: string,
  run: (
    editor: InkKitEditor,
    save: (text: string) => void,
  ) => void | Promise<void>,
) {
  const errors: Error[] = []
  const mount = async () => {
    const root = document.body.appendChild(document.createElement('div'))
    const editor = await InkKitEditor.mount(root, {
      changed() {},
      copy() {},
      openLink() {},
      error: (error) => errors.push(error),
    })
    const view = ctxOf(editor).get(editorViewCtx)
    return { root, editor, view }
  }
  const main = await mount(),
    other = await mount()
  let generation = 0
  try {
    main.editor.loadDocument({
      documentId: 'breaks',
      generation: 1,
      format: 'md',
      text: source,
    })
    await run(main.editor, (text) => {
      expect(errors).toEqual([])
      expect(main.editor.snapshot().text).toBe(text)
      other.editor.loadDocument({
        documentId: 'reopened',
        generation: ++generation,
        format: 'md',
        text,
      })
      expect(other.editor.snapshot().text).toBe(text)
      expect(semanticSignature(other.view.state.doc)).toBe(
        semanticSignature(cleanSourceDoc(main.view.state.doc)),
      )
    })
  } finally {
    for (const { root, editor } of [main, other]) {
      await editor.destroy()
      root.remove()
    }
  }
}

function select(editor: InkKitEditor, text: string, whole = false) {
  const snapshot = editor.textSnapshot()
  const from = snapshot.text.indexOf(text)
  expect(from).toBeGreaterThanOrEqual(0)
  editor.selectTextRange({
    snapshotId: snapshot.snapshotId,
    from: whole ? from : from + text.length,
    to: from + text.length,
  })
}

for (const ending of ['\n', '\r\n']) {
  for (const underline of ['=====', '---']) {
    for (const title of ['Title', 'One\nTitle']) {
      test(`setext ${JSON.stringify([ending, underline, title])} breaks save, reopen and undo`, async () => {
        const note = (body: string, rule = underline) =>
          `Untouched __before__.\n\n${body}\n${rule}\n\nUntouched _after_.\n`.replaceAll(
            '\n',
            ending,
          )
        await session(note(title), (editor, save) => {
          save(note(title))
          select(editor, 'Title')
          const before = editor.textSnapshot().text
          editor.keyDown({ key: 'Enter', shiftKey: true }, 1)
          save(note(title))
          editor.insertText('z', 1)
          save(note(`${title}\\\nz`, underline[0]))
          editor.undo()
          save(note(title))
          expect(editor.textSnapshot().text).toContain('Title\n')
          editor.undo()
          save(note(title))
          expect(editor.textSnapshot().text).toBe(before)
        })
      })
    }
  }
  for (const prefix of ['', '+ ']) {
    for (const method of [
      'insertText',
      'pasteAsPlainText',
      'replace',
      'replaceTextRange',
    ] as const) {
      if (prefix && method === 'replaceTextRange') continue
      test(`${method} keeps a pending break in ${JSON.stringify([prefix, ending])}`, async () => {
        const note = (s: string) =>
          `Untouched __before__.\n\n${prefix}${s}\n\nUntouched _after_.\n`.replaceAll(
            '\n',
            ending,
          )
        await session(note('Run now'), (editor, save) => {
          select(editor, 'now')
          if (method === 'replace') editor.replace('now', 'nowabc' + ending)
          else if (method === 'replaceTextRange') {
            select(editor, 'now', true)
            const snapshot = editor.textSnapshot()
            editor.replaceTextRange(snapshot.selection, 'nowabc' + ending)
          } else editor[method]('abc' + ending, 1)
          save(note('Run nowabc'))
          select(editor, 'Run nowabc\n')
          editor.insertText('z', 1)
          save(note(`Run nowabc\\\n${prefix ? '  ' : ''}z`))
          editor.undo()
          save(note('Run nowabc'))
          editor.undo()
          save(note('Run now'))
        })
      })
    }
  }
}

test('selection Markdown omits pending breaks and keeps completed and authored HTML breaks', async () => {
  await session('Run now\n', async (editor, save) => {
    select(editor, 'Run now')
    editor.keyDown({ key: 'Enter', shiftKey: true }, 1)
    select(editor, 'Run now\n', true)
    expect((await editor.clipboardSnapshot('selection')).markdown).toBe(
      'Run now\n',
    )
    save('Run now\n')
  })
  for (const source of ['Run\\\nnow\n', 'Run now<br />\n']) {
    await session(source, async (editor, save) => {
      const snapshot = editor.textSnapshot()
      editor.selectTextRange({
        snapshotId: snapshot.snapshotId,
        from: 0,
        to: snapshot.text.length,
      })
      expect((await editor.clipboardSnapshot('selection')).markdown).toBe(
        source,
      )
      save(source)
    })
  }
})

for (const context of [
  {
    name: 'ATX heading',
    wrap: (s: string) => `## ${s}\n`,
    pending: '## Run nowabc<br />\n',
    complete: '## Run nowabc<br />z\n',
  },
  {
    name: 'table cell',
    wrap: (s: string) => `| H |\n| - |\n| ${s} |\n`,
    pending: '| H |\n| - |\n| Run nowabc<br /> |\n',
    complete: '| H |\n| - |\n| Run nowabc<br />z |\n',
  },
  {
    name: 'setext heading',
    wrap: (s: string) => `${s}\n===\n`,
    pending: 'Run nowabc\n===\n',
    complete: 'Run nowabc\\\nz\n=\n',
  },
]) {
  for (const method of ['insertText', 'pasteAsPlainText', 'replace'] as const) {
    test(`${method} uses the source form of a ${context.name}`, async () => {
      await session(context.wrap('Run now'), (editor, save) => {
        select(editor, 'now')
        if (method === 'replace') editor.replace('now', 'nowabc\n')
        else editor[method]('abc\n', 1)
        save(context.pending)
        select(editor, 'Run nowabc\n')
        editor.insertText('z', 1)
        save(context.complete)
        editor.undo()
        save(context.pending)
        editor.undo()
        save(context.wrap('Run now'))
      })
    })
  }
}

test('break cleanup keeps emphasis and removes inline code from breaks', async () => {
  for (const source of ['**Run now**\n', '`Run now`\n']) {
    await session(source, (editor, save) => {
      select(editor, 'now')
      editor.keyDown({ key: 'Enter', shiftKey: true }, 1)
      save(source)
      editor.insertText('z', 1)
      save(source.trimEnd() + '\\\nz\n')
      editor.undo()
      save(source)
      editor.undo()
      save(source)
    })
  }
})

for (const method of ['insertText', 'pasteAsPlainText', 'replace'] as const) {
  for (const source of [
    '**Run now**\n',
    '## **Run now**\n',
    '| H |\n| - |\n| **Run now** |\n',
  ]) {
    test(`${method} preserves formatted text beside a trailing break: ${source.trim()}`, async () => {
      await session(source, (editor, save) => {
        select(editor, 'now')
        if (method === 'replace') editor.replace('now', 'nowabc\n')
        else editor[method]('abc\n', 1)
        const expected = source.replace('now', 'nowabc')
        const html = source.startsWith('##') || source.startsWith('|')
        save(
          html
            ? expected
                .replace('** |', '**<br /> |')
                .replace('**\n', '**<br />\n')
            : expected,
        )
      })
    })
  }
}

for (const marker of ['__', '_', '~~', '==']) {
  test(`multiline insertion keeps both ${marker} delimiters around a completed break`, async () => {
    await session(`${marker}Original${marker}\r\n`, (editor, save) => {
      select(editor, 'Original')
      editor.insertText('\r\nA😀B\r\n', 1)
      save(`${marker}Original\\\r\nA😀B${marker}\r\n`)
      editor.undo()
      save(`${marker}Original${marker}\r\n`)
    })
  })
}

for (const marker of ['**', '__', '*', '_', '~~', '==']) {
  for (const prefix of ['', '+ ', '> ']) {
    for (const ending of ['\n', '\r\n']) {
      for (const method of [
        'key',
        'insertText',
        'pasteAsPlainText',
        'replace',
      ] as const) {
        test(`formatting edge ${JSON.stringify([marker, prefix, ending, method])} saves, reopens and undoes`, async () => {
          const continuation = prefix === '+ ' ? '  ' : prefix
          const note = (body: string) =>
            `Untouched __before__.\n\n${prefix}${body}\n\nUntouched _after_.\n`.replaceAll(
              '\n',
              ending,
            )
          const source = note(`x ${marker}Original${marker} y`)
          await session(source, (editor, save) => {
            save(source)
            select(editor, 'Original')
            if (method === 'key')
              editor.keyDown({ key: 'Enter', shiftKey: true }, 1)
            else if (method === 'replace')
              editor.replace('Original', 'OriginalA' + ending)
            else
              editor[method](
                (method === 'pasteAsPlainText' ? ending : '') + 'A' + ending,
                1,
              )
            const content =
              method === 'key'
                ? 'Original'
                : method === 'pasteAsPlainText'
                  ? `Original\\\n${continuation}A`
                  : 'OriginalA'
            const savedMarker =
              method === 'key' ? marker : marker.replaceAll('_', '*')
            const broken = note(
              `x ${savedMarker}${content}${savedMarker}\\\n${continuation}&#x20;y`,
            )
            save(broken)
            if (method === 'replace') select(editor, 'OriginalA\n')
            editor.insertText('q', 1)
            save(
              note(
                `x ${savedMarker}${content}${savedMarker}\\\n${continuation}q y`,
              ),
            )
            editor.undo()
            save(broken)
            editor.undo()
            save(source)
          })
        })
      }
    }
  }
}

for (const [tail, escaped] of [
  ['  y &amp; z\\*', '&#x20;&#x20;y &amp; z\\*'],
  ['\ty', '&#x9;y'],
  [' &#32;y', '&#x20;&#32;y'],
]) {
  test(`a break after nested formatting retains the suffix spelling: ${JSON.stringify(tail)}`, async () => {
    const source = `> x **_Original_**${tail}\r\n`
    await session(source, (editor, save) => {
      save(source)
      select(editor, 'Original')
      editor.keyDown({ key: 'Enter', shiftKey: true }, 1)
      save(`> x ***Original***\\\r\n> ${escaped}\r\n`)
      editor.undo()
      save(source)
    })
  })
}

for (const [tail, escaped] of [
  ['- item', '\\- item'],
  ['- café🙂 &amp; z\\*', '\\- café🙂 &amp; z\\*'],
  ['# head', '\\# head'],
  ['> q', '\\> q'],
  ['1. x', '1\\. x'],
  ['+ x', '\\+ x'],
  ['---', '\\---'],
  ['===', '\\=\\=\\='],
  ['```', '\\`\\`\\`'],
  ['~~~', '\\~\\~\\~'],
  ['<!-- c -->', '<!-- c -->'],
  ['=', '\\='],
  ['-', '\\-'],
]) {
  for (const formatted of ['**A**', '`A`', '[A](https://example.com)']) {
    // Adjacent backticks join the code delimiter, so use a tilde fence there.
    if (formatted === '`A`' && tail === '```') continue
    for (const [prefix, continuation] of [
      ['', ''],
      ['+ ', '  '],
      ['> ', '> '],
      ['> [!note]\n> ', '> '],
    ]) {
      for (const ending of ['\n', '\r\n']) {
        test(`break before block marker ${JSON.stringify([tail, formatted, prefix, ending])} saves, reopens and undoes`, async () => {
          const note = (body: string) =>
            `Untouched __before__.\n\n${prefix}${body}\n\nUntouched _after_.\n`.replaceAll(
              '\n',
              ending,
            )
          const source = note(formatted + tail)
          await session(source, (editor, save) => {
            save(source)
            select(editor, 'A')
            editor.keyDown({ key: 'Enter', shiftKey: true }, 1)
            const comment = tail === '<!-- c -->'
            const broken = note(
              comment
                ? `${formatted}<br />${tail}`
                : `${formatted}\\\n${continuation}${escaped}`,
            )
            save(broken)
            if (!comment) expect(editor.textSnapshot().text).toContain('A\n')
            editor.insertText('z', 1)
            save(note(`${formatted}\\\n${continuation}z${tail}`))
            editor.undo()
            save(broken)
            editor.undo()
            save(source)
          })
        })
      }
    }
  }
}

test('replacing a soft break with a hard break preserves the new break kind', async () => {
  await session('A\nB\n', (editor, save) => {
    const snapshot = editor.textSnapshot()
    editor.selectTextRange({ snapshotId: snapshot.snapshotId, from: 1, to: 2 })
    editor.insertText('\n', 1)
    save('A\\\nB\n')
    editor.undo()
    save('A\nB\n')
  })
})

for (const ending of ['\n', '\r\n']) {
  for (const prefix of ['', '+ ']) {
    test(`a break inside text keeps boundary escapes ${JSON.stringify([prefix, ending])}`, async () => {
      const continuation = prefix ? '  ' : ''
      const note = (body: string) =>
        `${prefix}${body}\n`.replaceAll('\n', ending)
      await session(note('Run now'), (editor, save) => {
        select(editor, 'Run')
        editor.keyDown({ key: 'Enter', shiftKey: true }, 1)
        const broken = note(`Run\\\n${continuation}&#x20;now`)
        save(broken)
        editor.insertText('z', 1)
        save(note(`Run\\\n${continuation}z now`))
        editor.undo()
        save(broken)
        editor.undo()
        save(note('Run now'))
      })
    })
  }
}

for (const [prefix, continuation] of [
  ['', ''],
  ['+ ', '  '],
  ['> ', '> '],
  ['> [!note]\n> ', '> '],
]) {
  for (const ending of ['\n', '\r\n']) {
    const note = (body: string) =>
      `Untouched __before__.\n\n${prefix}${body}\n\nUntouched _after_.\n`.replaceAll(
        '\n',
        ending,
      )
    for (const removed of ['zz', '**B**', '`B`']) {
      test(`deleting before a block marker ${JSON.stringify([removed, prefix, ending])} saves, reopens and undoes`, async () => {
        const source = note(`A\\\n${continuation}${removed}- item`)
        await session(source, (editor, save) => {
          save(source)
          select(editor, removed === 'zz' ? 'zz' : 'B', true)
          editor.keyDown({ key: 'Backspace' }, 1)
          save(note(`A\\\n${continuation}\\- item`))
          editor.undo()
          save(source)
          editor.redo()
          save(note(`A\\\n${continuation}\\- item`))
        })
      })
    }
    for (const existingBreak of [false, true]) {
      test(`deleting before an HTML comment ${JSON.stringify([existingBreak, prefix, ending])} saves, reopens and undoes`, async () => {
        const source = note(
          `**A**${existingBreak ? `\\\n${continuation}` : ''}z<!-- c -->`,
        )
        await session(source, (editor, save) => {
          save(source)
          if (!existingBreak) {
            select(editor, 'A')
            editor.keyDown({ key: 'Enter', shiftKey: true }, 1)
            save(note(`**A**\\\n${continuation}z<!-- c -->`))
          }
          select(editor, 'z', true)
          editor.keyDown({ key: 'Backspace' }, 1)
          save(note('**A**<br /><!-- c -->'))
          editor.undo()
          save(note(`**A**\\\n${continuation}z<!-- c -->`))
          if (!existingBreak) {
            editor.undo()
            save(source)
          }
        })
      })
    }
  }
}
