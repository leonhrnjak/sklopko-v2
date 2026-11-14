/**
 * The last errors of this page, kept in memory only, and the "Report a problem" link built from them. Nothing is sent anywhere:
 * the link opens a new GitHub issue with the text filled in, and the person reads it and presses *Submit* (or not).
 */

const KEEP = 20
const MAX_URL = 8000
const NEW_ISSUE = 'https://github.com/leonhrnjak/sklopko-v2/issues/new'

type Logged = { time: string; message: string }
const errors: Logged[] = []

/** Remember one error (an `Error`, a rejection reason or any value); only the last 20 are kept. */
export function recordError(value: unknown): void {
  const message = value instanceof Error ? `${value.name}: ${value.message}\n${value.stack ?? ''}` : String(value)
  errors.push({ time: new Date().toISOString(), message: message.slice(0, 1000) })
  if (errors.length > KEEP) errors.shift()
}

export const recentErrors = (): readonly Logged[] => errors

export function clearErrors(): void {
  errors.length = 0
}

let installed = false
/** Listen for uncaught errors and unhandled rejections. Safe to call twice. */
export function installErrorLog(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('error', (e) => recordError(e.error ?? e.message))
  window.addEventListener('unhandledrejection', (e) => recordError(e.reason))
}

export type ReportInfo = { version: string; commit: string; browser: string; page: string }

/** The address of a new GitHub issue with the version, build, browser, page and recent errors in it (under 8,000 characters). */
export function reportUrl(info: ReportInfo, list: readonly Logged[] = errors): string {
  const build = (shown: readonly Logged[]) => {
    const body = [
      'Describe what happened and what you expected:',
      '',
      '',
      '---',
      `Version: ${info.version}${info.commit ? ` (${info.commit})` : ''}`,
      `Browser: ${info.browser}`,
      `Page: ${info.page}`,
      '',
      shown.length ? `Recent errors (${shown.length}):` : 'No errors were recorded.',
      ...shown.map((e) => '```\n' + e.time + ' ' + e.message + '\n```'),
    ].join('\n')
    return `${NEW_ISSUE}?title=${encodeURIComponent('Problem: ')}&body=${encodeURIComponent(body)}`
  }
  let shown = list.slice(-KEEP)
  let url = build(shown)
  // Drop the oldest errors until it fits, then shorten the rest.
  while (url.length > MAX_URL && shown.length > 1) url = build((shown = shown.slice(1)))
  if (url.length > MAX_URL) url = build(shown.map((e) => ({ ...e, message: e.message.slice(0, 300) })))
  if (url.length > MAX_URL) url = build([])
  return url
}

/** Where the person is, without the part of the address that holds a circuit. */
export function currentReportInfo(): ReportInfo {
  return { version: __APP_VERSION__, commit: __APP_COMMIT__, browser: navigator.userAgent, page: location.pathname }
}

export function openReport(): void {
  window.open(reportUrl(currentReportInfo()), '_blank', 'noopener')
}
