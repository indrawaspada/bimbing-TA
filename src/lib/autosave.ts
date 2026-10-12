import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, errorMessage } from './supabase';

export type SaveState = { kind: 'idle' } | { kind: 'dirty' } | { kind: 'saving' } | { kind: 'saved'; at: Date }
  | { kind: 'error'; message: string } | { kind: 'conflict' };

type SaveTarget<T> = {
  table: string; id: string; version: number; propVersion: number; values: T;
  enabled: boolean; last: string; conflict: boolean; force: boolean;
  pending: Promise<void> | null;
};

/**
 * Autosave a set of columns on one row with optimistic locking (row_version).
 * Shows "saved" ONLY after the server confirms; a stale row_version is reported as a conflict, never overwritten.
 */
export function useAutosave<T extends Record<string, any>>(opts: {
  table: string; id: string; rowVersion: number; values: T; enabled: boolean; delay?: number;
  onSaved: (row: any) => void;
}) {
  const { table, id, rowVersion, values, enabled, delay = 1200, onSaved } = opts;
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  const serialized = JSON.stringify(values);
  const timer = useRef<number | undefined>(undefined);
  const mounted = useRef(false);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  const targetRef = useRef<SaveTarget<T>>({
    table, id, version: rowVersion, propVersion: rowVersion, values, enabled,
    last: serialized, conflict: false, force: false, pending: null,
  });
  if (targetRef.current.id !== id || targetRef.current.table !== table) {
    targetRef.current = {
      table, id, version: rowVersion, propVersion: rowVersion, values, enabled,
      last: serialized, conflict: false, force: false, pending: null,
    };
  }
  const target = targetRef.current;
  target.values = values;
  target.enabled = enabled;
  if (target.propVersion !== rowVersion) {
    target.propVersion = rowVersion;
    target.version = Math.max(target.version, rowVersion);
  }

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; window.clearTimeout(timer.current); };
  }, []);

  const save = useCallback((force = false): Promise<void> => {
    const t = targetRef.current;
    if (!mounted.current || !t.enabled || !t.id) return Promise.resolve();
    if (force) { t.force = true; t.conflict = false; }
    if (t.conflict) return Promise.resolve();
    if (t.pending) return t.pending;
    const current = () => mounted.current && targetRef.current === t;
    const run = async () => {
      while (current() && t.enabled && !t.conflict
        && (JSON.stringify(t.values) !== t.last || t.force)) {
        const vals = t.values;
        const snapshot = JSON.stringify(vals);
        const overwrite = t.force;
        t.force = false;
        setState({ kind: 'saving' });
        try {
          let q = supabase.from(t.table).update(vals as any).eq('id', t.id);
          if (!overwrite) q = q.eq('row_version', t.version);
          const { data, error } = await q.select();
          if (!current()) return;
          if (error) { setState({ kind: 'error', message: errorMessage(error) }); return; }
          if (!data?.length) {
            t.conflict = true;
            setState({ kind: 'conflict' });
            return;
          }
          t.last = snapshot;
          t.version = data[0].row_version;
          onSavedRef.current(data[0]);
          // Continue with the newest values using the version just acknowledged.
          // A second save never races the first save from this hook instance.
        } catch (e) {
          if (current()) setState({ kind: 'error', message: errorMessage(e) });
          return;
        }
      }
      if (current()) setState(JSON.stringify(t.values) === t.last
        ? { kind: 'saved', at: new Date() } : { kind: 'dirty' });
    };
    t.pending = run().finally(() => { t.pending = null; });
    return t.pending;
  }, []);

  useEffect(() => {
    if (!enabled) return;
    if (serialized === targetRef.current.last || targetRef.current.conflict) return;
    setState({ kind: 'dirty' });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void save(), delay);
    return () => window.clearTimeout(timer.current);
  }, [serialized, enabled, table, id, delay, save]);

  return {
    state,
    retry: () => save(),
    overwrite: () => save(true),
    resetBaseline: (v: T) => {
      window.clearTimeout(timer.current);
      // Explicit reload also invalidates responses from the discarded edit.
      targetRef.current = { ...targetRef.current, values: v, last: JSON.stringify(v),
        conflict: false, force: false, pending: null };
      setState({ kind: 'idle' });
    },
  };
}
