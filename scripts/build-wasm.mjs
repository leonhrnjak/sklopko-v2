// Builds the simulator's Rust engine (engine-rs/) to WebAssembly and puts the result at src/engine/wasm/engine.wasm, which is committed:
// `npm run build` and the deploy need no Rust. CI builds it again and fails if the committed file is not what the source gives.
//
//   npm run build:wasm            build and copy
//   npm run build:wasm -- --check  build, compare with the committed file, change nothing
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const crate = join(root, 'engine-rs')
const built = join(crate, 'target/wasm32-unknown-unknown/release/sklopko_engine.wasm')
const committed = join(root, 'src/engine/wasm/engine.wasm')
const check = process.argv.includes('--check')

// (the paths of this machine would end up in the file otherwise, and the file would differ from one machine to the next)
const flags = `--remap-path-prefix=${crate}=engine-rs --remap-path-prefix=${process.env.HOME ?? '/root'}/.cargo=cargo --remap-path-prefix=${process.env.HOME ?? '/root'}/.rustup=rustup`
try {
  execFileSync('cargo', ['build', '--release', '--target', 'wasm32-unknown-unknown', '--locked'], {
    cwd: crate,
    stdio: 'inherit',
    env: { ...process.env, RUSTFLAGS: flags },
  })
} catch (e) {
  console.error('cargo failed. It needs Rust (https://rustup.rs); the toolchain in engine-rs/rust-toolchain.toml is installed by rustup itself.')
  process.exit(e.status ?? 1)
}

if (check) {
  const same = existsSync(committed) && readFileSync(built).equals(readFileSync(committed))
  if (!same) {
    console.error('src/engine/wasm/engine.wasm is not what engine-rs/ builds to. Run `npm run build:wasm` and commit the result.')
    process.exit(1)
  }
  console.log('src/engine/wasm/engine.wasm is up to date.')
} else {
  copyFileSync(built, committed)
  console.log(`src/engine/wasm/engine.wasm: ${readFileSync(committed).length} bytes`)
}
