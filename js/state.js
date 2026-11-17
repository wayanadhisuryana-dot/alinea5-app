// Keadaan aplikasi yang dipakai bersama oleh semua halaman.
import {NAMA_TABEL, terapkanOpsi} from './schema.js';
import {hitung, hariIni} from './calc.js';
import {store} from './store.js';
import {entriDirektori} from './sdm-util.js';

// db: data mentah per tabel; d: data + kolom hitungan; render: diisi oleh app.js.
export const S = {
  db: {}, d: null, user: null, cari: '', filterProyek: '', urutKlien: {k: 'nama', arah: 1}, pengaturan: null, render: () => {},
  urutSdm: {k: 'nama', arah: 1}, saringSdm: {aktif: 'Aktif', status: '', peringatan: false}, tabSdm: 'profil',
};

export async function muatData(sudahSinkron = false) {
  const records = await store.muat();
  S.db = Object.fromEntries(NAMA_TABEL.map((t) => [t, []]));
  for (const r of records) if (S.db[r.tabel]) S.db[r.tabel].push({...r.data, id: r.id});
  // Pengaturan aplikasi (pilihan dropdown, jabatan, parameter peringatan) disimpan sebagai satu catatan.
  S.pengaturan = records.find((r) => r.tabel === 'pengaturan') || null;
  terapkanOpsi(S.pengaturan?.data?.opsi);
  S.d = hitung(S.db, hariIni(), S.pengaturan?.data);
  if (!sudahSinkron && S.user?.role === 'admin' && await sinkronDirektori()) await muatData(true);
}

// Admin: menyamakan direktori orang (tabel 'tim', dibaca arsitek untuk Tim Proyek) dengan data SDM,
// dan mengisi jabatan_id pada data pegawai lama yang baru menyimpan nama jabatan. true bila ada perubahan.
async function sinkronDirektori() {
  const kerja = [];
  const direktori = new Map(S.db.tim.filter((r) => r.sdm_id).map((r) => [r.sdm_id, r]));
  for (const s of S.d.sdm) {
    const entri = entriDirektori(s), lama = direktori.get(s.id);
    direktori.delete(s.id);
    if (!lama || Object.keys(entri).some((k) => lama[k] !== entri[k])) kerja.push(store.simpan('tim', lama?.id, entri));
    const mentah = S.db.sdm.find((x) => x.id === s.id);
    if (!mentah.jabatan_id && s.jabatan_id) kerja.push(store.simpan('sdm', s.id, bersih({...mentah, jabatan_id: s.jabatan_id})));
  }
  for (const sisa of direktori.values()) kerja.push(store.hapus(sisa.id));
  if (!kerja.length) return false;
  try { await Promise.all(kerja); } catch (e) { console.error('Sinkron direktori gagal', e); return false; }
  return true;
}

export const kosongNilai = (v) => v == null || v === '';
// Baris -> isi yang disimpan: tanpa id dan tanpa kolom kosong.
export const bersih = (data) => Object.fromEntries(Object.entries(data).filter(([k, v]) => k !== 'id' && !kosongNilai(v)));
export async function segarkan() { await muatData(); S.render(); }
