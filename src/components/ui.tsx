import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, CloudOff, Loader2, X } from 'lucide-react';
import type { SaveState } from '@/lib/autosave';

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'teal'; size?: 'sm' | 'md'; loading?: boolean };
export const Button = forwardRef<HTMLButtonElement, BtnProps>(({ variant = 'primary', size = 'md', loading, className, children, disabled, ...p }, ref) => (
  <button ref={ref} disabled={disabled || loading} {...p}
    className={clsx('inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition disabled:cursor-not-allowed disabled:opacity-50',
      size === 'md' ? 'h-11 px-4 text-[15px]' : 'h-9 px-3 text-sm',
      variant === 'primary' && 'bg-ink-900 text-white hover:bg-ink-800 active:bg-ink-950',
      variant === 'teal' && 'bg-teal-600 text-white hover:bg-teal-700',
      variant === 'secondary' && 'border border-ink-200 bg-white text-ink-900 hover:bg-ink-50',
      variant === 'ghost' && 'text-ink-700 hover:bg-ink-100',
      variant === 'danger' && 'border border-red-200 bg-white text-red-700 hover:bg-red-50',
      className)}>
    {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
    {children}
  </button>
));

export function Card({ className, children, ...p }: { className?: string; children: ReactNode } & Record<string, any>) {
  return <div {...p} className={clsx('rounded-xl border border-ink-100 bg-white shadow-card', className)}>{children}</div>;
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <label className="block" htmlFor={htmlFor}>
      <span className="mb-1.5 block text-sm font-semibold text-ink-800">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-500">{hint}</span>}
    </label>
  );
}

const inputCls = 'w-full rounded-lg border border-ink-200 bg-white px-3 text-ink-900 placeholder:text-ink-300 focus:border-teal-500 focus:ring-2 focus:ring-teal-100 disabled:bg-ink-50 disabled:text-ink-500';
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => (
  <input ref={ref} {...p} className={clsx(inputCls, 'h-11', className)} />
));
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => (
  <textarea ref={ref} {...p} className={clsx(inputCls, 'min-h-[96px] py-2.5 leading-relaxed', className)} />
));
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...p }, ref) => (
  <select ref={ref} {...p} className={clsx(inputCls, 'h-11 pr-8', className)}>{children}</select>
));

export function Badge({ tone = 'slate', children, icon }: { tone?: 'slate' | 'teal' | 'amber' | 'red' | 'blue' | 'green'; children: ReactNode; icon?: ReactNode }) {
  return (
    <span className={clsx('inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset',
      tone === 'slate' && 'bg-ink-50 text-ink-700 ring-ink-200',
      tone === 'teal' && 'bg-teal-50 text-teal-800 ring-teal-200',
      tone === 'amber' && 'bg-amber-50 text-amber-800 ring-amber-200',
      tone === 'red' && 'bg-red-50 text-red-800 ring-red-200',
      tone === 'blue' && 'bg-blue-50 text-blue-800 ring-blue-200',
      tone === 'green' && 'bg-emerald-50 text-emerald-800 ring-emerald-200')}>
      {icon}{children}
    </span>
  );
}

export function Alert({ tone = 'info', title, children, onClose }: { tone?: 'info' | 'error' | 'warn' | 'success'; title?: string; children?: ReactNode; onClose?: () => void }) {
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={clsx('flex gap-3 rounded-lg border p-3 text-sm',
      tone === 'info' && 'border-ink-200 bg-ink-50 text-ink-800',
      tone === 'error' && 'border-red-200 bg-red-50 text-red-900',
      tone === 'warn' && 'border-amber-200 bg-amber-50 text-amber-900',
      tone === 'success' && 'border-teal-200 bg-teal-50 text-teal-900')}>
      {tone === 'error' || tone === 'warn' ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
      <div className="min-w-0 flex-1">{title && <p className="font-semibold">{title}</p>}{children}</div>
      {onClose && <button onClick={onClose} aria-label="Tutup" className="h-6 w-6 shrink-0 rounded hover:bg-black/5"><X className="mx-auto h-4 w-4" /></button>}
    </div>
  );
}

export function Spinner({ label = 'Memuat…' }: { label?: string }) {
  return <div className="flex items-center gap-2 py-10 text-ink-500" role="status"><Loader2 className="h-5 w-5 animate-spin" aria-hidden />{label}</div>;
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-ink-200 bg-white/60 px-6 py-12 text-center">
      {icon && <div className="mb-3 text-ink-300">{icon}</div>}
      <p className="font-semibold text-ink-800">{title}</p>
      {children && <div className="mt-1 max-w-md text-sm text-ink-500">{children}</div>}
    </div>
  );
}

export function SaveIndicator({ state, onRetry, onOverwrite, onReload }: { state: SaveState; onRetry?: () => void; onOverwrite?: () => void; onReload?: () => void }) {
  if (state.kind === 'idle') return null;
  if (state.kind === 'dirty') return <span className="text-xs text-ink-500" aria-live="polite">Perubahan belum tersimpan…</span>;
  if (state.kind === 'saving') return <span className="inline-flex items-center gap-1 text-xs text-ink-500" aria-live="polite"><Loader2 className="h-3 w-3 animate-spin" />Menyimpan…</span>;
  if (state.kind === 'saved') return <span className="inline-flex items-center gap-1 text-xs text-teal-700" aria-live="polite"><CheckCircle2 className="h-3.5 w-3.5" />Tersimpan {state.at.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</span>;
  if (state.kind === 'error') return (
    <span className="inline-flex flex-wrap items-center gap-2 text-xs font-medium text-red-700" role="alert"><CloudOff className="h-3.5 w-3.5" />Gagal menyimpan: {state.message}
      {onRetry && <button className="underline" onClick={onRetry}>Coba lagi</button>}</span>
  );
  return (
    <span className="inline-flex flex-wrap items-center gap-2 text-xs font-medium text-amber-800" role="alert"><AlertTriangle className="h-3.5 w-3.5" />Konflik: data diubah di sesi lain.
      {onReload && <button className="underline" onClick={onReload}>Muat versi terbaru</button>}
      {onOverwrite && <button className="underline" onClick={onOverwrite}>Timpa dengan isian saya</button>}</span>
  );
}

export function Modal({ open, title, onClose, children, footer }: { open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-950/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-xl sm:max-w-lg sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-ink-100 px-5 py-4">
          <h2 className="text-base font-bold">{title}</h2>
          <button onClick={onClose} aria-label="Tutup" className="grid h-9 w-9 place-items-center rounded-lg hover:bg-ink-50"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-4 px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-ink-100 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink-900 sm:text-[28px]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
