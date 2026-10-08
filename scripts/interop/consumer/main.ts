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
window.interop = {
  load(source) {
    editor.loadDocument({
      documentId: 'interop',
      generation: ++generation,
      format: 'md',
      text: source,
    })
    return editor.snapshot()
  },
  async export(all = true) {
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
  },
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
  get() {
    return {
      snapshot: editor.snapshot(),
      html: document.querySelector('.ProseMirror').innerHTML,
      error: window.lastError,
    }
  },
}
window.ready = true
