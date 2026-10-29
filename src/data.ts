/** Creates a fresh identifier for every uploaded screenshot. */
export function newScanId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `scan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
