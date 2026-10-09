import {
  DOMSerializer,
  type Fragment,
  type Node,
  type Schema,
} from '@milkdown/kit/prose/model'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { $prose } from '@milkdown/kit/utils'
import { shareableFragment } from './comments'
import { diagramImage } from './mermaid'
import type {
  ClipboardImage,
  ClipboardDiagram,
  ClipboardOutput,
  DocumentContext,
  ImageAdapter,
} from './types'

export interface ClipboardContent {
  text: string
  html: string
}

// Clipboard text is the visible document, not Markdown serialization: escaping
// punctuation or trailing spaces here leaks source syntax into other apps.
export function clipboardText(
  content: Fragment,
  missingImages: ReadonlySet<string> = new Set(),
): string {
  content = shareableFragment(content)
  const blocks: string[] = []
  content.forEach((node) => {
    if (node.type.name !== 'reference_definition')
      blocks.push(nodeText(node, missingImages))
  })
  const inline = content.firstChild?.isInline ?? false
  return blocks.join(inline ? '' : '\n\n')
}

function nodeText(node: Node, missingImages: ReadonlySet<string>): string {
  if (node.type.name === 'inkkit_callout')
    return `${
      node.attrs.title ||
      String(node.attrs.kind)
        .toLowerCase()
        .replace(/^./, (letter) => letter.toUpperCase())
    }\n${clipboardText(node.content, missingImages)}`
  if (node.type.name === 'reference_definition') return ''
  if (node.type.name === 'footnote_reference') return `[${node.attrs.label}]`
  if (node.type.name === 'footnote_definition')
    return `[${node.attrs.label}] ${clipboardText(node.content, missingImages)}`
  if (node.isText) return node.text ?? ''
  if (node.type.name === 'hardbreak' || node.type.name === 'hard_break')
    return '\n'
  if (node.type.name === 'bullet_list' || node.type.name === 'ordered_list') {
    const items: string[] = []
    node.forEach((item, _offset, index) => {
      const marker =
        node.type.name === 'ordered_list'
          ? `${Number(node.attrs.order ?? 1) + index}. `
          : '- '
      const task =
        item.attrs.checked == null ? '' : item.attrs.checked ? '[x] ' : '[ ] '
      const prefix = marker + task
      const indent = ' '.repeat(marker.length)
      const blocks: string[] = []
      item.forEach((child, _childOffset, childIndex) => {
        const text = nodeText(child, missingImages)
        const nestedList =
          child.type.name === 'bullet_list' ||
          child.type.name === 'ordered_list'
        const lines = text.split('\n')
        const indented = lines
          .map((line, lineIndex) =>
            childIndex === 0 && lineIndex === 0 ? prefix + line : indent + line,
          )
          .join('\n')
        // Nested lists follow their parent directly; subsequent paragraphs keep
        // their blank line and every continuation stays inside its list item.
        blocks.push((childIndex > 0 && !nestedList ? '\n' : '') + indented)
      })
      items.push(blocks.length ? blocks.join('\n') : prefix.trimEnd())
    })
    return items.join('\n')
  }
  if (node.type.name === 'image') {
    const alt =
      String(node.attrs.alt ?? '').replace(/\|\d{1,5}$/, '') || 'Image'
    return missingImages.has(String(node.attrs.src ?? ''))
      ? `[${alt}: image unavailable]`
      : alt
  }
  if (node.type.name === 'table') {
    const rows: string[] = []
    node.forEach((row) => {
      const cells: string[] = []
      row.forEach((cell) =>
        cells.push(clipboardText(cell.content, missingImages)),
      )
      rows.push(cells.join('\t'))
    })
    return rows.join('\n')
  }
  return clipboardText(node.content, missingImages)
}

export function clipboardContent(
  content: Fragment,
  schema: Schema,
): ClipboardContent {
  content = shareableFragment(content)
  const container = document.createElement('div')
  const serializer = DOMSerializer.fromSchema(schema)
  // Construct image elements without a source so detached clipboard DOM never
  // fetches authored references or temporary presentation URLs.
  const safe = new DOMSerializer(
    {
      ...serializer.nodes,
      image: (node) => [
        'img',
        {
          alt: String(node.attrs.alt ?? ''),
          title: String(node.attrs.title ?? ''),
        },
      ],
    },
    serializer.marks,
  )
  container.append(safe.serializeFragment(content))
  for (const definition of container.querySelectorAll(
    '[data-inkkit-reference-definition]',
  ))
    definition.remove()
  for (const reference of container.querySelectorAll(
    '[data-inkkit-footnote-reference]',
  )) {
    reference.removeAttribute('tabindex')
    reference.removeAttribute('role')
  }
  for (const definition of container.querySelectorAll(
    '[data-inkkit-footnote-definition]',
  )) {
    const label = document.createElement('span')
    label.textContent = `[${definition.getAttribute('data-inkkit-label')}] `
    definition.prepend(label)
  }
  return { text: clipboardText(content), html: container.innerHTML }
}

export const visibleClipboard = $prose(
  () =>
    new Plugin({
      key: new PluginKey('visibleClipboard'),
      props: {
        clipboardTextSerializer: (slice) => clipboardText(slice.content),
      },
    }),
)

/** Export a frozen document fragment; presentation URLs never enter the clipboard. */
export async function portableClipboard(
  content: Fragment,
  schema: Schema,
  markdown: string,
  adapter: ImageAdapter | undefined,
  context: DocumentContext,
  completeDiagrams?: ReadonlySet<string>,
): Promise<ClipboardOutput> {
  content = shareableFragment(content)
  const base = clipboardContent(content, schema)
  const container = document.createElement('div')
  container.innerHTML = base.html
  const images: ClipboardImage[] = []
  const references: string[] = []
  content.descendants((node) => {
    if (node.type.name === 'image')
      references.push(String(node.attrs.src ?? ''))
  })
  const captured = [...container.querySelectorAll('img')].map(
    (element, index) => {
      const reference = references[index] ?? ''
      const alt =
        element.getAttribute('alt')?.replace(/\|\d{1,5}$/, '') || 'Image'
      element.removeAttribute('src')
      element.removeAttribute('srcset')
      return { element, reference, alt }
    },
  )
  await Promise.all(
    captured.map(async ({ element, reference, alt }, index) => {
      element.setAttribute('data-inkkit-image-slot', String(index))
      element.setAttribute('data-inkkit-authored-image-slot', String(index))
      try {
        if (!adapter) throw new Error('The image is unavailable.')
        const image = await adapter.exportImage(reference, { ...context })
        if (!/^image\/(png|jpeg|gif|webp|avif|bmp|tiff)$/i.test(image.mimeType))
          throw new Error('The image format cannot be exported.')
        let binary = ''
        for (const byte of image.bytes) binary += String.fromCharCode(byte)
        const portable = `data:${image.mimeType};base64,${btoa(binary)}`
        element.setAttribute('src', portable)
        element.setAttribute('alt', alt)
        images[index] = { reference, alt, image }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'The image is unavailable.'
        const warning = document.createElement('span')
        warning.textContent = `[${alt}: image unavailable]`
        element.replaceWith(warning)
        images[index] = { reference, alt, error: message }
      }
    }),
  )
  const diagrams: ClipboardDiagram[] = []
  for (const code of container.querySelectorAll(
    'pre[data-language="mermaid"] > code',
  )) {
    const source = code.textContent ?? ''
    if (completeDiagrams && !completeDiagrams.has(source)) continue
    const result: ClipboardDiagram = { source }
    diagrams.push(result)
    try {
      const image = await diagramImage(source)
      let binary = ''
      for (const byte of image.bytes) binary += String.fromCharCode(byte)
      const figure = document.createElement('figure')
      figure.setAttribute('data-inkkit-mermaid', source)
      const fence = code.parentElement!.getAttribute('data-inkkit-fence')
      if (fence) figure.setAttribute('data-inkkit-fence', fence)
      const element = document.createElement('img')
      element.src = `data:image/png;base64,${btoa(binary)}`
      element.alt = `Mermaid diagram: ${source}`
      figure.append(element)
      code.parentElement!.replaceWith(figure)
      result.image = image
    } catch (error) {
      result.error =
        error instanceof Error
          ? error.message
          : 'The diagram could not be exported.'
      const warning = document.createElement('p')
      warning.setAttribute('data-inkkit-diagram-error', '')
      warning.textContent = `Diagram unavailable: ${result.error}`
      code.parentElement!.before(warning)
    }
  }
  // Native attachment slots follow DOM order, including generated diagrams.
  const orderedImages: ClipboardImage[] = []
  for (const element of container.querySelectorAll('img')) {
    const diagram = element.closest('[data-inkkit-mermaid]')
    const item = diagram
      ? {
          reference: '',
          alt: element.alt,
          image: diagrams.find(
            (entry) =>
              entry.source === diagram.getAttribute('data-inkkit-mermaid'),
          )!.image,
        }
      : images[Number(element.getAttribute('data-inkkit-image-slot'))]!
    element.setAttribute('data-inkkit-image-slot', String(orderedImages.length))
    orderedImages.push(item)
  }
  // Scriptable links and event attributes are not part of semantic rich text.
  for (const element of container.querySelectorAll('*')) {
    for (const attribute of [...element.attributes])
      if (
        attribute.name.startsWith('on') ||
        ((attribute.name === 'href' || attribute.name === 'src') &&
          /^javascript:/i.test(attribute.value))
      )
        element.removeAttribute(attribute.name)
  }
  const missing = new Set(
    images.filter((image) => image.error).map((image) => image.reference),
  )
  return {
    text: clipboardText(content, missing),
    html: container.innerHTML,
    markdown,
    images: [...orderedImages, ...images.filter((image) => image.error)],
    diagrams,
  }
}
