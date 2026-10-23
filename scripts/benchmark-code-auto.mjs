import { common, createLowlight } from 'lowlight'
import os from 'node:os'

const lowlight = createLowlight(common)
const cases = {
  javascript: 'const café = {name: "InkKit", count: 42};\n'
    .repeat(20)
    .slice(0, 500),
  plain: 'ordinary plain words '.repeat(30).slice(0, 500),
  longWord: 'a'.repeat(500),
  punctuation: '({[<>"\'\\*/;:_-+=!?'.repeat(40).slice(0, 500),
}
console.log(os.hostname(), os.cpus()[0].model, process.version)
console.log('Common grammars:', lowlight.listLanguages().length)
for (const [name, text] of Object.entries(cases)) {
  const results = {}
  for (const mode of ['explicit', 'auto']) {
    const times = []
    for (let index = 0; index < 25; index++) {
      const begin = performance.now()
      if (mode === 'auto') lowlight.highlightAuto(text)
      else lowlight.highlight('javascript', text)
      if (index >= 5) times.push(performance.now() - begin)
    }
    times.sort((a, b) => a - b)
    results[mode] = { median: times[10], max: times.at(-1) }
  }
  console.log(name, JSON.stringify(results))
}
