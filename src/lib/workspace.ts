import { must, supabase } from "./supabase";
export type Row = Record<string, any> & { id: string; row_version: number };
export const CHAPTERS = ["B1", "B2", "B3", "B4", "B5"];
export const STATUS: Record<string, string> = {
  uploading: "Mengunggah",
  uploaded: "Siap diekstrak",
  upload_failed: "Unggahan gagal",
  extracting: "Ekstraksi belum lengkap",
  extracted: "Perlu konfirmasi",
  extraction_failed: "Ekstraksi gagal",
  confirmed: "Terkunci",
  open: "Terbuka",
  in_progress: "Dikerjakan",
  submitted: "Diajukan",
  verified_closed: "Terverifikasi selesai",
  reopened: "Dibuka kembali",
};
export const workspace = {
  rows: async (table: string, project: string): Promise<Row[]> => {
    const out: Row[] = [];
    for (let from = 0; ; from += 500) {
      const part =
        (await must(
          supabase
            .from(table)
            .select("*")
            .eq("project_id", project)
            .order("created_at", { ascending: false })
            .order("id")
            .range(from, from + 499),
        )) || [];
      out.push(...part);
      if (part.length < 500) break;
    }
    return out;
  },
  pages: async (version: string): Promise<Row[]> => {
    // PostgREST's default 1,000-row cap must not truncate a 2,000-page thesis.
    const result: Row[] = [];
    for (let from = 0; ; from += 500) {
      const part =
        (await must(
          supabase
            .from("pages")
            .select("*")
            .eq("version_id", version)
            .order("pdf_page")
            .range(from, from + 499),
        )) || [];
      result.push(...part);
      if (part.length < 500) break;
    }
    return result;
  },
  ranges: async (version: string): Promise<Row[]> =>
    (await must(
      supabase
        .from("chapter_ranges")
        .select("*")
        .eq("version_id", version)
        .order("chapter"),
    )) || [],
  insert: async (table: string, values: Record<string, any>): Promise<Row> => {
    const row = await must(
      supabase.from(table).insert(values).select().single(),
    );
    if (!row) throw new Error("Data tidak ditemukan.");
    return row;
  },
  update: async (
    table: string,
    row: Row,
    values: Record<string, any>,
  ): Promise<Row> => {
    const data = await must(
      supabase
        .from(table)
        .update(values)
        .eq("id", row.id)
        .eq("row_version", row.row_version)
        .select(),
    );
    if (!data?.length)
      throw new Error(
        "Konflik: data berubah di sesi lain. Muat ulang sebelum menyimpan.",
      );
    return data[0];
  },
  rpc: async (name: string, args: Record<string, any>): Promise<any> => {
    const data = await must(supabase.rpc(name, args));
    if (Array.isArray(data)) {
      if (data.length !== 1)
        throw new Error(
          "Server tidak mengembalikan satu baris yang diharapkan. Muat ulang.",
        );
      return data[0];
    }
    return data;
  },
  file: async (path: string): Promise<Blob> => {
    const blob = await must(
      supabase.storage.from("thesis-files").download(path),
    );
    if (!blob) throw new Error("File tidak ditemukan.");
    return blob;
  },
};
export async function sha256(data: Uint8Array | string): Promise<string> {
  const bytes =
    typeof data === "string" ? new TextEncoder().encode(data) : data;
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", bytes as BufferSource),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export { safeHttps } from "./export-utils";
export function download(
  name: string,
  body: BlobPart,
  type = "text/plain;charset=utf-8",
) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export function localWIB(value: string | null): string {
  if (!value) return "";
  return new Date(new Date(value).getTime() + 7 * 3600000)
    .toISOString()
    .slice(0, 16);
}
export function fromWIB(value: string): string | null {
  return value ? new Date(`${value}:00+07:00`).toISOString() : null;
}
