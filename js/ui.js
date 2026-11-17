// Alat bantu tampilan yang dipakai semua halaman.
import {n} from './calc.js';

// ---------- alat bantu ----------
export const h = (tag, attrs, ...anak) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'style') Object.assign(e.style, v);
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, v);
  }
  e.append(...anak.flat(Infinity).filter((x) => x != null && x !== false));
  return e;
};
export const idn = (x, d = 0) => Number(x).toLocaleString('id-ID', {maximumFractionDigits: d});
export const rp = (v) => 'Rp ' + idn(Math.round(n(v)));
export const rpRingkas = (v) => {
  const x = n(v), a = Math.abs(x);
  if (a >= 1e9) return 'Rp ' + idn(x / 1e9, 2) + ' M';
  if (a >= 1e6) return 'Rp ' + idn(x / 1e6, 1) + ' jt';
  return 'Rp ' + idn(x);
};
export const persen = (v, d = 0) => (v == null || v === '' ? '—' : idn(n(v) * 100, d) + '%');
export const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
export const tgl = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
  return m ? +m[3] + ' ' + BULAN[+m[2] - 1] + ' ' + m[1] : '—';
};
// Isian rupiah: diketik dengan pemisah ribuan, dibaca kembali sebagai angka (atau null bila kosong).
export const formatUang = (teks) => {
  const minus = /^\s*-/.test(teks), angka = String(teks).replace(/\D/g, '');
  return angka ? (minus ? '-' : '') + idn(angka) : '';
};
export const bacaUang = (teks) => {
  const d = String(teks ?? '').replace(/\./g, '').replace(/[^\d-]/g, '');
  return d === '' || d === '-' ? null : +d;
};
export const ukuranFile = (b) => (b >= 1048576 ? idn(b / 1048576, 1) + ' MB' : idn(Math.max(1, Math.ceil(b / 1024))) + ' KB');
export const kosong = (v) => v == null || v === '';
export const isi = (v) => (kosong(v) ? '—' : String(v));

export const BURUK = ['Terlambat', 'Lewat tempo', 'Sebagian - lewat tempo', 'LEWAT', 'Tinggi', 'HABIS', 'Tidak', 'Rusak', 'Hilang', 'Batal', 'BELUM ADA / CEK'];
export const WASPADA = ['Terlambat ringan', 'Tertunda - klien', 'Tertunda - internal', 'Sedang', 'Sebagian', 'Menunggu bayar', 'Dana titipan klien', 'Perlu servis', 'Data belum lengkap', 'Terbuka', 'Belum ditagih'];
export const BAIK = ['Sesuai jadwal', 'Selesai', 'Lunas', 'Aktif', 'Berjalan', 'Rendah', 'Ya', 'Baik'];
export const pill = (v) => {
  if (kosong(v)) return '—';
  const t = String(v);
  const jenis = BURUK.includes(t) ? 'buruk' : WASPADA.includes(t) || t.startsWith('≤') ? 'waspada' : BAIK.includes(t) ? 'baik' : 'netral';
  return h('span', {class: 'pill pill-' + jenis}, t);
};
export const batangProgres = (v) => (v == null ? '—' : h('div', {class: 'prog'},
  h('div', {class: 'prog-jalur'}, h('div', {class: 'prog-isi', style: {width: Math.max(0, Math.min(100, n(v) * 100)) + '%'}})),
  h('span', null, persen(v))));

export const FORMAT = {
  uang: (v) => (kosong(v) ? '—' : rp(v)),
  persen: (v) => persen(v),
  persen1: (v) => persen(v, 1),
  tanggal: (v) => tgl(v),
  angka: (v) => (kosong(v) ? '—' : idn(v)),
  desimal: (v) => (kosong(v) ? '—' : idn(v, 1)),
  pill, progres: batangProgres,
};
export const RATA_KANAN = ['uang', 'persen', 'persen1', 'angka', 'desimal'];

export const pesan = (teks, jenis = 'info') => {
  const el = h('div', {class: 'toast toast-' + jenis, role: 'status'}, teks);
  document.body.append(el);
  setTimeout(() => el.remove(), 4500);
};
// Membungkus aksi tombol: galat ditampilkan sebagai pesan, dan selama aksi berjalan klik
// berikutnya diabaikan serta tombolnya dimatikan (mencegah simpan ganda).
export const aman = (fn) => {
  let jalan = false;
  return async (...a) => {
    if (jalan) return;
    jalan = true;
    const t = a[0]?.currentTarget;
    const tombol = typeof HTMLButtonElement !== 'undefined' && t instanceof HTMLButtonElement && !t.disabled ? t : null;
    if (tombol) tombol.disabled = true;
    try { await fn(...a); } catch (e) { console.error(e); pesan(e.message || String(e), 'galat'); } finally {
      jalan = false;
      if (tombol) tombol.disabled = false;
    }
  };
};
// Seperti aman() tetapi tanpa menangkap galat: untuk onsubmit formulir yang menampilkan galatnya sendiri.
export const sekali = (fn) => {
  let jalan = false;
  return async (...a) => {
    a[0]?.preventDefault?.();
    if (jalan) return;
    jalan = true;
    try { await fn(...a); } finally { jalan = false; }
  };
};

// Pengaman: nilai false/undefined yang tidak sengaja ikut tampil sebagai teks dibuang dari layar.
export function buangTeksPalsu(akar) {
  const jalan = document.createTreeWalker(akar, NodeFilter.SHOW_TEXT);
  const buang = [];
  while (jalan.nextNode()) if (/^(false|undefined|null)$/.test(jalan.currentNode.nodeValue.trim())) buang.push(jalan.currentNode);
  for (const t of buang) { console.warn('Teks "' + t.nodeValue + '" dibuang dari', t.parentElement); t.remove(); }
}

export function dialog(judul, isiDialog) {
  const dlg = h('dialog', {class: 'dialog'}, h('h2', null, judul), isiDialog);
  buangTeksPalsu(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}
