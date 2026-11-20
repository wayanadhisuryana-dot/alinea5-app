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

export const BURUK = ['Terlambat', 'Lewat tempo', 'Lewat jatuh tempo', 'Sebagian - lewat tempo', 'LEWAT', 'Tinggi', 'HABIS', 'Tidak', 'Rusak', 'Hilang', 'Batal', 'BELUM ADA / CEK'];
export const WASPADA = ['Terlambat ringan', 'Tertunda - klien', 'Tertunda - internal', 'Sedang', 'Sebagian', 'Menunggu bayar', 'Dana titipan klien', 'Perlu servis', 'Data belum lengkap', 'Terbuka', 'Belum ditagih', 'Ditagih', 'Dibayar sebagian', 'Jatuh tempo hari ini'];
export const BAIK = ['Sesuai jadwal', 'Selesai', 'Lunas', 'Lancar', 'Aktif', 'Berjalan', 'Rendah', 'Ya', 'Baik'];
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
  // Dilepas dari halaman seketika saat ditutup, agar id isian tidak bentrok dengan dialog berikutnya.
  dlg.close = (...a) => { HTMLDialogElement.prototype.close.apply(dlg, a); dlg.remove(); };
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}

// Dropdown dengan pencarian untuk data master. opsi: [{v, label, sub?, grup?}].
// Nilai terpilih ada di input tersembunyi ber-id `id` (event 'change' dipicu di sana); teks yang diketik hanya untuk mencari.
export function pilihCari(id, opsi, nilai, {wajib = false, placeholder = 'Ketik untuk mencari, lalu pilih dari daftar', label = 'Cari', kosongTeks = 'Tidak ada yang cocok.', batas = 60} = {}) {
  const labelDari = (v) => opsi.find((o) => o.v === v)?.label || '';
  const nilaiEl = h('input', {type: 'hidden', id, value: nilai || ''});
  const cari = h('input', {id: id + '-cari', type: 'text', placeholder, autocomplete: 'off', role: 'combobox', 'aria-expanded': 'false', 'aria-controls': id + '-daftar', 'aria-label': label});
  const daftar = h('div', {class: 'kombo-daftar', id: id + '-daftar', role: 'listbox', hidden: true});
  const wadah = h('div', {class: 'kombo'}, nilaiEl, cari, daftar);
  const tutup = () => { daftar.hidden = true; cari.setAttribute('aria-expanded', 'false'); };
  const pilih = (v) => {
    const berubah = nilaiEl.value !== (v || '');
    nilaiEl.value = v || ''; cari.value = labelDari(v); tutup();
    if (berubah) nilaiEl.dispatchEvent(new Event('change'));
  };
  const tahan = (ev) => ev.preventDefault();
  const buka = () => {
    const q = cari.value.trim().toLowerCase(), terpilih = labelDari(nilaiEl.value).toLowerCase();
    const cocok = opsi.filter((o) => !q || q === terpilih || (o.label + ' ' + (o.sub || '')).toLowerCase().includes(q)).slice(0, batas);
    let grup = null;
    const isiDaftar = [];
    for (const o of cocok) {
      if (o.grup && o.grup !== grup) { grup = o.grup; isiDaftar.push(h('div', {class: 'kombo-grup'}, grup)); }
      isiDaftar.push(h('button', {class: 'kombo-opsi', type: 'button', role: 'option', 'aria-selected': String(o.v === nilaiEl.value), onmousedown: tahan, onclick: () => pilih(o.v)},
        h('span', null, o.label), o.sub && h('span', {class: 'kecil redup'}, ' · ' + o.sub)));
    }
    if (!cocok.length) isiDaftar.push(h('div', {class: 'kombo-kosong redup'}, kosongTeks));
    if (!wajib && nilaiEl.value) isiDaftar.push(h('button', {class: 'kombo-opsi redup', type: 'button', onmousedown: tahan, onclick: () => pilih('')}, 'Kosongkan pilihan'));
    daftar.replaceChildren(...isiDaftar);
    daftar.hidden = false; cari.setAttribute('aria-expanded', 'true');
  };
  nilaiEl.pilih = pilih;
  cari.value = labelDari(nilai);
  cari.addEventListener('focus', buka);
  cari.addEventListener('input', buka);
  cari.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !daftar.hidden) { ev.preventDefault(); ev.stopPropagation(); tutup(); }
    if (ev.key === 'Enter' && !daftar.hidden) { ev.preventDefault(); daftar.querySelector('.kombo-opsi')?.click(); }
  });
  cari.addEventListener('blur', () => setTimeout(() => { if (!wadah.contains(document.activeElement)) { if (!cari.value.trim() && !wajib) pilih(''); cari.value = labelDari(nilaiEl.value); tutup(); } }, 120));
  return wadah;
}

// Mengunduh isi (Blob atau teks) sebagai file.
export function unduh(namaFile, isiFile, tipe = 'application/json') {
  const blob = isiFile instanceof Blob ? isiFile : new Blob([isiFile], {type: tipe});
  const url = URL.createObjectURL(blob);
  const a = h('a', {href: url, download: namaFile});
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Tombol Simpan: mati dan bertuliskan "Menyimpan…" selama proses.
export async function sambilMenyimpan(tombol, fn) {
  const teks = tombol.textContent;
  tombol.disabled = true; tombol.textContent = 'Menyimpan…';
  try { return await fn(); } finally { tombol.disabled = false; tombol.textContent = teks; }
}

// Kepala tabel yang bisa diurutkan. urut: {k, arah}; kolom: [[kunci, judul, kanan?]].
export function kepalaUrut(kolom, urut, setelah) {
  return h('thead', null, h('tr', null, kolom.map(([k, judul, kanan]) => h('th', {class: kanan ? 'kanan' : null, 'aria-sort': urut.k === k ? (urut.arah > 0 ? 'ascending' : 'descending') : null},
    k ? h('button', {class: 'th-urut', type: 'button', onclick: () => { urut.arah = urut.k === k ? -urut.arah : 1; urut.k = k; setelah(); }}, judul, urut.k === k ? (urut.arah > 0 ? ' ▲' : ' ▼') : '') : judul))));
}
export const bandingkan = (a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a ?? '').localeCompare(String(b ?? ''), 'id', {numeric: true}));
