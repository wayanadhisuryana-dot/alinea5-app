// Menu, hak akses per menu, dan modul aktif.
// Hak per menu: null (tidak ada), 'lihat', atau 'ubah'. Super admin selalu 'ubah'.
// Aturan yang sama dijaga database (fungsi public.hak di supabase/migrasi/1-fondasi.sql).
import {S} from './state.js';

// Semua menu yang bisa diatur haknya, berurutan seperti di menu samping.
export const MENU = [
  {k: 'dashboard', label: 'Dashboard', grup: null, ke: 'dashboard', bebas: true},
  {k: 'proyek', label: 'Proyek', grup: 'Proyek', ke: 't-proyek', tabel: 'proyek'},
  {k: 'tahap', label: 'Progres Tahap', grup: 'Proyek', ke: 't-tahap', tabel: 'tahap', modul: 'tahap'},
  {k: 'masalah', label: 'Masalah & Risiko', grup: 'Proyek', ke: 't-masalah', tabel: 'masalah', modul: 'masalah'},
  {k: 'rab', label: 'RAB / Penawaran', grup: 'Proyek', ke: 'rab', modul: 'rab', segera: true},
  {k: 'klien', label: 'Klien', grup: 'Master', ke: 't-klien', tabel: 'klien'},
  {k: 'vendor', label: 'Vendor & Tukang', grup: 'Master', ke: 'segera-vendor', segera: true},
  {k: 'supplier', label: 'Supplier', grup: 'Master', ke: 'segera-supplier', segera: true},
  {k: 'barang', label: 'Barang & Harga', grup: 'Master', ke: 'segera-barang', segera: true},
  {k: 'kontrak', label: 'Kontrak', grup: 'Keuangan', ke: 't-kontrak', tabel: 'kontrak'},
  {k: 'termin', label: 'Termin & Piutang', grup: 'Keuangan', ke: 't-termin', tabel: 'termin'},
  {k: 'pihak_proyek', label: 'Pihak Proyek', judul: 'Vendor / Tukang / Pihak Terkait Proyek', grup: 'Keuangan', ke: 't-vendor', tabel: 'vendor'},
  {k: 'pembelian', label: 'Pembelian Material', grup: 'Keuangan', ke: 'segera-pembelian', segera: true},
  {k: 'hutang_lain', label: 'Hutang Lain', grup: 'Keuangan', ke: 't-hutang_lain', tabel: 'hutang_lain', modul: 'hutang_lain'},
  {k: 'kas', label: 'Kas & Bank', grup: 'Keuangan', ke: 'kas'},
  {k: 'jurnal', label: 'Jurnal', grup: 'Keuangan', ke: 'jurnal'},
  {k: 'laporan', label: 'Laporan', grup: 'Keuangan', ke: 'segera-laporan', segera: true},
  {k: 'sdm', label: 'SDM', grup: 'Administrasi', ke: 't-sdm', tabel: 'sdm'},
  {k: 'aset', label: 'Aset', grup: 'Administrasi', ke: 't-aset', tabel: 'aset', modul: 'aset'},
  {k: 'legal', label: 'Legal & Izin', grup: 'Administrasi', ke: 't-legal', tabel: 'legal', modul: 'legal'},
  {k: 'pengaturan', label: 'Pengaturan', grup: 'Lainnya', ke: 'pengaturan'},
];
export const MENU_HAK = MENU.filter((m) => !m.bebas);
export const menuDari = (k) => MENU.find((m) => m.k === k);

// Hak khusus di luar hak per menu.
export const KHUSUS = {
  tutup_buku: 'Menutup buku bulanan',
  jurnal_manual: 'Membuat, mengubah, dan menghapus jurnal manual',
};

// Modul yang bisa dimatikan. Modul mati hilang dari menu; datanya tetap tersimpan.
export const MODUL = {
  tahap: 'Progres Tahap',
  masalah: 'Masalah & Risiko',
  rab: 'RAB / Penawaran',
  skk: 'SKK / STRA (di SDM)',
  hutang_lain: 'Hutang Lain',
  aset: 'Aset',
  legal: 'Legal & Izin',
};
export const modulAktif = (k, data = S.pengaturan?.data) => data?.modul?.[k] !== false;

// Peran bawaan, sama dengan yang dibuat migrasi database.
const SEMUA_UBAH = Object.fromEntries(MENU_HAK.map((m) => [m.k, 'ubah']));
export const PERAN_BAWAAN = {
  Admin: {hak: SEMUA_UBAH, khusus: {tutup_buku: true, jurnal_manual: true}},
  'Staf proyek': {hak: {proyek: 'ubah', tahap: 'ubah', masalah: 'ubah', klien: 'lihat'}, khusus: {}},
};

// Hak pengguna yang sedang masuk atas satu menu.
export function hak(menu, user = S.user) {
  if (!user?.aktif) return null;
  if (user.super_admin) return 'ubah';
  const v = user.peran?.hak?.[menu];
  return v === 'ubah' || v === 'lihat' ? v : null;
}
export const bisaUbah = (menu) => hak(menu) === 'ubah';
export const khusus = (k, user = S.user) => !!(user?.aktif && (user.super_admin || user.peran?.khusus?.[k]));

// Menu yang tampil: ada haknya dan modulnya aktif.
export const menuTampil = (m) => (m.bebas || hak(m.k) != null) && (!m.modul || modulAktif(m.modul));

// Tabel data (records.tabel) -> kunci menu. Direktori 'tim' dibaca oleh menu proyek dan SDM.
export const menuTabel = (tabel) => MENU.find((m) => m.tabel === tabel)?.k || tabel;
export function bolehAkses(tabel) {
  if (tabel === 'tim') return ['proyek', 'tahap', 'masalah', 'sdm'].some((k) => hak(k) != null);
  const m = menuDari(menuTabel(tabel));
  return hak(menuTabel(tabel)) != null && (!m?.modul || modulAktif(m.modul));
}
export const bolehUbahTabel = (tabel) => bolehAkses(tabel) && (tabel === 'tim' ? bisaUbah('sdm') : bisaUbah(menuTabel(tabel)));

// Profil dari database -> pengguna aplikasi. Database lama (sebelum Tahap 1) belum punya kolom
// super_admin dan peran: admin dianggap super admin, arsitek mendapat hak Staf proyek.
export function bentukPengguna(id, email, p, peran) {
  const lama = p && !('super_admin' in p);
  return {
    id, email, aktif: !!p?.aktif, role: p?.role || 'arsitek',
    super_admin: lama ? p?.role === 'admin' : !!p?.super_admin,
    peran: peran || (lama && p?.role !== 'admin' ? {nama: 'Staf proyek', ...PERAN_BAWAAN['Staf proyek']} : null),
  };
}
export const namaPeran = (user = S.user) => (user?.super_admin ? 'Super admin' : user?.peran?.nama || 'Tanpa peran');
