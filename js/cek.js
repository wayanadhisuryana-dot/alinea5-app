// Pengecekan format langsung saat mengetik untuk NPWP/NIK, No. HP, dan email.
// Dipakai oleh semua formulir: tanda ✓ hijau saat benar, ✕ merah saat salah.
import {h} from './ui.js';
import {normHp, normNpwp, emailSah} from './klien-util.js';

// -> {status: 'kosong' | 'benar' | 'salah', pesan, nilai (bentuk yang disimpan)}
export function periksaIsian(jenis, teks) {
  const s = String(teks ?? '').trim();
  if (!s) return {status: 'kosong', pesan: '', nilai: null};
  if (jenis === 'npwp') {
    const d = s.replace(/[.\-\s]/g, '');
    if (!/^\d+$/.test(d)) return {status: 'salah', pesan: 'Hanya boleh angka (titik dan strip diabaikan)'};
    if (d.length < 15) return {status: 'salah', pesan: 'Baru ' + d.length + ' digit, kurang ' + (15 - d.length)};
    if (d.length > 16) return {status: 'salah', pesan: d.length + ' digit, kelebihan ' + (d.length - 16)};
    return {status: 'benar', pesan: d.length === 16 ? '16 digit' : '15 digit (format lama)', nilai: normNpwp(d).nilai};
  }
  if (jenis === 'hp') {
    const r = normHp(s);
    return r.galat ? {status: 'salah', pesan: r.galat} : {status: 'benar', pesan: 'Disimpan sebagai ' + r.nilai, nilai: r.nilai};
  }
  if (jenis === 'email') {
    return emailSah(s) ? {status: 'benar', pesan: 'Format email benar', nilai: s.toLowerCase()} : {status: 'salah', pesan: 'Format email belum benar, contoh: nama@contoh.com'};
  }
  return {status: 'benar', pesan: '', nilai: s};
}

const PETUNJUK = {npwp: 'Opsional. 15 atau 16 digit.', hp: 'Contoh: 081234567890', email: 'Contoh: nama@contoh.com'};
const ATRIBUT = {npwp: {inputmode: 'numeric', placeholder: '16 digit'}, hp: {inputmode: 'tel', placeholder: '08xxxxxxxxxx'}, email: {inputmode: 'email', placeholder: 'nama@contoh.com'}};

// Membungkus sebuah <input> dengan tanda dan keterangan. NPWP menampilkan ✕ sejak mengetik
// (hitungan digitnya membantu); HP dan email baru menampilkan ✕ setelah kotaknya ditinggalkan.
export function kotakCek(input, jenis, petunjuk) {
  for (const [k, v] of Object.entries(ATRIBUT[jenis] || {})) if (!input.hasAttribute(k)) input.setAttribute(k, v);
  input.dataset.cek = jenis;
  const tanda = h('span', {class: 'cek-tanda', 'aria-hidden': 'true'});
  const ket = h('span', {class: 'cek-ket kecil', id: input.id + '-ket'});
  input.setAttribute('aria-describedby', ket.id);
  const kotak = h('div', {class: 'cek'}, h('div', {class: 'cek-isian'}, input, tanda), ket);
  let disentuh = jenis === 'npwp';
  const segar = () => {
    const r = periksaIsian(jenis, input.value);
    const tampil = r.status === 'salah' && !disentuh ? 'kosong' : r.status;
    kotak.dataset.status = tampil;
    tanda.textContent = tampil === 'benar' ? '✓' : tampil === 'salah' ? '✕' : '';
    ket.textContent = tampil === 'kosong' ? (typeof petunjuk === 'function' ? petunjuk() : petunjuk ?? PETUNJUK[jenis] ?? '') : r.pesan;
    input.setAttribute('aria-invalid', String(tampil === 'salah'));
    return r.status !== 'salah';
  };
  input.addEventListener('input', segar);
  input.addEventListener('blur', () => { disentuh = true; segar(); });
  kotak.periksa = (paksa) => { if (paksa) disentuh = true; return segar(); };
  segar();
  return kotak;
}

// Memeriksa semua kotak bercek yang tampak di dalam `akar`; mengembalikan input salah pertama (atau null).
export function cekSemua(akar) {
  let pertama = null;
  for (const kotak of akar.querySelectorAll('.cek')) {
    if (kotak.closest('[hidden]')) continue;
    if (!kotak.periksa(true) && !pertama) pertama = kotak.querySelector('input');
  }
  return pertama;
}
