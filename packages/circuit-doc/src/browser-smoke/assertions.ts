/** Small, dependency-free assertions shared by every browser-smoke check. */

export type Rect = { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number; readonly width: number; readonly height: number };

export function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

/** `child` lies fully inside `parent`, with a 1px tolerance for sub-pixel layout. */
export function assertContained(child: Rect, parent: Rect, label: string): void {
  const epsilon = 1;
  if (
    child.left < parent.left - epsilon ||
    child.right > parent.right + epsilon ||
    child.top < parent.top - epsilon ||
    child.bottom > parent.bottom + epsilon ||
    child.width <= 0 ||
    child.height <= 0
  ) {
    throw new Error(`${label} is not contained: child=${JSON.stringify(child)} parent=${JSON.stringify(parent)}`);
  }
}

/** A CSS `animation-duration`/`transition-duration` computed value (possibly comma-separated) is all `<= maximumSeconds`. */
export function assertDurationAtMost(value: string, maximumSeconds: number, label: string): void {
  const durations = value.split(",").map((part) => {
    const trimmed = part.trim();
    if (trimmed.endsWith("ms")) return Number.parseFloat(trimmed) / 1000;
    if (trimmed.endsWith("s")) return Number.parseFloat(trimmed);
    return Number.NaN;
  });
  if (durations.length === 0 || durations.some((duration) => !Number.isFinite(duration) || duration > maximumSeconds)) {
    throw new Error(`${label}: expected <= ${maximumSeconds}s, got ${JSON.stringify(value)}`);
  }
}
