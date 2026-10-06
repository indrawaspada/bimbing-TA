import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { Alert, Empty, Spinner } from '@/components/ui';
import { FolderOpen } from 'lucide-react';

export default function MyProject() {
  const [state, setState] = useState<{ loading: boolean; id?: string; err?: string; many?: boolean }>({ loading: true });
  useEffect(() => {
    api.projects().then((ps) => setState({ loading: false, id: ps[0]?.id, many: ps.length > 1 })).catch((e) => setState({ loading: false, err: e.message }));
  }, []);
  if (state.loading) return <Spinner />;
  if (state.err) return <Alert tone="error" title="Gagal memuat proyek">{state.err}</Alert>;
  if (state.many) return <Navigate to="/dashboard" replace />;
  if (!state.id) return <Empty icon={<FolderOpen className="h-10 w-10" />} title="Belum ada proyek TA">Dosen pembimbing belum membuat proyek untuk akun Anda. Hubungi dosen pembimbing.</Empty>;
  return <Navigate to={`/proyek/${state.id}`} replace />;
}
