// Tahap 3 — rumus Kontrak Klien, Termin & Piutang. Fungsi murni (tanpa layar, tanpa database) sehingga
// dipakai bersama oleh mesin demo, layar, dan uji otomatis. Rumus yang sama ditulis ulang di
// supabase/migrasi/3-kontrak.sql; keduanya harus selalu sama.
// Uang: rupiah utuh. Persen tarif PPN dan retensi disimpan dalam basis poin (1100 = 11,00%) agar
// perhitungan tetap bilangan bulat dan pembulatannya sama persis dengan database.

export const MODE_PPN = {tidak: 'Tidak ada PPN', belum: 'Belum termasuk PPN', termasuk: 'Sudah termasuk PPN'};
export const AKUN_PENDAPATAN = {'4-1': 'Pendapatan Jasa Desain', '4-2': 'Pendapatan Jasa Pelaksanaan / Turn-key'};
export const STATUS_TERMIN = ['Belum ditagih', 'Ditagih', 'Dibayar sebagian', 'Lunas', 'Lewat jatuh tempo'];
export const KELOMPOK_UMUR = ['Belum jatuh tempo', '1–30', '31–60', '61–90', '>90'];
export const SATUAN_DENDA = {hari: 'per hari', bulan: 'per bulan'};
export const FORMAT_INVOICE_BAWAAN = 'INV/{YYYY}/{MM}/{NNN}';
export const JATUH_TEMPO_BAWAAN = 14;
export const TARIF_PPN_BAWAAN = 1100;

// Akun pendapatan bawaan dari jenis layanan proyek (bisa diubah di kontrak).
export const akunPendapatanDari = (layanan) => (/turn-key|pengawasan|bangun|pelaksana/i.test(layanan || '') ? '4-2' : '4-1');

// round(a * b / c), setengah dibulatkan menjauhi nol — sama dengan round(numeric) di PostgreSQL.
export function bagi(a, b, c) {
  const C = BigInt(c);
  if (C === 0n) return 0;
  let p = BigInt(a) * BigInt(b);
  const minus = (p < 0n) !== (C < 0n);
  if (p < 0n) p = -p;
  const q = C < 0n ? -C : C;
  const r = (2n * p + q) / (2n * q);
  return Number(minus ? -r : r);
}
export const bpKePersen = (bp) => (bp || 0) / 100;
export const persenKeBp = (v) => {
  const s = String(v ?? '').trim().replace(',', '.');
  if (s === '') return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(+s * 100);
};

const hari = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 864e5); // a - b
export function tambahHari(t, n) {
  const d = new Date(t + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function tambahBulan(t, n) {
  const [y, m, d] = t.split('-').map(Number);
  const akhir = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + n, Math.min(d, akhir))).toISOString().slice(0, 10);
}

// Nilai sebuah baris termin. Termin biasa: jasa (termasuk PPN bila mode "termasuk") + titipan,
// retensi dipotong dari nilai sebelum PPN. Baris retensi: kumpulan potongan retensi, tanpa PPN.
// -> {dpp, ppn, ret_jasa, ret_titipan, tagihan, pendapatan, titipan_bersih}
export function hitungTermin(t, k) {
  const jasa = +t.jasa || 0, titipan = +t.titipan || 0;
  if (t.jenis === 'retensi') return {dpp: jasa, ppn: 0, ret_jasa: 0, ret_titipan: 0, tagihan: jasa + titipan, pendapatan: jasa, titipan_bersih: titipan};
  const bp = k.ppn === 'tidak' ? 0 : +k.tarif_ppn_bp || 0;
  let dpp = jasa, ppn = 0;
  if (k.ppn === 'termasuk') { dpp = bagi(jasa, 10000, 10000 + bp); ppn = jasa - dpp; }
  else if (k.ppn === 'belum') ppn = bagi(jasa, bp, 10000);
  const rb = +k.retensi_bp || 0;
  const ret_jasa = bagi(dpp, rb, 10000), ret_titipan = bagi(titipan, rb, 10000);
  return {dpp, ppn, ret_jasa, ret_titipan, tagihan: dpp + ppn + titipan - ret_jasa - ret_titipan, pendapatan: dpp - ret_jasa, titipan_bersih: titipan - ret_titipan};
}
// Isi baris retensi dari semua termin biasa.
export function isiRetensi(termin, k) {
  let jasa = 0, titipan = 0;
  for (const t of termin.filter((x) => x.jenis !== 'retensi')) { const v = hitungTermin(t, k); jasa += v.ret_jasa; titipan += v.ret_titipan; }
  return {jasa, titipan};
}

// Nilai kontrak termasuk addendum. -> {jasa, titipan, ppn, total}
export function nilaiKontrak(k, addendum = []) {
  const jasa = (+k.nilai_jasa || 0) + addendum.reduce((s, a) => s + (+a.tambah_jasa || 0), 0);
  const titipan = (+k.nilai_titipan || 0) + addendum.reduce((s, a) => s + (+a.tambah_titipan || 0), 0);
  const bp = k.ppn === 'tidak' ? 0 : +k.tarif_ppn_bp || 0;
  const ppn = k.ppn === 'belum' ? bagi(jasa, bp, 10000) : k.ppn === 'termasuk' ? jasa - bagi(jasa, 10000, 10000 + bp) : 0;
  return {jasa, titipan, ppn, total: jasa + titipan + (k.ppn === 'belum' ? ppn : 0)};
}
// Tanggal selesai pekerjaan yang berlaku: addendum terakhir yang mengubahnya, atau tanggal di kontrak.
export const selesaiBerlaku = (k, addendum = []) => addendum.filter((a) => a.selesai_baru).sort((a, b) => (a.tanggal + a.no).localeCompare(b.tanggal + b.no)).at(-1)?.selesai_baru || k.selesai || null;
export const tglPencairanRetensi = (k) => (k.tgl_serah_terima && k.masa_pemeliharaan_hari != null && k.masa_pemeliharaan_hari !== '' ? tambahHari(k.tgl_serah_terima, +k.masa_pemeliharaan_hari) : null);
export const akhirGaransi = (k) => (k.garansi_mulai && +k.garansi_bulan > 0 ? tambahBulan(k.garansi_mulai, +k.garansi_bulan) : null);

// Komponen yang dibayar klien untuk satu baris tagihan (setelah retensi).
export const komponenTagihan = (t) => ({pendapatan: t.dpp - t.ret_jasa, titipan: t.titipan - t.ret_titipan, ppn: t.ppn});
// Pembagian uang yang sudah diterima (kumulatif c dari tagihan T) ke pendapatan / titipan / PPN.
// Bagian satu penerimaan = bagian(sesudah) - bagian(sebelum); penerimaan yang melunasi mendapat sisanya tepat.
export function bagianKumulatif(kom, T, c) {
  if (!T) return {pendapatan: 0, titipan: 0, ppn: 0};
  const pendapatan = bagi(kom.pendapatan, c, T), ppn = bagi(kom.ppn, c, T);
  return {pendapatan, ppn, titipan: c - pendapatan - ppn};
}
export function alokasiPenerimaan(t, sebelum, jumlah) {
  const kom = komponenTagihan(t), a = bagianKumulatif(kom, t.tagihan, sebelum), b = bagianKumulatif(kom, t.tagihan, sebelum + jumlah);
  return {alok_pendapatan: b.pendapatan - a.pendapatan, alok_titipan: b.titipan - a.titipan, alok_ppn: b.ppn - a.ppn};
}
export const urutPenerimaan = (a, b) => String(a.tanggal).localeCompare(String(b.tanggal)) || String(a.dibuat || '').localeCompare(String(b.dibuat || '')) || String(a.id).localeCompare(String(b.id));

// Nomor invoice berikutnya. Format: {YYYY} {YY} {MM} dan satu {N…} (jumlah N = jumlah digit).
// Nomor urut dihitung per pola yang sama (mis. per bulan untuk INV/{YYYY}/{MM}/{NNN}).
export function periksaFormatInvoice(f) {
  const s = String(f || '');
  if (!s.trim()) return 'Format nomor invoice wajib diisi.';
  const n = s.match(/\{N+\}/g) || [];
  if (n.length !== 1) return 'Format harus memuat tepat satu nomor urut, mis. {NNN}.';
  const sisa = s.replace(/\{N+\}|\{YYYY\}|\{YY\}|\{MM\}/g, '');
  if (/[{}]/.test(sisa)) return 'Kode yang dikenal hanya {YYYY}, {YY}, {MM}, dan {NNN}.';
  return null;
}
const lolos = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
export function nomorInvoice(format, tanggal, ada = []) {
  const [y, m] = tanggal.split('-');
  const pola = format.replaceAll('{YYYY}', y).replaceAll('{YY}', y.slice(2)).replaceAll('{MM}', m);
  const c = /\{(N+)\}/.exec(pola);
  const depan = pola.slice(0, c.index), belakang = pola.slice(c.index + c[0].length);
  const re = new RegExp('^' + lolos(depan) + '(\\d+)' + lolos(belakang) + '$');
  const maks = Math.max(0, ...ada.map((x) => +(re.exec(x || '')?.[1] ?? 0)));
  return depan + String(maks + 1).padStart(c[1].length, '0') + belakang;
}

// Status dan umur satu baris tagihan. terima: penerimaan untuk baris ini.
export function keadaanTermin(t, terima, today) {
  const diterima = terima.reduce((s, p) => s + (+p.jumlah || 0) + (+p.potongan_pajak || 0), 0);
  const uang = terima.reduce((s, p) => s + (+p.jumlah || 0), 0), potongan = diterima - uang;
  const sisa = t.no_invoice ? t.tagihan - diterima : 0;
  let status;
  if (!t.no_invoice) status = 'Belum ditagih';
  else if (diterima >= t.tagihan) status = 'Lunas';
  else if (t.jatuh_tempo && today > t.jatuh_tempo) status = 'Lewat jatuh tempo';
  else status = diterima > 0 ? 'Dibayar sebagian' : 'Ditagih';
  const umur = t.no_invoice && sisa > 0 && t.jatuh_tempo ? hari(today, t.jatuh_tempo) : null;
  const kelompok = umur == null ? null : umur <= 0 ? 'Belum jatuh tempo' : umur <= 30 ? '1–30' : umur <= 60 ? '31–60' : umur <= 90 ? '61–90' : '>90';
  return {diterima, uang, potongan, sisa, status, umur, kelompok};
}

// Informasi denda keterlambatan pembayaran klien (hanya informasi, tidak ditagih otomatis).
export function dendaKlien(t, k, sisa, today) {
  const persen = +k.denda_klien_persen || 0;
  if (!persen || !t.jatuh_tempo || !(today > t.jatuh_tempo) || !(sisa > 0)) return null;
  const lewat = hari(today, t.jatuh_tempo);
  const periode = k.denda_klien_satuan === 'bulan' ? Math.ceil(lewat / 30) : lewat;
  let denda = sisa * persen / 100 * periode;
  const maks = batasDenda(k.denda_klien_maks_jenis, k.denda_klien_maks, t.tagihan);
  if (maks != null) denda = Math.min(denda, maks);
  return {hari: lewat, periode, denda: Math.round(denda), dibatasi: maks != null && denda === maks};
}
// Potensi denda keterlambatan pekerjaan Alinea (informasi).
export function dendaAlinea(k, selesai, total, today) {
  const persen = +k.denda_alinea_persen || 0;
  if (!selesai || !(today > selesai)) return null;
  const lewat = hari(today, selesai);
  let denda = total * persen / 100 * lewat;
  const maks = batasDenda(k.denda_alinea_maks_jenis, k.denda_alinea_maks, total);
  if (maks != null) denda = Math.min(denda, maks);
  return {hari: lewat, denda: Math.round(denda), dibatasi: maks != null && denda === maks};
}
function batasDenda(jenis, nilai, dasar) {
  if (nilai == null || nilai === '' || !(+nilai > 0)) return null;
  return jenis === 'rp' ? +nilai : dasar * +nilai / 100;
}

// Pemeriksaan kontrak sebelum disimpan (mesin demo dan layar; database memeriksa hal yang sama).
// ctx: {kontrak: semua kontrak, proyek: kode proyek, profil, addendum: addendum kontrak ini, termin: baris lama kontrak ini}
export function periksaKontrak(d, termin, ctx) {
  const salah = [];
  if (!d.proyek_kode || !ctx.proyek.includes(d.proyek_kode)) salah.push('Proyek wajib dipilih.');
  if (!String(d.no_kontrak || '').trim()) salah.push('No. kontrak / SPK wajib diisi.');
  else if (ctx.kontrak.some((x) => x.id !== d.id && x.no_kontrak.trim().toLowerCase() === d.no_kontrak.trim().toLowerCase())) salah.push('No. kontrak "' + d.no_kontrak.trim() + '" sudah dipakai kontrak lain.');
  if (!d.tanggal) salah.push('Tanggal kontrak wajib diisi.');
  if (!Number.isInteger(d.nilai_jasa) || d.nilai_jasa <= 0) salah.push('Nilai jasa wajib diisi (rupiah utuh, lebih dari 0).');
  if (!Number.isInteger(d.nilai_titipan) || d.nilai_titipan < 0) salah.push('Nilai material/tukang turn-key harus rupiah utuh (boleh 0).');
  if (!MODE_PPN[d.ppn]) salah.push('Perlakuan PPN wajib dipilih.');
  else if (d.ppn !== 'tidak' && !pkpPada(ctx.profil, d.tanggal)) salah.push('PPN hanya bisa dipilih bila perusahaan sudah PKP pada tanggal kontrak (lihat Pengaturan → Profil perusahaan).');
  if (d.ppn !== 'tidak' && !(d.tarif_ppn_bp > 0)) salah.push('Tarif PPN belum diatur di Pengaturan → Akuntansi.');
  if (!AKUN_PENDAPATAN[d.akun_pendapatan]) salah.push('Akun pendapatan wajib dipilih.');
  if (!Number.isInteger(d.retensi_bp) || d.retensi_bp < 0 || d.retensi_bp >= 10000) salah.push('Retensi harus 0 sampai di bawah 100%.');
  if (d.mulai && d.selesai && d.selesai < d.mulai) salah.push('Tanggal selesai pekerjaan tidak boleh sebelum tanggal mulai.');
  if (d.retensi_bp > 0 && (d.masa_pemeliharaan_hari == null || d.masa_pemeliharaan_hari === '')) salah.push('Masa pemeliharaan (hari) wajib diisi bila ada retensi.');
  const biasa = termin.filter((t) => t.jenis !== 'retensi');
  if (!biasa.length) salah.push('Jadwal termin wajib diisi (minimal 1 termin).');
  for (const [i, t] of biasa.entries()) {
    if (!Number.isInteger(t.jasa) || !Number.isInteger(t.titipan) || t.jasa < 0 || t.titipan < 0) salah.push('Termin ' + (i + 1) + ': porsi jasa dan titipan harus rupiah utuh, tidak minus.');
    else if (t.jasa + t.titipan <= 0) salah.push('Termin ' + (i + 1) + ': nilai termin harus lebih dari 0.');
  }
  const v = nilaiKontrak(d, ctx.addendum || []);
  const sj = biasa.reduce((s, t) => s + (+t.jasa || 0), 0), st = biasa.reduce((s, t) => s + (+t.titipan || 0), 0);
  if (biasa.length && (sj !== v.jasa || st !== v.titipan)) {
    const pct = v.jasa + v.titipan ? (sj + st) / (v.jasa + v.titipan) * 100 : 0;
    salah.push('Total termin harus 100% dari nilai kontrak. Sekarang ' + pct.toLocaleString('id-ID', {maximumFractionDigits: 2}) + '%'
      + (sj !== v.jasa ? '; porsi jasa ' + rpTeks(sj) + ' dari ' + rpTeks(v.jasa) : '') + (st !== v.titipan ? '; porsi titipan ' + rpTeks(st) + ' dari ' + rpTeks(v.titipan) : '') + '.');
  }
  return salah;
}
export const pkpPada = (profil, tanggal) => !!(profil?.pkp && profil.tgl_pkp && tanggal && profil.tgl_pkp <= tanggal);
const rpTeks = (x) => 'Rp ' + Number(x).toLocaleString('id-ID');

// Membagi nominal termin ke porsi jasa dan titipan secara proporsional terhadap nilai kontrak.
export function bagiPorsi(nominal, jasaTotal, titipanTotal) {
  const total = jasaTotal + titipanTotal;
  if (!total) return {jasa: nominal, titipan: 0};
  const jasa = bagi(nominal, jasaTotal, total);
  return {jasa, titipan: nominal - jasa};
}
// Addendum "sesuaikan termin yang belum ditagih": tambahan dibagi ke termin yang belum ditagih
// sebanding nilainya; sisa pembulatan masuk ke termin terakhir. -> [{id, jasa, titipan}] perubahan.
export function sesuaikanTermin(termin, tambahJasa, tambahTitipan) {
  const bebas = termin.filter((t) => t.jenis !== 'retensi' && !t.no_invoice);
  if (!bebas.length) throw new Error('Tidak ada termin yang belum ditagih untuk disesuaikan. Pakai pilihan termin tambahan.');
  const bagikan = (tambah, k) => {
    const dasar = bebas.reduce((s, t) => s + t[k], 0), sebar = bebas.reduce((s, t) => s + t.jasa + t.titipan, 0);
    let sisa = tambah;
    return bebas.map((t, i) => {
      const bobot = dasar ? t[k] : t.jasa + t.titipan, total = dasar || sebar;
      const d = i === bebas.length - 1 ? sisa : bagi(tambah, bobot, total || 1);
      sisa -= d;
      return d;
    });
  };
  const dj = bagikan(tambahJasa, 'jasa'), dt = bagikan(tambahTitipan, 'titipan');
  const hasil = bebas.map((t, i) => ({id: t.id, jasa: t.jasa + dj[i], titipan: t.titipan + dt[i], delta_jasa: dj[i], delta_titipan: dt[i]}));
  if (hasil.some((x) => x.jasa < 0 || x.titipan < 0)) throw new Error('Pengurangan nilai lebih besar dari sisa termin yang belum ditagih.');
  return hasil;
}

// Ringkasan semua kontrak dan baris tagihan dari data keuangan (S.keu). Dipakai daftar, dashboard, notifikasi.
export function ringkasPiutang(K, today) {
  const add = new Map(), trm = new Map(), byTermin = new Map();
  for (const a of K.kontrak_addendum || []) (add.get(a.kontrak_id) || add.set(a.kontrak_id, []).get(a.kontrak_id)).push(a);
  for (const p of K.penerimaan || []) (byTermin.get(p.termin_id) || byTermin.set(p.termin_id, []).get(p.termin_id)).push(p);
  for (const t of K.termin || []) (trm.get(t.kontrak_id) || trm.set(t.kontrak_id, []).get(t.kontrak_id)).push(t);
  const kontrakById = new Map((K.kontrak_klien || []).map((k) => [k.id, k]));
  const baris = (K.termin || []).map((t) => {
    const k = kontrakById.get(t.kontrak_id);
    const terima = (byTermin.get(t.id) || []).slice().sort(urutPenerimaan);
    const st = keadaanTermin(t, terima, today);
    const cair = t.jenis === 'retensi' ? tglPencairanRetensi(k || {}) : null;
    return {...t, ...st, kontrak: k, penerimaan: terima, tgl_pencairan: cair, bisa_ditagih: t.jenis !== 'retensi' || (!!cair && today >= cair), denda: k ? dendaKlien(t, k, st.sisa, today) : null};
  });
  const perKontrak = new Map();
  for (const b of baris) (perKontrak.get(b.kontrak_id) || perKontrak.set(b.kontrak_id, []).get(b.kontrak_id)).push(b);
  const kontrak = (K.kontrak_klien || []).map((k) => {
    const rows = (perKontrak.get(k.id) || []).sort((a, b) => (a.jenis === 'retensi') - (b.jenis === 'retensi') || a.ke - b.ke);
    const addendum = (add.get(k.id) || []).slice().sort((a, b) => (a.tanggal + a.no).localeCompare(b.tanggal + b.no));
    const nilai = nilaiKontrak(k, addendum);
    const total = rows.length ? rows.reduce((s, r) => s + r.tagihan, 0) : nilai.total;
    const ditagih = rows.filter((r) => r.no_invoice).reduce((s, r) => s + r.tagihan, 0);
    const diterima = rows.reduce((s, r) => s + r.diterima, 0);
    const lewat = rows.some((r) => r.status === 'Lewat jatuh tempo');
    const status = total > 0 && diterima >= total ? 'Lunas' : lewat ? 'Lewat jatuh tempo' : ditagih > 0 ? 'Berjalan' : 'Belum ditagih';
    const selesai = selesaiBerlaku(k, addendum);
    return {...k, termin: rows, addendum, nilai, total, ditagih, diterima, sisa: total - diterima, piutang: ditagih - diterima, belum_ditagih: total - ditagih,
      pct_terbayar: total ? diterima / total : null, status, selesai_berlaku: selesai, tgl_pencairan: tglPencairanRetensi(k), garansi_akhir: akhirGaransi(k)};
  });
  return {kontrak, baris: baris.map((b) => ({...b, ringkas: kontrak.find((k) => k.id === b.kontrak_id)}))};
}
export function ringkasUmur(baris) {
  return KELOMPOK_UMUR.map((k) => {
    const rows = baris.filter((b) => b.kelompok === k);
    return {kelompok: k, sisa: rows.reduce((s, b) => s + b.sisa, 0), jumlah: rows.length};
  });
}
