// Tahap 6 — Rumus hutang lain: jadwal angsuran (flat, anuitas, efektif, tanpa bunga), sisa pokok, status,
// angsuran berikutnya, dan pemisahan jangka pendek (≤ 12 bulan) / jangka panjang.
// Uang rupiah utuh; suku bunga dalam basis poin per tahun (1000 = 10,00% per tahun).
// Pemeriksaan jadwal (total pokok, nomor angsuran) SAMA dengan public.simpan_jadwal_hutang() di supabase/migrasi/6-hutang.sql.
import {bagi} from './kontrak-util.js';

export const JENIS_HUTANG = {kredit_bank: 'Kredit bank', leasing: 'Leasing', pinjaman_pemilik: 'Pinjaman pemilik', pinjaman_lain: 'Pinjaman pihak lain',
  sewa: 'Sewa terutang', lainnya: 'Lainnya'};
export const METODE_BUNGA = {flat: 'Flat', anuitas: 'Anuitas', efektif: 'Efektif (menurun)', tanpa: 'Tanpa bunga'};
export const CARA_HUTANG = {tunai: 'Dana diterima ke rekening', aset: 'Kredit / leasing pembelian aset', saldo_awal: 'Saldo awal (pinjaman lama)'};
export const STATUS_HUTANG = ['Lancar', 'Terlambat', 'Lunas'];

const n = (v) => (v == null || v === '' ? 0 : +v);
const hariDalam = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m = 1..12
const tambahHari = (t, x) => new Date(Date.parse(t + 'T00:00:00Z') + x * 864e5).toISOString().slice(0, 10);

// Akun hutang menurut jenis: bank & leasing 2-8; pinjaman pemilik atau kreditur afiliasi 2-9; lainnya 2-10.
export function akunHutang(jenis, afiliasi) {
  if (jenis === 'kredit_bank' || jenis === 'leasing') return '2-8';
  if (jenis === 'pinjaman_pemilik' || afiliasi) return '2-9';
  return '2-10';
}

// Tanggal angsuran: bulan dari tanggal t ditambah i bulan, pada tanggal "hari" (dipotong ke akhir bulan bila bulannya lebih pendek).
export function tanggalBulan(t, i, hari) {
  const y0 = +String(t).slice(0, 4), m0 = +String(t).slice(5, 7) - 1 + i;
  const y = y0 + Math.floor(m0 / 12), m = ((m0 % 12) + 12) % 12 + 1;
  const d = Math.min(Math.max(1, n(hari) || +String(t).slice(8, 10)), hariDalam(y, m));
  return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}

// Jadwal otomatis. tglPertama: tanggal bulan angsuran pertama (bawaan: sebulan setelah tanggal mulai).
// Pokok dibagi rata dengan pembulatan kumulatif (jumlahnya tepat sama dengan pokok); anuitas: angsuran tetap, angsuran terakhir menutup sisa.
export function buatJadwal({pokok, bunga_bp = 0, metode = 'flat', tenor_bulan, tgl_mulai, hari_angsuran}, {tglPertama, mulaiKe = 1} = {}) {
  const P = n(pokok), L = n(tenor_bulan), bp = metode === 'tanpa' ? 0 : n(bunga_bp);
  if (!(P > 0) || !(Number.isInteger(L) && L > 0) || !(tglPertama || tgl_mulai)) return [];
  const awal = tglPertama || tanggalBulan(tgl_mulai, 1, hari_angsuran);
  const tanggal = (i) => tanggalBulan(awal, i, hari_angsuran || +String(awal).slice(8, 10));
  const rows = [];
  let saldo = P;
  let A = 0;
  if (metode === 'anuitas' && bp > 0) {
    const r = bp / 120000;
    A = Math.round((P * r) / (1 - Math.pow(1 + r, -L)));
  }
  for (let i = 1; i <= L; i++) {
    let pk, bg;
    if (metode === 'anuitas' && bp > 0) {
      bg = bagi(saldo, bp, 120000);
      pk = i === L ? saldo : Math.min(saldo, A - bg);
    } else {
      pk = bagi(P, i, L) - bagi(P, i - 1, L);
      bg = metode === 'flat' ? bagi(P, bp, 120000) : metode === 'efektif' ? bagi(saldo, bp, 120000) : 0;
    }
    rows.push({ke: mulaiKe + i - 1, tanggal: tanggal(i - 1), pokok: pk, bunga: bg});
    saldo -= pk;
  }
  return rows;
}

// Pembayaran per angsuran (nomor angsuran = ke). Pembayaran tanpa nomor (pelunasan / bayar lebih) hanya mengurangi sisa pokok.
const dibayarPer = (bayar) => {
  const m = new Map();
  for (const b of bayar) if (b.angsuran_ke != null) {
    const x = m.get(b.angsuran_ke) || {pokok: 0, bunga: 0, denda: 0};
    x.pokok += n(b.pokok); x.bunga += n(b.bunga); x.denda += n(b.denda);
    m.set(b.angsuran_ke, x);
  }
  return m;
};

// Bagian jadwal yang dipertahankan saat jadwal diganti (impor / buat ulang): angsuran sampai nomor terakhir yang sudah ada pembayarannya.
// target = total pokok yang harus dimuat jadwal baru: pokok pinjaman (belum ada pembayaran) atau sisa pokok − sisa angsuran yang dipertahankan.
export function targetJadwal(hu, angsuran, bayar) {
  const per = dibayarPer(bayar);
  const K = Math.max(0, ...[...per.keys()]);
  const sisa = sisaPokok(hu, bayar);
  if (!K) return {K: 0, target: n(hu.pokok), sisa, dipertahankan: []};
  const dipertahankan = angsuran.filter((a) => a.ke <= K);
  const sebelum = (a) => hu.cara === 'saldo_awal' && hu.tgl_saldo_awal && a.tanggal < hu.tgl_saldo_awal;
  const sisaLama = dipertahankan.reduce((t, a) => t + (sebelum(a) ? 0 : Math.max(0, n(a.pokok) - (per.get(a.ke)?.pokok || 0))), 0);
  return {K, target: sisa - sisaLama, sisa, dipertahankan};
}

// Pemeriksaan jadwal baru: daftar pesan galat (kosong = sah).
export function periksaJadwal(rows, {K = 0, target}) {
  const galat = [];
  const ke = new Set();
  rows.forEach((r, i) => {
    const b = 'Baris ' + (r.no ?? i + 1) + ': ';
    if (!Number.isInteger(r.ke) || r.ke < 1) galat.push(b + 'nomor angsuran harus bilangan bulat ≥ 1.');
    else if (ke.has(r.ke)) galat.push(b + 'angsuran ke-' + r.ke + ' dobel.');
    else if (r.ke <= K) galat.push(b + 'angsuran ke-' + r.ke + ' sudah ada pembayarannya; jadwal baru harus mulai dari angsuran ke-' + (K + 1) + '.');
    ke.add(r.ke);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(r.tanggal || ''))) galat.push(b + 'tanggal tidak sah.');
    if (!Number.isInteger(r.pokok) || r.pokok < 0) galat.push(b + 'pokok harus rupiah utuh, tidak minus.');
    if (!Number.isInteger(r.bunga) || r.bunga < 0) galat.push(b + 'bunga harus rupiah utuh, tidak minus.');
  });
  if (!rows.length) galat.push('Jadwal kosong.');
  const total = rows.reduce((t, r) => t + (Number.isInteger(r.pokok) ? r.pokok : 0), 0);
  if (target != null && total !== target) {
    galat.push('Total pokok jadwal Rp ' + total.toLocaleString('id-ID') + ' tidak sama dengan ' + (K ? 'sisa pokok yang dijadwalkan ulang' : 'pokok pinjaman') + ' Rp ' + target.toLocaleString('id-ID') + '.');
  }
  return galat;
}

export const sisaPokok = (hu, bayar) => (hu.cara === 'saldo_awal' ? n(hu.sisa_pokok_awal) : n(hu.pokok)) - bayar.reduce((t, b) => t + n(b.pokok), 0);

// Ringkasan satu hutang pada tanggal today. hariNotif: batas H-X untuk peringatan "segera jatuh tempo".
export function ringkasHutang(hu, angsuran, bayar, today, {hariNotif = 14} = {}) {
  const per = dibayarPer(bayar);
  const sisa = sisaPokok(hu, bayar);
  const lunas = sisa <= 0;
  const sebelum = (a) => hu.cara === 'saldo_awal' && hu.tgl_saldo_awal && a.tanggal < hu.tgl_saldo_awal;
  const rows = angsuran.slice().sort((a, b) => a.ke - b.ke).map((a) => {
    const p = per.get(a.ke) || {pokok: 0, bunga: 0, denda: 0};
    const total = n(a.pokok) + n(a.bunga), dibayar = p.pokok + p.bunga;
    const selesai = dibayar >= total && total > 0;
    const status = sebelum(a) ? 'Sebelum aplikasi' : selesai ? 'Lunas' : lunas ? 'Ditutup' : a.tanggal < today ? 'Terlambat' : a.tanggal === today ? 'Jatuh tempo hari ini' : 'Belum jatuh tempo';
    const terbuka = !['Sebelum aplikasi', 'Lunas', 'Ditutup'].includes(status);
    return {...a, total, dibayar_pokok: p.pokok, dibayar_bunga: p.bunga, dibayar_denda: p.denda, kurang: terbuka ? Math.max(0, total - dibayar) : 0,
      kurang_pokok: terbuka ? Math.max(0, n(a.pokok) - p.pokok) : 0, status, terbuka};
  });
  const buka = rows.filter((r) => r.terbuka);
  const berikut = buka[0] || null;
  const terlambat = buka.filter((r) => r.tanggal < today);
  const batas12 = tanggalBulan(today, 12, +today.slice(8, 10));
  const dalam12 = buka.filter((r) => r.tanggal <= batas12).reduce((t, r) => t + r.kurang_pokok, 0);
  const pendek = lunas ? 0 : buka.length ? Math.min(sisa, dalam12) : sisa;
  const bulanIni = today.slice(0, 7);
  const jatuhBulanIni = buka.filter((r) => r.tanggal.slice(0, 7) === bulanIni).reduce((t, r) => t + r.kurang, 0);
  const sisaTerjadwal = buka.reduce((t, r) => t + r.kurang_pokok, 0);
  const peringatan = [];
  if (!lunas) {
    if (terlambat.length) peringatan.push({jenis: 'terlambat', teks: terlambat.length + ' angsuran terlambat (sejak ' + terlambat[0].tanggal.split('-').reverse().join('/') + ')'});
    else if (berikut && berikut.tanggal <= tambahHari(today, hariNotif)) peringatan.push({jenis: 'segera', teks: berikut.tanggal === today ? 'Jatuh tempo hari ini' : 'Jatuh tempo ' + berikut.tanggal.split('-').reverse().join('/')});
    if (!angsuran.length) peringatan.push({jenis: 'jadwal', teks: 'Belum ada jadwal angsuran'});
    else if (sisaTerjadwal !== sisa) peringatan.push({jenis: 'jadwal', teks: 'Jadwal perlu diperbarui (sisa pokok terjadwal ' + sisaTerjadwal.toLocaleString('id-ID') + ' ≠ sisa pokok ' + sisa.toLocaleString('id-ID') + ')'});
  }
  return {
    ...hu, jadwal: rows, bayar, sisa_pokok: Math.max(0, sisa), pokok_dibayar: bayar.reduce((t, b) => t + n(b.pokok), 0),
    bunga_dibayar: bayar.reduce((t, b) => t + n(b.bunga), 0), denda_dibayar: bayar.reduce((t, b) => t + n(b.denda), 0),
    status: lunas ? 'Lunas' : terlambat.length ? 'Terlambat' : 'Lancar', berikut, terlambat, jangka_pendek: pendek, jangka_panjang: Math.max(0, sisa) - pendek,
    jatuh_bulan_ini: jatuhBulanIni, peringatan,
  };
}

// Semua hutang dari data keuangan.
export function ringkasSemuaHutang(K, today, opsi) {
  if (K.hutang_siap === false || !K.hutang) return [];
  const kred = new Map((K.kreditur || []).map((k) => [k.id, k]));
  return K.hutang.map((hu) => ({...ringkasHutang(hu, K.hutang_angsuran.filter((a) => a.hutang_id === hu.id), K.hutang_bayar.filter((b) => b.hutang_id === hu.id), today, opsi),
    kreditur: kred.get(hu.kreditur_id) || null, kreditur_nama: kred.get(hu.kreditur_id)?.nama || '—', afiliasi: !!kred.get(hu.kreditur_id)?.afiliasi}));
}
