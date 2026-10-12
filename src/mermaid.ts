import { editorLabels } from './labels'
import DOMPurify from 'dompurify'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { InkKitError, type PortableImage } from './types'

export function isMermaid(node: ProseNode): boolean {
  return node.type.name === 'code_block' && node.attrs.language === 'mermaid'
}

const refusal =
  'HTML, styles, actions, resources and diagram configuration are disabled. The source is retained.'

// CSS functions that can load an image or display another element. Mermaid's
// own styles use none of them apart from url() for in-document markers.
const cssResource =
  /url\s*\(\s*[^#\s]|(?:image-set|cross-fade|image|element|src)\s*\(/i

export function validateDiagram(source: string): void {
  if (source.length > 30000)
    throw new Error('The diagram exceeds the 30,000 character rendering limit.')
  if (
    !/^\s*(?:%%[^\n]*\n\s*)*(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|pie)\b/.test(
      source,
    )
  )
    throw new Error(
      'This diagram type is not supported. The source is retained.',
    )
  // Mermaid can load image bytes before sanitising its result, so resource and
  // configuration syntax is refused anywhere in the source, labels included.
  // Statements are checked separately, in Mermaid's parse result.
  if (
    /%%\{|^\s*---|<\s*[a-z!/?]|&(?:#\w+|[a-z]+);|@\{|\$\$|(?:https?|data|file|javascript|vbscript|blob):|\/\/|url\s*\(|image-set\s*\(|cross-fade\s*\(|@import|\\/im.test(
      source,
    )
  )
    throw new Error(refusal)
}

type Entry = Record<string, unknown>
interface ParsedDiagram {
  type: string
  db: unknown
}

const entries = (value: unknown): Entry[] =>
  value instanceof Map ? [...value.values()] : Array.isArray(value) ? value : []
const filled = (value: unknown): boolean =>
  value instanceof Map
    ? value.size > 0
    : Array.isArray(value)
      ? value.length > 0
      : typeof value === 'object' && value !== null
        ? Object.keys(value).length > 0
        : Boolean(value)
// In strict mode a flowchart records a click handler only as this class.
const clickable = (classes: unknown) =>
  (Array.isArray(classes) ? classes : String(classes ?? '').split(/\s+/))
    .map(String)
    .includes('clickable')

function statementIn(
  node: unknown,
  kinds: string[],
  seen = new Set(),
): boolean {
  if (typeof node !== 'object' || node === null || seen.has(node)) return false
  seen.add(node)
  if (kinds.includes(String((node as Entry).stmt))) return true
  return Object.values(node).some((value) => statementIn(value, kinds, seen))
}

// Refuses styles, class definitions, link styles, links, click handlers,
// tooltips, icons and images wherever the grammar accepted them. The names are
// those of the pinned Mermaid's diagram databases; if one is missing, the
// diagram is refused rather than passed unchecked.
function refuseDirectives({ type, db }: ParsedDiagram): void {
  const store = db as Entry
  const field = (name: string): unknown => {
    if (!(name in store))
      throw new Error(
        'The diagram could not be checked. The source is retained.',
      )
    return store[name]
  }
  const read = (name: string): unknown => {
    const accessor = field(name)
    if (typeof accessor !== 'function')
      throw new Error(
        'The diagram could not be checked. The source is retained.',
      )
    return (accessor as () => unknown).call(db)
  }
  let found: boolean
  switch (type) {
    case 'flowchart-v2': {
      const edges = read('getEdges') as Entry[] & Entry
      found =
        filled(read('getClasses')) ||
        filled(field('tooltips')) ||
        filled(edges.defaultStyle) ||
        edges.defaultInterpolate !== undefined ||
        entries(read('getVertices')).some(
          (vertex) =>
            filled(vertex.styles) ||
            Boolean(
              vertex.link || vertex.haveCallback || vertex.icon || vertex.img,
            ) ||
            clickable(vertex.classes),
        ) ||
        entries(edges).some(
          (edge) =>
            filled(edge.style) ||
            edge.interpolate !== undefined ||
            clickable(edge.classes),
        ) ||
        entries(read('getSubGraphs')).some((graph) => clickable(graph.classes))
      break
    }
    case 'stateDiagram':
      found =
        statementIn(field('rootDoc'), ['style', 'classDef', 'click']) ||
        filled(read('getClasses')) ||
        filled(read('getLinks')) ||
        entries(read('getStates')).some(
          (state) => filled(state.styles) || filled(state.textStyles),
        )
      break
    case 'classDiagram':
      found =
        filled(field('styleClasses')) ||
        entries(read('getClasses')).some(
          (node) =>
            filled(node.styles) ||
            Boolean(node.link || node.haveCallback || node.tooltip) ||
            clickable(node.cssClasses),
        )
      break
    case 'er':
      found =
        filled(read('getClasses')) ||
        entries(read('getEntities')).some((entity) =>
          filled(entity.cssStyles),
        ) ||
        entries(read('getSubGraphs')).some((graph) => filled(graph.cssStyles))
      break
    case 'sequence':
      found = entries(read('getActors')).some(
        (actor) => filled(actor.links) || filled(actor.properties),
      )
      break
    case 'pie':
      found = false
      break
    default:
      throw new Error(
        'This diagram type is not supported. The source is retained.',
      )
  }
  if (found) throw new Error(refusal)
}

let sequence = 0
let queue: Promise<unknown> = Promise.resolve()
const cache = new Map<string, Promise<string>>()

export function safeDiagramSVG(svg: string): string {
  const clean = DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['foreignObject', 'image', 'a', 'script', 'animate', 'set'],
    FORBID_ATTR: ['href', 'xlink:href'],
  })
  const template = document.createElement('template')
  template.innerHTML = clean
  const root = template.content.querySelector('svg')
  if (!root) throw new Error('The renderer did not produce a diagram.')
  for (const element of [root, ...root.querySelectorAll('*')]) {
    for (const attribute of [...element.attributes]) {
      if (
        /^on/i.test(attribute.name) ||
        /(?:https?|data|file|javascript|blob):|@import|\\/i.test(
          attribute.value,
        ) ||
        cssResource.test(attribute.value)
      )
        element.removeAttribute(attribute.name)
    }
    if (
      element.tagName.toLowerCase() === 'style' &&
      (/@import|(?:https?|data|file):|\\/i.test(element.textContent ?? '') ||
        cssResource.test(element.textContent ?? ''))
    )
      element.remove()
  }
  root.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  return root.outerHTML
}

export function renderDiagram(source: string): Promise<string> {
  try {
    validateDiagram(source)
  } catch (error) {
    return Promise.reject(error)
  }
  const previous = cache.get(source)
  if (previous) return previous
  const rendered = queue.then(async () => {
    const { default: mermaid } = await import('mermaid')
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      htmlLabels: false,
      suppressErrorRendering: true,
      fontFamily: 'Arial, sans-serif',
      altFontFamily: 'Arial, sans-serif',
      layout: 'dagre',
      look: 'classic',
      theme: 'default',
      maxTextSize: 30000,
      maxEdges: 500,
      flowchart: { htmlLabels: false },
      sequence: {
        actorFontFamily: 'Arial, sans-serif',
        noteFontFamily: 'Arial, sans-serif',
        messageFontFamily: 'Arial, sans-serif',
      },
      secure: [
        'securityLevel',
        'htmlLabels',
        'theme',
        'themeCSS',
        'themeVariables',
        'fontFamily',
        'dompurifyConfig',
        'flowchart',
        'startOnLoad',
        'maxTextSize',
        'maxEdges',
        'secure',
        'altFontFamily',
        'layout',
        'look',
        'sequence',
        'class',
        'state',
        'er',
        'pie',
        'suppressErrorRendering',
      ],
    })
    // getDiagramFromText is the pinned Mermaid's own parser, which render runs
    // again on the same text; the public parse does not return the diagram. It
    // skips render's configuration step, so the two parse alike only because
    // the source check refuses %%{ directives and front matter.
    refuseDirectives(await mermaid.mermaidAPI.getDiagramFromText(source))
    // Mermaid measures text while laying out, so the holder must be attached
    // and rendered. Such a holder can load CSS resources before sanitising,
    // which is why the source and the parse result are checked first.
    const holder = document.createElement('div')
    holder.style.cssText =
      'position:fixed;left:-100000px;top:0;width:1200px;pointer-events:none'
    holder.setAttribute('aria-hidden', 'true')
    document.body.append(holder)
    try {
      const result = await mermaid.render(
        `inkkitDiagram${++sequence}`,
        source,
        holder,
      )
      return safeDiagramSVG(result.svg)
    } finally {
      holder.remove()
    }
  })
  queue = rendered.catch(() => undefined)
  cache.set(source, rendered)
  void rendered.catch(() => {
    if (cache.get(source) === rendered) cache.delete(source)
  })
  if (cache.size > 64) cache.delete(cache.keys().next().value!)
  return rendered
}

export async function diagramImage(source: string): Promise<PortableImage> {
  const svg = await renderDiagram(source)
  const parsed = new DOMParser().parseFromString(
    svg,
    'image/svg+xml',
  ).documentElement
  const bounds = (parsed.getAttribute('viewBox') ?? '')
    .split(/[\s,]+/)
    .map(Number)
  const width =
    bounds[2] || Number.parseFloat(parsed.getAttribute('width') ?? '')
  const height =
    bounds[3] || Number.parseFloat(parsed.getAttribute('height') ?? '')
  if (!(width > 0 && height > 0 && Number.isFinite(width + height)))
    throw new Error('The rendered diagram has no usable dimensions.')
  const scale = Math.min(2, 4096 / width, 4096 / height)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(width * scale))
  canvas.height = Math.max(1, Math.ceil(height * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Portable diagram output is unavailable.')
  parsed.setAttribute('width', String(width))
  parsed.setAttribute('height', String(height))
  const image = new Image()
  const url = URL.createObjectURL(
    new Blob([new XMLSerializer().serializeToString(parsed)], {
      type: 'image/svg+xml',
    }),
  )
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () =>
        reject(new Error('The diagram image could not be rendered.'))
      image.src = url
    })
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const data = canvas.toDataURL('image/png').split(',')[1]
    if (!data) throw new Error('The diagram image could not be exported.')
    return {
      bytes: Uint8Array.from(atob(data), (character) =>
        character.charCodeAt(0),
      ),
      mimeType: 'image/png',
      filename: 'diagram.png',
    }
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function mermaidPreview(onError: (error: Error) => void) {
  return $prose(
    (ctx) =>
      new Plugin({
        key: new PluginKey('mermaidPreview'),
        props: {
          decorations(state) {
            const widgets: Decoration[] = []
            state.doc.descendants((node, pos) => {
              if (!isMermaid(node)) return true
              const source = node.textContent
              widgets.push(
                Decoration.widget(
                  pos + node.nodeSize,
                  () => {
                    const preview = document.createElement('div')
                    preview.className = 'inkkit-mermaid-preview'
                    preview.contentEditable = 'false'
                    preview.textContent = editorLabels(ctx).diagramRendering
                    preview.setAttribute('role', 'status')
                    preview.setAttribute('aria-live', 'polite')
                    let active = true
                    ;(preview as HTMLElement & { cancel?: () => void }).cancel =
                      () => {
                        active = false
                      }
                    void renderDiagram(source).then(
                      (svg) => {
                        if (active) {
                          preview.innerHTML = svg
                          preview.dataset.state = 'ready'
                        }
                      },
                      (error: unknown) => {
                        if (!active) return
                        const message =
                          error instanceof Error
                            ? error.message
                            : 'The diagram could not be rendered.'
                        preview.textContent = `${editorLabels(ctx).diagramUnavailable} ${message}`
                        preview.dataset.state = 'error'
                        onError(new InkKitError('diagram-unavailable', message))
                      },
                    )
                    return preview
                  },
                  {
                    key: `mermaid:${source}`,
                    side: -1,
                    ignoreSelection: true,
                    destroy: (node) =>
                      (
                        node as HTMLElement & { cancel?: () => void }
                      ).cancel?.(),
                  },
                ),
              )
              return false
            })
            return DecorationSet.create(state.doc, widgets)
          },
        },
      }),
  )
}
