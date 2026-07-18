/** Trigger a browser download for a Blob with a sanitized filename. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const safeName = fileName
    .split('')
    .map((ch) => {
      const code = ch.charCodeAt(0);
      if (ch === '<' || ch === '>' || ch === ':' || ch === '"' || ch === '/' || ch === '\\' || ch === '|' || ch === '?' || ch === '*') {
        return '_';
      }
      if (code < 32) return '_';
      return ch;
    })
    .join('');
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = safeName;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
