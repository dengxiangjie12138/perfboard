/** Friendly text only. Keep canonical paths unchanged for storage and commands. */
export function formatDisplayPath(path: string): string {
  const verbatimPrefix = '\\\\?\\';
  if (!path.startsWith(verbatimPrefix)) return path;
  const remainder = path.slice(verbatimPrefix.length);
  if (/^[a-z]:\\/i.test(remainder)) return remainder;
  if (/^UNC\\[^\\]+\\[^\\]+(?:\\|$)/i.test(remainder)) {
    return '\\\\' + remainder.slice(4);
  }
  return path;
}
