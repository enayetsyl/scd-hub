/**
 * Deep-strip `__typename` keys (D-#1657). A query result reused as mutation/query input
 * carries `__typename`, which the server rejects ("Field __typename is not defined by type
 * ...Input"). Plain objects and arrays are rebuilt; Date, File/Blob, null, primitives and any
 * other class instance are returned as they are.
 */
export function stripTypename<T>(value: T): T {
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((v) => {
      const n = stripTypename(v);
      if (n !== v) changed = true;
      return n;
    });
    return (changed ? out : value) as T;
  }
  if (value === null || typeof value !== "object") return value;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;
  let changed = false;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k === "__typename") {
      changed = true;
      continue;
    }
    const n = stripTypename(v);
    if (n !== v) changed = true;
    out[k] = n;
  }
  return (changed ? out : value) as T;
}
