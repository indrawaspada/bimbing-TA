import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, errorMessage } from './supabase';

export type SaveState = { kind: 'idle' } | { kind: 'dirty' } | { kind: 'saving' } | { kind: 'saved'; at: Date }
  | { kind: 'error'; message: string } | { kind: 'conflict' };

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
  const last = useRef(JSON.stringify(values));
  const timer = useRef<number | undefined>(undefined);
  const versionRef = useRef(rowVersion);
  versionRef.current = rowVersion;

  const save = useCallback(async (vals: T, force = false) => {
    setState({ kind: 'saving' });
    let q = supabase.from(table).update(vals as any).eq('id', id);
    if (!force) q = q.eq('row_version', versionRef.current);
    const { data, error } = await q.select();
    if (error) { setState({ kind: 'error', message: errorMessage(error) }); return; }
    if (!data || data.length === 0) { setState({ kind: 'conflict' }); return; }
    last.current = JSON.stringify(vals);
    onSaved(data[0]);
    setState({ kind: 'saved', at: new Date() });
  }, [table, id, onSaved]);

  useEffect(() => {
    if (!enabled) return;
    const s = JSON.stringify(values);
    if (s === last.current) return;
    if (state.kind === 'conflict') return;
    setState({ kind: 'dirty' });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => save(values), delay);
    return () => window.clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(values), enabled]);

  return {
    state,
    retry: () => save(values),
    overwrite: () => save(values, true),
    resetBaseline: (v: T) => { last.current = JSON.stringify(v); setState({ kind: 'idle' }); },
  };
}
