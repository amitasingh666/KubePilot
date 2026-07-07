// Pure digest rendering — the content a scheduled email/report contains.
export type DigestRec = { label: string; savingsUsd: number | null; kind: string | null };

export type DigestData = {
  tenantName: string;
  date: string; // YYYY-MM-DD
  totalMonthlyUsd: number;
  realizedMonthlyUsd: number;
  wasteMonthlyUsd: number;
  accuracyPct: number | null;
  topRecs: DigestRec[];
};

const usd = (n: number | null) =>
  n == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

export function renderDigestText(d: DigestData): string {
  const lines = [
    `KubePilot cost digest — ${d.tenantName} — ${d.date}`,
    ``,
    `Current monthly cost:   ${usd(d.totalMonthlyUsd)}`,
    `Realized savings / mo:  ${usd(d.realizedMonthlyUsd)}`,
    `Waste (freed requests): ${usd(d.wasteMonthlyUsd)}`,
    `Recommendation accuracy: ${d.accuracyPct == null ? "n/a" : d.accuracyPct + "%"}`,
    ``,
    `Top opportunities:`,
    ...d.topRecs.map((r, i) => `  ${i + 1}. ${r.label} — ${usd(r.savingsUsd)}/mo${r.kind ? ` (${r.kind})` : ""}`),
  ];
  return lines.join("\n");
}

export function renderDigestHtml(d: DigestData): string {
  const row = (r: DigestRec, i: number) =>
    `<tr><td style="padding:6px 12px;color:#64748b">${i + 1}</td><td style="padding:6px 12px">${r.label}</td>` +
    `<td style="padding:6px 12px;text-align:right;font-weight:600">${usd(r.savingsUsd)}/mo</td>` +
    `<td style="padding:6px 12px;color:#64748b">${r.kind ?? ""}</td></tr>`;
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;background:#0d1017;color:#e5eaf0;margin:0;padding:24px">
  <div style="max-width:640px;margin:0 auto">
    <h1 style="font-size:20px">KubePilot cost digest</h1>
    <p style="color:#94a3b8">${d.tenantName} · ${d.date}</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      <tr><td style="padding:8px 12px;color:#94a3b8">Current monthly cost</td><td style="padding:8px 12px;text-align:right;font-weight:700">${usd(d.totalMonthlyUsd)}</td></tr>
      <tr><td style="padding:8px 12px;color:#94a3b8">Realized savings / mo</td><td style="padding:8px 12px;text-align:right;font-weight:700;color:#17d4a3">${usd(d.realizedMonthlyUsd)}</td></tr>
      <tr><td style="padding:8px 12px;color:#94a3b8">Waste (freed requests)</td><td style="padding:8px 12px;text-align:right;font-weight:700;color:#eab308">${usd(d.wasteMonthlyUsd)}</td></tr>
      <tr><td style="padding:8px 12px;color:#94a3b8">Recommendation accuracy</td><td style="padding:8px 12px;text-align:right;font-weight:700">${d.accuracyPct == null ? "n/a" : d.accuracyPct + "%"}</td></tr>
    </table>
    <h2 style="font-size:15px">Top opportunities</h2>
    <table style="width:100%;border-collapse:collapse;font-size:14px">${d.topRecs.map(row).join("")}</table>
  </div></body></html>`;
}
