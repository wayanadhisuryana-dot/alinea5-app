// Keadaan aplikasi yang dipakai bersama oleh semua halaman.
import {NAMA_TABEL} from './schema.js';
import {hitung, hariIni} from './calc.js';
import {store} from './store.js';

// db: data mentah per tabel; d: data + kolom hitungan; render: diisi oleh app.js.
export const S = {db: {}, d: null, user: null, cari: '', filterProyek: '', urutKlien: {k: 'nama', arah: 1}, render: () => {}};

export async function muatData() {
  const records = await store.muat();
  S.db = Object.fromEntries(NAMA_TABEL.map((t) => [t, []]));
  for (const r of records) if (S.db[r.tabel]) S.db[r.tabel].push({...r.data, id: r.id});
  S.d = hitung(S.db, hariIni());
}
export const kosongNilai = (v) => v == null || v === '';
// Baris -> isi yang disimpan: tanpa id dan tanpa kolom kosong.
export const bersih = (data) => Object.fromEntries(Object.entries(data).filter(([k, v]) => k !== 'id' && !kosongNilai(v)));
export async function segarkan() { await muatData(); S.render(); }
