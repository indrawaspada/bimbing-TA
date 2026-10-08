import { useCallback, useEffect, useRef, useState } from "react";
import { supabase, must } from "./supabase";
import type { SaveState } from "./autosave";
import { workspace, type Row } from "./workspace";
/** Private, persisted drafts with compare-and-swap. Serialize saves so slow responses
 * cannot overwrite newer keystrokes or falsely label a newer draft as saved. */
export function useDraft<T extends Record<string, any>>(
  project: string,
  scope: string,
  initial: T,
  enabled = true,
) {
  const [value, setValue] = useState<T>(initial),
    [row, setRow] = useState<Row | null>(null),
    [ready, setReady] = useState(false),
    [state, setState] = useState<SaveState>({ kind: "idle" });
  const ref = useRef<T>(initial),
    rowRef = useRef<Row | null>(null),
    baseline = useRef(""),
    busy = useRef(false),
    mounted = useRef(true),
    conflict = useRef(false);
  const flushRef = useRef<() => Promise<boolean>>(() => Promise.resolve(false));
  const assign = (v: T) => {
    ref.current = v;
    setValue(v);
  };
  const load = useCallback(async () => {
    setReady(false);
    if (!enabled) {
      rowRef.current = null;
      setRow(null);
      baseline.current = JSON.stringify(initial);
      assign(initial);
      setReady(true);
      return;
    }
    try {
      let r = await must(
        supabase
          .from("workspace_drafts")
          .select("*")
          .eq("project_id", project)
          .eq("scope", scope)
          .maybeSingle(),
      );
      if (!r) {
        const { data, error } = await supabase
          .from("workspace_drafts")
          .insert({ project_id: project, scope, payload: initial })
          .select()
          .single();
        if (error?.code === "23505")
          r = await must(
            supabase
              .from("workspace_drafts")
              .select("*")
              .eq("project_id", project)
              .eq("scope", scope)
              .single(),
          );
        else if (error) throw new Error(error.message);
        else r = data;
      }
      if (!mounted.current) return;
      rowRef.current = r;
      setRow(r);
      baseline.current = JSON.stringify(r.payload);
      assign(r.payload);
      conflict.current = false;
      setState({ kind: "idle" });
      setReady(true);
    } catch (e: any) {
      if (mounted.current) setState({ kind: "error", message: e.message });
    }
  }, [project, scope, enabled]);
  useEffect(() => {
    mounted.current = true;
    load();
    return () => {
      mounted.current = false;
      void flushRef.current();
    };
  }, [load]);
  const flush = useCallback(async (): Promise<boolean> => {
    if (!rowRef.current || busy.current || conflict.current) return false;
    busy.current = true;
    try {
      while (JSON.stringify(ref.current) !== baseline.current) {
        const v = ref.current;
        setState({ kind: "saving" });
        const updated = await workspace.update(
          "workspace_drafts",
          rowRef.current,
          { payload: v },
        );
        rowRef.current = updated;
        baseline.current = JSON.stringify(v);
        if (mounted.current) setRow(updated);
      }
      if (mounted.current) setState({ kind: "saved", at: new Date() });
      return true;
    } catch (e: any) {
      if (e.message.startsWith("Konflik")) {
        conflict.current = true;
        setState({ kind: "conflict" });
      } else setState({ kind: "error", message: e.message });
      return false;
    } finally {
      busy.current = false;
    }
  }, []);
  flushRef.current = flush;
  const serialized = JSON.stringify(value);
  useEffect(() => {
    if (!ready || serialized === baseline.current || conflict.current) return;
    setState({ kind: "dirty" });
    const timer = setTimeout(flush, 1200);
    return () => clearTimeout(timer);
  }, [serialized, ready, flush]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (JSON.stringify(ref.current) !== baseline.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  return {
    value,
    setValue: assign,
    ready,
    row,
    state,
    flush,
    reload: load,
    reset: async () => {
      assign(initial);
      return flush();
    },
  };
}
export function useActivePolling(load: () => Promise<void>, key: string) {
  useEffect(() => {
    let alive = true,
      running = false,
      timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (!alive || running) return;
      running = true;
      try {
        if (document.visibilityState === "visible") await load();
      } finally {
        running = false;
      }
      if (alive) timer = setTimeout(tick, 15000);
    };
    const visibility = () => {
      if (document.visibilityState === "visible") {
        clearTimeout(timer);
        void tick();
      }
    };
    void tick();
    document.addEventListener("visibilitychange", visibility);
    return () => {
      alive = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [key, load]);
}
