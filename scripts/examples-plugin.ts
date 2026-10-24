import { createServer, type Plugin, type ViteDevServer } from 'vite'

const TYPES = { json: 'application/json', svg: 'image/svg+xml' } as const

interface ExampleModule {
  exampleIds(): string[]
  exampleFiles(id: string): { json: string; svg: string } | undefined
}

/** Load the module that makes the files through Vite itself, so it reads the app's TypeScript as the app does. */
async function load(server: ViteDevServer) {
  return (await server.ssrLoadModule('/src/model/example-files.ts')) as ExampleModule
}

/**
 * Runs the examples' builders when the site is built and writes `examples/<id>.json` and `examples/<id>.svg` next to the app,
 * so the app fetches a ready circuit instead of building and routing one. The dev server makes the same files on request.
 * Nothing generated is checked in, so the files cannot go stale.
 */
export function examplesPlugin(): Plugin {
  return {
    name: 'sklopko-examples',
    configureServer(server) {
      server.middlewares.use('/examples', async (req, res, next) => {
        const m = /^\/([a-z0-9-]+)\.(json|svg)$/.exec((req.url ?? '').split('?')[0])
        const files = m && (await load(server)).exampleFiles(m[1])
        if (!m || !files) return next()
        res.setHeader('Content-Type', TYPES[m[2] as 'json' | 'svg'])
        res.setHeader('Cache-Control', 'no-cache')
        res.end(files[m[2] as 'json' | 'svg'])
      })
    },
    async generateBundle() {
      // A throw-away server with no HTTP port, only to load the app's modules.
      const server = await createServer({
        configFile: false,
        appType: 'custom',
        logLevel: 'silent',
        server: { middlewareMode: true, hmr: false, watch: null },
        optimizeDeps: { noDiscovery: true },
      })
      try {
        const { exampleIds, exampleFiles } = await load(server)
        for (const id of exampleIds()) {
          const files = exampleFiles(id)!
          this.emitFile({ type: 'asset', fileName: `examples/${id}.json`, source: files.json })
          this.emitFile({ type: 'asset', fileName: `examples/${id}.svg`, source: files.svg })
        }
      } finally {
        await server.close()
      }
    },
  }
}
