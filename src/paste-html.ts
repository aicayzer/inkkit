// Elements the HTML paste path hands to ProseMirror's parser. Anything else
// is kept as literal source, so a tag must be listed here or rewritten by
// `normalizeClipboardHTML` to avoid becoming a raw-HTML block.
const rich = new Set([
  'P',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'STRONG',
  'MARK',
  'B',
  'EM',
  'I',
  'S',
  'DEL',
  'STRIKE',
  'CODE',
  'PRE',
  'BLOCKQUOTE',
  'A',
  'BR',
  'HR',
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
  'IMG',
  'SPAN',
  'SUP',
  'DIV',
  'FONT',
  'SECTION',
  'ARTICLE',
  'MAIN',
  'HEADER',
  'FOOTER',
])
// Document furniture and form inputs hold no content of their own. A
// template never keeps `head`, so it is not listed.
const dropped = new Set(['STYLE', 'META', 'LINK', 'TITLE', 'SOURCE', 'INPUT'])
// The dialect has no underline, subscript or similar marks, so these keep
// their children and lose only the wrapper.
const unwrapped = new Set([
  'U',
  'SUB',
  'SMALL',
  'TIME',
  'ABBR',
  'CITE',
  'DFN',
  'VAR',
  'INS',
  'BDI',
  'BDO',
  'LABEL',
])
const blockWrappers = new Set(['FIGURE', 'FIGCAPTION', 'DL', 'DD'])
const handled = new Set([
  ...dropped,
  ...unwrapped,
  ...blockWrappers,
  'DT',
  'PICTURE',
])

export function isRichElement(element: Element): boolean {
  return rich.has(element.tagName)
}

/**
 * Rewrites common web-page elements to ones the importer already understands.
 * Elements that will stay literal source are not entered, so their content is
 * preserved exactly.
 */
export function normalizeClipboardHTML(root: Node): void {
  for (const node of [...root.childNodes]) {
    if (node.nodeType === Node.COMMENT_NODE) {
      // Windows and some native apps leave the CF_HTML fragment markers in.
      if (/^\s*(?:Start|End)Fragment\s*$/.test((node as Comment).data))
        node.parentNode?.removeChild(node)
      continue
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue
    const element = node as Element
    const tag = element.tagName
    if (!rich.has(tag) && !handled.has(tag)) continue
    if (dropped.has(tag)) {
      element.remove()
    } else if (tag === 'PICTURE') {
      const image = element.querySelector('img')
      if (image) element.replaceWith(image)
      else element.remove()
    } else if (unwrapped.has(tag)) {
      normalizeClipboardHTML(element)
      element.replaceWith(...element.childNodes)
    } else if (tag === 'DT') {
      normalizeClipboardHTML(element)
      tidy(element)
      if (!hasContent(element)) element.remove()
      else {
        // Markdown has no definition lists. A bold term over its definition
        // keeps which text names the other.
        const term = element.ownerDocument.createElement('p')
        const strong = element.ownerDocument.createElement('strong')
        strong.append(...element.childNodes)
        term.append(strong)
        element.replaceWith(term)
      }
    } else if (blockWrappers.has(tag)) {
      normalizeClipboardHTML(element)
      if (tag === 'FIGCAPTION' || tag === 'DD') tidy(element)
      else
        // Source indentation between a figure's or list's parts would
        // otherwise join the image's paragraph as stray spaces.
        for (const child of [...element.childNodes])
          if (child.nodeType === Node.TEXT_NODE && !child.textContent?.trim())
            child.remove()
      const block = element.ownerDocument.createElement('div')
      block.append(...element.childNodes)
      element.replaceWith(block)
    } else {
      if (tag === 'LI') markTask(element)
      normalizeClipboardHTML(element)
    }
  }
}

function hasContent(element: Element): boolean {
  return !!element.textContent?.trim() || !!element.querySelector('img')
}

// GitHub, Notion and similar pages render a task as a checkbox leading its
// list item, optionally inside a paragraph or label.
function leadingCheckbox(item: Element): Element | undefined {
  let node: Element = item
  for (;;) {
    const first = [...node.childNodes].find(
      (child) =>
        child.nodeType !== Node.COMMENT_NODE &&
        !(child.nodeType === Node.TEXT_NODE && !child.textContent?.trim()),
    )
    if (first?.nodeType !== Node.ELEMENT_NODE) return undefined
    const element = first as Element
    if (element.tagName === 'INPUT')
      return element.getAttribute('type')?.toLowerCase() === 'checkbox'
        ? element
        : undefined
    if (!['P', 'LABEL', 'DIV', 'SPAN'].includes(element.tagName))
      return undefined
    node = element
  }
}

function markTask(item: Element): void {
  const checkbox = leadingCheckbox(item)
  if (!checkbox) return
  item.setAttribute('data-item-type', 'task')
  item.setAttribute('data-checked', String(checkbox.hasAttribute('checked')))
  checkbox.remove()
  tidy(item)
}

// Pretty-printed source indents and breaks lines inside elements that the
// importer would otherwise keep as literal spaces.
function tidy(element: Element): void {
  const walker = element.ownerDocument.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
  )
  while (walker.nextNode()) {
    const text = walker.currentNode as Text
    if (!text.parentElement?.closest('pre,code'))
      text.data = text.data.replace(/[ \t\r\n\f]+/g, ' ')
  }
  trimEdge(element, 'start')
  trimEdge(element, 'end')
}

function trimEdge(element: Element, side: 'start' | 'end'): void {
  for (;;) {
    const edge = side === 'start' ? element.firstChild : element.lastChild
    if (!edge) return
    if (edge.nodeType === Node.TEXT_NODE) {
      const text = edge as Text
      text.data = side === 'start' ? text.data.trimStart() : text.data.trimEnd()
      if (text.data) return
      text.remove()
    } else if (
      edge.nodeType === Node.ELEMENT_NODE &&
      ['SPAN', 'STRONG', 'EM', 'B', 'I', 'A', 'P', 'LABEL'].includes(
        (edge as Element).tagName,
      )
    ) {
      trimEdge(edge as Element, side)
      if ((edge as Element).childNodes.length) return
      edge.remove()
    } else return
  }
}
