import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
const baseline = process.argv[2]
if (!baseline)
  throw Error(
    'Usage: node scripts/measure-preservation.mjs BASELINE_CHECKOUT [source]',
  )
// `source` runs only the source-mode typing measurements.
const onlySource = process.argv[3] === 'source'
const results = []
for (const [name, root, port] of [
  ['baseline', resolve(baseline), 4194],
  ['candidate', process.cwd(), 4195],
]) {
  const server = spawn(
    process.execPath,
    [
      root + '/node_modules/vite/bin/vite.js',
      'playground',
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--strictPort',
    ],
    { cwd: root, stdio: 'ignore' },
  )
  let browser
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true })
    for (let i = 0; i < 100; i++) {
      try {
        if (server.exitCode !== null) throw Error('Measurement server exited')
        const response = await fetch(`http://127.0.0.1:${port}`)
        if (!response.ok) throw Error('Measurement server is not ready')
        break
      } catch {
        await new Promise((r) => setTimeout(r, 100))
      }
    }
    const page = await browser.newPage()
    await page.goto(`http://127.0.0.1:${port}/?configuration=minimal`)
    await page.locator('#editor .ProseMirror').waitFor()
    for (const [blocks, kind] of onlySource
      ? []
      : [
          [100, 'plain'],
          [500, 'plain'],
          [1000, 'plain'],
          [500, 'code'],
          [500, 'marked'],
          [500, 'heading'],
          [500, 'mixed'],
          [500, 'code-heading'],
          [500, 'code-heading-plain'],
          [4000, 'middle'],
          [4000, 'middle-link'],
          [4000, 'middle-short-link'],
          [4000, 'middle-reference'],
          [4000, 'middle-task'],
          [1000, 'middle-code'],
          [1000, 'middle-table'],
          [2000, 'middle-footnote'],
        ]) {
      const setup = await page.evaluate(
        async ({ root, blocks, kind }) => {
          const leadingHeading =
            ['heading', 'mixed'].includes(kind) ||
            kind.startsWith('code-heading')
          if (window.measuredEditor) await window.measuredEditor.destroy()
          const { InkKitEditor } = await import(`/@fs${root}/src/index.ts`)
          const { Preservation } = await import(`/@fs${root}/src/preserve.ts`)
          if (!window.measureWrapped) {
            const original = Preservation.prototype.serialize
            Preservation.prototype.serialize = function (...args) {
              const start = performance.now()
              try {
                return original.apply(this, args)
              } finally {
                window.preservationTimes.push(performance.now() - start)
              }
            }
            window.measureWrapped = true
          }
          document.body.innerHTML =
            '<main id="probe" style="width:800px;height:600px;overflow:auto"></main>'
          window.preservationTimes = []
          window.inputTimes = []
          window.inputStart = 0
          const editor = await InkKitEditor.mount(
            document.querySelector('#probe'),
            {
              changed() {
                if (window.inputStart)
                  window.inputTimes.push(performance.now() - window.inputStart)
              },
              stateChanged() {},
              openLink() {},
              copy() {},
            },
            {
              rendering: {
                diagramPreview: false,
                codeHighlighting: kind !== 'code-heading-plain',
              },
            },
          )
          const paragraph =
            'A paragraph with enough words to cover several lines in this editor. '.repeat(
              5,
            ) + '\n\n'
          const codeBlock =
            '```typescript\n' +
            'const value = items.map((item) => item.name).filter(Boolean);\n'.repeat(
              5,
            ) +
            '```\n\n'
          const linked =
            'A paragraph with a [link](/target) and enough words to cover several lines in this editor. '.repeat(
              4,
            ) + '\n\n'
          const shortLinks = Array.from(
            { length: blocks },
            (_, i) => `See [link ${i}](/t/${i}) for the details.\n\n`,
          ).join('')
          const generated = {
            'middle-short-link': () => shortLinks,
            'middle-reference': () =>
              Array.from(
                { length: blocks },
                (_, i) => `See [link ${i}][target] for the details.\n\n`,
              ).join('') + '[target]: /target\n',
            'middle-task': () =>
              Array.from(
                { length: blocks },
                (_, i) => `- [ ] Task ${i} with [a link](/t/${i}) to follow\n`,
              ).join(''),
            'middle-code': () =>
              '```ts\nconst value = items.map((item) => item.name);\n```\n\n'.repeat(
                blocks,
              ),
            'middle-footnote': () =>
              shortLinks +
              Array.from(
                { length: blocks },
                (_, i) =>
                  `[^n${i}]: A footnote ${i} with [a link](/f/${i}) and more words to read.\n\n`,
              ).join(''),
            'middle-table': () =>
              Array.from(
                { length: blocks },
                (_, i) =>
                  `| Name | Value |\n| --- | --- |\n| row ${i} | [link](/t/${i}) |\n\n`,
              ).join(''),
          }[kind]
          const text = generated
            ? generated()
            : (leadingHeading ? '# Heading\n\n' : '') +
              (kind === 'code' || kind.startsWith('code-heading')
                ? codeBlock
                : kind === 'marked'
                  ? '__Authored bold__ and _emphasis_. ' + paragraph
                  : kind === 'middle-link'
                    ? linked
                    : paragraph
              ).repeat(blocks) +
              (kind === 'mixed'
                ? '| A | B |\n| - | - |\n| one | two |\n\n```ts\nconst x = 1;\n```\n\n[Retained][ref]\n\n[ref]: /target\n\n<section>unsupported</section>\n'
                : '')
          const start = performance.now()
          editor.loadDocument({
            documentId: 'performance',
            generation: 1,
            format: 'md',
            text,
          })
          const load = performance.now() - start
          window.measuredEditor = editor
          editor.focus()
          if (leadingHeading) {
            const heading = document.querySelector('#probe h1')
            const selection = window.getSelection()
            selection.collapse(heading.firstChild, heading.textContent.length)
          }
          if (kind.startsWith('middle')) {
            const middle =
              {
                'middle-task': () =>
                  document.querySelectorAll('#probe .ProseMirror li p')[
                    blocks / 2
                  ],
                'middle-code': () =>
                  document.querySelectorAll('#probe .ProseMirror pre code')[
                    blocks / 2
                  ],
                'middle-table': () =>
                  document.querySelectorAll('#probe .ProseMirror td')[
                    blocks + 1
                  ],
              }[kind]?.() ??
              document.querySelectorAll('#probe .ProseMirror > p')[blocks / 2]
            const walker = document.createTreeWalker(
              middle,
              NodeFilter.SHOW_TEXT,
            )
            let last
            for (let node = walker.nextNode(); node; node = walker.nextNode())
              last = node
            window.getSelection().collapse(last, last.length)
          }
          document
            .querySelector('.ProseMirror')
            .addEventListener(
              'beforeinput',
              () => (window.inputStart = performance.now()),
            )
          window.preservationTimes = []
          return { load, chars: text.length }
        },
        { root, blocks, kind },
      )
      for (let i = 0; i < 10; i++) await page.keyboard.insertText('x')
      const times = await page.evaluate(() => ({
        preservation: window.preservationTimes,
        input: window.inputTimes,
        saved: window.measuredEditor.snapshot().text.includes('xxxxxxxxxx'),
      }))
      if (
        !times.saved ||
        times.input.length !== 10 ||
        times.preservation.length < 10
      )
        throw Error(
          `The measurement did not preserve all ten ordinary inputs: ${JSON.stringify(times)}`,
        )
      results.push({
        name,
        blocks,
        kind,
        browser: browser.version(),
        node: process.version,
        ...setup,
        ...times,
      })
      console.log(JSON.stringify(results.at(-1)))
    }
    for (const [blocks, changed] of onlySource
      ? []
      : [
          [300, 100],
          [1000, 300],
          [2000, 1000],
        ]) {
      const outcome = await page.evaluate(
        async ({ root, blocks, changed }) => {
          if (window.measuredEditor) await window.measuredEditor.destroy()
          const { InkKitEditor } = await import(`/@fs${root}/src/index.ts`)
          document.body.innerHTML =
            '<main id="probe" style="width:800px;height:600px;overflow:auto"></main>'
          const editor = await InkKitEditor.mount(
            document.querySelector('#probe'),
            { changed() {}, stateChanged() {}, openLink() {}, copy() {} },
            { rendering: { diagramPreview: false } },
          )
          window.measuredEditor = editor
          const kinds = [
            (i, w) => `__Kept ${i}__ [link ${i}](/k/${i}) ${w} here.`,
            (i, w) => `* first ${i} ${w}\n* second ${i}`,
            (i, w) => `> quoted ${i} ${w}`,
            (i, w) => '```ts\nconst a' + i + ` = "${w}";\n` + '```',
            (i, w) => `| A | B |\n| - | - |\n| ${w} ${i} | x |`,
            (i, w) => `Note ${i} ${w}[^n${i}]\n\n[^n${i}]: Footnote ${i}.`,
            (i, w) => `# Heading ${i} ${w}`,
          ]
          const every = blocks / changed
          const text =
            Array.from({ length: blocks }, (_, i) => {
              const edit = Math.floor((i + 1) / every) > Math.floor(i / every)
              return kinds[i % kinds.length](i, edit ? 'word' : 'plain')
            }).join('\n\n') + '\n'
          editor.loadDocument({
            documentId: 'replace',
            generation: 1,
            format: 'md',
            text,
          })
          const start = performance.now()
          let count, error
          try {
            count = editor.replaceAll('word', 'term')
          } catch (cause) {
            error = String(cause.message)
          }
          const milliseconds = performance.now() - start
          const saved = error
            ? undefined
            : editor.snapshot().text === text.replaceAll('word', 'term')
          return { milliseconds, count, error, savedExactly: saved }
        },
        { root, blocks, changed },
      )
      results.push({ name, kind: 'replace-all', blocks, changed, ...outcome })
      console.log(JSON.stringify(results.at(-1)))
    }
    // Source-mode typing: the textarea is the typing surface, so a keystroke
    // is an input event on it. Time runs from `beforeinput` to the synchronous
    // `changed` callback, and again to the next animation frame, which covers
    // the layout work that follows the handler.
    for (const [blocks, kind] of [
      [1000, 'plain'],
      [4000, 'plain'],
      [1000, 'middle-link'],
    ]) {
      const setup = await page.evaluate(
        async ({ root, blocks, kind }) => {
          if (window.measuredEditor) await window.measuredEditor.destroy()
          const { InkKitEditor } = await import(`/@fs${root}/src/index.ts`)
          document.body.innerHTML =
            '<main id="probe" style="width:800px;height:600px;overflow:auto"></main>'
          window.sourceInputTimes = []
          window.sourceFrameTimes = []
          window.inputStart = 0
          const editor = await InkKitEditor.mount(
            document.querySelector('#probe'),
            {
              changed() {
                if (window.inputStart)
                  window.sourceInputTimes.push(
                    performance.now() - window.inputStart,
                  )
              },
              stateChanged() {},
              openLink() {},
              copy() {},
            },
            { rendering: { diagramPreview: false } },
          )
          const paragraph =
            kind === 'middle-link'
              ? 'A paragraph with a [link](/target) and enough words to cover several lines in this editor. '.repeat(
                  4,
                ) + '\n\n'
              : 'A paragraph with enough words to cover several lines in this editor. '.repeat(
                  5,
                ) + '\n\n'
          const text = paragraph.repeat(blocks)
          editor.loadDocument({
            documentId: 'source-typing',
            generation: 1,
            format: 'md',
            text,
          })
          window.measuredEditor = editor
          const start = performance.now()
          editor.setEditingMode('source')
          const switchToSource = performance.now() - start
          const area = document.querySelector('#probe textarea')
          area.focus()
          const middle = Math.floor(text.length / 2)
          area.setSelectionRange(middle, middle)
          area.addEventListener('beforeinput', () => {
            window.inputStart = performance.now()
            const began = window.inputStart
            requestAnimationFrame(() =>
              window.sourceFrameTimes.push(performance.now() - began),
            )
          })
          // The same text in a bare textarea: what the browser itself spends on a
          // keystroke, which no editor logic can remove.
          const bare = document.createElement('textarea')
          bare.style.cssText = 'width:800px;height:600px'
          bare.value = text
          document.body.append(bare)
          bare.focus()
          bare.setSelectionRange(middle, middle)
          window.bareTimes = []
          let bareStart = 0
          bare.addEventListener('beforeinput', () => {
            bareStart = performance.now()
          })
          bare.addEventListener('input', () =>
            window.bareTimes.push(performance.now() - bareStart),
          )
          window.bare = bare
          area.focus()
          return { switchToSource, chars: text.length }
        },
        { root, blocks, kind },
      )
      await page.evaluate(() => window.bare.focus())
      for (let i = 0; i < 10; i++) await page.keyboard.insertText('x')
      await page.evaluate(() => {
        window.bare.remove()
        document.querySelector('#probe textarea').focus()
      })
      for (let i = 0; i < 10; i++) {
        await page.keyboard.insertText('x')
        await page.evaluate(
          () => new Promise((resolve) => requestAnimationFrame(resolve)),
        )
      }
      const times = await page.evaluate(() => ({
        input: window.sourceInputTimes,
        frame: window.sourceFrameTimes,
        bare: window.bareTimes,
        typed: document
          .querySelector('#probe textarea')
          .value.includes('xxxxxxxxxx'),
        saved: window.measuredEditor.snapshot().text.includes('xxxxxxxxxx'),
        // Taking in the typed source: the first thing that needs the formatted
        // document pays for it once, where each keystroke paid before.
        leave: (() => {
          const start = performance.now()
          window.measuredEditor.setEditingMode('formatted')
          return performance.now() - start
        })(),
      }))
      if (!times.typed || !times.saved || times.input.length !== 10)
        throw Error(
          `The source measurement did not keep all ten inputs: ${JSON.stringify(times)}`,
        )
      results.push({
        name,
        blocks,
        kind: `source-${kind}`,
        browser: browser.version(),
        node: process.version,
        ...setup,
        ...times,
      })
      console.log(JSON.stringify(results.at(-1)))
    }
    // Buffered native typing reaches the source editor through insertText
    // rather than through the textarea, so the caret must be revealed by the
    // editor itself.
    for (const blocks of [1000, 4000]) {
      const outcome = await page.evaluate(
        async ({ root, blocks }) => {
          if (window.measuredEditor) await window.measuredEditor.destroy()
          const { InkKitEditor } = await import(`/@fs${root}/src/index.ts`)
          document.body.innerHTML =
            '<main id="probe" style="width:800px;height:600px;overflow:auto"></main>'
          const editor = await InkKitEditor.mount(
            document.querySelector('#probe'),
            { changed() {}, stateChanged() {}, openLink() {}, copy() {} },
            { rendering: { diagramPreview: false } },
          )
          window.measuredEditor = editor
          const text = (
            'A paragraph with enough words to cover several lines in this editor. '.repeat(
              5,
            ) + '\n\n'
          ).repeat(blocks)
          editor.loadDocument({
            documentId: 'source-bridge',
            generation: 1,
            format: 'md',
            text,
          })
          editor.setEditingMode('source')
          const area = document.querySelector('#probe textarea')
          area.focus()
          area.setSelectionRange(text.length / 2, text.length / 2)
          const times = []
          for (let i = 0; i < 10; i++) {
            const start = performance.now()
            editor.insertText('x', 1)
            times.push(performance.now() - start)
          }
          return {
            times,
            saved: editor.snapshot().text.includes('xxxxxxxxxx'),
          }
        },
        { root, blocks },
      )
      if (!outcome.saved) throw Error('The bridge measurement lost its input')
      results.push({ name, kind: 'source-bridge', blocks, ...outcome })
      console.log(JSON.stringify(results.at(-1)))
    }
  } finally {
    await browser?.close()
    server.kill('SIGTERM')
  }
}
await mkdir('_local', { recursive: true })
await writeFile(
  '_local/preservation-performance.json',
  JSON.stringify(results, null, 2) + '\n',
)
