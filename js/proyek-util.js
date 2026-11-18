// Tahap 4 — rumus Pihak Proyek (kontrak vendor, opname, pembayaran), Pembelian Material, Dompet Proyek,
// dan Pinjaman Antar Proyek. Fungsi murni: dipakai mesin demo, layar, dan uji otomatis.
// Rumus yang sama ditulis ulang di supabase/migrasi/4-proyek.sql.
import {bagi, tambahHari} from './kontrak-util.js';

export const SKEMA = {termin: 'Borongan bertermin', volume: 'Volume / satuan', persen: 'Persentase progres', harian: 'Harian'};
export const SUMBER_DANA = {perusahaan: 'Dana perusahaan', titipan: 'Dana titipan klien'};
export const JENIS_BAYAR_VENDOR = {bayar: 'Pembayaran', retensi: 'Pencairan retensi'};
export const STATUS_OPNAME = {draft: 'Draft', disetujui: 'Disetujui'};
export const CARA_BAYAR = {tunai: 'Tunai / transfer', tempo: 'Tempo (hutang supplier)'};
export const TUJUAN_BELI = {proyek: 'Proyek', stok: 'Stok kantor'};

// Volume / qty: sampai 3 angka desimal. Nilai = volume × harga, dibulatkan ke rupiah (sama dengan SQL round()).
export const volumeSah = (v) => /^\d+(\.\d{1,3})?$/.test(String(v ?? '').trim());
export const bacaVolume = (v) => { const s = String(v ?? '').trim().replace(',', '.'); return /^\d+(\.\d{1,3})?$/.test(s) ? +s : null; };
export const kali = (volume, harga) => bagi(Math.round(+volume * 1000), +harga || 0, 1000);
const jumlah = (rows, f) => rows.reduce((s, r) => s + (typeof f === 'function' ? f(r) : +r[f] || 0), 0);
const urutWaktu = (a, b) => String(a.tanggal).localeCompare(String(b.tanggal)) || String(a.dibuat || '').localeCompare(String(b.dibuat || '')) || String(a.id).localeCompare(String(b.id));

// ---------- kontrak vendor ----------
// Nilai kontrak: volume = Σ volume × harga; harian = upah × perkiraan hari (perkiraan); lainnya = nilai yang diisi.
export function nilaiKontrakVendor(k, items = []) {
  if (k.skema === 'volume') return jumlah(items, (i) => kali(i.volume, i.harga));
  if (k.skema === 'harian') return (+k.upah_harian || 0) * (+k.perkiraan_hari || 0);
  return +k.nilai || 0;
}
// Termin vendor dari persen (basis poin); baris terakhir menerima sisa pembulatan bila total 100%.
export function nilaiTerminVendor(nilai, termin) {
  const hasil = termin.map((t) => bagi(nilai, +t.persen_bp || 0, 10000));
  if (termin.reduce((s, t) => s + (+t.persen_bp || 0), 0) === 10000 && hasil.length) hasil[hasil.length - 1] += nilai - hasil.reduce((s, x) => s + x, 0);
  return hasil;
}

// Pemeriksaan kontrak vendor -> daftar pesan.
export function periksaKontrakVendor(k, items, termin, ctx = {}) {
  const salah = [];
  if (!k.proyek_kode || (ctx.proyek && !ctx.proyek.includes(k.proyek_kode))) salah.push('Proyek wajib dipilih.');
  if (!k.vendor_id) salah.push('Vendor wajib dipilih dari master Vendor & Tukang.');
  if (!k.tanggal) salah.push('Tanggal wajib diisi.');
  if (!SUMBER_DANA[k.sumber_dana]) salah.push('Sumber dana wajib dipilih.');
  if (!SKEMA[k.skema]) salah.push('Skema pembayaran wajib dipilih.');
  if (!Number.isInteger(+k.retensi_bp) || +k.retensi_bp < 0 || +k.retensi_bp >= 10000) salah.push('Retensi harus 0 sampai di bawah 100%.');
  if (+k.retensi_bp > 0 && (k.masa_retensi_hari == null || k.masa_retensi_hari === '')) salah.push('Masa retensi (hari) wajib diisi bila ada retensi.');
  if (k.skema === 'termin' || k.skema === 'persen') {
    if (!Number.isInteger(+k.nilai) || +k.nilai <= 0) salah.push('Nilai kontrak wajib diisi (rupiah utuh, lebih dari 0).');
  }
  if (k.skema === 'termin') {
    if (!termin.length) salah.push('Jadwal termin wajib diisi.');
    termin.forEach((t, i) => { if (!(+t.persen_bp > 0)) salah.push('Termin ' + (i + 1) + ': persen harus lebih dari 0.'); });
    const total = termin.reduce((s, t) => s + (+t.persen_bp || 0), 0);
    if (termin.length && total !== 10000) salah.push('Total termin harus tepat 100% (sekarang ' + (total / 100).toLocaleString('id-ID', {maximumFractionDigits: 2}) + '%).');
  }
  if (k.skema === 'volume') {
    if (!items.length) salah.push('Daftar item pekerjaan wajib diisi.');
    items.forEach((it, i) => {
      if (!it.barang_id) salah.push('Item ' + (i + 1) + ': pilih item pekerjaan dari master (Barang & Harga → Harga Pekerjaan).');
      if (!(+it.volume > 0) || !volumeSah(it.volume)) salah.push('Item ' + (i + 1) + ': volume harus lebih dari 0 (maksimal 3 desimal).');
      if (!Number.isInteger(+it.harga) || +it.harga <= 0) salah.push('Item ' + (i + 1) + ': harga satuan harus rupiah utuh lebih dari 0.');
    });
  }
  if (k.skema === 'harian') {
    if (!Number.isInteger(+k.upah_harian) || +k.upah_harian <= 0) salah.push('Upah per hari wajib diisi (rupiah utuh, lebih dari 0).');
    if (k.perkiraan_hari != null && k.perkiraan_hari !== '' && !(Number.isInteger(+k.perkiraan_hari) && +k.perkiraan_hari >= 0)) salah.push('Perkiraan jumlah hari diisi angka bulat.');
  }
  return salah;
}

// ---------- opname ----------
// Nilai satu opname. sebelumBp: persen kumulatif opname disetujui sebelumnya (skema persen).
export function nilaiOpname(o, k, items = [], termin = [], sebelumBp = 0) {
  const d = o.detail || {};
  if (k.skema === 'volume') return jumlah(items, (i) => kali(d.volume?.[i.id] || 0, i.harga));
  if (k.skema === 'harian') return (+d.hari || 0) * (+k.upah_harian || 0);
  if (k.skema === 'persen') { const n = +k.nilai || 0; return bagi(n, +d.persen_bp || 0, 10000) - bagi(n, sebelumBp, 10000); }
  if (k.skema === 'termin') {
    const nt = nilaiTerminVendor(+k.nilai || 0, termin);
    return termin.reduce((s, t, i) => s + ((d.termin || []).includes(t.id) ? nt[i] : 0), 0);
  }
  return 0;
}
export const retensiDari = (nilai, k) => bagi(nilai, +k.retensi_bp || 0, 10000);
// Persen kumulatif opname disetujui terakhir sebelum opname `o` (urut tanggal, waktu dibuat).
export function persenSebelum(o, semua) {
  const urut = semua.filter((x) => x.status === 'disetujui' && x.id !== o.id).sort(urutWaktu);
  const sebelum = urut.filter((x) => urutWaktu(x, o) < 0);
  return Math.max(0, ...sebelum.map((x) => +x.detail?.persen_bp || 0));
}

// Ringkasan semua kontrak vendor. K: data keuangan (kontrak_vendor, kontrak_vendor_item, kontrak_vendor_termin, opname, pembayaran_vendor).
export function ringkasVendor(K, today) {
  const grup = (rows, k) => { const m = new Map(); for (const r of rows || []) (m.get(r[k]) || m.set(r[k], []).get(r[k])).push(r); return m; };
  const items = grup(K.kontrak_vendor_item, 'kontrak_id'), termin = grup(K.kontrak_vendor_termin, 'kontrak_id');
  const opn = grup(K.opname, 'kontrak_id'), bayar = grup(K.pembayaran_vendor, 'kontrak_id');
  return (K.kontrak_vendor || []).map((k) => {
    const it = (items.get(k.id) || []).slice().sort((a, b) => a.urut - b.urut);
    const tr = (termin.get(k.id) || []).slice().sort((a, b) => a.ke - b.ke);
    const op = (opn.get(k.id) || []).slice().sort(urutWaktu);
    const by = (bayar.get(k.id) || []).slice().sort(urutWaktu);
    const nilai = nilaiKontrakVendor(k, it);
    const ok = op.filter((o) => o.status === 'disetujui');
    const hak = jumlah(ok, 'nilai'), retensi = jumlah(ok, 'retensi');
    const biasa = by.filter((p) => p.jenis !== 'retensi'), cair = by.filter((p) => p.jenis === 'retensi');
    const dibayar = jumlah(biasa, 'jumlah'), potongan = jumlah(biasa, 'potongan_pajak');
    const dicairkan = jumlah(cair, (p) => (+p.jumlah || 0) + (+p.potongan_pajak || 0));
    const tglCair = k.tgl_selesai && k.masa_retensi_hari != null && k.masa_retensi_hari !== '' ? tambahHari(k.tgl_selesai, +k.masa_retensi_hari) : null;
    const nt = k.skema === 'termin' ? nilaiTerminVendor(+k.nilai || 0, tr) : [];
    const tercapai = new Set(ok.flatMap((o) => o.detail?.termin || []));
    // Volume kumulatif per item (opname disetujui).
    const volKum = Object.fromEntries(it.map((i) => [i.id, ok.reduce((s, o) => s + (+o.detail?.volume?.[i.id] || 0), 0)]));
    const hari = k.skema === 'harian' ? ok.reduce((s, o) => s + (+o.detail?.hari || 0), 0) : null;
    const persen = k.skema === 'persen' ? Math.max(0, ...ok.map((o) => +o.detail?.persen_bp || 0)) : null;
    return {
      ...k, items: it, termin: tr.map((t, i) => ({...t, nilai: nt[i], tercapai: tercapai.has(t.id)})), opname: op, pembayaran: by,
      nilai_kontrak: nilai, hak, retensi, dibayar, potongan, dicairkan,
      hutang: hak - retensi - dibayar - potongan, retensi_ditahan: retensi - dicairkan,
      progres: nilai > 0 ? hak / nilai : null, vol_kumulatif: volKum, hari_kumulatif: hari, persen_kumulatif: persen,
      tgl_cair_retensi: tglCair, retensi_bisa_cair: !!tglCair && today >= tglCair && retensi - dicairkan > 0,
      ada_draft: op.some((o) => o.status === 'draft'),
    };
  });
}

// ---------- pembelian ----------
export const subtotalBaris = (b) => kali(b.qty, b.harga) - (+b.diskon || 0);
export function hitungPembelian(p, baris) {
  const subtotal = jumlah(baris, subtotalBaris);
  const ppn = +p.ppn || 0, ongkir = +p.ongkir || 0;
  const total = subtotal + ppn + ongkir;
  const ppnKredit = p.sumber_dana === 'perusahaan' && p.ppn_kredit ? ppn : 0;
  // Nilai yang dibebankan ke material / persediaan (PPN tak dapat dikreditkan ikut menjadi biaya).
  return {subtotal, ppn, ongkir, total, ppn_kredit_nilai: ppnKredit, biaya: total - ppnKredit};
}
export function periksaPembelian(p, baris, ctx = {}) {
  const salah = [];
  if (!p.tanggal) salah.push('Tanggal wajib diisi.');
  if (!p.supplier_id) salah.push('Supplier wajib dipilih dari master Supplier.');
  if (!TUJUAN_BELI[p.tujuan]) salah.push('Pilih untuk proyek atau stok kantor.');
  if (p.tujuan === 'proyek' && (!p.proyek_kode || (ctx.proyek && !ctx.proyek.includes(p.proyek_kode)))) salah.push('Proyek wajib dipilih.');
  if (!SUMBER_DANA[p.sumber_dana]) salah.push('Sumber dana wajib dipilih.');
  if (p.tujuan === 'stok' && p.sumber_dana === 'titipan') salah.push('Stok kantor tidak bisa memakai dana titipan klien.');
  if (!CARA_BAYAR[p.cara_bayar]) salah.push('Cara bayar wajib dipilih.');
  if (p.cara_bayar === 'tunai' && !p.rekening_id) salah.push('Rekening pembayaran wajib dipilih.');
  if (p.cara_bayar === 'tempo' && !p.jatuh_tempo) salah.push('Jatuh tempo wajib diisi untuk pembelian tempo.');
  if (p.cara_bayar === 'tempo' && p.jatuh_tempo && p.tanggal && p.jatuh_tempo < p.tanggal) salah.push('Jatuh tempo tidak boleh sebelum tanggal pembelian.');
  for (const k of ['ppn', 'ongkir']) if (!Number.isInteger(+p[k] || 0) || (+p[k] || 0) < 0) salah.push((k === 'ppn' ? 'PPN' : 'Ongkir') + ' harus rupiah utuh, tidak minus.');
  if (!baris.length) salah.push('Isi minimal satu baris barang.');
  baris.forEach((b, i) => {
    if (!b.barang_id) salah.push('Baris ' + (i + 1) + ': barang wajib dipilih dari master.');
    if (!(+b.qty > 0) || !volumeSah(b.qty)) salah.push('Baris ' + (i + 1) + ': qty harus lebih dari 0 (maksimal 3 desimal).');
    if (!b.satuan) salah.push('Baris ' + (i + 1) + ': satuan wajib dipilih.');
    if (!Number.isInteger(+b.harga) || +b.harga < 0) salah.push('Baris ' + (i + 1) + ': harga satuan harus rupiah utuh.');
    if (!Number.isInteger(+b.diskon || 0) || (+b.diskon || 0) < 0) salah.push('Baris ' + (i + 1) + ': diskon harus rupiah utuh, tidak minus.');
    else if (subtotalBaris(b) < 0) salah.push('Baris ' + (i + 1) + ': diskon lebih besar dari nilai barang.');
  });
  if (!salah.length && hitungPembelian(p, baris).total <= 0) salah.push('Total pembelian harus lebih dari 0.');
  return salah;
}
export function ringkasPembelian(K, today) {
  const baris = new Map(), bayar = new Map();
  for (const b of K.pembelian_baris || []) (baris.get(b.pembelian_id) || baris.set(b.pembelian_id, []).get(b.pembelian_id)).push(b);
  for (const b of K.pembayaran_supplier || []) (bayar.get(b.pembelian_id) || bayar.set(b.pembelian_id, []).get(b.pembelian_id)).push(b);
  return (K.pembelian || []).map((p) => {
    const br = (baris.get(p.id) || []).slice().sort((a, b) => a.urut - b.urut);
    const by = (bayar.get(p.id) || []).slice().sort(urutWaktu);
    const v = hitungPembelian(p, br);
    const dibayar = p.cara_bayar === 'tunai' ? v.total : jumlah(by, (x) => (+x.jumlah || 0) + (+x.potongan_pajak || 0));
    const sisa = v.total - dibayar;
    const status = sisa <= 0 ? 'Lunas' : p.jatuh_tempo && today > p.jatuh_tempo ? 'Lewat jatuh tempo' : dibayar > 0 ? 'Dibayar sebagian' : 'Belum dibayar';
    return {...p, baris: br, pembayaran: by, ...v, dibayar, sisa, status};
  });
}

// ---------- pinjaman antar proyek ----------
export function ringkasPinjaman(K, today) {
  const kembali = new Map();
  for (const x of K.pengembalian_pinjaman || []) (kembali.get(x.pinjaman_id) || kembali.set(x.pinjaman_id, []).get(x.pinjaman_id)).push(x);
  return (K.pinjaman_proyek || []).map((p) => {
    const rw = (kembali.get(p.id) || []).slice().sort(urutWaktu);
    const dikembalikan = jumlah(rw, 'jumlah'), sisa = p.jumlah - dikembalikan;
    const status = sisa <= 0 ? 'Lunas' : dikembalikan > 0 ? 'Kembali sebagian' : 'Berjalan';
    return {...p, pengembalian: rw, dikembalikan, sisa, status, lewat: sisa > 0 && !!p.rencana_kembali && today > p.rencana_kembali};
  });
}

// ---------- dompet proyek ----------
// Uang tunai per proyek: masuk (termin, kas umum masuk, pinjaman diterima) − keluar (vendor, material, kas umum keluar,
// pinjaman diberikan). Pinjaman tidak membuat jurnal; hanya alokasi internal.
// ctx: {kontrakKlien: ringkasPiutang().kontrak, vendor: ringkasVendor(), pembelian: ringkasPembelian(), pinjaman: ringkasPinjaman()}
export function dompetProyek(K, kode, ctx) {
  const kontrak = new Set(ctx.kontrakKlien.filter((k) => k.proyek_kode === kode).map((k) => k.id));
  const terminK = new Map((K.termin || []).map((t) => [t.id, t.kontrak_id]));
  const terima = (K.penerimaan || []).filter((p) => kontrak.has(terminK.get(p.termin_id)));
  const masukTitipan = jumlah(terima, 'alok_titipan');
  const masukJasa = jumlah(terima, 'jumlah') - masukTitipan;
  const pendapatan = jumlah(terima, 'alok_pendapatan');
  const vendor = ctx.vendor.filter((v) => v.proyek_kode === kode);
  const bayarV = (sumber) => jumlah(vendor.filter((v) => !sumber || v.sumber_dana === sumber).flatMap((v) => v.pembayaran), (p) => (+p.jumlah || 0) + (+p.potongan_pajak || 0));
  const beli = ctx.pembelian.filter((p) => p.tujuan === 'proyek' && p.proyek_kode === kode);
  const keluarBeli = (sumber) => jumlah(beli.filter((p) => !sumber || p.sumber_dana === sumber), 'dibayar');
  const kas = (K.kas_transaksi || []).filter((x) => x.proyek_kode === kode);
  const kasMasuk = jumlah(kas.filter((x) => x.jenis === 'masuk'), 'jumlah'), kasKeluar = jumlah(kas.filter((x) => x.jenis === 'keluar'), 'jumlah');
  const pinj = ctx.pinjaman;
  const terimaPinjaman = jumlah(pinj.filter((p) => p.ke_proyek === kode), 'jumlah');
  const beriPinjaman = jumlah(pinj.filter((p) => p.dari_proyek === kode), 'jumlah');
  const bayarKembali = jumlah(pinj.filter((p) => p.ke_proyek === kode), 'dikembalikan');
  const terimaKembali = jumlah(pinj.filter((p) => p.dari_proyek === kode), 'dikembalikan');
  const masuk = masukJasa + masukTitipan + kasMasuk + terimaPinjaman + terimaKembali;
  const keluar = bayarV() + keluarBeli() + kasKeluar + beriPinjaman + bayarKembali;
  const keluarTitipan = bayarV('titipan') + keluarBeli('titipan');
  // Beban proyek dari dana perusahaan (laba kotor sementara).
  const opnamePerusahaan = jumlah(vendor.filter((v) => v.sumber_dana === 'perusahaan').flatMap((v) => v.opname.filter((o) => o.status === 'disetujui')), 'nilai');
  const materialPerusahaan = jumlah(beli.filter((p) => p.sumber_dana === 'perusahaan'), 'biaya');
  const akunBeban = new Set((K.akun || []).filter((a) => a.golongan === 5).map((a) => a.id));
  const kasBeban = jumlah(kas.filter((x) => x.jenis === 'keluar' && akunBeban.has(x.akun_id)), 'jumlah');
  const pinjamanMasukSisa = jumlah(pinj.filter((p) => p.ke_proyek === kode), 'sisa');
  const pinjamanKeluarSisa = jumlah(pinj.filter((p) => p.dari_proyek === kode), 'sisa');
  return {
    masuk_jasa: masukJasa, masuk_titipan: masukTitipan, kas_masuk: kasMasuk, terima_pinjaman: terimaPinjaman, terima_kembali: terimaKembali,
    keluar_vendor: bayarV(), keluar_material: keluarBeli(), kas_keluar: kasKeluar, beri_pinjaman: beriPinjaman, bayar_kembali: bayarKembali,
    masuk, keluar, saldo: masuk - keluar,
    saldo_titipan: masukTitipan - keluarTitipan - pinjamanKeluarSisa,
    pinjaman_masuk_sisa: pinjamanMasukSisa, pinjaman_keluar_sisa: pinjamanKeluarSisa,
    pendapatan_diterima: pendapatan, beban_perusahaan: opnamePerusahaan + materialPerusahaan + kasBeban,
    laba_kotor: pendapatan - opnamePerusahaan - materialPerusahaan - kasBeban,
    hutang_vendor: jumlah(vendor, (v) => Math.max(0, v.hutang)), retensi_vendor: jumlah(vendor, 'retensi_ditahan'),
    hutang_supplier: jumlah(beli.filter((p) => p.cara_bayar === 'tempo'), (p) => Math.max(0, p.sisa)),
    biaya_vendor: jumlah(vendor, 'hak'), biaya_material: jumlah(beli, 'biaya'), biaya_lain: kasKeluar,
  };
}
// Batas pinjaman dari dana titipan (Pengaturan, opsional): maksimal persen × saldo titipan pemberi.
export const batasPinjaman = (saldoTitipan, persen) => (persen == null || persen === '' ? null : Math.max(0, Math.floor(saldoTitipan * +persen / 100)));
