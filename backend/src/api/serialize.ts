export function serializeBigInts<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString() : v)));
}
