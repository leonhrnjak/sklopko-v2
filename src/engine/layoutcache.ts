import { getDef } from './registry'
import type { Layout, Params } from './types'

// Not in `layouts.ts`: the part definitions import that file (for `box`) and the registry imports them.
const layoutCache = new Map<string, Layout>()

/** Layout of a component type with given params (cached; layouts are pure). */
export function layoutOf(type: string, params: Params): Layout {
  const key = type + JSON.stringify(params)
  let l = layoutCache.get(key)
  if (!l) {
    if (layoutCache.size > 500) layoutCache.clear()
    l = getDef(type).layout(params)
    layoutCache.set(key, l)
  }
  return l
}
