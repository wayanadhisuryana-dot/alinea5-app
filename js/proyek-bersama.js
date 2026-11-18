// Tahap 4: bagian layar yang dipakai bersama oleh Pihak Proyek, Pembelian, Dompet, dan Detail Proyek.
import {S} from './state.js';
import {hak} from './akses.js';
import {h, idn, isi, dialog, bandingkan} from './ui.js';
import {kartuBelumSiap} from './keuangan.js';
import {bpKePersen} from './kontrak-util.js';

export const K = () => S.keu;
export const proyekDari = (kode) => S.d.proyek.find((p) => p.kode === kode);
export const namaProyek = (kode) => (kode ? kode + ' — ' + isi(proyekDari(kode)?.nama) : 'Stok kantor');
export const persenBp = (bp) => idn(bpKePersen(bp), 2) + '%';
export const pct = (x) => (x == null ? '—' : idn(x * 100, 1) + '%');
export const angkaId = (x) => Number(x).toLocaleString('id-ID', {maximumFractionDigits: 3});
export const bacaAngka = (v) => { const s = String(v ?? '').trim().replace(/\./g, '').replace(',', '.'); return s === '' ? null : /^\d+(\.\d{1,3})?$/.test(s) ? +s : NaN; };
export const bacaDesimalId = (v) => { const s = String(v ?? '').trim().replace(',', '.'); return s === '' ? null : /^\d+(\.\d{1,3})?$/.test(s) ? +s : NaN; };
export const rincian = (baris) => h('dl', {class: 'rincian'}, baris.filter((b) => b && b[1] != null && b[1] !== '').flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)]));
export const ubin = (label, nilai, kakiTeks, o = {}) => h('div', {class: 'ubin' + (o.buruk ? ' ubin-buruk' : '')},
  h('span', {class: 'ubin-label'}, label), h('span', {class: 'ubin-nilai'}, nilai), h('span', {class: 'ubin-kaki'}, kakiTeks));
export const dialogLebar = (judul, isiDialog) => { const d = dialog(judul, isiDialog); d.classList.add('dialog-lebar'); return d; };
// Data keuangan proyek bisa dibaca bila punya hak salah satu menu keuangan proyek (sama dengan public.baca_keuangan_proyek).
export const bacaKeuangan = () => ['kontrak', 'termin', 'pihak_proyek', 'pembelian', 'kas', 'jurnal'].some((k) => hak(k) != null);

export const opsiProyek = () => S.db.proyek.slice().sort((a, b) => bandingkan(a.kode, b.kode)).map((p) => ({v: p.kode, label: p.kode + ' — ' + isi(p.nama), sub: p.status}));
export const opsiVendor = (kecuali) => S.db.vendor_tukang.filter((v) => v.aktif !== false || v.id === kecuali).sort((a, b) => bandingkan(a.nama, b.nama))
  .map((v) => ({v: v.id, label: v.nama, sub: [v.jenis, v.aktif === false && 'nonaktif'].filter(Boolean).join(' · ')}));
export const opsiSupplier = (kecuali) => S.db.supplier.filter((v) => v.aktif !== false || v.id === kecuali).sort((a, b) => bandingkan(a.nama, b.nama))
  .map((v) => ({v: v.id, label: v.nama, sub: [v.pkp && 'PKP', v.aktif === false && 'nonaktif'].filter(Boolean).join(' · ')}));
export const opsiBarang = (jenis, kecuali = []) => S.db.barang.filter((b) => (b.jenis || 'barang') === jenis && (b.aktif !== false || kecuali.includes(b.id)))
  .sort((a, b) => bandingkan(a.nama, b.nama)).map((b) => ({v: b.id, label: b.nama, sub: [b.kode, b.merk, b.satuan].filter(Boolean).join(' · ')}));
export const barangDari = (id) => S.db.barang.find((b) => b.id === id);
// Harga terakhir (riwayat Barang & Harga) untuk mengisi harga satuan bawaan. Dari pihak yang sama bila ada.
export function hargaTerakhir(barangId, pihakId, satuan) {
  const rows = S.db.harga.filter((x) => x.barang_id === barangId && (!satuan || x.satuan === satuan)).sort((a, b) => bandingkan(b.tanggal, a.tanggal));
  return (rows.find((x) => x.pihak_id === pihakId) || rows[0])?.harga ?? null;
}
// Pemeriksa opname: anggota Tim Proyek (pengawas / PIC dulu).
export function pemeriksaProyek(kode) {
  const tim = (proyekDari(kode)?.tim || []).filter((a) => a.ref);
  const urut = {Pengawas: 0, PIC: 1};
  return tim.slice().sort((a, b) => (urut[a.peran] ?? 9) - (urut[b.peran] ?? 9) || bandingkan(a.nama, b.nama))
    .map((a) => ({v: a.ref, label: a.nama + (a.peran ? ' (' + a.peran + ')' : ''), nama: a.nama}));
}

export function belumSiap(el) {
  if (!K().siap) { kartuBelumSiap(el); return true; }
  if (K().proyek_siap === false) {
    el.append(h('div', {class: 'kartu'}, h('h2', null, 'Database Tahap 4 belum dipasang'),
      h('p', null, 'Bagian ini memerlukan pembaruan database Tahap 4. Jalankan SQL file supabase/migrasi/4-proyek.sql di Supabase SQL Editor, lalu muat ulang halaman.')));
    return true;
  }
  return false;
}
