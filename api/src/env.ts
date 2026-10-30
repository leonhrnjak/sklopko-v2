/** What the Worker is given: bindings and variables from `wrangler.toml` and the dashboard. Tests pass their own. */
export interface Env {
  DB: D1Database
  /** The build's version (`scripts/print-version.ts`), set at deploy; `dev` when not set. */
  APP_VERSION?: string
}
