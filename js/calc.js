// Rumus yang di Excel ada di kolom abu-abu. Semua fungsi murni: masukan data + tanggal hari ini.
import {TAHAP, TOLERANSI} from './schema.js';
import {normNama, kontakDari} from './klien-util.js';
import {ringkasPiutang, ringkasUmur} from './kontrak-util.js';
import {ringkasVendor, ringkasPembelian, ringkasPinjaman, dompetProyek} from './proyek-util.js';
import {ringkasAset} from './aset-util.js';
import {ringkasSemuaHutang} from './hutang-util.js';
import {aturSdm, cariJabatan, kontrakDari, dokumenDari, gajiSaatIni, gajiDari, totalGaji, peringatanPegawai, masaKerja, bawaanTimProyek, refSdm, STATUS, STATUS_PENDEK} from './sdm-util.js';

export const n = (v) => (v == null || v === '' || isNaN(+v) ? 0 : +v);
const jumlah = (rows, f) => rows.reduce((a, r) => a + n(typeof f === 'function' ? f(r) : r[f]), 0);
const hari = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 864e5); // a - b, dalam hari
const jepit = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
// Zona waktu untuk menentukan "hari ini" (bukan jam perangkat). Diatur admin di Pengaturan; bawaan WITA.
export const ZONA_WAKTU = {'Asia/Jakarta': 'WIB (Asia/Jakarta)', 'Asia/Makassar': 'WITA (Asia/Makassar)', 'Asia/Jayapura': 'WIT (Asia/Jayapura)'};
export const ZONA_BAWAAN = 'Asia/Makassar';
let zona = ZONA_BAWAAN;
export const aturZona = (z) => { zona = ZONA_WAKTU[z] ? z : ZONA_BAWAAN; };
export const zonaAktif = () => zona;
export const hariIni = () => new Intl.DateTimeFormat('en-CA', {timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date());
const bobotDefault = (nama) => (TAHAP.find((t) => t.nama === nama) || {}).bobot ?? 0;
const batasHari = (tgl, today, batas, label) => (!tgl ? '' : tgl < today ? 'HABIS' : hari(tgl, today) <= batas ? label : '');

// db: {tabel: [baris]} -> salinan dengan kolom hitungan ditambahkan pada tiap baris.
// atur: isi catatan pengaturan admin (jabatan dan parameter peringatan SDM).
// keu: data keuangan (kontrak klien, termin, penerimaan ada di tabel keuangan sejak Tahap 3).
export function hitung(db, today = hariIni(), atur = {}, keu = {}) {
  const t = (nama) => db[nama] || [];
  const namaProyek = Object.fromEntries(t('proyek').map((p) => [p.kode, p.nama]));
  const np = (kode) => namaProyek[kode] ?? (kode ? 'Kode tidak ada di daftar Proyek' : '');

  // Relasi ke klien: lewat klien_id; data lama yang hanya menyimpan nama dicocokkan lewat nama.
  const klienById = Object.fromEntries(t('klien').map((k) => [k.id, k]));
  const klienByNama = {};
  for (const k of t('klien')) klienByNama[normNama(k.nama)] ??= k.id;
  const refKlien = (r) => (r.klien_id && klienById[r.klien_id] ? r.klien_id : (r.klien && klienByNama[normNama(r.klien)]) || null);
  const denganKlien = (r) => { const ref = refKlien(r); return {klien_ref: ref, klien: ref ? klienById[ref].nama : r.klien || ''}; };

  const tahap = t('tahap').map((r) => {
    const bobot = r.bobot == null || r.bobot === '' ? bobotDefault(r.tahap) : n(r.bobot);
    const selesai = n(r.selesai);
    const status_tahap = selesai >= 1 ? 'Selesai' : r.rencana_selesai && today > r.rencana_selesai ? 'Terlambat' : selesai > 0 ? 'Proses' : 'Belum mulai';
    return {...r, nama_proyek: np(r.kode), bobot, selesai, status_tahap, kontribusi: bobot * selesai};
  });

  const proyek = t('proyek').map((p) => {
    const tp = tahap.filter((x) => x.kode === p.kode);
    const totalBobot = jumlah(tp, 'bobot');
    const progres = tp.length && totalBobot > 0 ? jumlah(tp, 'kontribusi') / totalBobot : null;
    const mundur = p.target && p.perkiraan ? hari(p.perkiraan, p.target) : null;
    let status_jadwal;
    if (p.status === 'Selesai' || n(progres) >= 1) status_jadwal = 'Selesai';
    else if (progres == null || !p.mulai || !p.target) status_jadwal = 'Data belum lengkap';
    else if (today > p.target) status_jadwal = 'Terlambat';
    else {
      const waktu = jepit(hari(today, p.mulai) / Math.max(1, hari(p.target, p.mulai)), 0, 1);
      const dev = progres - waktu;
      status_jadwal = dev >= TOLERANSI.ringan ? 'Sesuai jadwal' : dev >= TOLERANSI.terlambat ? 'Terlambat ringan' : 'Terlambat';
    }
    return {...p, ...denganKlien(p), progres, mundur, status_jadwal};
  });

  const masalah = t('masalah').map((m) => {
    const buka = m.status !== 'Selesai';
    return {...m, nama_proyek: np(m.kode), umur: buka && m.tanggal ? hari(today, m.tanggal) : null, lewat: buka && m.target && today > m.target ? 'LEWAT' : ''};
  });

  // Kontrak klien: klien selalu mengikuti proyeknya.
  const proyekByKode = Object.fromEntries(proyek.map((p) => [p.kode, p]));
  const piutang = ringkasPiutang(keu, today);
  const kontrak = piutang.kontrak.map((k) => {
    const p = proyekByKode[k.proyek_kode];
    return {...k, kode: k.proyek_kode, nama_proyek: np(k.proyek_kode), klien_ref: p?.klien_ref || null, klien: p?.klien || '', tgl_kontrak: k.tanggal};
  });
  const termin = piutang.baris.map((b) => ({...b, ringkas: undefined, kode: b.kontrak?.proyek_kode, nama_proyek: np(b.kontrak?.proyek_kode), termin_ke: b.ke, no_kontrak: b.kontrak?.no_kontrak}));

  // Tahap 4: kontrak vendor (Pihak Proyek), pembelian material, pinjaman antar proyek, dan dompet tiap proyek.
  const vendor = ringkasVendor(keu, today).map((v) => ({...v, kode: v.proyek_kode, nama_proyek: np(v.proyek_kode), vendor: v.vendor_nama}));
  const pembelian = ringkasPembelian(keu, today).map((b) => ({...b, kode: b.proyek_kode, nama_proyek: b.proyek_kode ? np(b.proyek_kode) : 'Stok kantor'}));
  const pinjaman = ringkasPinjaman(keu, today);
  const ctxDompet = {kontrakKlien: piutang.kontrak, vendor, pembelian, pinjaman};
  const dompet = Object.fromEntries(proyek.map((p) => [p.kode, dompetProyek(keu, p.kode, ctxDompet)]));

  // Tahap 6: hutang lain dari tabel hutang (kreditur, jadwal angsuran, pembayaran).
  const hariHutang = atur?.notifikasi?.hutang_lain?.hari;
  const hariNotif = hariHutang != null && hariHutang !== '' && Number.isFinite(+hariHutang) ? +hariHutang : 14;
  const hutang_lain = ringkasSemuaHutang(keu, today, {hariNotif}).map((x) => ({...x, kreditur: x.kreditur_nama, sisa: x.sisa_pokok, jatuh_tempo: x.berikut?.tanggal || null,
    alert: x.status === 'Terlambat' ? 'LEWAT' : x.peringatan.some((p) => p.jenis === 'segera') ? '≤' + hariNotif + ' hari' : ''}));

  const {jabatan, param, skk: modulSkk} = aturSdm(atur);
  const sdm = t('sdm').map((s) => {
    const jab = cariJabatan(s, jabatan);
    const kontrak = kontrakDari(s), akhir = kontrak.at(-1);
    const gaji = gajiSaatIni(s, today);
    const peringatan = peringatanPegawai(s, jab, param, today);
    const keluar = s.aktif === 'Keluar';
    const proyekDiikuti = proyek.flatMap((p) => (Array.isArray(p.tim) ? p.tim : []).filter((a) => a.ref === refSdm(s.id)).map((a) => ({
      kode: p.kode, nama: p.nama, status: p.status, peran: a.peran, mulai: a.mulai, selesai: a.selesai,
      sedang: !['Selesai', 'Batal'].includes(p.status) && (!a.selesai || a.selesai >= today),
    })));
    return {
      ...s, aktif: keluar ? 'Keluar' : 'Aktif',
      jabatan_id: jab?.id ?? s.jabatan_id ?? null, jabatan_nama: jab?.nama || '', perlu_skk: modulSkk && (!!jab?.skk || !!s.skk_no || !!s.no_skk),
      skk_no: s.skk_no ?? s.no_skk, status_pendek: STATUS_PENDEK[s.status] || s.status || '',
      tim_proyek: s.tim_proyek ?? bawaanTimProyek(jab?.id),
      kontrak_list: kontrak, dokumen_list: dokumenDari(s), gaji_list: gajiDari(s), gaji_saat_ini: gaji, gaji_total: totalGaji(gaji),
      kontrak_akhir: s.status === STATUS.pkwt || !s.status ? akhir?.berakhir || null : s.status === STATUS.magang ? s.magang_selesai || null : null,
      peringatan, jml_peringatan: peringatan.length,
      masa_kerja: masaKerja(s.tgl_masuk, keluar && s.tgl_keluar ? s.tgl_keluar : today),
      proyek_diikuti: proyekDiikuti,
    };
  });

  // Aset (Tahap 5, tabel keuangan): nilai per hari ini dan peringatan dokumen / kondisi.
  const hariDok = atur?.notifikasi?.aset?.hari;
  const aset = keu.aset_siap === false || !keu.aset ? [] : ringkasAset(keu, today, {hariDokumen: hariDok != null && hariDok !== '' && Number.isFinite(+hariDok) ? +hariDok : 30});

  const legal = t('legal').map((l) => {
    const sisa_hari = l.berlaku_sd ? hari(l.berlaku_sd, today) : null;
    const status = !l.nomor && !l.tgl_terbit ? 'BELUM ADA / CEK' : sisa_hari == null ? 'Aktif' : sisa_hari < 0 ? 'HABIS' : sisa_hari <= 90 ? '≤90 hari' : 'Aktif';
    return {...l, sisa_hari, status};
  });

  // Kolom klien yang dihitung dari Proyek dan Kontrak.
  const klienProyek = Object.fromEntries(proyek.map((p) => [p.kode, p.klien_ref]));
  const terbaru = (...tgl) => tgl.filter(Boolean).sort().pop() || null;
  const klien = t('klien').map((k) => {
    const pk = proyek.filter((p) => p.klien_ref === k.id);
    const kk = kontrak.filter((c) => (c.klien_ref || klienProyek[c.kode]) === k.id);
    const kontak = kontakDari(k), utama = kontak.find((c) => c.utama);
    const hidup = pk.filter((p) => p.status !== 'Batal');
    const status_klien = !pk.length ? 'Prospek' : hidup.some((p) => p.status !== 'Selesai') ? 'Aktif' : 'Selesai';
    return {
      ...k, kontak, kontak_utama: utama?.nama || '', jabatan_utama: utama?.jabatan || '', hp_utama: utama?.hp || '', email_utama: utama?.email || '',
      jml_proyek: pk.length, jml_kontrak: kk.length, total_kontrak: jumlah(kk, 'total'),
      terakhir_aktif: terbaru(...pk.map((p) => p.mulai), ...kk.map((c) => c.tgl_kontrak)), status_klien,
    };
  });

  return {proyek, tahap, masalah, klien, tim: t('tim'), kontrak, termin, vendor, pembelian, pinjaman, dompet, hutang_lain, sdm, aset, legal};
}

// Angka ringkasan untuk dashboard, dari hasil hitung().
export function ringkasan(d) {
  const berjalan = d.proyek.filter((p) => p.status === 'Berjalan');
  const terbuka = d.masalah.filter((m) => m.status !== 'Selesai');
  const nilai = jumlah(d.kontrak, 'total'), diterima = jumlah(d.kontrak, 'diterima');
  const umur = ringkasUmur(d.termin);
  const progresBerjalan = berjalan.filter((p) => p.progres != null);
  return {
    jumlah_kontrak: d.kontrak.length, nilai_kontrak: nilai, ditagih: jumlah(d.kontrak, 'ditagih'), diterima,
    pct_diterima: nilai ? diterima / nilai : 0,
    piutang: jumlah(d.kontrak, 'piutang'), belum_ditagih: jumlah(d.kontrak, 'belum_ditagih'), umur,
    hutang_vendor: d.vendor.reduce((s, v) => s + Math.max(0, v.hutang), 0), retensi: jumlah(d.vendor, 'retensi_ditahan'),
    hutang_supplier: d.pembelian.reduce((s, b) => s + (b.cara_bayar === 'tempo' ? Math.max(0, b.sisa) : 0), 0), hutang_lain: jumlah(d.hutang_lain, 'sisa'),
    gaji_bulanan: jumlah(d.sdm.filter((s) => s.aktif !== 'Keluar'), 'gaji_total'), nilai_buku_aset: jumlah(d.aset, 'buku'),
    proyek_total: d.proyek.length, proyek_berjalan: berjalan.length,
    proyek_tertunda: d.proyek.filter((p) => /^Tertunda/.test(p.status || '')).length,
    proyek_selesai: d.proyek.filter((p) => p.status === 'Selesai').length,
    proyek_terlambat: berjalan.filter((p) => p.status_jadwal === 'Terlambat').length,
    proyek_terlambat_ringan: berjalan.filter((p) => p.status_jadwal === 'Terlambat ringan').length,
    rata_progres: progresBerjalan.length ? jumlah(progresBerjalan, 'progres') / progresBerjalan.length : null,
    masalah_terbuka: terbuka.length, masalah_tinggi: terbuka.filter((m) => m.dampak === 'Tinggi').length,
    masalah_lewat: terbuka.filter((m) => m.lewat === 'LEWAT').length,
    sdm_peringatan: jumlah(d.sdm, 'jml_peringatan'), sdm_pegawai_peringatan: d.sdm.filter((s) => s.jml_peringatan).length,
  };
}

// Temuan administrasi yang perlu ditindaklanjuti. Bagian keuangan hanya diisi bila datanya ada (admin).
export function temuan(d, fmtTanggal = (x) => x) {
  const butir = (area, hal, rows, nama) => ({area, hal, jumlah: rows.length, rincian: rows.map(nama).join('; ')});
  return [
    butir('Kontrak', 'Kontrak tanpa dokumen bertanda tangan', d.kontrak.filter((k) => !/ditandatangani/i.test(k.bentuk_dokumen || '')), (k) => k.nama_proyek + ' (' + (k.bentuk_dokumen || 'belum diisi') + ')'),
    butir('Proyek', 'Perubahan di luar kontrak yang belum tertulis', d.proyek.filter((p) => p.perubahan_belum_tertulis === 'Ya'), (p) => p.nama),
    butir('Proyek', 'Proyek dengan data jadwal belum lengkap', d.proyek.filter((p) => p.status_jadwal === 'Data belum lengkap' && p.status !== 'Batal'), (p) => p.nama),
    butir('Vendor', 'Kontrak vendor tanpa file SPK', d.vendor.filter((v) => !v.file), (v) => v.vendor + ' (' + v.nama_proyek + ')'),
    butir('Vendor', 'Pembayaran vendor melebihi hak (lebih bayar)', d.vendor.filter((v) => v.hutang < 0), (v) => v.vendor + ' (' + v.nama_proyek + ')'),
    butir('Pembelian', 'Hutang supplier lewat jatuh tempo', d.pembelian.filter((b) => b.status === 'Lewat jatuh tempo'), (b) => b.supplier_nama + (b.no_nota ? ' ' + b.no_nota : '')),
    butir('Dompet', 'Pinjaman antar proyek lewat rencana kembali', d.pinjaman.filter((x) => x.lewat), (x) => (x.dari_proyek || 'Kas perusahaan') + ' → ' + x.ke_proyek),
    butir('Hutang', 'Kewajiban lewat jatuh tempo', d.hutang_lain.filter((h) => h.alert === 'LEWAT'), (h) => h.uraian || h.kreditur),
    butir('Hutang', 'Kewajiban jatuh tempo dalam 14 hari', d.hutang_lain.filter((h) => h.alert && h.alert !== 'LEWAT'), (h) => h.uraian || h.kreditur),
    butir('SDM', 'Peringatan kontrak, SKK/STRA, atau magang', d.sdm.filter((s) => s.jml_peringatan), (s) => s.nama + ' (' + s.peringatan.map((p) => p.teks).join(', ') + ')'),
    butir('SDM', 'Kontrak PKWT terbaru belum ada file PDF', d.sdm.filter((s) => s.aktif === 'Aktif' && s.status === STATUS.pkwt && s.kontrak_list.length && !s.kontrak_list.at(-1).file), (s) => s.nama),
    butir('SDM', 'Pegawai tetap belum ada dokumen kerja (perjanjian kerja / SK)', d.sdm.filter((s) => s.aktif === 'Aktif' && s.status === STATUS.tetap && !s.dokumen_list.some((x) => x.file)), (s) => s.nama),
    butir('SDM', 'Belum ada No. BPJS Ketenagakerjaan', d.sdm.filter((s) => s.aktif === 'Aktif' && s.status !== STATUS.magang && !s.bpjs_tk_no && s.bpjs_tk !== 'Ya'), (s) => s.nama),
    butir('Aset', 'Dokumen aset (pajak, STNK, lisensi, garansi, asuransi) habis atau segera habis', d.aset.filter((a) => a.peringatan.some((p) => p.dokumen)),
      (a) => a.kode + ' ' + a.nama + ' (' + a.peringatan.filter((p) => p.dokumen).map((p) => p.dokumen.jenis + ' s.d. ' + fmtTanggal(p.tanggal)).join(', ') + ')'),
    butir('Aset', 'Aset aktif tidak dalam kondisi baik', d.aset.filter((a) => a.status === 'Aktif' && a.kondisi !== 'Baik'), (a) => a.kode + ' ' + a.nama + ' (' + a.kondisi + ')'),
    butir('Legal', 'Dokumen legal belum ada atau perlu dicek', d.legal.filter((l) => l.status === 'BELUM ADA / CEK'), (l) => l.dokumen),
    butir('Legal', 'Dokumen legal habis atau berakhir dalam 90 hari', d.legal.filter((l) => l.status === 'HABIS' || l.status === '≤90 hari'), (l) => l.dokumen),
  ].filter((b) => b.jumlah > 0);
}
