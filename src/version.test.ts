import { describe, expect, it } from 'vitest'
import { appVersion } from '../scripts/version'

/** A git that answers the commands `appVersion` asks, from a table, and remembers what it was asked. */
function fakeGit(answers: Record<string, string | Error>) {
  const asked: string[] = []
  const git = (...args: string[]) => {
    const key = args.join(' ')
    asked.push(key)
    const a = Object.entries(answers).find(([k]) => key.startsWith(k))?.[1]
    if (a === undefined) throw new Error(`unexpected git ${key}`)
    if (a instanceof Error) throw a
    return a
  }
  return { git, asked }
}

describe('the version shown in the app', () => {
  it('is the version of package.json with the number of merges since it was last changed as the last number', () => {
    const { git } = fakeGit({ 'rev-parse --is-shallow-repository': 'false', 'log --first-parent': 'abc123', 'rev-list --first-parent --count abc123..HEAD': '7' })
    expect(appVersion('0.1.0', git)).toBe('0.1.7')
    expect(appVersion('2.14.5', git)).toBe('2.14.7') // only the first two numbers of package.json count
  })

  it('is x.y.0 on the commit that changes the version', () => {
    const { git } = fakeGit({ 'rev-parse --is-shallow-repository': 'false', 'log --first-parent': 'abc123', 'rev-list --first-parent --count': '0' })
    expect(appVersion('0.2.0', git)).toBe('0.2.0')
  })

  it('looks for the last change of the version line along the main line of history', () => {
    const { git, asked } = fakeGit({ 'rev-parse --is-shallow-repository': 'false', 'log --first-parent': 'abc123', 'rev-list --first-parent --count': '3' })
    appVersion('0.1.0', git)
    expect(asked[1]).toBe('log --first-parent -1 --format=%H -G^\\s*"version": -- package.json')
  })

  it('deepens a shallow clone (CI, Pages) before it counts', () => {
    const { git, asked } = fakeGit({ 'rev-parse --is-shallow-repository': 'true', 'fetch --unshallow --quiet': '', 'log --first-parent': 'abc123', 'rev-list --first-parent --count': '12' })
    expect(appVersion('0.1.0', git)).toBe('0.1.12')
    expect(asked[1]).toBe('fetch --unshallow --quiet')
  })

  it('is package.json’s version as it is where the history cannot be read', () => {
    expect(appVersion('0.1.0', fakeGit({ 'rev-parse --is-shallow-repository': new Error('not a git repository') }).git)).toBe('0.1.0')
    expect(appVersion('0.1.0', fakeGit({ 'rev-parse --is-shallow-repository': 'false', 'log --first-parent': '' }).git)).toBe('0.1.0')
  })
})
