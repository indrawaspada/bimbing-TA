import { useEffect, useState } from "react";
import { zipSync, strToU8 } from "fflate";
import { useAuth } from "@/lib/auth";
import { must, supabase } from "@/lib/supabase";
import { workspace, sha256, download, type Row } from "@/lib/workspace";
import { revisionsCsv, reportHtml } from "@/lib/export-utils";
import { Alert, Button, Card, Select } from "@/components/ui";
export default function ExportsTab({ project }: { project: any }) {
  const { isOwner } = useAuth();
  const [err, setErr] = useState(""),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false),
    [legacy, setLegacy] = useState<Row[]>([]),
    [selected, setSelected] = useState(""),
    [backupSaved, setBackupSaved] = useState(false);
  useEffect(() => {
    if (!isOwner) return;
    void (async () => {
      try {
        const pending =
          (await must(
            supabase
              .from("version_deletion_requests")
              .select("*")
              .eq("project_id", project.id),
          )) || [];
        if (pending.length) {
          const all = await workspace.rows("versions", project.id);
          setLegacy(
            all.filter((v) => pending.some((p) => p.version_id === v.id)),
          );
          setStatus(
            "Ada penghapusan setelah ekspor yang belum selesai. Konfirmasikan backup Anda untuk mencoba ulang.",
          );
        }
      } catch (e: any) {
        setErr(e.message);
      }
    })();
  }, [project.id, isOwner]);
  const metadata = async () => {
    const tables = [
      "versions",
      "findings",
      "comments",
      "meetings",
      "resources",
      "milestones",
    ];
    const data = Object.fromEntries(
      await Promise.all(
        tables.map(async (t) => [t, await workspace.rows(t, project.id)]),
      ),
    );
    const children = await Promise.all(
      data.versions.map(async (v: Row) => ({
        version_id: v.id,
        pages: await workspace.pages(v.id),
        chapter_ranges: await workspace.ranges(v.id),
      })),
    );
    // A deliberate whitelist. Auth/session/environment and private owner notes never enter an export.
    return {
      format: "bimbingta-project",
      schema_version: 1,
      exported_at: new Date().toISOString(),
      scope: "authorized_project_without_private_notes",
      project,
      ...data,
      documents: children,
    };
  };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr("");
    setStatus("");
    try {
      await fn();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const bundle = () =>
    run(async () => {
      setBackupSaved(false);
      setLegacy([]);
      const m = await metadata();
      const files: Record<string, Uint8Array> = {},
        entries: any[] = [];
      const hashes: Record<string, string> = {};
      const originals = m.versions.filter(
        (v: Row) => !["uploading", "upload_failed"].includes(v.status),
      );
      // An unresolved upload may contain a committed object. Do not report a complete backup.
      if (m.versions.some((v: Row) => v.status === "uploading"))
        throw new Error(
          "Selesaikan unggahan yang tertunda sebelum membuat backup lengkap.",
        );
      for (const v of originals) {
        setStatus(`Memeriksa file v${v.sequence}…`);
        const blob = await workspace.file(v.file_path);
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const hash = await sha256(bytes);
        if (
          bytes.length !== Number(v.file_size) ||
          !v.file_hash ||
          hash !== v.file_hash
        )
          throw new Error(
            `Integritas file v${v.sequence} gagal. Backup dibatalkan.`,
          );
        const name = `files/${v.id}.pdf`;
        files[name] = bytes;
        entries.push({
          path: name,
          version_id: v.id,
          original_name: v.file_name,
          size: bytes.length,
          sha256: hash,
        });
        hashes[v.id] = hash;
      }
      if (m.resources.some((r: Row) => r.optional_file_path))
        throw new Error(
          "Ada lampiran sumber lama. Ekspor lampiran tersebut perlu disertakan sebelum backup dinyatakan lengkap.",
        );
      const json = JSON.stringify(m, null, 2);
      files["metadata.json"] = strToU8(json);
      files["revisi.csv"] = strToU8(revisionsCsv(m.findings));
      files["laporan.html"] = strToU8(reportHtml(m));
      const manifest = {
        format: "bimbingta-backup",
        schema_version: 1,
        project_id: project.id,
        created_at: m.exported_at,
        metadata_sha256: await sha256(json),
        files: entries,
        excluded: ["private_notes", "workspace_drafts", "auth", "credentials"],
        not_included: m.versions
          .filter((v: Row) => v.status === "upload_failed")
          .map((v: Row) => ({ id: v.id, status: v.status })),
      };
      files["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));
      setStatus("Menyusun ZIP…");
      const zip = zipSync(files, { level: 0 });
      if (isOwner)
        await workspace.rpc("record_file_export", {
          p_project: project.id,
          p_hashes: hashes,
        });
      download(
        `bimbingta-${project.id}-backup.zip`,
        zip as BlobPart,
        "application/zip",
      );
      const sealed = m.versions
        .filter((v: Row) => v.status === "confirmed")
        .sort((a: Row, b: Row) => b.sequence - a.sequence);
      setLegacy(sealed.slice(1));
      setStatus(
        "ZIP sudah disiapkan dan unduhan dimulai. Pastikan file tersimpan serta dapat dibuka di laptop.",
      );
    });
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold">Ekspor proyek</h2>
      <p className="text-sm text-ink-500">
        Ekspor hanya memuat proyek yang dapat Anda akses. Catatan privat dosen,
        draf pribadi, sesi login, dan kredensial tidak disertakan.
      </p>
      {err && <Alert tone="error">{err}</Alert>}
      {status && <Alert>{status}</Alert>}
      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={busy}
            variant="secondary"
            onClick={() =>
              run(async () => {
                const m = await metadata();
                download(
                  "revisi.csv",
                  revisionsCsv(m.findings),
                  "text/csv;charset=utf-8",
                );
              })
            }
          >
            Revisi CSV
          </Button>
          <Button
            disabled={busy}
            variant="secondary"
            onClick={() =>
              run(async () => {
                download(
                  "metadata.json",
                  JSON.stringify(await metadata(), null, 2),
                  "application/json",
                );
              })
            }
          >
            Metadata JSON
          </Button>
          <Button
            disabled={busy}
            variant="secondary"
            onClick={() =>
              run(async () => {
                download(
                  "laporan-bimbingta.html",
                  reportHtml(await metadata()),
                  "text/html;charset=utf-8",
                );
                setStatus(
                  "Buka laporan HTML di browser, lalu gunakan Cetak / Simpan sebagai PDF.",
                );
              })
            }
          >
            Laporan untuk dicetak
          </Button>
          <Button loading={busy} onClick={bundle}>
            Backup ZIP + file asli
          </Button>
        </div>
        <p className="text-xs text-ink-500">
          ZIP memuat manifest SHA-256, metadata, laporan, CSV, dan PDF asli.
          Kegagalan satu file membatalkan backup. Draf unggahan gagal dicatat
          tanpa file.
        </p>
      </Card>
      {isOwner && legacy.length > 0 && (
        <Card className="space-y-3 p-4">
          <h3 className="font-bold">Hapus versi lama setelah ekspor</h3>
          <p className="text-sm">
            Versi terbaru dan versi yang dipakai sebagai sumber revisi, bukti,
            atau komentar tidak dapat dihapus. Tidak ada penghapusan otomatis.
          </p>
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={backupSaved}
              onChange={(e) => setBackupSaved(e.target.checked)}
            />
            Saya sudah menyimpan dan memeriksa ZIP beserta PDF aslinya.
          </label>
          <Select
            aria-label="Versi lama untuk dihapus"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">Pilih versi lama</option>
            {legacy.map((v) => (
              <option key={v.id} value={v.id}>
                v{v.sequence} · {v.file_name}
              </option>
            ))}
          </Select>
          <Button
            variant="danger"
            disabled={!backupSaved || !selected || busy}
            onClick={() => {
              const v = legacy.find((r) => r.id === selected);
              if (
                !v ||
                !window.confirm(
                  `Hapus permanen v${v.sequence}? File harus sudah tersedia dalam backup Anda.`,
                )
              )
                return;
              void run(async () => {
                await workspace.rpc("begin_version_deletion", {
                  p_version: v.id,
                });
                await must(
                  supabase.storage.from("thesis-files").remove([v.file_path]),
                );
                await workspace.rpc("delete_exported_version", {
                  p_version: v.id,
                });
                setLegacy((r) => r.filter((x) => x.id !== v.id));
                setSelected("");
                setStatus("Versi lama dihapus; jejak audit dipertahankan.");
              });
            }}
          >
            Hapus versi lama terpilih
          </Button>
        </Card>
      )}
    </div>
  );
}
