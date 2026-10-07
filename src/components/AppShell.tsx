import { NavLink, Outlet, useLocation } from "react-router-dom";
import clsx from "clsx";
import {
  Bell,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Settings,
  Users,
  FolderOpen,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

function useUnread() {
  const [n, setN] = useState(0);
  const loc = useLocation();
  useEffect(() => {
    const load = () =>
      supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .is("read_at", null)
        .then(({ count }) => setN(count || 0));
    void load();
    window.addEventListener("notifications-read", load);
    return () => window.removeEventListener("notifications-read", load);
  }, [loc.pathname]);
  return n;
}

export function Logo({ compact }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="grid h-9 w-9 place-items-center rounded-lg bg-teal-500/15 ring-1 ring-teal-400/30">
        <GraduationCap className="h-5 w-5 text-teal-400" />
      </div>
      {!compact && (
        <div className="leading-tight">
          <p className="text-[15px] font-extrabold tracking-tight text-white">
            BimbingTA
          </p>
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-teal-300/80">
            Copilot
          </p>
        </div>
      )}
    </div>
  );
}

export default function AppShell() {
  const { membership, isOwner, signOut } = useAuth();
  const unread = useUnread();
  const name =
    membership?.status === "active"
      ? membership.display_name || membership.email
      : "";
  const nav = isOwner
    ? [
        { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
        { to: "/mahasiswa", label: "Mahasiswa", icon: Users },
        { to: "/notifikasi", label: "Notifikasi", icon: Bell, badge: unread },
        { to: "/pengaturan", label: "Pengaturan", icon: Settings },
      ]
    : [
        { to: "/proyek", label: "Proyek saya", icon: FolderOpen },
        { to: "/notifikasi", label: "Notifikasi", icon: Bell, badge: unread },
        { to: "/pengaturan", label: "Pengaturan", icon: Settings },
      ];

  return (
    <div className="min-h-screen lg:pl-64">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2"
      >
        Lewati ke konten
      </a>
      {/* desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-ink-900 px-4 py-5 lg:flex">
        <div className="px-2">
          <Logo />
        </div>
        <nav className="mt-8 flex-1 space-y-1" aria-label="Navigasi utama">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                clsx(
                  "flex h-11 items-center gap-3 rounded-lg px-3 text-[15px] font-semibold transition",
                  isActive
                    ? "bg-white/10 text-white"
                    : "text-ink-200 hover:bg-white/5 hover:text-white",
                )
              }
            >
              <n.icon className="h-5 w-5" aria-hidden />
              {n.label}
              {!!n.badge && (
                <span className="ml-auto rounded-full bg-teal-500 px-2 py-0.5 text-xs font-bold text-white">
                  {n.badge}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="rounded-xl bg-white/5 p-3">
          <p className="truncate text-sm font-semibold text-white">{name}</p>
          <p className="text-xs text-teal-300">
            {isOwner ? "Dosen pembimbing" : "Mahasiswa"}
          </p>
          <button
            onClick={signOut}
            className="mt-3 flex h-9 w-full items-center gap-2 rounded-lg px-2 text-sm font-medium text-ink-200 hover:bg-white/10 hover:text-white"
          >
            <LogOut className="h-4 w-4" />
            Keluar
          </button>
        </div>
      </aside>
      {/* mobile top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between bg-ink-900 px-4 lg:hidden">
        <Logo />
        <button
          onClick={signOut}
          aria-label="Keluar"
          className="grid h-10 w-10 place-items-center rounded-lg text-ink-200 hover:bg-white/10"
        >
          <LogOut className="h-5 w-5" />
        </button>
      </header>
      <main
        id="main"
        className="mx-auto max-w-6xl px-4 pb-28 pt-6 sm:px-6 lg:px-10 lg:pb-12 lg:pt-10"
      >
        <Outlet />
      </main>
      {/* mobile bottom nav */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 grid border-t border-ink-100 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden"
        style={{ gridTemplateColumns: `repeat(${nav.length}, minmax(0,1fr))` }}
        aria-label="Navigasi bawah"
      >
        {nav.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            className={({ isActive }) =>
              clsx(
                "relative flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-semibold",
                isActive ? "text-teal-700" : "text-ink-500",
              )
            }
          >
            <n.icon className="h-5 w-5" aria-hidden />
            {n.label}
            {!!n.badge && (
              <span
                className="absolute right-[28%] top-2 h-2.5 w-2.5 rounded-full bg-teal-500"
                aria-label={`${n.badge} belum dibaca`}
              />
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
