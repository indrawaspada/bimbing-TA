import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  Select,
  Textarea,
} from "./ui";
import { supabase, must } from "@/lib/supabase";
import { workspace, type Row } from "@/lib/workspace";
import { invokeAI, currentAIMonth } from "@/lib/ai";
import catalog from "../../docs/model_catalog.json";
export default function AISettings() {
  const [models, setModels] = useState<Row[]>([]),
    [projects, setProjects] = useState<Row[]>([]),
    [project, setProject] = useState(""),
    [budget, setBudget] = useState<any>(null),
    [providers, setProviders] = useState<any>({}),
    [usage, setUsage] = useState<any[]>([]),
    [err, setErr] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [capability, setCapability] = useState('{"structured_output":true}');
  const [form, setForm] = useState({
    provider: "openai",
    model_id: "",
    label: "",
    tier: "balanced",
    input: "",
    output: "",
    max_input: "18000",
    max_output: "4000",
  });
  const load = useCallback(async () => {
    try {
      const [m, p, b, u] = await Promise.all([
        must(supabase.from("model_settings").select("*").order("created_at")),
        must(supabase.from("projects").select("*")),
        must(
          supabase
            .from("budget_settings")
            .select("*")
            .eq("month", currentAIMonth())
            .maybeSingle(),
        ),
        must(
          supabase
            .from("usage_reservations")
            .select("status,max_cost,actual_cost")
            .eq("month", currentAIMonth()),
        ),
      ]);
      setModels(m || []);
      setProjects(p || []);
      setBudget(
        b || {
          month: currentAIMonth(),
          ai_enabled: false,
          student_ai_enabled: false,
          max_cost_usd: 5,
          per_call_max_usd: 0.25,
          max_calls: 40,
          per_student_calls: 0,
        },
      );
      setUsage(u || []);
      try {
        setProviders((await invokeAI({ action: "status" })).providers || {});
      } catch {
        setProviders({});
      }
    } catch (e: any) {
      setErr(e.message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const action = async (fn: () => Promise<any>) => {
    setErr("");
    setNotice("");
    setBusy(true);
    try {
      await fn();
      await load();
      setNotice("Perubahan berhasil disimpan.");
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const held = usage.reduce(
    (n, r) =>
      n +
      Number(
        r.status === "reconciled"
          ? r.actual_cost
          : r.status === "released"
            ? 0
            : r.max_cost,
      ),
    0,
  );
  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-5">
        <h2 className="font-bold">Asisten AI dan biaya</h2>
        <p className="text-sm">
          Alur manual tetap tersedia tanpa API. API key hanya di Supabase
          Secrets: OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY. Tidak
          ada kolom untuk memasukkan key di aplikasi.
        </p>
        {err && <Alert tone="error">{err}</Alert>}
        {notice && <Alert tone="success">{notice}</Alert>}
        <p className="text-xs text-ink-500">
          Pemanggilan model frontier dapat berbayar. Gemini free tier mengikuti
          akun dan ketentuan pemakaian data; jangan kirim naskah rahasia hanya
          karena layanan gratis. Anggaran di sini mengendalikan aplikasi ini,
          bukan seluruh tagihan provider.
        </p>
        <div className="flex flex-wrap gap-2">
          {["openai", "anthropic", "gemini"].map((p) => (
            <Badge key={p}>
              {p}:{" "}
              {providers[p]?.configured
                ? "Key dikonfigurasi"
                : "Belum terkonfirmasi"}
            </Badge>
          ))}
        </div>
        {budget && (
          <>
            <p className="text-sm">
              Bulan {budget.month} · Biaya/komitmen USD {held.toFixed(4)} ·{" "}
              {usage.filter((r) => r.status !== "released").length} panggilan ·{" "}
              {
                usage.filter((r) => ["unknown", "held"].includes(r.status))
                  .length
              }{" "}
              belum pasti/reservasi.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                ["max_cost_usd", "Batas bulanan USD"],
                ["per_call_max_usd", "Batas satu panggilan USD"],
                ["max_calls", "Jumlah panggilan/bulan"],
                ["per_student_calls", "Panggilan per mahasiswa/bulan"],
              ].map(([k, label]) => (
                <Field key={k} label={label}>
                  <Input
                    type="number"
                    min={0}
                    step={k.includes("usd") ? "0.01" : "1"}
                    value={budget[k]}
                    onChange={(e) =>
                      setBudget({ ...budget, [k]: Number(e.target.value) })
                    }
                  />
                </Field>
              ))}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={budget.ai_enabled}
                onChange={(e) =>
                  setBudget({ ...budget, ai_enabled: e.target.checked })
                }
              />
              Aktifkan AI untuk bulan ini (termasuk uji koneksi)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={budget.student_ai_enabled}
                onChange={(e) =>
                  setBudget({ ...budget, student_ai_enabled: e.target.checked })
                }
              />
              Izinkan mahasiswa memakai anggaran bersama
            </label>
            <Button
              loading={busy}
              onClick={() =>
                action(() =>
                  budget.id
                    ? workspace.update("budget_settings", budget, {
                        ai_enabled: budget.ai_enabled,
                        student_ai_enabled: budget.student_ai_enabled,
                        max_cost_usd: budget.max_cost_usd,
                        per_call_max_usd: budget.per_call_max_usd,
                        max_calls: budget.max_calls,
                        per_student_calls: budget.per_student_calls,
                      })
                    : workspace.insert("budget_settings", budget),
                )
              }
            >
              Simpan anggaran
            </Button>
          </>
        )}
      </Card>
      <Card className="space-y-3 p-5">
        <h2 className="font-bold">Tambahkan model</h2>
        <p className="text-sm">
          Model baru nonaktif. ID dan tarif dari katalog adalah contoh yang
          harus diperiksa untuk akun Bapak. Uji koneksi menggunakan permintaan
          kecil tanpa naskah, tetapi tetap dihitung sebagai panggilan.
        </p>
        <Field label="Isi dari katalog awal (opsional)">
          <Select
            defaultValue=""
            onChange={(e) => {
              const m = catalog.models[Number(e.target.value)];
              if (m)
                setForm({
                  ...form,
                  provider: m.provider,
                  model_id: m.model_id,
                  label: m.label,
                  input: String(m.input_usd_per_million ?? ""),
                  output: String(m.output_usd_per_million ?? ""),
                  tier: m.label.includes("frontier") ? "frontier" : "balanced",
                });
            }}
          >
            <option value="">Pilih contoh lalu periksa ID/tarif</option>
            {catalog.models.map((m, i) => (
              <option key={m.model_id} value={i}>
                {m.label}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Provider">
            <Select
              value={form.provider}
              onChange={(e) => setForm({ ...form, provider: e.target.value })}
            >
              {["openai", "anthropic", "gemini"].map((p) => (
                <option key={p}>{p}</option>
              ))}
            </Select>
          </Field>
          <Field label="Tier">
            <Select
              value={form.tier}
              onChange={(e) => setForm({ ...form, tier: e.target.value })}
            >
              {["balanced", "frontier", "economy"].map((p) => (
                <option key={p}>{p}</option>
              ))}
            </Select>
          </Field>
          {Object.entries({
            model_id: "ID model API",
            label: "Nama model",
            input: "Tarif input USD/juta token",
            output: "Tarif output USD/juta token",
            max_input: "Batas input",
            max_output: "Batas output",
          }).map(([k, label]) => (
            <Field key={k} label={label}>
              <Input
                value={(form as any)[k]}
                type={
                  ["input", "output", "max_input", "max_output"].includes(k)
                    ? "number"
                    : "text"
                }
                min={0}
                step="any"
                onChange={(e) => setForm({ ...form, [k]: e.target.value })}
              />
            </Field>
          ))}
        </div>
        <Field label="Kemampuan model (JSON; periksa dokumentasi model)">
          <Textarea
            value={capability}
            onChange={(e) => setCapability(e.target.value)}
          />
        </Field>
        <p className="text-xs text-ink-500">
          Gemini memerlukan supports_thinking_budget:true dan thinking_budget
          berupa angka yang didukung model, agar reservasi mencakup token
          reasoning. Model yang hanya mendukung thinking level belum didukung di
          tahap ini.
        </p>
        <Button
          loading={busy}
          disabled={
            !form.model_id ||
            !form.label ||
            form.input === "" ||
            form.output === ""
          }
          onClick={() =>
            action(() =>
              workspace.insert("model_settings", {
                provider: form.provider,
                model_id: form.model_id,
                label: form.label,
                tier: form.tier,
                input_usd_per_million: Number(form.input),
                output_usd_per_million: Number(form.output),
                max_input_tokens: Number(form.max_input),
                max_output_tokens: Number(form.max_output),
                capability: JSON.parse(capability),
                roles_allowed: ["owner"],
                price_scope: `Tarif dimasukkan pembimbing ${new Date().toISOString().slice(0, 10)}`,
              }),
            )
          }
        >
          Simpan model nonaktif
        </Button>
      </Card>
      <Card className="space-y-3 p-5">
        <h2 className="font-bold">Model yang tersedia</h2>
        <Field label="Proyek untuk mencatat uji koneksi">
          <Select value={project} onChange={(e) => setProject(e.target.value)}>
            <option value="">Pilih proyek</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </Select>
        </Field>
        {!models.length && (
          <p className="text-sm">
            Belum ada model; semua alur manual tetap tersedia.
          </p>
        )}
        {models.map((m) => (
          <div
            key={m.id}
            className="space-y-2 rounded-lg border border-ink-100 p-3"
          >
            <p className="font-semibold">{m.label || m.model_id}</p>
            <p className="text-xs">
              {m.provider} · {m.model_id} · {m.tier}
            </p>
            <div className="flex flex-wrap gap-2">
              <Badge>{m.enabled ? "Aktif" : "Nonaktif"}</Badge>
              <Badge>
                {m.last_test_status === "ok" &&
                m.last_tested_hash === m.config_hash
                  ? "Lulus uji live"
                  : "Belum lulus uji live"}
              </Badge>
              <Badge>
                {m.roles_allowed.includes("student")
                  ? "Mahasiswa diizinkan"
                  : "Pembimbing saja"}
              </Badge>
            </div>
            <p className="text-xs">
              Input/output USD {m.input_usd_per_million}/
              {m.output_usd_per_million} per juta · {m.max_input_tokens}/
              {m.max_output_tokens} token.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                loading={busy}
                disabled={!project || !budget?.ai_enabled}
                onClick={() => {
                  if (
                    window.confirm(
                      `Kirim permintaan uji kecil ke ${m.provider}/${m.model_id}? Tidak ada naskah dikirim. Biaya mengikuti tarif dan reservasi aplikasi.`,
                    )
                  )
                    void action(async () => {
                      const r = await invokeAI({
                        action: "test",
                        project_id: project,
                        model_setting_id: m.id,
                        idempotency_key: crypto.randomUUID(),
                      });
                      if (r.run.state !== "succeeded")
                        throw new Error(
                          r.run.error_code || "Uji gagal; periksa reservasi.",
                        );
                    });
                }}
              >
                Uji koneksi live
              </Button>
              <Button
                size="sm"
                variant="secondary"
                loading={busy}
                disabled={
                  !m.enabled &&
                  (m.last_test_status !== "ok" ||
                    m.last_tested_hash !== m.config_hash)
                }
                onClick={() =>
                  action(() =>
                    workspace.update("model_settings", m, {
                      enabled: !m.enabled,
                    }),
                  )
                }
              >
                {m.enabled ? "Nonaktifkan" : "Aktifkan model"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                loading={busy}
                onClick={() =>
                  action(() =>
                    workspace.update("model_settings", m, {
                      roles_allowed: m.roles_allowed.includes("student")
                        ? ["owner"]
                        : ["owner", "student"],
                    }),
                  )
                }
              >
                {m.roles_allowed.includes("student")
                  ? "Batasi pembimbing"
                  : "Izinkan mahasiswa"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                loading={busy}
                onClick={() => {
                  const value = window.prompt(
                    "Konfigurasi kemampuan JSON (perubahan memerlukan uji ulang)",
                    JSON.stringify(m.capability),
                  );
                  if (value !== null)
                    void action(() =>
                      workspace.update("model_settings", m, {
                        capability: JSON.parse(value),
                      }),
                    );
                }}
              >
                Ubah kemampuan
              </Button>
              <Button
                size="sm"
                variant="ghost"
                loading={busy}
                onClick={() => {
                  const a = window.prompt(
                    "Tarif input USD/juta token",
                    String(m.input_usd_per_million),
                  );
                  if (a === null) return;
                  const b = window.prompt(
                    "Tarif output USD/juta token",
                    String(m.output_usd_per_million),
                  );
                  if (b === null) return;
                  if (
                    a.trim() === "" ||
                    b.trim() === "" ||
                    !Number.isFinite(Number(a)) ||
                    !Number.isFinite(Number(b)) ||
                    Number(a) < 0 ||
                    Number(b) < 0
                  ) {
                    setErr("Tarif harus angka nonnegatif.");
                    return;
                  }
                  void action(() =>
                    workspace.update("model_settings", m, {
                      input_usd_per_million: Number(a),
                      output_usd_per_million: Number(b),
                    }),
                  );
                }}
              >
                Ubah tarif (uji ulang)
              </Button>
            </div>
          </div>
        ))}
        <p className="text-xs text-ink-500">
          Tidak ada pergantian ke model berbayar secara otomatis. Perubahan
          konfigurasi model membatalkan status uji sebelumnya. Usage tanpa bukti
          tagihan tetap ditahan sampai rekonsiliasi oleh admin.
        </p>
      </Card>
    </div>
  );
}
