import DOMPurify from 'dompurify'
import { parse, render, type DiagramModel } from 'pele'
import {
  diagramRefusal,
  stateBrackets,
  validateDiagram,
} from './diagram-validation'

const cssResource =
  /url\s*\(\s*[^#\s]|(?:image-set|cross-fade|image|element|src)\s*\(/i

const clickable = (classes: string | string[]): boolean =>
  (Array.isArray(classes) ? classes : classes.split(/\s+/)).includes(
    'clickable',
  )

function walk(
  value: unknown,
  visit: (entry: Record<string, unknown>) => boolean | void,
  seen = new Set<object>(),
): boolean {
  if (typeof value !== 'object' || value === null || seen.has(value))
    return false
  seen.add(value)
  if (visit(value as Record<string, unknown>)) return true
  return Object.values(value).some((child) => walk(child, visit, seen))
}

// Keep the policy on parsed statements: a label may legitimately contain words
// such as style, click or link. Class names without definitions remain allowed.
function refuseDirectives(model: DiagramModel): void {
  let refused: boolean
  switch (model.type) {
    case 'flowchart':
      refused =
        model.classes.size > 0 ||
        model.tooltips.size > 0 ||
        Boolean(model.defaultEdgeStyle?.length) ||
        model.defaultInterpolate !== undefined ||
        [...model.nodes.values()].some(
          (node) =>
            node.styles.length > 0 ||
            Boolean(node.link || node.icon || node.img) ||
            clickable(node.classes),
        ) ||
        model.edges.some(
          (edge) =>
            Boolean(edge.style?.length) ||
            edge.interpolate !== undefined ||
            clickable(edge.classes),
        ) ||
        model.subgraphs.some((graph) => clickable(graph.classes))
      break
    case 'class':
      refused =
        model.styleClasses.size > 0 ||
        [...model.classes.values()].some(
          (node) =>
            node.styles.length > 0 ||
            Boolean(node.link || node.haveCallback || node.tooltip) ||
            clickable(node.cssClasses),
        )
      break
    case 'state':
      refused =
        model.classes.size > 0 ||
        model.links.size > 0 ||
        walk(model.rootDoc, (entry) =>
          ['style', 'classDef', 'click'].includes(String(entry.stmt)),
        ) ||
        [...model.states.values()].some((state) =>
          Boolean(state.styles?.length || state.textStyles?.length),
        )
      break
    case 'er':
      refused =
        model.classes.size > 0 ||
        [...model.entities.values()].some(
          (entity) => entity.cssStyles.length > 0,
        ) ||
        model.subgraphs.some((graph) => graph.cssStyles.length > 0)
      break
    case 'sequence':
      refused = [...model.actors.values()].some(
        (actor) => actor.links.size > 0 || actor.properties.size > 0,
      )
      break
    case 'pie':
      refused = false
      break
    default:
      throw new Error(
        'This diagram type is not supported. The source is retained.',
      )
  }
  if (refused) throw new Error(diagramRefusal)
}

function refuseStrayAnnotations(
  model: DiagramModel,
  source: string,
  names: string[],
): void {
  if (names.length === 0) return
  const expected = [...names]
  const parsed: string[] = []
  if (model.type === 'class') {
    for (const node of model.classes.values()) parsed.push(...node.annotations)
  } else if (model.type === 'state') {
    walk(model.rootDoc, ({ stmt, type }) => {
      if (stmt === 'state' && /^(?:fork|join|choice)$/.test(String(type)))
        parsed.push(String(type))
    })
    for (const [, name] of source.matchAll(stateBrackets))
      expected.push(name!.toLowerCase())
  } else throw new Error(diagramRefusal)
  if (parsed.sort().join('\n') !== expected.sort().join('\n'))
    throw new Error(diagramRefusal)
}

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

let sequence = 0

export function renderPele(source: string): string {
  const { names } = validateDiagram(source)
  const model = parse(source, { limit: 30000, maxEdges: 500 })
  if (model.mermaidType === 'flowchart-elk')
    throw new Error(
      'This diagram type is not supported. The source is retained.',
    )
  refuseDirectives(model)
  refuseStrayAnnotations(model, source, names)
  return safeDiagramSVG(
    render(model, {
      fontFamily: 'Arial, sans-serif',
      limit: 30000,
      maxEdges: 500,
      links: false,
      images: false,
      autoDirection: false,
      idPrefix: `inkkit-diagram-${++sequence}`,
    }).svg,
  )
}
