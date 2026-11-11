import type { Plugin } from 'vite'

/**
 * Tells the browser at the top of `index.html` what the start-up needs, so the downloads begin together instead of one after
 * another as each script asks for the next: `modulepreload` for the chunks `src/main.tsx` loads with import() (and what they
 * import), and `preload` for the WebAssembly module, which `installEngine` fetches.
 * The chunks are found the way `scripts/check-bundle.mjs` finds them: the entry's dynamic imports with their static imports.
 */
export function preloadPlugin(): Plugin {
  return {
    name: 'sklopko-preload',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const bundle = ctx.bundle
        if (!bundle) return html
        const entry = Object.values(bundle).find((f) => f.type === 'chunk' && f.isEntry)
        if (!entry || entry.type !== 'chunk') return html
        const chunks = new Set<string>()
        const add = (name: string) => {
          if (chunks.has(name)) return
          const f = bundle[name]
          if (!f || f.type !== 'chunk') return
          chunks.add(name)
          for (const dep of f.imports) add(dep)
        }
        for (const name of entry.dynamicImports) add(name)
        chunks.delete(entry.fileName)
        const already = new Set(entry.imports) // vite adds these to index.html itself
        const tags: string[] = []
        for (const name of [...chunks].sort()) if (!already.has(name)) tags.push(`    <link rel="modulepreload" crossorigin href="/${name}" />`)
        for (const f of Object.values(bundle)) {
          if (f.type === 'asset' && f.fileName.endsWith('.wasm')) tags.push(`    <link rel="preload" as="fetch" type="application/wasm" crossorigin href="/${f.fileName}" />`)
        }
        return tags.length ? html.replace('</head>', tags.join('\n') + '\n  </head>') : html
      },
    },
  }
}
