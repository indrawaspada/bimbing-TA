import { Link } from 'react-router-dom';
import { Button, Empty } from '@/components/ui';
export default function NotFound() {
  return <Empty title="Halaman tidak ditemukan">Alamat ini tidak ada atau Anda tidak memiliki akses.<div className="mt-4"><Link to="/"><Button variant="secondary">Kembali</Button></Link></div></Empty>;
}
