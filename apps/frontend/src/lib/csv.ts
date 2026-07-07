/** Client-side CSV generation + download — no server, no object storage. */

export type CsvColumn<T> = { header: string; get: (row: T) => unknown };

// Escape a cell: quote when it contains a comma, quote, or newline; double inner quotes.
function cell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Build a CSV string from rows + column definitions. */
export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const head = columns.map((c) => cell(c.header)).join(",");
  const body = rows.map((r) => columns.map((c) => cell(c.get(r))).join(",")).join("\n");
  return `${head}\n${body}`;
}

/** Trigger a browser download of the given CSV text. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** A dated filename like "kubepilot-recommendations-2026-07-07.csv". */
export function reportFilename(kind: string): string {
  return `kubepilot-${kind}-${new Date().toISOString().slice(0, 10)}.csv`;
}
