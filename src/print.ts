import type { Fragment, Schema } from '@milkdown/kit/prose/model'
import { clipboardContent } from './clipboard'
import { shareableFragment } from './comments'
import { splitAlt } from './images'
import { sourceFrontmatter } from './literals'
import { diagramImage, renderDiagram } from './mermaid'
import {
  InkKitError,
  type DocumentContext,
  type ImageAdapter,
  type PortableImage,
  type PrintableDocument,
  type PrintableWarning,
} from './types'

type PrintableContent = Pick<
  PrintableDocument,
  'html' | 'styles' | 'assets' | 'warnings'
>

const styles = `
:root { color-scheme: light; font: 11pt/1.5 Arial, sans-serif; }
html, body { margin: 0; padding: 0; height: auto; overflow: visible; background: white; color: #222; }
.inkkit-print-document { padding: 1rem; overflow-wrap: anywhere; }
h1, h2, h3, h4, h5, h6 { line-height: 1.25; break-after: avoid; }
p, ul, ol, blockquote, pre, table, figure { margin-block: 0 1em; }
li > p { margin-bottom: .35em; }
li > ul, li > ol { margin-bottom: .35em; }
a { color: inherit; text-decoration: underline; }
mark { color: inherit; background: #fff0a8; print-color-adjust: exact; }
code, pre { font-family: ui-monospace, Menlo, monospace; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; overflow: visible; padding: .65em; border: 1px solid #ddd; font-size: .9em; }
.inkkit-print-literal { padding: 0; border: 0; font-size: 1em; tab-size: 4; }
blockquote { margin-inline: 0; padding-inline-start: 1em; border-inline-start: 3px solid #aaa; }
.inkkit-callout { padding: .65em 1em; border-inline-start: 3px solid #777; }
.inkkit-callout-title { display: block; margin-bottom: .4em; }
.inkkit-callout-body { display: block; }
.inkkit-print-footnote { border-inline-start: 2px solid #aaa; padding-inline-start: 1em; margin-bottom: 1em; }
sup { font-size: .75em; }
.inkkit-print-task-marker { font-family: ui-monospace, Menlo, monospace; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: .95em; }
th, td { border: 1px solid #aaa; padding: .4em .6em; vertical-align: top; overflow-wrap: anywhere; }
th { font-weight: bold; }
th p, td p { margin: 0; }
thead { display: table-header-group; }
tfoot { display: table-footer-group; }
tr { break-inside: avoid; }
img { max-width: 100%; height: auto; }
figure { margin-inline: 0; }
.inkkit-print-diagram img { display: block; }
figure, img { break-inside: avoid; }
hr { border: 0; border-top: 1px solid #aaa; }
@page { margin: 18mm; }
@media print { .inkkit-print-document { padding: 0; } }
`.trim()

function documentOutput(
  content: HTMLElement,
  assets: PortableImage[] = [],
  warnings: PrintableWarning[] = [],
): PrintableContent {
  const page = document.implementation.createHTMLDocument('')
  page.head.textContent = ''
  const charset = page.createElement('meta')
  charset.setAttribute('charset', 'utf-8')
  const style = page.createElement('style')
  style.textContent = styles
  page.head.append(charset, style)
  const main = page.createElement('main')
  main.className = 'inkkit-print-document'
  while (content.firstChild) main.appendChild(content.firstChild)
  page.body.append(main)
  return {
    html: '<!DOCTYPE html>\n' + page.documentElement.outerHTML,
    styles,
    assets,
    warnings,
  }
}

export function printableText(text: string): PrintableContent {
  const container = document.createElement('div')
  const pre = document.createElement('pre')
  pre.className = 'inkkit-print-literal'
  pre.textContent = text
  container.append(pre)
  return documentOutput(container)
}

export function hasAuthoredImagesInLiterals(
  content: Fragment,
  parse: (source: string) => unknown,
): boolean {
  const hasImage = (value: unknown): boolean => {
    if (!value || typeof value !== 'object') return false
    const node = value as { type?: unknown; children?: unknown }
    if (node.type === 'image') return true
    if (
      ['html', 'code', 'inlineCode', 'imageReference'].includes(
        String(node.type),
      )
    )
      return false
    return Array.isArray(node.children) && node.children.some(hasImage)
  }
  let found = false
  shareableFragment(content).descendants((node) => {
    if (found) return false
    if (node.type.name !== 'literal_markdown') return true
    const source = node.textContent.replace(/^\uFEFF/, '')
    const body = source.slice(sourceFrontmatter(source)?.length ?? 0)
    if (body && hasImage(parse(body))) found = true
    return false
  })
  return found
}

function matchesSignature(bytes: Uint8Array, mimeType: string): boolean {
  const ascii = (start: number, end: number) =>
    String.fromCharCode(...bytes.subarray(start, end))
  switch (mimeType) {
    case 'image/png':
      return (
        bytes.length >= 24 &&
        [137, 80, 78, 71, 13, 10, 26, 10].every(
          (byte, index) => bytes[index] === byte,
        ) &&
        ascii(12, 16) === 'IHDR'
      )
    case 'image/jpeg':
      return (
        bytes.length >= 4 &&
        bytes[0] === 255 &&
        bytes[1] === 216 &&
        bytes[2] === 255
      )
    case 'image/gif':
      return bytes.length >= 10 && /^(GIF87a|GIF89a)$/.test(ascii(0, 6))
    case 'image/webp':
      return (
        bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP'
      )
    case 'image/avif':
      return (
        bytes.length >= 16 &&
        ascii(4, 8) === 'ftyp' &&
        /avif|avis/.test(ascii(8, 32))
      )
    case 'image/bmp':
      return bytes.length >= 26 && ascii(0, 2) === 'BM'
    case 'image/tiff':
      return (
        bytes.length >= 8 &&
        (ascii(0, 4) === 'II*\0' || ascii(0, 4) === 'MM\0*')
      )
    default:
      return false
  }
}

async function validatedImage(input: PortableImage): Promise<PortableImage> {
  const image = {
    bytes: new Uint8Array(input.bytes),
    mimeType: input.mimeType.toLowerCase(),
  }
  if (!matchesSignature(image.bytes, image.mimeType))
    throw new Error(
      'The portable image bytes do not match a supported image format.',
    )
  const url = URL.createObjectURL(
    new Blob([image.bytes], { type: image.mimeType }),
  )
  try {
    await new Promise<void>((resolve, reject) => {
      const decoder = new Image()
      const timeout = setTimeout(() => {
        decoder.onload = decoder.onerror = null
        decoder.removeAttribute('src')
        reject(new Error('The portable image could not be decoded.'))
      }, 10000)
      const finish = (error?: Error) => {
        clearTimeout(timeout)
        decoder.onload = decoder.onerror = null
        if (error) reject(error)
        else resolve()
      }
      decoder.onload = () =>
        finish(
          decoder.naturalWidth > 0 && decoder.naturalHeight > 0
            ? undefined
            : new Error('The portable image has no usable dimensions.'),
        )
      decoder.onerror = () =>
        finish(new Error('The portable image could not be decoded.'))
      decoder.src = url
    })
    return image
  } finally {
    URL.revokeObjectURL(url)
  }
}

function dataURL(image: PortableImage): string {
  let binary = ''
  for (const byte of image.bytes) binary += String.fromCharCode(byte)
  return `data:${image.mimeType};base64,${btoa(binary)}`
}

const semanticTags = new Set([
  'DIV',
  'P',
  'SPAN',
  'STRONG',
  'EM',
  'DEL',
  'S',
  'MARK',
  'A',
  'SUP',
  'SUB',
  'PRE',
  'CODE',
  'BLOCKQUOTE',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'UL',
  'OL',
  'LI',
  'TABLE',
  'THEAD',
  'TBODY',
  'TFOOT',
  'TR',
  'TH',
  'TD',
  'HR',
  'BR',
  'IMG',
  'FIGURE',
  'FIGCAPTION',
])
const printClasses = new Set([
  'inkkit-callout',
  'inkkit-callout-title',
  'inkkit-callout-body',
  'inkkit-print-footnote',
  'inkkit-print-task-marker',
  'inkkit-print-diagram',
])

function safeLink(value: string): string | undefined {
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return undefined
  const href = value.trim()
  if (!href) return undefined
  // A colon in the first path component denotes a scheme, including an
  // obfuscated one. Relative paths can still contain colons after a slash.
  if (/^[^/?#]*:/.test(href) && !/^(https?:|mailto:)/i.test(href))
    return undefined
  return href.replaceAll(' ', '%20')
}

function cleanSemantics(
  container: HTMLElement,
  localIDs: ReadonlySet<string>,
): void {
  for (const element of container.querySelectorAll('*')) {
    if (!semanticTags.has(element.tagName)) {
      if (
        /^(SCRIPT|STYLE|LINK|META|IFRAME|OBJECT|EMBED|BUTTON|INPUT|TEXTAREA|SELECT)$/.test(
          element.tagName,
        )
      )
        element.remove()
      else element.replaceWith(...Array.from(element.childNodes))
      continue
    }
    const classes = Array.from(element.classList).filter((name) =>
      printClasses.has(name),
    )
    const href = element.tagName === 'A' ? element.getAttribute('href') : null
    const src = element.tagName === 'IMG' ? element.getAttribute('src') : null
    const alt = element.tagName === 'IMG' ? element.getAttribute('alt') : null
    const width =
      element.tagName === 'IMG' ? element.getAttribute('width') : null
    const title = element.getAttribute('title')
    const id = element.getAttribute('id')
    const order =
      element.tagName === 'OL' ? element.getAttribute('start') : null
    const alignment =
      element instanceof HTMLElement ? element.style.textAlign : ''
    for (const attribute of [...element.attributes])
      element.removeAttribute(attribute.name)
    if (classes.length) element.setAttribute('class', classes.join(' '))
    const destination = href == null ? undefined : safeLink(href)
    if (destination != null) element.setAttribute('href', destination)
    if (
      src &&
      /^data:image\/(png|jpeg|gif|webp|avif|bmp|tiff);base64,[A-Za-z0-9+/=]+$/.test(
        src,
      )
    )
      element.setAttribute('src', src)
    if (alt != null) element.setAttribute('alt', alt)
    if (width && /^\d+$/.test(width)) element.setAttribute('width', width)
    if (title) element.setAttribute('title', title)
    if (id && localIDs.has(id)) element.setAttribute('id', id)
    if (order && /^\d+$/.test(order)) element.setAttribute('start', order)
    if (
      /^(left|center|right)$/.test(alignment) &&
      /^(TH|TD)$/.test(element.tagName)
    )
      element.setAttribute('style', `text-align: ${alignment}`)
  }
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_COMMENT)
  const comments: globalThis.Node[] = []
  while (walker.nextNode()) comments.push(walker.currentNode)
  for (const comment of comments) comment.parentNode?.removeChild(comment)
}

export async function printableMarkdown(
  content: Fragment,
  schema: Schema,
  adapter: ImageAdapter | undefined,
  context: DocumentContext,
): Promise<PrintableContent> {
  content = shareableFragment(content)
  const container = document.createElement('div')
  container.innerHTML = clipboardContent(content, schema).html
  const references: { reference: string; alt: string; width: number | null }[] =
    []
  const tasks: (boolean | null)[] = []
  content.descendants((node) => {
    if (node.type.name === 'image')
      references.push({
        reference: String(node.attrs.src ?? ''),
        ...splitAlt(String(node.attrs.alt ?? '')),
      })
    if (node.type.name === 'list_item') tasks.push(node.attrs.checked ?? null)
  })
  for (const [index, item] of [...container.querySelectorAll('li')].entries()) {
    if (tasks[index] == null) continue
    const marker = document.createElement('span')
    marker.className = 'inkkit-print-task-marker'
    marker.textContent = tasks[index] ? '[x] ' : '[ ] '
    ;(item.firstElementChild?.tagName === 'P'
      ? item.firstElementChild
      : item
    ).prepend(marker)
  }
  const footnotes = new Map<string, string>()
  const localIDs = new Set<string>()
  for (const [index, definition] of [
    ...container.querySelectorAll('[data-inkkit-footnote-definition]'),
  ].entries()) {
    const identifier = definition.getAttribute(
      'data-inkkit-footnote-definition',
    )!
    const id = `inkkit-print-note-${index + 1}`
    localIDs.add(id)
    if (!footnotes.has(identifier)) footnotes.set(identifier, id)
    definition.setAttribute('id', id)
    definition.className = 'inkkit-print-footnote'
  }
  for (const reference of container.querySelectorAll(
    '[data-inkkit-footnote-reference]',
  )) {
    const id = footnotes.get(
      reference.getAttribute('data-inkkit-footnote-reference')!,
    )
    if (!id) continue
    const link = document.createElement('a')
    link.setAttribute('href', `#${id}`)
    link.textContent = reference.textContent
    reference.replaceChildren(link)
  }

  const images = new Map<Element, PortableImage>()
  for (const [index, element] of [
    ...container.querySelectorAll('img'),
  ].entries()) {
    const reference = references[index]
    try {
      if (!adapter || !reference)
        throw new Error('The authored image is unavailable.')
      const image = await validatedImage(
        await adapter.exportImage(reference.reference, { ...context }),
      )
      images.set(element, image)
      element.setAttribute('src', dataURL(image))
      element.setAttribute('alt', reference.alt)
      if (reference.width != null && reference.width > 0)
        element.setAttribute('width', String(Math.min(4096, reference.width)))
    } catch (error) {
      throw new InkKitError(
        'image-unavailable',
        error instanceof Error
          ? error.message
          : 'The authored image is unavailable.',
      )
    }
  }
  const warnings: PrintableWarning[] = []
  for (const code of container.querySelectorAll(
    'pre[data-language="mermaid"] > code',
  )) {
    const source = code.textContent ?? ''
    try {
      await renderDiagram(source)
    } catch (error) {
      const message = `${error instanceof Error ? error.message : 'This diagram could not be rendered.'} The source is printed below.`
      warnings.push({ code: 'diagram-unavailable', message })
      const warning = document.createElement('p')
      warning.textContent = message
      code.parentElement!.before(warning)
      continue
    }
    try {
      const image = await validatedImage(await diagramImage(source))
      const figure = document.createElement('figure')
      figure.className = 'inkkit-print-diagram'
      const element = document.createElement('img')
      element.setAttribute('src', dataURL(image))
      element.setAttribute('alt', 'Mermaid diagram')
      figure.append(element)
      images.set(element, image)
      code.parentElement!.replaceWith(figure)
    } catch (error) {
      throw new InkKitError(
        'diagram-unavailable',
        error instanceof Error
          ? error.message
          : 'The diagram image is unavailable.',
      )
    }
  }
  cleanSemantics(container, localIDs)
  const assets = [...container.querySelectorAll('img')].map((element) =>
    images.get(element)!,
  )
  return documentOutput(container, assets, warnings)
}
