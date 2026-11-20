// Tahap 5 — Rumus aset: nilai perolehan, penyusutan komersial (garis lurus, bulanan), penyusutan fiskal
// (buku pajak, paralel), pelepasan, dan rekonsiliasi komersial vs fiskal.
// Rumus komersial SAMA dengan public.akumulasi_aset() di supabase/migrasi/5-aset.sql (dipakai untuk jurnal).
// Uang rupiah utuh; persen dalam basis poin (1250 = 12,50%). Bulan dihitung sebagai indeks: tahun × 12 + (bulan − 1).
import {bagi} from './kontrak-util.js';

export const KONDISI_ASET = ['Baik', 'Perlu servis', 'Rusak'];
export const STATUS_ASET = ['Aktif', 'Dijual', 'Dihapuskan', 'Hilang'];
export const CARA_PEROLEHAN = {tunai: 'Tunai / transfer', kredit: 'Kredit / cicilan', leasing: 'Leasing', saldo_awal: 'Saldo awal (aset lama)'};
export const JENIS_DOKUMEN_ASET = ['Pajak tahunan', 'STNK 5 tahunan', 'Lisensi', 'Garansi', 'Asuransi', 'Lainnya'];
export const METODE_FISKAL = {garis_lurus: 'Garis lurus', saldo_menurun: 'Saldo menurun'};
export const JENIS_KATEGORI = {berwujud: 'Berwujud', tak_berwujud: 'Tak berwujud'};

// ---------- bulan ----------
export const idxBulan = (t) => (t ? +String(t).slice(0, 4) * 12 + +String(t).slice(5, 7) - 1 : null);
export const bulanKe = (i) => Math.floor(i / 12) + '-' + String((i % 12) + 1).padStart(2, '0') + '-01';
export const akhirBulan = (i) => {
  const y = Math.floor(i / 12), m = (i % 12) + 1;
  return y + '-' + String(m).padStart(2, '0') + '-' + String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0');
};
// Bulan terakhir yang penyusutannya sudah "terjadi" pada tanggal t: bulan t bila t hari terakhir bulan itu, bila tidak bulan sebelumnya.
export const bulanSelesaiPada = (t) => (akhirBulan(idxBulan(t)) === String(t).slice(0, 10) ? idxBulan(t) : idxBulan(t) - 1);

// ---------- nilai perolehan ----------
const n = (v) => (v == null || v === '' ? 0 : +v);
// Nilai perolehan = harga + biaya tambahan − diskon (+ PPN bila tidak dapat dikreditkan).
export const nilaiPerolehan = (a) => n(a.harga) + n(a.biaya_tambahan) - n(a.diskon) + (a.ppn_kredit ? 0 : n(a.ppn));
// Yang dibayar / dihutangkan ke penjual.
export const totalBayar = (a) => n(a.harga) + n(a.biaya_tambahan) - n(a.diskon) + n(a.ppn);
export const disusutkan = (a, kat) => !!kat?.disusutkan && n(a.umur_bulan) > 0;
export const dilepas = (a) => !!a && a.status && a.status !== 'Aktif' && !!a.tgl_pelepasan;

// Servis yang dikapitalisasi, urut tanggal lalu waktu dibuat.
export const servisKap = (servis = []) => servis.filter((s) => s.kapitalisasi && n(s.biaya) > 0)
  .sort((a, b) => a.tanggal.localeCompare(b.tanggal) || String(a.dibuat || '').localeCompare(String(b.dibuat || '')) || String(a.id).localeCompare(String(b.id)));

// ---------- penyusutan komersial ----------
// Segmen garis lurus: mulai (indeks bulan), basis (nilai yang disusutkan), umur (bulan), awal (akumulasi sebelum segmen).
// Servis dikapitalisasi pada bulan T: nilai buku akhir bulan T + biaya − residu disusutkan ulang mulai bulan T+1 selama sisa umur baru.
function segmen(a, kat, servis, sampai) {
  let s = idxBulan(a.tgl_mulai), L = n(a.umur_bulan), A = 0, N = n(a.nilai_perolehan);
  const R = n(a.residu);
  let B = Math.max(0, N - R);
  for (const x of servisKap(servis)) {
    const T = idxBulan(x.tanggal);
    if (T >= sampai) break;
    const accT = A + bagi(B, Math.min(Math.max(T - s + 1, 0), L), L);
    N += n(x.biaya);
    A = accT;
    B = Math.max(0, N - accT - R);
    s = T + 1;
    L = Math.max(1, n(x.sisa_umur_bulan));
  }
  return {s, L, A, B};
}
// Akumulasi penyusutan komersial sampai akhir bulan berindeks X. Bulan pelepasan tidak disusutkan.
export function akumulasiSampai(a, kat, servis, X) {
  if (!disusutkan(a, kat) || !a.tgl_mulai) return 0;
  const batas = dilepas(a) ? Math.min(X, idxBulan(a.tgl_pelepasan) - 1) : X;
  const {s, L, A, B} = segmen(a, kat, servis, batas);
  return A + bagi(B, Math.min(Math.max(batas - s + 1, 0), L), L);
}
// Nilai perolehan (termasuk servis dikapitalisasi) pada tanggal t.
export const perolehanPada = (a, servis, t) => n(a.nilai_perolehan) + servisKap(servis).filter((x) => x.tanggal <= t).reduce((s, x) => s + n(x.biaya), 0);

// Nilai satu aset per tanggal: aset yang sudah dilepas atau belum diperoleh bernilai 0.
export function nilaiPada(a, kat, servis, t) {
  if (!a.tgl_perolehan || a.tgl_perolehan > t) return {perolehan: 0, akumulasi: 0, buku: 0, ada: false};
  if (dilepas(a) && a.tgl_pelepasan <= t) return {perolehan: 0, akumulasi: 0, buku: 0, ada: false, dilepas: true};
  const perolehan = perolehanPada(a, servis, t), akumulasi = akumulasiSampai(a, kat, servis, bulanSelesaiPada(t));
  return {perolehan, akumulasi, buku: perolehan - akumulasi, ada: true};
}
// Penyusutan satu bulan (indeks X).
export const susutBulan = (a, kat, servis, X) => akumulasiSampai(a, kat, servis, X) - akumulasiSampai(a, kat, servis, X - 1);
// Penyusutan komersial satu tahun kalender.
export const susutTahunKomersial = (a, kat, servis, y) => akumulasiSampai(a, kat, servis, y * 12 + 11) - akumulasiSampai(a, kat, servis, y * 12 - 1);

// Bulan terakhir yang masih bisa disusutkan (akhir segmen terakhir, atau bulan sebelum pelepasan).
export function bulanAkhirSusut(a, kat, servis) {
  if (!disusutkan(a, kat) || !a.tgl_mulai) return null;
  const {s, L} = segmen(a, kat, servis, Infinity);
  const akhir = s + L - 1;
  return dilepas(a) ? Math.min(akhir, idxBulan(a.tgl_pelepasan) - 1) : akhir;
}
// Jadwal bulanan komersial: [{bulan, susut, akumulasi, buku}].
export function jadwalKomersial(a, kat, servis) {
  const akhir = bulanAkhirSusut(a, kat, servis);
  if (akhir == null) return [];
  const rows = [];
  let sebelum = 0;
  for (let X = idxBulan(a.tgl_mulai); X <= akhir; X++) {
    const acc = akumulasiSampai(a, kat, servis, X), perolehan = perolehanPada(a, servis, akhirBulan(X));
    rows.push({bulan: bulanKe(X), susut: acc - sebelum, akumulasi: acc, buku: perolehan - acc});
    sebelum = acc;
  }
  return rows;
}
// Sisa umur (bulan) segmen yang sedang berjalan setelah bulan tanggal t — bawaan untuk servis yang dikapitalisasi.
export function sisaUmurPada(a, kat, servis, t) {
  if (!disusutkan(a, kat) || !a.tgl_mulai) return null;
  const T = idxBulan(t), {s, L} = segmen(a, kat, servis.filter((x) => x.tanggal < t), T);
  return Math.max(0, s + L - 1 - T);
}

// Pelepasan: akumulasi sampai bulan sebelum pelepasan, nilai buku, laba (+) / rugi (−).
export function hitungPelepasan(a, kat, servis) {
  if (!dilepas(a)) return null;
  const akumulasi = akumulasiSampai(a, kat, servis, idxBulan(a.tgl_pelepasan) - 1);
  const perolehan = perolehanPada(a, servis, a.tgl_pelepasan), buku = perolehan - akumulasi;
  return {perolehan, akumulasi, buku, nilai_jual: n(a.nilai_jual), laba: n(a.nilai_jual) - buku};
}

// ---------- penyusutan fiskal (buku pajak) ----------
// Tahun pajak = tahun kalender. Bangunan (kelompok tanpa tarif saldo menurun) selalu garis lurus.
// Tahun pertama proporsional jumlah bulan; tahun terakhir masa manfaat: sisa disusutkan sekaligus.
// Servis dikapitalisasi menambah nilai sisa buku fiskal mulai tahun berikutnya.
// Hasil null bila tidak disusutkan secara fiskal (kategori tidak disusutkan atau kelompok belum diisi).
export function hitungFiskal(a, kat, servis, kelompok, metode = 'garis_lurus') {
  if (!kat?.disusutkan || !kelompok || !(n(kelompok.masa_tahun) > 0) || !a.tgl_perolehan) return null;
  const sm = metode === 'saldo_menurun' && kelompok.tarif_sm_bp != null;
  const tarif = sm ? n(kelompok.tarif_sm_bp) : n(kelompok.tarif_gl_bp);
  const F = idxBulan(a.bulan_fiskal || a.tgl_perolehan), E = F + n(kelompok.masa_tahun) * 12 - 1;
  const D = dilepas(a) ? idxBulan(a.tgl_pelepasan) : Infinity;
  const tambah = new Map();
  for (const x of servisKap(servis)) { const y = +x.tanggal.slice(0, 4); tambah.set(y, (tambah.get(y) || 0) + n(x.biaya)); }
  const N = n(a.nilai_perolehan), tahun = [];
  let nsb = N, basis = N, lepas = null;
  for (let y = Math.floor(F / 12); y <= Math.floor(F / 12) + 200; y++) {
    if (D <= y * 12 - 1) break;
    const awal = nsb, mulai = Math.max(F, y * 12), akhir = Math.min(y * 12 + 11, E, D - 1), cnt = Math.max(0, akhir - mulai + 1);
    const sapu = (E >= y * 12 && E <= y * 12 + 11 && E <= D - 1) || (y * 12 > E && D > y * 12);
    const susut = awal <= 0 ? 0 : sapu ? awal : Math.min(awal, bagi(sm ? awal : basis, tarif * cnt, 120000));
    nsb = awal - susut;
    const t = tambah.get(y) || 0;
    tahun.push({tahun: y, bulan: cnt, nsb_awal: awal, susut, nsb_akhir: nsb, tambahan: t});
    nsb += t; basis += t;
    if (D <= y * 12 + 11) { lepas = {nsb, laba: n(a.nilai_jual) - nsb}; break; }
    if (nsb <= 0 && y * 12 + 11 >= E && ![...tambah.keys()].some((k) => k > y)) break;
  }
  // Rincian bulanan: susut tahunan dibagi rata ke bulan yang dihitung (tahun sapu tanpa bulan: di bulan Januari).
  const bulanan = [];
  for (const t of tahun) {
    if (!t.susut) continue;
    const mulai = Math.max(F, t.tahun * 12), k = t.bulan || 1;
    for (let i = 1; i <= k; i++) bulanan.push({bulan: bulanKe(mulai + i - 1), susut: bagi(t.susut, i, k) - bagi(t.susut, i - 1, k)});
  }
  return {metode: sm ? 'saldo_menurun' : 'garis_lurus', tarif_bp: tarif, tahun, bulanan, lepas, nsb};
}
export const susutTahunFiskal = (fis, y) => fis?.tahun.find((t) => t.tahun === y)?.susut || 0;
// Nilai sisa buku fiskal pada akhir tahun y.
export const nsbAkhirTahun = (fis, y) => {
  if (!fis) return null;
  const t = fis.tahun.filter((x) => x.tahun <= y).at(-1);
  return t ? t.nsb_akhir + t.tambahan : null;
};

// Rekonsiliasi komersial vs fiskal untuk tahun y.
// koreksi = efek ke penghasilan kena pajak: penyusutan (komersial − fiskal) + laba pelepasan (fiskal − komersial).
export function rekonsiliasi(baris, y) {
  const rows = baris.map(({a, kat, servis, kelompok, metode}) => {
    const fis = hitungFiskal(a, kat, servis, kelompok, metode);
    const kom = susutTahunKomersial(a, kat, servis, y), fs = susutTahunFiskal(fis, y);
    const lepasTahun = dilepas(a) && +a.tgl_pelepasan.slice(0, 4) === y;
    const lk = lepasTahun ? hitungPelepasan(a, kat, servis).laba : null;
    const lf = lepasTahun ? (fis?.lepas?.laba ?? n(a.nilai_jual) - (perolehanPada(a, servis, a.tgl_pelepasan))) : null;
    const koreksi_susut = kom - fs, koreksi_lepas = lepasTahun ? lf - lk : 0;
    return {a, kom, fis: fs, koreksi_susut, laba_kom: lk, laba_fis: lf, koreksi_lepas, koreksi: koreksi_susut + koreksi_lepas, tanpa_kelompok: !!kat?.disusutkan && !kelompok};
  }).filter((r) => r.kom || r.fis || r.laba_kom != null);
  const total = (k) => rows.reduce((s, r) => s + (r[k] || 0), 0);
  return {rows, total: {kom: total('kom'), fis: total('fis'), koreksi_susut: total('koreksi_susut'), laba_kom: total('laba_kom'), laba_fis: total('laba_fis'),
    koreksi_lepas: total('koreksi_lepas'), koreksi: total('koreksi')}};
}

// ---------- kode aset ----------
// <prefix>-<nomor 3 digit>, nomor = nomor terbesar dengan prefix itu + 1.
export function kodeAsetBerikut(prefix, kodeAda) {
  const p = String(prefix || '').trim().toUpperCase(), pola = new RegExp('^' + p.replace(/[^A-Z0-9]/g, '') + '-(\\d+)$');
  const maks = Math.max(0, ...kodeAda.map((k) => +(pola.exec(k)?.[1] || 0)));
  return p + '-' + String(maks + 1).padStart(3, '0');
}
export const prefixSah = (p) => /^[A-Z0-9]{1,6}$/.test(String(p || ''));
// Umur dalam tahun (boleh desimal ,5) -> bulan.
export const tahunKeBulan = (t) => (t == null || t === '' ? null : Math.round(+t * 12));
export const bulanKeTahun = (b) => (b == null ? '' : +(b / 12).toFixed(2));

// ---------- ringkasan untuk daftar, dashboard, dan notifikasi ----------
const tambahHariT = (t, d) => { const x = new Date(String(t).slice(0, 10) + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };
const kelompokkan = (rows) => { const m = new Map(); for (const r of rows || []) (m.get(r.aset_id) || m.set(r.aset_id, []).get(r.aset_id)).push(r); return m; };
// Semua aset dengan nilai per tanggal t dan peringatannya.
// Peringatan: dokumen terbaru per jenis yang habis atau habis dalam hariDokumen hari; kondisi selain Baik (hanya aset aktif).
export function ringkasAset(K, t, {hariDokumen = 30} = {}) {
  const kat = new Map((K.aset_kategori || []).map((k) => [k.id, k])), kel = new Map((K.kelompok_fiskal || []).map((k) => [k.id, k]));
  const lok = new Map((K.aset_lokasi || []).map((k) => [k.id, k]));
  const servis = kelompokkan(K.aset_servis), dok = kelompokkan(K.aset_dokumen), mutasi = kelompokkan(K.aset_mutasi);
  const batas = tambahHariT(t, hariDokumen);
  return (K.aset || []).map((a) => {
    const k = kat.get(a.kategori_id) || null, sv = (servis.get(a.id) || []).slice().sort((x, y) => x.tanggal.localeCompare(y.tanggal));
    const v = nilaiPada(a, k, sv, t);
    const terbaru = new Map();
    for (const d of dok.get(a.id) || []) if (d.berlaku_sd && (!terbaru.has(d.jenis) || terbaru.get(d.jenis).berlaku_sd < d.berlaku_sd)) terbaru.set(d.jenis, d);
    const aktif = a.status === 'Aktif';
    const peringatan = aktif ? [
      ...[...terbaru.values()].filter((d) => d.berlaku_sd <= batas).sort((x, y) => x.berlaku_sd.localeCompare(y.berlaku_sd))
        .map((d) => ({jenis: 'dokumen', dokumen: d, tanggal: d.berlaku_sd, habis: d.berlaku_sd < t})),
      ...(a.kondisi && a.kondisi !== 'Baik' ? [{jenis: 'kondisi', kondisi: a.kondisi}] : []),
    ] : [];
    return {...a, kat: k, kategori_nama: k?.nama || '—', jenis_kategori: k?.jenis || 'berwujud', kelompok: kel.get(a.kelompok_id) || null,
      lokasi_nama: lok.get(a.lokasi_id)?.nama || null, servis: sv, dokumen: (dok.get(a.id) || []).slice().sort((x, y) => String(y.berlaku_sd || '').localeCompare(String(x.berlaku_sd || ''))),
      mutasi: (mutasi.get(a.id) || []).slice().sort((x, y) => y.tanggal.localeCompare(x.tanggal) || String(y.dibuat || '').localeCompare(String(x.dibuat || ''))),
      perolehan_pada: v.perolehan, akumulasi: v.akumulasi, buku: v.buku, ada: v.ada, peringatan};
  });
}
