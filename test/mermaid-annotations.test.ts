import { afterEach, beforeAll, expect, test, vi } from 'vitest'
import mermaid from 'mermaid'
import { renderDiagram } from '../src/mermaid'

// These cases use the pinned Mermaid itself. jsdom lays nothing out, so text
// gets a plausible size and Mermaid can complete a real render.
beforeAll(() => {
  const prototype = SVGElement.prototype as unknown as SVGTextContentElement
  prototype.getBBox = function (this: SVGElement) {
    return new DOMRect(0, 0, (this.textContent?.length ?? 1) * 8, 16)
  }
  prototype.getComputedTextLength = function (this: SVGElement) {
    return (this.textContent?.length ?? 1) * 8
  }
})

afterEach(() => {
  vi.restoreAllMocks()
})

const classAnnotations: [string, string, string][] = [
  [
    'interface in a class body',
    'classDiagram\nclass Shape {\n  <<interface>>\n  draw()\n}',
    'interface',
  ],
  [
    'abstract as a statement',
    'classDiagram\nclass Shape\n<<abstract>> Shape\nShape : area()',
    'abstract',
  ],
  [
    'service after a class name',
    'classDiagram\nclass Billing <<service>>',
    'service',
  ],
  [
    'service after a class name with a body',
    'classDiagram\nclass Billing <<service>> {\n  +charge()\n}',
    'service',
  ],
  [
    'enumeration in a class body',
    'classDiagram\nclass Colour {\n<<enumeration>>\nRED\nGREEN\n}',
    'enumeration',
  ],
  [
    'an arbitrary name',
    'classDiagram\nclass Order\n<<Entity>> Order',
    'Entity',
  ],
  [
    'an arbitrary name with a space and a hyphen',
    'classDiagram\nclass Price {\n  <<value-object type>>\n}',
    'value-object type',
  ],
  [
    'an annotation inside a namespace',
    'classDiagram\nnamespace Shop {\n  class Cart {\n    <<aggregate>>\n  }\n}',
    'aggregate',
  ],
  [
    'an annotation with carriage returns',
    'classDiagram\r\nclass Shape {\r\n<<interface>>\r\n}\r\n',
    'interface',
  ],
  [
    'annotations beside generics and relations',
    'classDiagram-v2\nclass List~T~ {\n<<interface>>\n+add(T item)\n}\nclass ArrayList~T~\nList <|.. ArrayList',
    'interface',
  ],
]

for (const [name, diagram, annotation] of classAnnotations)
  test(`renders a class diagram annotation: ${name}`, async () => {
    const svg = await renderDiagram(diagram)
    expect(svg).toMatch(/^<svg[\s\S]*<style>/)
    const group = new DOMParser()
      .parseFromString(svg, 'image/svg+xml')
      .querySelector('.annotation-group')
    expect(group?.textContent).toBe(`«${annotation}»`)
  })

const stateAnnotations: [string, string][] = [
  [
    'fork and join',
    'stateDiagram-v2\nstate Split <<fork>>\nstate Merge <<join>>\n[*] --> Split\nSplit --> A\nSplit --> B\nA --> Merge\nB --> Merge\nMerge --> [*]',
  ],
  [
    'choice',
    'stateDiagram-v2\nstate Check <<choice>>\n[*] --> Check\nCheck --> Small : n < 10\nCheck --> Large : n >= 10',
  ],
  [
    'fork in a version 1 state diagram',
    'stateDiagram\nstate Split <<fork>>\n[*] --> Split\nSplit --> A',
  ],
  [
    'join inside a composite state',
    'stateDiagram-v2\nstate Busy {\n  state Merge <<join>>\n  A --> Merge\n  B --> Merge\n}',
  ],
  [
    'upper-case choice',
    'stateDiagram-v2\nstate Check <<CHOICE>>\n[*] --> Check\nCheck --> A',
  ],
  [
    'fork beside bracket syntax',
    'stateDiagram-v2\nstate Split <<fork>>\nstate Merge [[join]]\nSplit --> A\nA --> Merge',
  ],
]

const labels: [string, string][] = [
  ['a state transition label', 'stateDiagram-v2\nA --> B : shift << 2'],
  ['a state note', 'stateDiagram-v2\nA --> B\nnote right of A : shift << 2'],
  ['a state description', 'stateDiagram-v2\nA : shift << 2'],
  ['a class relation label', 'classDiagram\nA --> B : shift << 2'],
  ['a class member statement', 'classDiagram\nA : shift << 2'],
  ['a class body member', 'classDiagram\nclass A {\n+shift << 2\n}'],
  [
    'a state annotation beside bracket syntax in a comment',
    'stateDiagram-v2\nstate Split <<fork>>\nSplit --> A\n%% later use [[join]]',
  ],
]

for (const [name, diagram] of labels)
  test(`renders angle brackets that are not an annotation in ${name}`, async () => {
    expect(await renderDiagram(diagram)).toMatch(/^<svg[\s\S]*<style>/)
  })

for (const [name, diagram] of stateAnnotations)
  test(`renders a state diagram annotation: ${name}`, async () => {
    expect(await renderDiagram(diagram)).toMatch(/^<svg[\s\S]*<style>/)
  })

const refusal = /HTML, styles/

async function refusedBeforeRendering(diagram: string) {
  const render = vi.spyOn(mermaid, 'render')
  await expect(renderDiagram(diagram)).rejects.toThrow(refusal)
  expect(render).not.toHaveBeenCalled()
}

const refused: [string, string][] = [
  [
    'an element after an annotation in a class body',
    'classDiagram\nclass Shape {\n<<interface>> <b>draw</b>\n}',
  ],
  [
    'an element in a member beside an annotation',
    'classDiagram\nclass Shape {\n<<interface>>\n<b>draw()</b>\n}',
  ],
  [
    'an element inside annotation brackets',
    'classDiagram\nclass Shape {\n<<<b>interface</b>>>\n}',
  ],
  [
    'attributes inside annotation brackets',
    'classDiagram\nclass Shape {\n<<b title=x>>\n}',
  ],
  [
    'an element directly after annotation brackets',
    'classDiagram\nclass Shape {\n<<interface>><b>x</b>\n}',
  ],
  [
    'an element in a class name after an annotation',
    'classDiagram\n<<interface>> <b>Shape</b>',
  ],
  [
    'an annotation in a class label',
    'classDiagram\nclass Shape["<<interface>>"]',
  ],
  [
    'an annotation in a note',
    'classDiagram\nclass Shape\nnote for Shape "<<interface>>"',
  ],
  [
    'an annotation-shaped line in a multi-line note',
    'classDiagram\nclass Shape\nnote for Shape "Shape\n<<interface>> Shape\n"',
  ],
  [
    'an annotation-shaped line in a multi-line note beside an annotation',
    'classDiagram\nclass Shape {\n<<interface>>\n}\nnote for Shape "Shape\n<<interface>>\n"',
  ],
  [
    'an annotation-shaped line in a multi-line accessible description',
    'classDiagram\naccDescr {\n<<interface>> Shape\n}\nclass Shape',
  ],
  [
    'an annotation in a member statement',
    'classDiagram\nShape : <<interface>>',
  ],
  [
    'text after an annotation in a class body',
    'classDiagram\nclass Shape {\n<<interface>> draw\n}',
  ],
  ['an annotation in a relation label', 'classDiagram\nA --> B : <<uses>>'],
  [
    'a class annotation in a state diagram',
    'stateDiagram-v2\nstate Shape <<interface>>',
  ],
  [
    'an element in a state name before an annotation',
    'stateDiagram-v2\nstate <b>Split</b> <<fork>>',
  ],
  [
    'an element after a state annotation',
    'stateDiagram-v2\nstate Split <<fork>> <b>x</b>',
  ],
  [
    'an annotation in a state description',
    'stateDiagram-v2\nstate "<<fork>>" as Split',
  ],
  [
    'an annotation in a transition label',
    'stateDiagram-v2\nA --> B : <<choice>>',
  ],
  [
    'an annotation in a note',
    'stateDiagram-v2\nA --> B\nnote right of A : <<fork>>',
  ],
  [
    'an annotation-shaped line in a multi-line note',
    'stateDiagram-v2\nA --> B\nnote right of A\nstate X <<fork>>\nend note',
  ],
  [
    'an annotation-shaped line in a multi-line note beside bracket syntax',
    'stateDiagram-v2\nstate Y [[fork]]\nA --> B\nnote right of A\nstate X <<fork>>\nend note',
  ],
  [
    'an annotation split by a comment',
    'classDiagram\nclass Shape\n<<%% note\ninterface>> Shape',
  ],
  [
    'an annotation with a space after its brackets',
    'classDiagram\nclass Shape\n<< interface>> Shape',
  ],
  [
    'a second annotation on one line',
    'classDiagram\nclass Shape <<interface>> <<abstract>>',
  ],
  [
    'an annotation split by a comment after a quoted label',
    'classDiagram\nclass A["x: y"] <<%% note\ninterface>>',
  ],
  [
    'an annotation split by a comment beside an annotation-shaped note line',
    'classDiagram\nclass Shape\nclass A["x: y"] <<%% note\ninterface>>\nnote for Shape "Shape\n<<interface>> Shape\n"',
  ],
  ['an annotation in a flowchart', 'flowchart TD\nA["<<interface>>"] --> B'],
  ['an annotation-shaped line in a flowchart', 'flowchart TD\n<<interface>> A'],
  ['an annotation in a sequence message', 'sequenceDiagram\nA->>B: <<create>>'],
  ['an annotation in an ER diagram', 'erDiagram\nA ||--|| B : "<<owns>>"'],
  ['an annotation in a pie chart', 'pie\n"<<slice>>" : 1'],
]

for (const [name, diagram] of refused)
  test(`refuses ${name} before rendering`, () =>
    refusedBeforeRendering(diagram))
