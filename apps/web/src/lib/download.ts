// How long the object URL stays alive after the click. Safari starts the download asynchronously and fails it when
// the URL is already revoked; FileSaver.js waits 40 seconds for the same reason.
export const REVOKE_DELAY_MS = 40_000;

/** Hands the blob to the browser to save under the given file name. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}
