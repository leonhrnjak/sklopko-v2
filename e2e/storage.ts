import type { Page } from '@playwright/test'

/** Forget everything the app keeps in the browser: local and session storage, and the library database. */
export async function clearStorage(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        localStorage.clear()
        sessionStorage.clear()
        const del = indexedDB.deleteDatabase('sklopko')
        del.onsuccess = del.onerror = del.onblocked = () => resolve()
      }),
  )
}
