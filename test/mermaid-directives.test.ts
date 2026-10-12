import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
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

const refusal = /actions, resources/

async function refusedBeforeRendering(diagram: string, message?: RegExp) {
  const render = vi.spyOn(mermaid, 'render')
  await expect(renderDiagram(diagram)).rejects.toThrow(message)
  expect(render).not.toHaveBeenCalled()
}

const accepted = [
  'flowchart LR\nA --> B',
  'graph TD\nA --> B',
  'sequenceDiagram\nAlice->>Bob: Hello',
  'classDiagram\nclass A',
  'stateDiagram-v2\n[*] --> A',
  'stateDiagram\n[*] --> A',
  'erDiagram\nA ||--|| B : owns',
  'pie\n"A" : 1',
  'flowchart TD\nA[Click to upload image] --> B',
  'flowchart TD\nA[Style guide] --> B[Link icon]',
  'graph TD\nA[icon] --> B[href] --> C[callback]',
  'flowchart TD\nA["classDef and linkStyle"] --> B',
  'flowchart TD\nA -- click here --> B',
  'flowchart TD\nA -->|Click me| B',
  'flowchart TD\nA{Link broken?} --> B{{Image}}',
  'flowchart TD\nsubgraph Style guide\nA --> B\nend',
  'flowchart TD\nA["Fontawesome icons"] --> B\n%% click the link, style it',
  'flowchart TD\nA["First line\nstyle guide"] --> B',
  'flowchart TD\nA((Round)) --> B>Flag] --> C[(Store)] --> D[/Lean/]',
  'flowchart TD\nA:::warn --> B\nclass B warn',
  'sequenceDiagram\nA->>B: Send link',
  'sequenceDiagram\nparticipant A as Image service\nNote over A,B: click the style icon',
  'sequenceDiagram\nLink->>Bob: Hello',
  'sequenceDiagram\nrect rgb(200, 220, 255)\nA->>B: Inside\nend\nbox Aqua Group\nparticipant C\nend',
  'classDiagram\nclass Account {\n+String icon\n+String link\n}\nAccount --> Account : click',
  'classDiagram\nclass Style\nclass Link\nStyle --> Link',
  'classDiagram\nnamespace Shop {\nclass Cart\n}\nnote for Cart "click the link"',
  'classDiagram\nclass A:::warn\ncssClass "A" warn',
  'stateDiagram-v2\nstate "Click to start" as S\nS --> T : style guide\nS : image icon href',
  'stateDiagram-v2\nstate Busy {\nA --> B\n}\nnote right of A : style note',
  'stateDiagram-v2\nA:::warn --> B\nclass B warn',
  'erDiagram\nA ||--|| B : "Click link"\nA {\nstring link\nstring style\n}',
  'erDiagram\nA:::warn ||--|| B : has',
  'pie title Style guide\n"click" : 1\n"link" : 2\n"image" : 3',
  'flowchart TD\nA[CLICK] --> B[LINKSTYLE]',
]

for (const diagram of accepted)
  test(`renders directive words and plain syntax with Mermaid: ${diagram.replace(/\n/g, ' | ')}`, async () => {
    const svg = await renderDiagram(diagram)
    expect(svg).toMatch(/^<svg[\s\S]*<style>/)
  })

const refused: [string, string][] = [
  [
    'a style statement in a flowchart',
    'flowchart TD\nA --> B\nstyle A fill:#f0e',
  ],
  [
    'a style statement on a subgraph',
    'flowchart TD\nsubgraph s\nA --> B\nend\nstyle s fill:#f0e',
  ],
  [
    'a class definition in a flowchart',
    'flowchart TD\nA --> B\nclassDef c fill:#f0e',
  ],
  [
    'an unused class definition in a flowchart',
    'flowchart TD\nA --> B\nclassDef c stroke:#f0e',
  ],
  [
    'a link style in a flowchart',
    'flowchart TD\nA --> B\nlinkStyle 0 stroke:#f00',
  ],
  [
    'a default link style in a flowchart',
    'flowchart TD\nA --> B\nlinkStyle default stroke:#f00',
  ],
  [
    'a link curve in a flowchart',
    'flowchart TD\nA --> B\nlinkStyle default interpolate basis',
  ],
  [
    'a click callback in a flowchart',
    'flowchart TD\nA --> B\nclick A callback',
  ],
  ['a click call in a flowchart', 'flowchart TD\nA --> B\nclick A call cb()'],
  ['a click link in a flowchart', 'flowchart TD\nA --> B\nclick A "page"'],
  [
    'a click href in a flowchart',
    'flowchart TD\nA --> B\nclick A href "page" "Tip"',
  ],
  [
    'a click tooltip before its node',
    'flowchart TD\nclick X cb "Tip"\nX --> B',
  ],
  [
    'a style statement after a semicolon',
    'flowchart TD\nA --> B;style A fill:#f0e',
  ],
  ['a style statement after the header', 'flowchart TD;style A fill:#f0e'],
  [
    'a style statement after a subgraph end',
    'flowchart TD\nsubgraph s\nend style s fill:#f0e',
  ],
  [
    'a style statement after carriage returns',
    'flowchart TD\nA --> B\r\rstyle A fill:#f0e',
  ],
  [
    'a style statement in a state diagram',
    'stateDiagram-v2\nA --> B\nstyle A fill:#f0e',
  ],
  [
    'a class definition in a state diagram',
    'stateDiagram-v2\nA --> B\nclassDef c fill:#f0e\nclass A c',
  ],
  [
    'a click link in a state diagram',
    'stateDiagram-v2\nA --> B\nclick A "page" "Tip"',
  ],
  [
    'a click href in a state diagram',
    'stateDiagram-v2\nA --> B\nclick A href "page"',
  ],
  [
    'a style statement inside a composite state',
    'stateDiagram-v2\nstate Busy {\nA\nstyle A fill:#f0e\n}',
  ],
  [
    'a class definition inside a composite state',
    'stateDiagram-v2\nstate Busy { classDef c fill:red\n}',
  ],
  [
    'a style statement after a state name',
    'stateDiagram-v2\nA style A fill:#f0e',
  ],
  [
    'a style statement after a state name in a version 1 state diagram',
    'stateDiagram\nA style A fill:#f0e',
  ],
  [
    'a class definition after a state name',
    'stateDiagram-v2\nA --> B\nA classDef c fill:#f0e\nclass A c',
  ],
  [
    'a click href after a state name',
    'stateDiagram-v2\nA --> B\nA click A href "page"',
  ],
  ...['&', ',', ':::x', ']', ')', '|', '>', '"', '~', 'subgraph X'].map(
    (prefix): [string, string] => [
      `a style statement after other state tokens (${prefix})`,
      `stateDiagram-v2\nA ${prefix} style A fill:#f0e`,
    ],
  ),
  [
    'a style statement in an ER diagram',
    'erDiagram\nA ||--|| B : has\nstyle A fill:#f0e',
  ],
  [
    'a class definition in an ER diagram',
    'erDiagram\nA ||--|| B : has\nclassDef c fill:#f0e',
  ],
  ['a style statement after an entity name', 'erDiagram\nA style A fill:#f0e'],
  [
    'a class definition after an entity name',
    'erDiagram\nA ||--|| B : x\nA classDef c fill:#f0e\nclass A c',
  ],
  ...[':::x', 'state X'].map((prefix): [string, string] => [
    `a style statement after other ER tokens (${prefix})`,
    `erDiagram\nA ||--|| B : has\nA ${prefix} style A fill:#f0e`,
  ]),
  [
    'a style statement in a class diagram',
    'classDiagram\nclass A\nstyle A fill:#f0e',
  ],
  [
    'a class definition in a class diagram',
    'classDiagram\nclass A\nclassDef c fill:#f0e',
  ],
  [
    'a click href in a class diagram',
    'classDiagram\nclass A\nclick A href "page"',
  ],
  ['a callback in a class diagram', 'classDiagram\nclass A\ncallback A "cb"'],
  ['a link in a class diagram', 'classDiagram\nclass A\nlink A "page"'],
  [
    'an actor link in a sequence diagram',
    'sequenceDiagram\nparticipant A\nlink A: Home @ page',
  ],
  [
    'actor links in a sequence diagram',
    'sequenceDiagram\nparticipant A\nlinks A: {"Home": "page"}',
  ],
  [
    'actor links at the start of a sequence diagram',
    'sequenceDiagram\nlinks A: {"Home": "page"}',
  ],
  [
    'an actor link after a parenthesis',
    'sequenceDiagram\nparticipant A\nA->>B: x\n) link A: Home @ page',
  ],
  [
    'actor links after an angle bracket',
    'sequenceDiagram\nparticipant A\nA->>B: x\n> links A: {"Home": "page"}',
  ],
  [
    'actor links after a header semicolon',
    'sequenceDiagram ;link A: Home @ page',
  ],
  [
    'actor properties in a sequence diagram',
    'sequenceDiagram\nparticipant A\nproperties A: {"class": "x"}',
  ],
]

for (const [name, diagram] of refused)
  test(`refuses ${name} before rendering`, () =>
    refusedBeforeRendering(diagram, refusal))

test('refuses diagram types outside the supported list after parsing', () =>
  refusedBeforeRendering('flowchart-elk TD\nA --> B', /not supported/))

const statements = [
  'style A fill:#f0e',
  'classDef c fill:#f0e',
  'linkStyle 0 stroke:#f00',
  'click A callback',
  'click A href "page"',
]
for (const statement of statements)
  for (const [position, build] of [
    ['at the start of a line', (s: string) => `flowchart TD\nA --> B\n${s}`],
    ['after spaces', (s: string) => `flowchart TD\nA --> B\n   ${s}`],
    ['after a tab', (s: string) => `flowchart TD\nA --> B\n\t${s}`],
    [
      'after a spaced semicolon',
      (s: string) => `flowchart TD\nA --> B ;  ${s}`,
    ],
    [
      'after a label and semicolon',
      (s: string) => `graph TD\nA[Link]-->B; ${s}`,
    ],
    ['on the header line', (s: string) => `flowchart TD ${s}`],
    ['after a carriage return', (s: string) => `flowchart TD\r\nA --> B\r${s}`],
    [
      'after comment lines',
      (s: string) => `%% note\nflowchart TD\n%% x\nA --> B\n${s}`,
    ],
    [
      'in upper case',
      (s: string) => `flowchart TD\nA --> B\n${s.toUpperCase()}`,
    ],
  ] as const)
    test(`never renders "${statement.split(' ')[0]}" ${position}`, () =>
      refusedBeforeRendering(build(statement)))

test('the directive check was verified against the installed Mermaid', () => {
  const require = createRequire(import.meta.url)
  const manifest = require.resolve('mermaid/package.json')
  const { version } = JSON.parse(readFileSync(manifest, 'utf8')) as {
    version: string
  }
  // refuseDirectives reads each diagram type's own fields; check them again
  // against the new version's parsers before changing this.
  expect(version).toBe('12.1.0')
})
