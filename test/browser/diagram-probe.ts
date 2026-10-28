import { registerDiagram } from '../../src/mermaid'
import { renderPele } from '../../src/pele'

let renders = 0

// Browser fixtures share this renderer registration with the actual editor.
// Counting layout calls here avoids adding diagnostics to the public facade.
export function install(): void {
  renders = 0
  registerDiagram((source) => {
    renders++
    return renderPele(source)
  })
}

export function count(): number {
  return renders
}
