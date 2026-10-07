import { test } from "node:test";
import assert from "node:assert/strict";
import {
  csvCell,
  revisionsCsv,
  reportHtml,
  meetingIcs,
  safeHttps,
} from "../../src/lib/export-utils.ts";
test("CSV prevents formula execution and escapes multiline quotes", () => {
  for (const text of ["=SUM(1,2)", "  +cmd", "\t@SUM(A1)", "-123"])
    assert.ok(csvCell(text).startsWith("\"'"));
  assert.equal(csvCell('a"b\nc'), '"a""b\nc"');
  assert.ok(revisionsCsv([{ title: "normal" }]).startsWith("\ufeff"));
});
test("print report escapes HTML and script input", () => {
  const html = reportHtml({
    project: { title: "<script>alert(1)</script>" },
    exported_at: "today",
    versions: [],
    findings: [{ title: "<img onerror=evil>", recommendation: "<b>x</b>" }],
    meetings: [],
  });
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("<img"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("&lt;b&gt;"));
});
test("ICS preserves WIB instant, duration, escapes and UTF-8 folding", () => {
  const ics = meetingIcs(
    {
      id: "test",
      title: "Diskusi ; Bab, IV",
      meeting_at: "2026-10-20T10:00:00+07:00",
      duration_min: 60,
      agenda: "👩‍🎓".repeat(50) + "\nBaris kedua",
      decisions: "Ya",
      next_targets: "Bab V",
      meeting_url: "https://meet.example/a",
    },
    new Date("2026-10-01T00:00:00Z"),
  );
  assert.ok(ics.includes("DTSTART:20261020T030000Z"));
  assert.ok(ics.includes("DTEND:20261020T040000Z"));
  assert.ok(ics.includes("SUMMARY:Diskusi \\; Bab\\, IV"));
  for (const line of ics.split("\r\n"))
    assert.ok(Buffer.byteLength(line, "utf8") <= 75);
  assert.ok(ics.endsWith("\r\n"));
});

test("HTTPS URL validation rejects scripts, credentials and controls", () => {
  assert.equal(
    safeHttps("https://example.com/demo"),
    "https://example.com/demo",
  );
  for (const url of [
    "javascript:alert(1)",
    "http://example.com",
    "https://user:pass@example.com",
    "https://example.com/\nattack",
    "https://example.com/a b",
  ])
    assert.throws(() => safeHttps(url));
});
