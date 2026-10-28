import { expect, test } from 'vitest'
import { themedDiagram } from '../src/diagram-theme'

const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50" aria-labelledby="title" aria-describedby="description" style="--_bg:var(--pele-bg,#fff);--_fg:var(--pele-fg,#111);font-family:var(--pele-font,Arial,sans-serif)">
<title id="title">A title</title><desc id="description">A description</desc>
<defs><clipPath id="clip"><rect width="10" height="10"/></clipPath></defs>
<g clip-path="url(#clip)" fill="var(--_fg)"><text>Label</text></g>
<g class="pele-slice-labels"><text>50%</text></g>
<path fill="var(--pele-series-9,#f58518)"/>
</svg>`

const parseSVG = (text: string) => {
  const template = document.createElement('template')
  template.innerHTML = text
  return template.content.querySelector('svg')!
}

test('placements have independent IDs while preserving accessible labels and geometry', () => {
  const first = parseSVG(themedDiagram(source))
  const second = parseSVG(themedDiagram(source))
  const ids = [...first.querySelectorAll('[id]')].map((node) => node.id)
  expect(
    [...second.querySelectorAll('[id]')].every(
      (node) => !ids.includes(node.id),
    ),
  ).toBe(true)
  for (const svg of [first, second]) {
    expect(svg.getAttribute('viewBox')).toBe('0 0 100 50')
    expect(svg.querySelector('title')!.id).toBe(
      svg.getAttribute('aria-labelledby'),
    )
    expect(svg.querySelector('desc')!.id).toBe(
      svg.getAttribute('aria-describedby'),
    )
    expect(svg.querySelector('[clip-path]')!.getAttribute('clip-path')).toBe(
      `url(#${svg.querySelector('clipPath')!.id})`,
    )
    expect(svg.textContent).toContain('A description')
    expect(svg.outerHTML).not.toContain('--pele-')
    expect(svg.querySelector('path')!.getAttribute('fill')).toBe(
      'var(--_inkkit-diagram-series-1,#f58518)',
    )
  }
})

test('portable colors and fonts resolve from one snapshot without inherited CSS', () => {
  const theme = {
    '--_inkkit-diagram-bg': 'rgb(255, 255, 255)',
    '--_inkkit-diagram-fg': 'rgb(28, 28, 30)',
    '--_inkkit-diagram-series-1': 'rgb(166, 213, 255)',
    '--_inkkit-diagram-font': 'Arial, sans-serif',
  }
  const result = themedDiagram(source, undefined, true, theme)
  const svg = parseSVG(result)
  expect(result).not.toContain('var(')
  expect(result).not.toContain('--_')
  expect(svg.style.fontFamily).toBe('Arial, sans-serif')
  expect(svg.style.background).toBe('rgb(255, 255, 255)')
  expect(svg.querySelector('path')!.getAttribute('fill')).toBe(
    theme['--_inkkit-diagram-series-1'],
  )
  const label = svg.querySelector('.pele-slice-labels text')!
  expect(label.getAttribute('fill')).toBe(theme['--_inkkit-diagram-fg'])
  expect(label.getAttribute('stroke')).toBe(theme['--_inkkit-diagram-bg'])
  expect(label.getAttribute('paint-order')).toBe('stroke')
  expect(source).toContain('var(--pele-series-9')
})
