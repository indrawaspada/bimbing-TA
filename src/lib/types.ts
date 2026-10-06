export type Project = {
  id: string; owner_uid: string; student_uid: string | null; invitation_id: string | null;
  title: string; research_profile: string; stage: 'proposal' | 'final'; status: 'aktif' | 'selesai' | 'arsip';
  summary: string; student_label: string | null; storage_limit_bytes: number;
  created_at: string; updated_at: string; row_version: number;
};
export type Milestone = {
  id: string; project_id: string; name: string; description: string; due_at: string | null; sort_order: number;
  status: 'belum' | 'berjalan' | 'diajukan' | 'selesai'; progress_note: string; completed_at: string | null;
  updated_at: string; row_version: number;
};
export type Invitation = {
  id: string; normalized_email: string; role: string; display_name: string | null; note: string | null;
  active: boolean; claimed_uid: string | null; claimed_at: string | null; created_at: string;
};
export type Member = { id: string; auth_user_id: string; verified_email: string; display_name: string | null; role: string; active: boolean };

export const PROFILES: Record<string, string> = {
  ml: 'Machine Learning', software_si: 'Rekayasa Perangkat Lunak / SI', hci: 'Interaksi Manusia–Komputer',
  iot: 'Internet of Things', ir_rag: 'Information Retrieval / RAG', process_mining: 'Process Mining', lainnya: 'Lainnya',
};
export const STAGES: Record<string, string> = { proposal: 'Proposal', final: 'Naskah akhir' };
export const PROJECT_STATUS: Record<string, string> = { aktif: 'Aktif', selesai: 'Selesai', arsip: 'Arsip' };
export const MILESTONE_STATUS: Record<string, string> = { belum: 'Belum mulai', berjalan: 'Berjalan', diajukan: 'Diajukan', selesai: 'Selesai' };
export const DEFAULT_MILESTONES = ['Proposal', 'Pengumpulan data', 'Implementasi', 'Eksperimen', 'Naskah akhir'];
