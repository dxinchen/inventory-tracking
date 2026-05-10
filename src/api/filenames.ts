/** Strip path separators, collapse whitespace, lowercase. */
export function sanitizeFilename(name: string): string {
  return name
    .replace(/[/\\:*?"<>|]/g, '')
    .replace(/\s+/g, '-')
    .toLowerCase();
}
