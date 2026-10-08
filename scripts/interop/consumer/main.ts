import { InkKitEditor } from '@aicayzer/inkkit'
import '@aicayzer/inkkit/style.css'
const imageData =
  'iVBORw0KGgoAAAANSUhEUgAAAFAAAAAoCAYAAABpYH0BAAAAAXNSR0IArs4c6QAAADhlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAAqACAAQAAAABAAAAUKADAAQAAAABAAAAKAAAAADbisV7AAAAlUlEQVRoBe3SMQ0AIQAEQR4X6MC/Nj5BAtvO9dtM7jtrn2HPAvO5FF4BgPEIAAFGgZh7IMAoEHMPBBgFYu6BAKNAzD0QYBSIuQcCjAIx90CAUSDmHggwCsTcAwFGgZh7IMAoEHMPBBgFYu6BAKNAzD0QYBSIuQcCjAIx90CAUSDmHggwCsTcAwFGgZh7IMAoEHMPjIA/2VgCmiePpoIAAAAASUVORK5CYII='
const bytes = Uint8Array.from(atob(imageData), (c) => c.charCodeAt(0))
const importedImages = new Map<
  string,
  { bytes: Uint8Array; mimeType: string }
>()
const editor = await InkKitEditor.mount(
  document.querySelector('#editor'),
  {
    changed() {},
    stateChanged() {},
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
        const reference = `images/imported-${importedImages.size}.png`
        importedImages.set(reference, {
          bytes: input.bytes.slice(),
          mimeType: input.mimeType,
        })
        return { reference }
      },
      async exportImage(reference) {
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
const capture = () => ({
  snapshot: editor.snapshot(),
  html: view().innerHTML,
  selection: getSelection()?.toString() ?? '',
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
const exportClipboard = async (all = true) => {
  const data = await editor.clipboardSnapshot(all)
  return {
    ...data,
    images: data.images.map((image) => ({
      ...image,
      image: image.image
        ? {
            ...image.image,
            bytesBase64: btoa(String.fromCharCode(...image.image.bytes)),
            bytes: undefined,
          }
        : undefined,
    })),
  }
}

const selectText = async ({ text, occurrence = 0, from = 0, to, selector }) => {
  editor.focus()
  const plain = document.querySelector('textarea')
  if (documentFormat === 'txt') {
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
          index === 1 &&
          positions[0] !== positions[1]) ||
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
          case 'select':
            result = await selectText(operation)
            break
          case 'find':
            editor.find(operation.text)
            await settle()
            result = getSelection()?.toString() ?? ''
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
            if (
              'equals' in operation &&
              JSON.stringify(actual) !== JSON.stringify(operation.equals)
            )
              throw Error(
                `Expected ${operation.path} to equal ${JSON.stringify(operation.equals)}, got ${JSON.stringify(actual)}`,
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
