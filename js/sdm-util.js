// Aturan data pegawai (SDM): jabatan, riwayat kontrak, riwayat gaji, dan peringatan.
// Fungsi murni, dipakai oleh perhitungan, formulir, dan halaman SDM.

export const STATUS = {tetap: 'Tetap (PKWTT)', pkwt: 'Kontrak (PKWT)', magang: 'Magang'};
export const STATUS_KERJA = Object.values(STATUS);
export const STATUS_PENDEK = {[STATUS.tetap]: 'Tetap', [STATUS.pkwt]: 'PKWT', [STATUS.magang]: 'Magang'};
export const ALASAN_KELUAR = ['Resign', 'Kontrak habis', 'PHK', 'Lainnya'];
export const BATAS_FILE = 10 * 1024 * 1024;

// Daftar jabatan awal. id tetap agar pegawai yang memakai jabatan ini tidak terputus saat namanya diubah.
export const JABATAN_BAWAAN = [
  ['j-principal', 'Principal / Direktur', false], ['j-arsitek', 'Arsitek', true], ['j-arsitek-senior', 'Arsitek senior', true],
  ['j-desainer', 'Desainer interior', false], ['j-drafter', 'Drafter', false], ['j-pengawas', 'Pengawas lapangan', true],
  ['j-admin', 'Admin', false], ['j-keuangan', 'Accountant / Keuangan', false], ['j-mandor', 'Mandor', false], ['j-tukang', 'Tukang', false],
].map(([id, nama, skk]) => ({id, nama, skk, aktif: true}));
// Staf manajemen yang secara bawaan tidak muncul di pilihan Tim Proyek.
const BUKAN_TIM = ['j-principal', 'j-admin', 'j-keuangan'];
export const bawaanTimProyek = (jabatanId) => !BUKAN_TIM.includes(jabatanId);

// Parameter peringatan. Batas PKWT kosong (null) berarti pengecekannya tidak dijalankan.
export const PARAM_BAWAAN = {hari_kontrak: 60, hari_skk: 90, hari_magang: 30, pkwt_awal_bln: null, pkwt_maks_perpanjangan: null, pkwt_perpanjangan_bln: null};

const slug = (s) => 'j-' + String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const angkaAtauNull = (v) => (v == null || v === '' || isNaN(+v) ? null : +v);

// Pengaturan SDM dari catatan pengaturan admin, dengan isian bawaan untuk yang belum diatur.
export function aturSdm(data) {
  let jabatan = Array.isArray(data?.jabatan) && data.jabatan.length ? data.jabatan : null;
  if (!jabatan && Array.isArray(data?.opsi?.jabatan) && data.opsi.jabatan.length) {
    // Daftar jabatan yang sempat diatur lewat Pilihan dropdown.
    jabatan = data.opsi.jabatan.map((nama) => JABATAN_BAWAAN.find((j) => j.nama === nama) || {id: slug(nama), nama, skk: false, aktif: true});
  }
  const param = {...PARAM_BAWAAN};
  for (const k of Object.keys(PARAM_BAWAAN)) if (data?.sdm && k in data.sdm) param[k] = angkaAtauNull(data.sdm[k]) ?? (k.startsWith('hari') ? PARAM_BAWAAN[k] : null);
  // Modul SKK/STRA dimatikan di Pengaturan: tidak ada isian maupun peringatan SKK/STRA (data lama tetap tersimpan).
  const skk = data?.modul?.skk !== false;
  if (!skk) param.hari_skk = -Infinity;
  return {jabatan: (jabatan || JABATAN_BAWAAN).map((j) => ({...j, skk: skk && !!j.skk})), param, skk};
}

// Jabatan seorang pegawai: lewat jabatan_id; data lama yang hanya menyimpan nama dicocokkan lewat nama.
export function cariJabatan(s, jabatan) {
  const j = (s?.jabatan_id && jabatan.find((x) => x.id === s.jabatan_id)) || (s?.jabatan && jabatan.find((x) => x.nama.toLowerCase() === String(s.jabatan).trim().toLowerCase()));
  return j || (s?.jabatan ? {id: null, nama: String(s.jabatan), skk: false, aktif: false} : null);
}

// ---------- tanggal ----------
export const selisihHari = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 864e5); // a - b
const iso = (d) => d.toISOString().slice(0, 10);
export const tambahHari = (t, n) => { const d = new Date(t + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
export function tambahBulan(t, n) {
  const d = new Date(t + 'T00:00:00Z'), hari = d.getUTCDate();
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n);
  const akhir = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(hari, akhir));
  return iso(d);
}
// "2 thn 3 bln" dari tanggal masuk sampai hari ini (atau tanggal keluar).
export function masaKerja(dari, sampai) {
  if (!dari || !sampai || sampai < dari) return '';
  const a = new Date(dari + 'T00:00:00Z'), b = new Date(sampai + 'T00:00:00Z');
  let bln = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth();
  if (b.getUTCDate() < a.getUTCDate()) bln--;
  const thn = Math.floor(bln / 12), sisa = bln % 12;
  if (!thn && !sisa) return selisihHari(sampai, dari) + ' hari';
  return [thn && thn + ' thn', sisa && sisa + ' bln'].filter(Boolean).join(' ');
}

// ---------- riwayat ----------
// Kontrak PKWT sebagai riwayat. Data lama (satu pasang kontrak_mulai / kontrak_berakhir) ikut dibaca.
export function kontrakDari(s) {
  let daftar = Array.isArray(s?.kontrak) ? s.kontrak : [];
  if (!daftar.length && (s?.kontrak_mulai || s?.kontrak_berakhir)) daftar = [{ke: 0, mulai: s.kontrak_mulai, berakhir: s.kontrak_berakhir}];
  return daftar.map((k, i) => ({ke: Number.isFinite(+k.ke) && k.ke !== '' && k.ke != null ? +k.ke : i, mulai: k.mulai || '', berakhir: k.berakhir || '', file: k.file || null, catatan: k.catatan || ''}))
    .sort((a, b) => a.ke - b.ke);
}
export const kontrakTerbaru = (s) => kontrakDari(s).at(-1) || null;

// Dokumen kerja untuk semua status (perjanjian kerja PKWTT, SK pengangkatan, perjanjian magang, addendum, dll),
// urut dari yang paling lama. Satu baris per dokumen; dokumen lama tidak ditimpa.
export const dokumenDari = (s) => (Array.isArray(s?.dokumen) ? s.dokumen : [])
  .map((d) => ({jenis: d.jenis || '', nomor: d.nomor || '', tanggal: d.tanggal || '', file: d.file || null, catatan: d.catatan || ''}))
  .sort((a, b) => a.tanggal.localeCompare(b.tanggal));

// Riwayat gaji, urut dari yang paling lama berlaku. Data lama (gaji/tunjangan tunggal) ikut dibaca.
export function gajiDari(s) {
  let daftar = Array.isArray(s?.gaji_riwayat) ? s.gaji_riwayat : [];
  if (!daftar.length && (angkaAtauNull(s?.gaji) != null || angkaAtauNull(s?.tunjangan) != null)) daftar = [{berlaku: s.tgl_masuk || '', gaji: s.gaji, tunjangan: s.tunjangan}];
  return daftar.map((g) => ({berlaku: g.berlaku || '', gaji: angkaAtauNull(g.gaji), tunjangan: angkaAtauNull(g.tunjangan), catatan: g.catatan || ''}))
    .sort((a, b) => a.berlaku.localeCompare(b.berlaku));
}
// Gaji saat ini = baris dengan tanggal berlaku terbaru yang sudah lewat.
export const gajiSaatIni = (s, today) => gajiDari(s).filter((g) => !g.berlaku || g.berlaku <= today).at(-1) || null;
export const totalGaji = (g) => (g ? (g.gaji || 0) + (g.tunjangan || 0) : 0);

// ---------- batas PKWT ----------
const akhirMaks = (mulai, bln) => tambahHari(tambahBulan(mulai, bln), -1);
export const namaKontrak = (ke) => (ke === 0 ? 'Kontrak awal' : 'Perpanjangan ke-' + ke);
export function cekBatasPkwt(kontrak, param) {
  const pesan = [];
  for (const k of kontrak) {
    const bln = k.ke === 0 ? param.pkwt_awal_bln : param.pkwt_perpanjangan_bln;
    if (bln && k.mulai && k.berakhir && k.berakhir > akhirMaks(k.mulai, bln)) pesan.push(namaKontrak(k.ke) + ' lebih dari ' + bln + ' bulan');
  }
  const ke = kontrak.at(-1)?.ke ?? 0;
  if (param.pkwt_maks_perpanjangan != null && ke > param.pkwt_maks_perpanjangan) pesan.push('Perpanjangan ke-' + ke + ' melebihi batas ' + param.pkwt_maks_perpanjangan + ' kali');
  return pesan;
}
export const jatahHabis = (kontrak, param) => param.pkwt_maks_perpanjangan != null && (kontrak.at(-1)?.ke ?? 0) >= param.pkwt_maks_perpanjangan;

// ---------- peringatan ----------
const sisaTeks = (sisa, apa, lewat) => (sisa < 0 ? lewat + ' ' + -sisa + ' hari lalu' : sisa === 0 ? apa + ' hari ini' : apa + ' ' + sisa + ' hari');
// -> [{jenis: 'kontrak' | 'skk' | 'magang' | 'batas', teks, berat}]; berat = sudah lewat / melanggar batas.
export function peringatanPegawai(s, jab, param, today) {
  const hasil = [];
  if (s.aktif === 'Keluar') return hasil;
  // Data lama tanpa status kerja tetapi punya tanggal kontrak diperlakukan seperti PKWT.
  if (s.status === STATUS.pkwt || (!s.status && kontrakDari(s).length)) {
    const kontrak = kontrakDari(s), akhir = kontrak.at(-1);
    if (akhir?.berakhir) {
      const sisa = selisihHari(akhir.berakhir, today);
      if (sisa <= param.hari_kontrak) hasil.push({jenis: 'kontrak', berat: sisa < 0, teks: sisaTeks(sisa, 'Kontrak habis', 'Kontrak sudah habis') + (jatahHabis(kontrak, param) ? ' · jatah perpanjangan habis' : '')});
    }
    for (const teks of cekBatasPkwt(kontrak, param)) hasil.push({jenis: 'batas', berat: true, teks});
  }
  if ((jab?.skk || s.skk_no) && s.skk_berlaku) {
    const sisa = selisihHari(s.skk_berlaku, today);
    if (sisa <= param.hari_skk) hasil.push({jenis: 'skk', berat: sisa < 0, teks: sisaTeks(sisa, 'SKK/STRA habis', 'SKK/STRA sudah habis')});
  }
  if (s.status === STATUS.magang && s.magang_selesai) {
    const sisa = selisihHari(s.magang_selesai, today);
    if (sisa <= param.hari_magang) hasil.push({jenis: 'magang', berat: sisa < 0, teks: sisaTeks(sisa, 'Magang berakhir', 'Magang sudah berakhir')});
  }
  return hasil;
}

// ---------- NIK dan nama ----------
export const normNik = (v) => String(v ?? '').replace(/[.\-\s]/g, '');
export const nikSama = (nik, semua, kecualiId) => (nik ? semua.filter((s) => s.id !== kecualiId && normNik(s.nik) === nik) : []);
const normOrang = (s) => String(s ?? '').toLowerCase().replace(/[.,']/g, ' ').replace(/\s+/g, ' ').trim();
export function namaMiripPegawai(teks, semua, kecualiId) {
  const n = normOrang(teks);
  if (n.length < 3) return [];
  return semua.filter((s) => {
    const m = normOrang(s.nama);
    return s.id !== kecualiId && m && (m === n || (m.length >= 3 && (m.includes(n) || n.includes(m))));
  }).slice(0, 5);
}

// Satu baris direktori orang (tabel 'tim') yang boleh dibaca arsitek: tanpa gaji dan data pribadi.
export const entriDirektori = (s) => ({sdm_id: s.id, nama: s.nama || '', jabatan: s.jabatan_nama || '', aktif: s.aktif !== 'Keluar', tim_proyek: !!s.tim_proyek});
export const refSdm = (id) => 'sdm:' + id;
