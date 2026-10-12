// Maintenance dry-run only: never loads admin.env or connects to hosted services.
import { readFile, stat, writeFile } from "node:fs/promises";
import { rehearseBackup, BackupError, MAX_BACKUP_BYTES } from "./lib/backup-restore.mjs";

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--help") {
  console.log("Usage: node scripts/restore-backup.mjs <backup.zip> [--report=<report.json>]\nVerifies a manual project ZIP and restores it in disposable local PostgreSQL WASM, then rolls back. No hosted/apply mode; no credentials required.");
} else {
  try {
    const input = args.find((arg) => !arg.startsWith("--"));
    if (!input || args.filter((arg) => !arg.startsWith("--")).length !== 1 || args.some((arg) => arg.startsWith("--") && !arg.startsWith("--report=")))
      throw new BackupError("usage_requires_zip_and_optional_report_only");
    const reports = args.filter((arg) => arg.startsWith("--report="));
    if (reports.length > 1 || reports.some((arg) => !arg.slice(9))) throw new BackupError("invalid_report_argument");
    if ((await stat(input)).size > MAX_BACKUP_BYTES) throw new BackupError("archive_size_limit");
    const report = await rehearseBackup(await readFile(input));
    const json = JSON.stringify(report, null, 2) + "\n";
    if (reports.length) await writeFile(reports[0].slice(9), json, { flag: "wx" });
    process.stdout.write(json);
  } catch (e) {
    console.error(e instanceof BackupError ? e.code : "backup_file_or_report_unavailable");
    process.exitCode = 1;
  }
}
