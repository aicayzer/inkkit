import { resolve } from 'node:path'

export function fixtureRoutes(repository) {
  const entries = new Map([
    [`/@fs${resolve(repository, 'src/core.ts')}`, '/_test/core.js'],
    [`/@fs${resolve(repository, 'src/preserve.ts')}`, '/_test/preservation.js'],
  ])
  const redirect = (response, location) => {
    response.writeHead(307, { Location: location, 'Cache-Control': 'no-store' })
    response.end()
  }
  return {
    name: 'browser-fixture-entries',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = request.url?.split('?')[0]
        for (const [source, entry] of entries) {
          if (path === entry) return redirect(response, source)
        }
        next()
      })
    },
    configurePreviewServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = request.url?.split('?')[0] ?? ''
        const entry = entries.get(path)
        if (entry) return redirect(response, entry)
        // Never turn an unexpected source import into a filesystem read or HTML.
        if (
          path.startsWith('/@fs') ||
          (path.startsWith('/_test/') && ![...entries.values()].includes(path))
        ) {
          response.writeHead(404)
          response.end('Unknown browser fixture module')
          return
        }
        next()
      })
    },
  }
}
