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
import { fileReference } from './linked-syntax'
import { portableFile, portableFileImage } from './portable-files'
import { withFileSignal } from './files'
import type {
  ClipboardImage,
  ClipboardDiagram,
  ClipboardOutput,
  DocumentContext,
  ImageAdapter,
  FileAdapter,
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
  fileDescriptions: ReadonlyMap<object, string> = new Map(),
): string {
  content = shareableFragment(content)
  const blocks: string[] = []
  content.forEach((node) => {
    if (node.type.name !== 'reference_definition')
      blocks.push(nodeText(node, missingImages, fileDescriptions))
  })
  const inline = content.firstChild?.isInline ?? false
  return blocks.join(inline ? '' : '\n\n')
}

function nodeText(
  node: Node,
  missingImages: ReadonlySet<string>,
  fileDescriptions: ReadonlyMap<object, string>,
): string {
  if (node.type.name === 'inkkit_wiki_link')
    return String(node.attrs.label || node.attrs.target || 'Link')
  if (node.type.name === 'inkkit_callout')
    return `${
      node.attrs.title ||
      String(node.attrs.kind)
        .toLowerCase()
        .replace(/^./, (letter) => letter.toUpperCase())
    }\n${clipboardText(node.content, missingImages, fileDescriptions)}`
  if (node.type.name === 'reference_definition') return ''
  if (node.type.name === 'footnote_reference') return `[${node.attrs.label}]`
  if (node.type.name === 'footnote_definition')
    return `[${node.attrs.label}] ${clipboardText(node.content, missingImages, fileDescriptions)}`
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
        const text = nodeText(child, missingImages, fileDescriptions)
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
    const description = fileDescriptions.get(node.attrs)
    if (description != null) return description
    const alt = fileReference(node).label || 'Image'
    return missingImages.has(String(node.attrs.src ?? ''))
      ? `[${alt}: image unavailable]`
      : alt
  }
  if (node.type.name === 'table') {
    const rows: string[] = []
    node.forEach((row) => {
      const cells: string[] = []
      row.forEach((cell) =>
        cells.push(
          clipboardText(cell.content, missingImages, fileDescriptions),
        ),
      )
      rows.push(cells.join('\t'))
    })
    return rows.join('\n')
  }
  return clipboardText(node.content, missingImages, fileDescriptions)
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
      inkkit_wiki_link: (node) => [
        'span',
        String(node.attrs.label || node.attrs.target || 'Link'),
      ],
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
  files?: FileAdapter,
  signal: AbortSignal = new AbortController().signal,
): Promise<ClipboardOutput> {
  signal.throwIfAborted()
  content = shareableFragment(content)
  const base = clipboardContent(content, schema)
  const container = document.createElement('div')
  container.innerHTML = base.html
  const images: ClipboardImage[] = []
  const references: Node[] = []
  const fileDescriptions = new Map<object, string>()
  content.descendants((node) => {
    if (node.type.name === 'image') references.push(node)
  })
  const captured = [...container.querySelectorAll('img')].map(
    (element, index) => {
      const node = references[index]!
      const reference = String(node?.attrs.src ?? '')
      const { label: authoredAlt, width } = fileReference(node)
      const alt = authoredAlt || 'Image'
      if (width != null && width > 0)
        element.setAttribute('width', String(Math.min(4096, width)))
      element.removeAttribute('src')
      element.removeAttribute('srcset')
      return { element, node, reference, alt }
    },
  )
  await Promise.all(
    captured.map(async ({ element, node, reference, alt }, index) => {
      let label = alt
      element.setAttribute('data-inkkit-image-slot', String(index))
      element.setAttribute('data-inkkit-authored-image-slot', String(index))
      try {
        const file = files
          ? await portableFile(node, files, context, signal)
          : undefined
        if (file && file.presentation.kind !== 'image') {
          const fallback = document.createElement('span')
          fallback.textContent = file.description
          element.replaceWith(fallback)
          fileDescriptions.set(node.attrs, file.description)
          return
        }
        label = file?.label || alt
        if (!files && !adapter) throw new Error('The image is unavailable.')
        const input = file
          ? await portableFileImage(file, files!, adapter, context, signal)
          : await withFileSignal(
              adapter!.exportImage(reference, { ...context }),
              signal,
            )
        signal.throwIfAborted()
        const image = { ...input, bytes: new Uint8Array(input.bytes) }
        if (!/^image\/(png|jpeg|gif|webp|avif|bmp|tiff)$/i.test(image.mimeType))
          throw new Error('The image format cannot be exported.')
        let binary = ''
        for (const byte of image.bytes) binary += String.fromCharCode(byte)
        const portable = `data:${image.mimeType};base64,${btoa(binary)}`
        element.setAttribute('src', portable)
        element.setAttribute('alt', label)
        fileDescriptions.set(node.attrs, label)
        images[index] = { reference, alt: label, image }
      } catch (error) {
        signal.throwIfAborted()
        const message =
          error instanceof Error ? error.message : 'The image is unavailable.'
        const warning = document.createElement('span')
        warning.textContent = `[${label}: image unavailable]`
        element.replaceWith(warning)
        fileDescriptions.set(node.attrs, warning.textContent)
        images[index] = { reference, alt: label, error: message }
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
      const image = await withFileSignal(diagramImage(source), signal)
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
      signal.throwIfAborted()
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
    images.filter((image) => image?.error).map((image) => image.reference),
  )
  signal.throwIfAborted()
  return {
    text: clipboardText(content, missing, fileDescriptions),
    html: container.innerHTML,
    markdown,
    images: [...orderedImages, ...images.filter((image) => image?.error)],
    diagrams,
  }
}
