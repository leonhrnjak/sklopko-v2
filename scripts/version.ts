/**
 * The version shown in the app, `MAJOR.MINOR.PATCH`. `package.json`'s version holds the first two numbers, which are changed by hand
 * when a larger feature is started (and its patch number, 0). The third is built, not stored: the number of commits on the main
 * line of the history since the commit that last changed `package.json`'s version. Each merge to `main` is one more, a PR never has
 * to bump anything, and parallel PRs never conflict on `package.json`. The merge that bumps the version is `x.y.0`.
 *
 * `git` runs one git command (its arguments) and returns what it printed. A shallow clone (CI, Cloudflare Pages) is deepened first;
 * where the history cannot be read, the version is `package.json`'s as it is.
 */
export function appVersion(pkgVersion: string, git: (...args: string[]) => string): string {
  try {
    if (git('rev-parse', '--is-shallow-repository') === 'true') git('fetch', '--unshallow', '--quiet')
    const bump = git('log', '--first-parent', '-1', '--format=%H', '-G^\\s*"version":', '--', 'package.json')
    if (!bump) return pkgVersion
    const [major, minor] = pkgVersion.split('.')
    return `${major}.${minor}.${Number(git('rev-list', '--first-parent', '--count', `${bump}..HEAD`))}`
  } catch {
    return pkgVersion
  }
}
