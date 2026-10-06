import { supabase, must } from './supabase';
import type { Invitation, Member, Milestone, Project } from './types';
import { DEFAULT_MILESTONES } from './types';

export const api = {
  projects: () => must(supabase.from('projects').select('*').order('updated_at', { ascending: false })) as Promise<Project[]>,
  project: async (id: string) => {
    const rows = (await must(supabase.from('projects').select('*').eq('id', id))) as Project[];
    return rows[0] ?? null;
  },
  members: () => must(supabase.from('memberships').select('*')) as Promise<Member[]>,
  invitations: () => must(supabase.from('invitations').select('*').order('created_at', { ascending: false })) as Promise<Invitation[]>,
  milestones: (projectId?: string) => {
    let q = supabase.from('milestones').select('*').order('sort_order').order('due_at', { nullsFirst: false });
    if (projectId) q = q.eq('project_id', projectId);
    return must(q) as Promise<Milestone[]>;
  },
  openFindingCounts: async () => {
    const rows = (await must(supabase.from('findings').select('project_id, workflow_status').not('workflow_status', 'is', null))) as any[];
    const out: Record<string, { open: number; submitted: number }> = {};
    for (const r of rows) {
      const o = (out[r.project_id] ||= { open: 0, submitted: 0 });
      if (['open', 'in_progress', 'reopened'].includes(r.workflow_status)) o.open++;
      if (r.workflow_status === 'submitted') o.submitted++;
    }
    return out;
  },
  appConfig: async () => ((await must(supabase.from('app_config').select('*'))) as any[])[0] ?? null,
  rubric: async () => ((await must(supabase.from('rubric_versions').select('version, source_sha256, rule_count, is_active, weights_provisional, dimension_weights, created_at').eq('is_active', true))) as any[])[0] ?? null,

  invite: (email: string, display_name: string, note: string) =>
    must(supabase.from('invitations').insert({ normalized_email: email.trim().toLowerCase(), display_name: display_name || null, note: note || null }).select()),
  setInvitationActive: (id: string, active: boolean) => must(supabase.from('invitations').update({ active }).eq('id', id).select()),
  deleteInvitation: (id: string) => must(supabase.from('invitations').delete().eq('id', id).select()),
  setMemberActive: (memberId: string, active: boolean) => must(supabase.rpc('owner_set_member_active', { p_member: memberId, p_active: active })),

  createProject: async (p: { title: string; research_profile: string; stage: string; invitation_id: string | null; student_label?: string; withDefaults: boolean }) => {
    const rows = (await must(supabase.from('projects').insert({
      title: p.title, research_profile: p.research_profile, stage: p.stage, invitation_id: p.invitation_id, student_label: p.student_label || null,
    }).select())) as Project[];
    const proj = rows[0];
    if (p.withDefaults) {
      await must(supabase.from('milestones').insert(DEFAULT_MILESTONES.map((name, i) => ({ project_id: proj.id, name, sort_order: i + 1, description: '', due_at: null, status: 'belum', progress_note: '' }))).select());
    }
    return proj;
  },
  deleteProject: (id: string) => must(supabase.from('projects').delete().eq('id', id).select()),

  addMilestone: (m: Partial<Milestone>) => must(supabase.from('milestones').insert(m).select()),
  updateMilestone: async (id: string, rowVersion: number, patch: Partial<Milestone>) => {
    const rows = (await must(supabase.from('milestones').update(patch).eq('id', id).eq('row_version', rowVersion).select())) as Milestone[];
    if (!rows.length) throw new Error('Konflik: milestone sudah diubah di sesi lain. Muat ulang lalu ulangi.');
    return rows[0];
  },
  deleteMilestone: (id: string) => must(supabase.from('milestones').delete().eq('id', id).select()),

  privateNote: async (projectId: string) => ((await must(supabase.from('private_notes').select('*').eq('project_id', projectId).limit(1))) as any[])[0] ?? null,
  createPrivateNote: async (projectId: string) => ((await must(supabase.from('private_notes').insert({ project_id: projectId, body: '' }).select())) as any[])[0],
};
