import { InkKitEditor } from '@aicayzer/inkkit'
import '@aicayzer/inkkit/style.css'
const imageData =
  'iVBORw0KGgoAAAANSUhEUgAAAFAAAAAoCAYAAABpYH0BAAAAAXNSR0IArs4c6QAAADhlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAAqACAAQAAAABAAAAUKADAAQAAAABAAAAKAAAAADbisV7AAAAlUlEQVRoBe3SMQ0AIQAEQR4X6MC/Nj5BAtvO9dtM7jtrn2HPAvO5FF4BgPEIAAFGgZh7IMAoEHMPBBgFYu6BAKNAzD0QYBSIuQcCjAIx90CAUSDmHggwCsTcAwFGgZh7IMAoEHMPBBgFYu6BAKNAzD0QYBSIuQcCjAIx90CAUSDmHggwCsTcAwFGgZh7IMAoEHMPjIA/2VgCmiePpoIAAAAASUVORK5CYII='
const bytes = Uint8Array.from(atob(imageData), (c) => c.charCodeAt(0))
const importedImages = new Map<
  string,
  { bytes: Uint8Array; mimeType: string }
>()
let currentCaretState
let imageExportMode = 'normal'
let imageExportStarted = false
let releaseImageExport
let imageExportGate
let imageImportStarted = false
let releaseImageImport
let imageImportGate
let pendingPaste
let pendingPrintable
const editor = await InkKitEditor.mount(
  document.querySelector('#editor'),
  {
    changed() {},
    stateChanged(state) {
      currentCaretState = state
    },
    copy() {},
    openLink() {},
    error(error) {
      window.lastError = error.message
    },
  },
  {
    images: {
      presentation(reference) {
        const imported = importedImages.get(reference)
        return {
          url: imported
            ? `data:${imported.mimeType};base64,${btoa(String.fromCharCode(...imported.bytes))}`
            : `data:image/png;base64,${imageData}`,
        }
      },
      async importImage(input) {
        imageImportStarted = true
        if (imageImportGate) await imageImportGate
        const reference = `images/imported-${importedImages.size}.png`
        importedImages.set(reference, {
          bytes: input.bytes.slice(),
          mimeType: input.mimeType,
        })
        return { reference }
      },
      async exportImage(reference) {
        imageExportStarted = true
        if (imageExportGate) await imageExportGate
        if (imageExportMode === 'reject')
          throw Error('Fixture image unavailable')
        if (imageExportMode === 'corrupt')
          return { bytes: bytes.subarray(0, 24), mimeType: 'image/png' }
        return importedImages.get(reference) ?? { bytes, mimeType: 'image/png' }
      },
    },
  },
)
let generation = 0
let documentId = 'interop'
let documentFormat = 'md'
const settle = () => new Promise((resolve) => setTimeout(resolve, 100))
const view = () => document.querySelector('.ProseMirror')
const activeEditor = () =>
  editor.editingMode === 'source' || documentFormat === 'txt'
    ? document.querySelector('textarea.inkkit-plain')
    : view()
const selectedText = () => {
  const active = activeEditor()
  return active instanceof HTMLTextAreaElement
    ? active.value.slice(active.selectionStart, active.selectionEnd)
    : (getSelection()?.toString() ?? '')
}
const capture = () => ({
  snapshot: editor.snapshot(),
  html: view()?.innerHTML ?? '',
  selection: selectedText(),
  editingMode: editor.editingMode,
  caretState: currentCaretState ?? null,
  error: window.lastError ?? null,
})
const load = (source, format = 'md', identity = 'interop') => {
  window.lastError = undefined
  documentId = identity
  documentFormat = format
  editor.loadDocument({
    documentId,
    generation: ++generation,
    format,
    text: source,
  })
  return editor.snapshot()
}
const portableImage = (image) => {
  if (!image) return undefined
  let binary = ''
  for (let offset = 0; offset < image.bytes.length; offset += 8192)
    binary += String.fromCharCode(
      ...image.bytes.subarray(offset, offset + 8192),
    )
  return { ...image, bytesBase64: btoa(binary), bytes: undefined }
}
const exportClipboard = async (all = true) => {
  const data = await editor.clipboardSnapshot(all)
  return {
    ...data,
    images: data.images.map((image) => ({
      ...image,
      image: portableImage(image.image),
    })),
    ...(data.diagrams
      ? {
          diagrams: data.diagrams.map((diagram) => ({
            ...diagram,
            image: portableImage(diagram.image),
          })),
        }
      : {}),
  }
}
const printableOutput = async (generation) => {
  const data = await editor.printableSnapshot(generation)
  const assets = data.assets.map(portableImage)
  const document = new DOMParser().parseFromString(data.html, 'text/html')
  const images = [...document.querySelectorAll('img')]
  const assetGeometry = await Promise.all(
    assets.map(async (asset, index) => {
      const image = new Image()
      const src = `data:${asset.mimeType};base64,${asset.bytesBase64}`
      image.src = src
      await image.decode()
      return {
        width: image.naturalWidth,
        height: image.naturalHeight,
        htmlBytesMatch: images[index]?.getAttribute('src') === src,
      }
    }),
  )
  return { ...data, assets, assetGeometry, htmlImageCount: images.length }
}

const selectText = async ({ text, occurrence = 0, from = 0, to, selector }) => {
  editor.focus()
  const plain = document.querySelector('textarea')
  if (documentFormat === 'txt' || editor.editingMode === 'source') {
    const start = findOccurrence(plain.value, text, occurrence)
    plain.setSelectionRange(start + from, start + (to ?? text.length))
    return plain.value.slice(plain.selectionStart, plain.selectionEnd)
  }
  const root = selector ? view().querySelector(selector) : view()
  if (!root) throw Error(`Selection root not found: ${selector}`)
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes = []
  let node
  while ((node = walker.nextNode())) nodes.push(node)
  const content = nodes.map((entry) => entry.textContent).join('')
  const start = findOccurrence(content, text, occurrence)
  const positions = [start + from, start + (to ?? text.length)]
  if (positions[0] > positions[1] || positions[1] > start + text.length)
    throw Error('Invalid selection offsets')
  const points = positions.map((position, index) => {
    let offset = 0
    for (const entry of nodes) {
      const length = entry.textContent.length
      if (
        position < offset + length ||
        (position === offset + length &&
          ((index === 1 && positions[0] !== positions[1]) ||
            (positions[0] === positions[1] && from === text.length))) ||
        (entry === nodes.at(-1) && position === offset + length)
      )
        return [entry, position - offset]
      offset += length
    }
    throw Error('Selection position is outside editor text')
  })
  const range = document.createRange()
  range.setStart(...points[0])
  range.setEnd(...points[1])
  const selection = getSelection()
  selection.removeAllRanges()
  selection.addRange(range)
  document.dispatchEvent(new Event('selectionchange'))
  await settle()
  return selection.toString()
}
const findOccurrence = (source, text, occurrence) => {
  let index = -1
  for (let count = 0; count <= occurrence; count++) {
    index = source.indexOf(text, index + 1)
    if (index < 0) throw Error(`Selection text not found: ${text}`)
  }
  return index
}
const inspectDOM = (selector) => {
  const nodes = [...view().querySelectorAll(selector)]
  return {
    count: nodes.length,
    nodes: nodes.map((node) => ({
      text: node.textContent,
      html: node.innerHTML,
      attributes: Object.fromEntries(
        [...node.attributes].map(({ name, value }) => [name, value]),
      ),
      hidden: node.hidden,
      display: getComputedStyle(node).display,
      visibility: getComputedStyle(node).visibility,
    })),
  }
}
const valueAt = (result, path) =>
  path ? path.split('.').reduce((value, key) => value?.[key], result) : result

window.interop = {
  load,
  export: exportClipboard,
  select: selectText,
  async paste(input) {
    await editor.paste(input)
    return {
      snapshot: editor.snapshot(),
      html: document.querySelector('.ProseMirror').innerHTML,
      error: window.lastError,
      importedImages: [...importedImages].map(([reference, image]) => ({
        reference,
        mimeType: image.mimeType,
        bytesBase64: btoa(String.fromCharCode(...image.bytes)),
      })),
    }
  },
  selectPartial() {
    const text = [...document.querySelector('.ProseMirror').childNodes].find(
      (node) => node.textContent?.includes('bold'),
    )
    document.querySelector('.ProseMirror').focus()
    const range = document.createRange()
    range.selectNodeContents(text)
    const selection = getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  },
  get: capture,
  async run(input) {
    load(
      input.source ?? '',
      input.format ?? 'md',
      input.documentId ?? 'interop',
    )
    const results = {}
    const steps = []
    let saved
    for (const [index, operation] of (input.operations ?? []).entries()) {
      let result
      try {
        switch (operation.op) {
          case 'awaitDOM': {
            const deadline = performance.now() + (operation.timeout ?? 15_000)
            do {
              result = inspectDOM(operation.selector)
              if (result.count === (operation.count ?? 1)) break
              await settle()
            } while (performance.now() < deadline)
            if (result.count !== (operation.count ?? 1))
              throw Error(
                `Timed out waiting for ${operation.selector}: expected ${operation.count ?? 1}, got ${result.count}`,
              )
            break
          }
          case 'select':
            result = await selectText(operation)
            break
          case 'selectContents': {
            editor.focus()
            const candidates = [
              ...view().querySelectorAll(operation.selector),
            ].filter(
              (node) =>
                operation.text === undefined ||
                node.textContent.includes(operation.text),
            )
            const target = candidates[operation.occurrence ?? 0]
            if (!target)
              throw Error(`Selection root not found: ${operation.selector}`)
            const range = document.createRange()
            range.selectNodeContents(target)
            const selection = getSelection()
            selection.removeAllRanges()
            selection.addRange(range)
            document.dispatchEvent(new Event('selectionchange'))
            await settle()
            result = selection.toString()
            break
          }
          case 'selectBlocks': {
            editor.focus()
            const first = view().querySelectorAll(operation.fromSelector)[
              operation.fromOccurrence ?? 0
            ]
            const last = view().querySelectorAll(operation.toSelector)[
              operation.toOccurrence ?? 0
            ]
            if (!first || !last) throw Error('Selection block not found')
            const range = document.createRange()
            range.setStartBefore(first)
            range.setEndAfter(last)
            const selection = getSelection()
            selection.removeAllRanges()
            selection.addRange(range)
            document.dispatchEvent(new Event('selectionchange'))
            await settle()
            result = selection.toString()
            break
          }
          case 'security':
            result = {
              callbackExecuted: Boolean(window.inkkitUnsafeCallback),
              externalResources: performance
                .getEntriesByType('resource')
                .map((entry) => entry.name)
                .filter((name) => /^https?:/i.test(name)),
              activeElements: view().querySelectorAll(
                'script, iframe, object, embed, [onclick], [onerror]',
              ).length,
            }
            break
          case 'imageFixture': {
            const canvas = document.createElement('canvas')
            canvas.width = operation.width
            canvas.height = operation.height
            const context = canvas.getContext('2d')
            for (const [index, color] of [
              '#f02020',
              '#20c040',
              '#2040f0',
            ].entries()) {
              context.fillStyle = color
              context.fillRect(
                0,
                (index * canvas.height) / 3,
                canvas.width,
                canvas.height / 3,
              )
            }
            const data = canvas.toDataURL('image/png').split(',')[1]
            const image = {
              bytes: Uint8Array.from(atob(data), (character) =>
                character.charCodeAt(0),
              ),
              mimeType: 'image/png',
            }
            importedImages.set(operation.reference, image)
            result = {
              ...portableImage(image),
              width: canvas.width,
              height: canvas.height,
            }
            break
          }
          case 'imageExport':
            imageExportMode = operation.mode ?? 'normal'
            imageExportStarted = false
            imageExportGate =
              imageExportMode === 'hold'
                ? new Promise((resolve) => {
                    releaseImageExport = resolve
                  })
                : undefined
            result = true
            break
          case 'startPrintable':
            pendingPrintable = printableOutput(operation.generation).then(
              (value) => ({ value }),
              (error) => ({ error }),
            )
            for (let count = 0; count < 100 && !imageExportStarted; count++)
              await settle()
            if (!imageExportStarted)
              throw Error('Held image export did not start')
            result = { pending: true }
            break
          case 'finishPrintable': {
            releaseImageExport?.()
            imageExportGate = undefined
            if (!pendingPrintable)
              throw Error('No printable capture is pending')
            const completed = await pendingPrintable
            pendingPrintable = undefined
            if (completed.error) throw completed.error
            result = completed.value
            break
          }
          case 'startImagePaste':
            imageImportStarted = false
            imageImportGate = new Promise((resolve) => {
              releaseImageImport = resolve
            })
            pendingPaste = editor.paste({
              text: '',
              images: [{ bytes, mimeType: 'image/png', filename: 'held.png' }],
            })
            for (let count = 0; count < 100 && !imageImportStarted; count++)
              await settle()
            if (!imageImportStarted)
              throw Error('Held image import did not start')
            result = { pending: true }
            break
          case 'finishImagePaste':
            releaseImageImport?.()
            imageImportGate = undefined
            if (!pendingPaste) throw Error('No image paste is pending')
            await pendingPaste
            pendingPaste = undefined
            result = capture()
            break
          case 'composition':
            activeEditor().dispatchEvent(
              new CompositionEvent(
                operation.active ? 'compositionstart' : 'compositionend',
                { bubbles: true },
              ),
            )
            result = true
            break
          case 'insertPrintable': {
            editor.insertText(
              operation.text,
              operation.generation ?? generation,
            )
            const sourceSnapshot = editor.snapshot()
            result = {
              ...(await printableOutput(operation.generation)),
              sourceSnapshot,
            }
            break
          }
          case 'printable':
            result = await printableOutput(operation.generation)
            break
          case 'dom':
            result = inspectDOM(operation.selector)
            break
          case 'domKeyDown': {
            const target = view().querySelector(operation.selector)
            if (!target)
              throw Error(`Keyboard target not found: ${operation.selector}`)
            target.focus()
            target.dispatchEvent(
              new KeyboardEvent('keydown', {
                key: operation.key,
                code: operation.code ?? '',
                bubbles: true,
                cancelable: true,
              }),
            )
            result = inspectDOM(operation.selector)
            break
          }
          case 'click': {
            const target = view().querySelector(operation.selector)
            if (!target)
              throw Error(`Click target not found: ${operation.selector}`)
            target.click()
            result = inspectDOM(operation.selector)
            break
          }
          case 'setCommentsVisible':
            editor.setCommentsVisible(operation.visible)
            result = capture()
            break
          case 'setKeymap':
            editor.setKeymap(operation.bindings)
            result = true
            break
          case 'capture':
            result = capture()
            break
          case 'find':
            editor.find(operation.text, operation.generation)
            await settle()
            result = selectedText()
            break
          case 'editingMode':
            result = editor.setEditingMode(operation.mode, operation.generation)
            break
          case 'replaceSource':
            result = editor.replaceSource(
              operation.text ??
                valueAt(results[operation.sourceName], operation.path),
              operation.generation,
            )
            break
          case 'sourceInput': {
            const target = activeEditor()
            if (!(target instanceof HTMLTextAreaElement))
              throw Error('Source input requires the source textarea')
            target.focus()
            if (operation.value !== undefined) target.value = operation.value
            else
              target.setRangeText(
                operation.text,
                target.selectionStart,
                target.selectionEnd,
                'end',
              )
            target.dispatchEvent(
              new InputEvent('input', {
                bubbles: true,
                inputType: operation.inputType ?? 'insertText',
                data: operation.text ?? null,
                isComposing: operation.composing ?? false,
              }),
            )
            result = true
            break
          }
          case 'sourceState': {
            const target = activeEditor()
            if (!(target instanceof HTMLTextAreaElement))
              throw Error('Source state requires the source textarea')
            result = {
              text: target.value,
              start: target.selectionStart,
              end: target.selectionEnd,
              focused: document.activeElement === target,
            }
            break
          }
          case 'surface': {
            const source = document.querySelector('textarea.inkkit-plain')
            const formatted = view()?.parentElement
            result = {
              sourceHidden: source?.hidden,
              sourceDisplay: source ? getComputedStyle(source).display : null,
              formattedHidden: formatted?.hidden,
              formattedDisplay: formatted
                ? getComputedStyle(formatted).display
                : null,
            }
            break
          }
          case 'activeKeyDown': {
            const event = new KeyboardEvent('keydown', {
              key: operation.key,
              code: operation.code ?? '',
              metaKey: operation.metaKey ?? false,
              ctrlKey: operation.ctrlKey ?? false,
              shiftKey: operation.shiftKey ?? false,
              bubbles: true,
              cancelable: true,
            })
            activeEditor().dispatchEvent(event)
            result = { prevented: event.defaultPrevented }
            break
          }
          case 'undo':
            result = editor.undo(operation.generation)
            break
          case 'redo':
            result = editor.redo(operation.generation)
            break
          case 'replace':
            result = editor.replace(
              operation.search,
              operation.replacement,
              operation.generation,
            )
            break
          case 'replaceAll':
            result = editor.replaceAll(
              operation.search,
              operation.replacement,
              operation.generation,
            )
            break
          case 'headings':
            result = editor.headings(operation.generation)
            break
          case 'navigateHeading':
            result = editor.navigateHeading(
              operation.entry ??
                JSON.parse(
                  JSON.stringify(
                    results[operation.sourceName]?.[operation.index ?? 0],
                  ),
                ),
            )
            break
          case 'insertText':
            result = editor.insertText(
              operation.text,
              operation.generation ?? generation,
            )
            break
          case 'format':
            result = editor.format(operation.command, operation.argument)
            break
          case 'table':
            result = editor.table(operation.command, operation.options)
            break
          case 'tableCells':
            result = [...view().querySelectorAll('table')].map((table) =>
              [...table.querySelectorAll('tr')].map((row) =>
                [...row.querySelectorAll('th,td')].map((cell) => ({
                  text: cell.textContent,
                  html: cell.innerHTML,
                  alignment: cell.getAttribute('style'),
                })),
              ),
            )
            break
          case 'domPaste': {
            const clipboardData = new DataTransfer()
            for (const [type, text] of Object.entries(operation.types))
              clipboardData.setData(type, String(text))
            const event = new ClipboardEvent('paste', {
              clipboardData,
              bubbles: true,
              cancelable: true,
            })
            activeEditor().dispatchEvent(event)
            await settle()
            result = { prevented: event.defaultPrevented, ...capture() }
            break
          }
          case 'keyDown':
            result = editor.keyDown(
              operation.key,
              operation.code ?? '',
              operation.metaKey ?? false,
              operation.ctrlKey ?? false,
              operation.altKey ?? false,
              operation.shiftKey ?? false,
              operation.generation ?? generation,
            )
            break
          case 'pasteExport': {
            const exported = results[operation.sourceName]
            if (!exported)
              throw Error(`Clipboard result not found: ${operation.sourceName}`)
            if (exported.images?.length)
              throw Error('pasteExport requires an image-free fixture')
            await editor.paste({
              text: exported.text,
              html: exported.html,
              ...(operation.markdown ? { markdown: exported.markdown } : {}),
            })
            result = capture()
            break
          }
          case 'paste':
            await editor.paste(operation.input)
            result = capture()
            break
          case 'snapshot':
            result = editor.snapshot(operation.generation)
            break
          case 'save':
            saved = editor.snapshot()
            result = saved
            break
          case 'reopen':
            if (!saved && operation.source === undefined)
              throw Error('Reopen requires a saved snapshot or explicit source')
            result = load(
              operation.source ?? saved.text,
              operation.format ?? saved?.format ?? documentFormat,
              operation.documentId ?? documentId,
            )
            break
          case 'load':
            result = load(
              operation.source ?? '',
              operation.format ?? documentFormat,
              operation.documentId ?? documentId,
            )
            break
          case 'reload':
            editor.reloadDocument({
              documentId,
              generation: ++generation,
              format: operation.format ?? documentFormat,
              text: operation.source,
            })
            documentFormat = operation.format ?? documentFormat
            result = capture()
            break
          case 'export':
            result = await exportClipboard(operation.all ?? true)
            break
          case 'insertFootnote':
            result = editor.insertFootnote(operation.label)
            break
          case 'navigateFootnote':
            result = editor.navigateFootnote(operation.target)
            break
          case 'editReferenceDefinition':
            result = editor.editReferenceDefinition(
              operation.label,
              operation.destination,
              operation.title,
            )
            break
          case 'assert': {
            const actual = valueAt(
              operation.name ? results[operation.name] : capture(),
              operation.path,
            )
            const expected = operation.equalsFrom
              ? valueAt(
                  results[operation.equalsFrom.name],
                  operation.equalsFrom.path,
                )
              : operation.equals
            if (
              ('equals' in operation || operation.equalsFrom) &&
              JSON.stringify(actual) !== JSON.stringify(expected)
            )
              throw Error(
                `Expected ${operation.path} to equal ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
              )
            if (
              'includes' in operation &&
              !actual?.includes(operation.includes)
            )
              throw Error(
                `Expected ${operation.path} to include ${JSON.stringify(operation.includes)}, got ${JSON.stringify(actual)}`,
              )
            if ('excludes' in operation && actual?.includes(operation.excludes))
              throw Error(
                `Expected ${operation.path} to exclude ${JSON.stringify(operation.excludes)}, got ${JSON.stringify(actual)}`,
              )
            if ('truthy' in operation && Boolean(actual) !== operation.truthy)
              throw Error(
                `Expected ${operation.path} truthiness to equal ${operation.truthy}, got ${JSON.stringify(actual)}`,
              )
            result = { passed: true, actual }
            break
          }
          default:
            throw Error(`Unknown operation: ${operation.op}`)
        }
        await settle()
        if (operation.expectedError) {
          const error = Error(
            `Expected error ${operation.expectedError} was not raised`,
          )
          error.code = 'harness-expected-error-missing'
          throw error
        }
        if (operation.name && operation.op !== 'assert')
          results[operation.name] = result ?? null
        steps.push({
          index,
          operation: operation.op,
          passed: true,
          result: result ?? null,
        })
      } catch (error) {
        const expected =
          operation.expectedError &&
          error.code !== 'harness-expected-error-missing' &&
          (error.code === operation.expectedError ||
            error.message.includes(operation.expectedError))
        const failure = { code: error.code ?? null, message: error.message }
        if (operation.name && operation.op !== 'assert')
          results[operation.name] = failure
        steps.push({
          index,
          operation: operation.op,
          passed: Boolean(expected),
          error: failure,
        })
        if (!expected) break
      }
    }
    let final
    try {
      final = capture()
    } catch (error) {
      final = { error: error.message, code: error.code ?? null }
    }
    return {
      passed: steps.every((step) => step.passed) && !final.error,
      steps,
      results,
      final,
    }
  },
}
window.ready = true
