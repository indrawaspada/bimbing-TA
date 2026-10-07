import { useCallback, useEffect, useState, lazy, Suspense } from "react";
import { Link, NavLink, useParams } from "react-router-dom";
import clsx from "clsx";
import { ArrowLeft, Lock } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Milestone, Project } from "@/lib/types";
import { PROFILES, STAGES } from "@/lib/types";
import { Alert, Badge, Empty, Spinner } from "@/components/ui";
import SummaryTab from "./project/SummaryTab";
import MilestonesTab from "./project/MilestonesTab";
import PrivateNotesTab from "./project/PrivateNotesTab";
const DocumentsTab = lazy(() => import("./project/DocumentsTab"));
const RevisionsTab = lazy(() => import("./project/RevisionsTab"));
const DiscussionTab = lazy(() => import("./project/DiscussionTab"));
const MeetingsTab = lazy(() => import("./project/MeetingsTab"));
const ResourcesTab = lazy(() => import("./project/ResourcesTab"));
const ExportsTab = lazy(() => import("./project/ExportsTab"));

const TABS = [
  { key: "ringkasan", label: "Ringkasan" },
  { key: "naskah", label: "Naskah" },
  { key: "revisi", label: "Revisi" },
  { key: "diskusi", label: "Diskusi" },
  { key: "target", label: "Target" },
  { key: "pertemuan", label: "Pertemuan" },
  { key: "sumber", label: "Sumber & demo" },
  { key: "ekspor", label: "Ekspor" },
  { key: "catatan", label: "Catatan privat", ownerOnly: true },
];

export default function ProjectPage() {
  const { id = "", tab = "ringkasan" } = useParams();
  const { isOwner } = useAuth();
  const [project, setProject] = useState<Project | null | undefined>(undefined);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [studentName, setStudentName] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, ms] = await Promise.all([api.project(id), api.milestones(id)]);
      setProject(p);
      setMilestones(ms);
      if (p && isOwner) {
        const [members, invs] = await Promise.all([
          api.members(),
          api.invitations(),
        ]);
        const m = members.find((x) => x.auth_user_id === p.student_uid);
        const i = invs.find((x) => x.id === p.invitation_id);
        setStudentName(
          m?.display_name ||
            i?.display_name ||
            m?.verified_email ||
            i?.normalized_email ||
            "Belum ditugaskan",
        );
      }
    } catch (e: any) {
      setErr(e.message);
    }
  }, [id, isOwner]);
  useEffect(() => {
    load();
  }, [load]);

  if (err)
    return (
      <Alert tone="error" title="Gagal memuat proyek">
        {err}
      </Alert>
    );
  if (project === undefined) return <Spinner />;
  // RLS returns no row for projects the user may not access: same message as non-existent (no metadata leak)
  if (project === null)
    return (
      <Empty
        icon={<Lock className="h-10 w-10" />}
        title="Proyek tidak ditemukan"
      >
        Proyek tidak ada atau Anda tidak memiliki akses.
      </Empty>
    );

  const tabs = TABS.filter((t) => !t.ownerOnly || isOwner);
  const active = tabs.find((t) => t.key === tab) ? tab : "ringkasan";

  return (
    <div data-testid="project-page">
      {isOwner && (
        <Link
          to="/dashboard"
          className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-ink-500 hover:text-ink-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Dashboard
        </Link>
      )}
      <div className="mb-5">
        {isOwner && (
          <p className="text-sm font-semibold text-teal-700">
            {studentName}
            {project.student_label ? ` · ${project.student_label}` : ""}
          </p>
        )}
        <h1 className="mt-1 text-2xl font-extrabold leading-tight tracking-tight sm:text-[28px]">
          {project.title}
        </h1>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Badge tone="blue">{STAGES[project.stage]}</Badge>
          <Badge>{PROFILES[project.research_profile]}</Badge>
          {project.status !== "aktif" && (
            <Badge tone="amber">{project.status}</Badge>
          )}
        </div>
      </div>
      <nav
        className="-mx-4 mb-6 overflow-x-auto border-b border-ink-100 px-4 sm:mx-0 sm:px-0"
        aria-label="Tab proyek"
      >
        <div className="flex min-w-max gap-1">
          {tabs.map((t) => (
            <NavLink
              key={t.key}
              to={`/proyek/${id}/${t.key}`}
              replace
              className={clsx(
                "flex h-11 items-center border-b-2 px-3 text-sm font-semibold transition",
                active === t.key
                  ? "border-teal-600 text-ink-900"
                  : "border-transparent text-ink-500 hover:text-ink-800",
              )}
            >
              {t.ownerOnly && (
                <Lock className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              )}
              {t.label}
            </NavLink>
          ))}
        </div>
      </nav>
      {active === "ringkasan" && (
        <SummaryTab
          project={project}
          milestones={milestones}
          onChanged={setProject}
          onReload={load}
        />
      )}
      {active === "target" && (
        <MilestonesTab
          project={project}
          milestones={milestones}
          onReload={load}
        />
      )}
      {active === "catatan" && isOwner && (
        <PrivateNotesTab projectId={project.id} />
      )}
      <Suspense fallback={<Spinner />}>
        {active === "naskah" && <DocumentsTab project={project} />}
        {active === "revisi" && <RevisionsTab project={project} />}
        {active === "diskusi" && <DiscussionTab projectId={project.id} />}
        {active === "pertemuan" && <MeetingsTab project={project} />}
        {active === "sumber" && <ResourcesTab projectId={project.id} />}
        {active === "ekspor" && <ExportsTab project={project} />}
      </Suspense>
    </div>
  );
}
