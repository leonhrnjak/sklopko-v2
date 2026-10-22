/**
 * Embed mode (`?embed=1`): the circuit runs and its switches work, but it can't be edited, and nothing is read from
 * or written to the visitor's saved circuit. For an iframe in a web page.
 */
let on = typeof location !== 'undefined' && new URLSearchParams(location.search).get('embed') === '1'

export const isEmbed = () => on

/** For tests. */
export const setEmbed = (value: boolean) => {
  on = value
}
