/** Pure serializers: no session, key, token or environment access. */
export function csvCell(value: unknown): string {
  let text = value == null ? "" : String(value);
  // Neutralize spreadsheet formulas even behind leading whitespace/control characters.
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
export function revisionsCsv(rows: any[]): string {
  const fields = [
    "id",
    "title",
    "chapter",
    "severity",
    "workflow_status",
    "acceptance_criterion",
    "recommendation",
    "due_at",
  ];
  return (
    "\ufeff" +
    [
      fields.map(csvCell).join(","),
      ...rows.map((r) => fields.map((f) => csvCell(r[f])).join(",")),
    ].join("\r\n")
  );
}
export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
export function reportHtml(metadata: any): string {
  const e = escapeHtml;
  return `<!doctype html><html lang="id"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Laporan BimbingTA</title><style>body{font:14px system-ui;max-width:900px;margin:30px auto;padding:20px}article{break-inside:avoid;border-bottom:1px solid #ccc;padding:12px 0}p{white-space:pre-wrap;overflow-wrap:anywhere}@media print{body{margin:0}}</style><h1>${e(metadata.project.title)}</h1><p>Ekspor ${e(metadata.exported_at)} · Visual naskah: Not assessed</p><h2>Revisi</h2>${metadata.findings.map((r: any) => `<article><h3>${e(r.title)}</h3><p>${e(r.severity)} · ${e(r.workflow_status)}</p><p>Masalah: ${e(r.reason)}</p><p>Saran: ${e(r.recommendation)}</p><p>Kriteria: ${e(r.acceptance_criterion)}</p><p>Bukti: ${e(r.revision_proof ? JSON.stringify(r.revision_proof) : "Belum diajukan")}</p></article>`).join("")}<h2>Pertemuan</h2>${metadata.meetings.map((m: any) => `<article><h3>${e(m.title)}</h3><p>${e(m.meeting_at)}</p><p>Keputusan: ${e(m.decisions)}</p><p>Target: ${e(m.next_targets)}</p></article>`).join("")}<h2>Naskah</h2>${metadata.versions.map((v: any) => `<p>v${e(v.sequence)} · ${e(v.file_name)} · ${e(v.status)}</p>`).join("")}</html>`;
}
function icsEscape(v: string): string {
  return v
    .replaceAll("\\", "\\\\")
    .replaceAll("\r", "")
    .replaceAll("\n", "\\n")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,");
}
function stamp(v: string | Date): string {
  return new Date(v)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}
/** RFC 5545 folds by UTF-8 octets rather than JS character count. */
function fold(line: string): string {
  const chunks: string[] = [];
  let current = "",
    size = 0;
  for (const c of line) {
    const n = new TextEncoder().encode(c).length;
    if (size + n > 75) {
      chunks.push(current);
      current = " ";
      size = 1;
    }
    current += c;
    size += n;
  }
  chunks.push(current);
  return chunks.join("\r\n");
}
export function meetingIcs(m: any, now = new Date()): string {
  const desc = [
    m.agenda,
    m.decisions && `Keputusan: ${m.decisions}`,
    m.next_targets && `Target: ${m.next_targets}`,
  ]
    .filter(Boolean)
    .join("\n");
  return (
    [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//BimbingTA//Bimbingan//ID",
      "CALSCALE:GREGORIAN",
      "BEGIN:VEVENT",
      `UID:${icsEscape(m.id)}@bimbingta`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART:${stamp(m.meeting_at)}`,
      `DTEND:${stamp(new Date(new Date(m.meeting_at).getTime() + m.duration_min * 60000))}`,
      `SUMMARY:${icsEscape(m.title)}`,
      `DESCRIPTION:${icsEscape(desc)}`,
      ...(m.meeting_url ? [`URL:${icsEscape(m.meeting_url)}`] : []),
      "END:VEVENT",
      "END:VCALENDAR",
    ]
      .map(fold)
      .join("\r\n") + "\r\n"
  );
}

export function safeHttps(value: string): string {
  const trimmed = value.trim();
  if (/[\u0000-\u0020\u007f]/.test(trimmed))
    throw new Error("Tautan tidak boleh berisi spasi atau karakter kontrol.");
  const url = new URL(trimmed);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("Gunakan tautan HTTPS tanpa nama pengguna/password.");
  return url.href;
}
