/** Save a blob as a file download. */
export function downloadBlob(filename: string, blob: Blob) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

/** Save text as a file download. */
export function downloadText(filename: string, text: string, type = 'text/plain') {
  downloadBlob(filename, new Blob([text], { type }))
}

/** Ask for a text file and read it. Resolves to null if the person cancels (or the browser doesn't say). */
export function openTextFile(accept: string): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.onchange = async () => {
      const file = input.files?.[0]
      resolve(file ? { name: file.name, text: await file.text() } : null)
    }
    input.oncancel = () => resolve(null)
    input.click()
  })
}
