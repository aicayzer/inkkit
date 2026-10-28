import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function fixtureMode(value = process.env.INKKIT_BROWSER_FIXTURE) {
  if (value === undefined || value === '') return undefined
  if (value !== 'dev' && value !== 'built')
    throw Error('INKKIT_BROWSER_FIXTURE must be dev or built')
  return value
}

export async function startFixture({
  mode = fixtureMode(),
  port = Number(process.env.INKKIT_PLAYGROUND_PORT ?? 4178),
  vite,
} = {}) {
  if (mode !== 'dev' && mode !== 'built')
    throw Error('Select INKKIT_BROWSER_FIXTURE=dev or built')
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw Error('INKKIT_PLAYGROUND_PORT must be a port number')
  vite ??= await import('vite')
  const started = performance.now()
  const config = {
    configFile: fileURLToPath(
      new URL('../vite.browser.config.mjs', import.meta.url),
    ),
  }
  const address = { host: '127.0.0.1', port, strictPort: true }
  const report = (event) =>
    console.log(
      `[browser-fixture] ${JSON.stringify({ event, mode, elapsedMs: performance.now() - started })}`,
    )
  let server
  if (mode === 'built') {
    // A failed build must never serve a previous candidate's output.
    await vite.build(config)
    report('built')
    server = await vite.preview({ ...config, preview: address })
  } else {
    server = await vite.createServer({ ...config, server: address })
    await server.listen()
  }
  report('ready')
  return server
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await startFixture({
    port: Number(process.argv[2] ?? process.env.INKKIT_PLAYGROUND_PORT ?? 4178),
  })
}
