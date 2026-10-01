export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  const mb = n / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/** "4.2 MB → 1.1 MB, 74% smaller" (or no percentage when the file did not shrink). */
export function resultLine(input: number, output: number): string {
  const base = `${formatBytes(input)} → ${formatBytes(output)}`;
  const pct = Math.round((1 - output / input) * 100);
  return input > 0 && pct >= 1 ? `${base}, ${pct}% smaller` : base;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}
