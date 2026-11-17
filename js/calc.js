// Rumus yang di Excel ada di kolom abu-abu. Semua fungsi murni: masukan data + tanggal hari ini.
import {TAHAP, TOLERANSI} from './schema.js';
import {normNama, kontakDari} from './klien-util.js';

export const n = (v) => (v == null || v === '' || isNaN(+v) ? 0 : +v);
const jumlah = (rows, f) => rows.reduce((a, r) => a + n(typeof f === 'function' ? f(r) : r[f]), 0);
const hari = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 864e5); // a - b, dalam hari
const jepit = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
export const hariIni = () => {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};
const bobotDefault = (nama) => (TAHAP.find((t) => t.nama === nama) || {}).bobot ?? 0;
const batasHari = (tgl, today, batas, label) => (!tgl ? '' : tgl < today ? 'HABIS' : hari(tgl, today) <= batas ? label : '');

// db: {tabel: [baris]} -> salinan dengan kolom hitungan ditambahkan pada tiap baris.
export function hitung(db, today = hariIni()) {
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

  const totalKontrak = Object.fromEntries(t('kontrak').map((k) => [k.kode, n(k.nilai_awal) + n(k.nilai_addendum)]));
  const termin = t('termin').map((r) => {
    const nilai = n(r.persen) * n(totalKontrak[r.kode]);
    const diterima = n(r.diterima);
    const sisa = nilai - diterima;
    const lewat = r.jatuh_tempo && today > r.jatuh_tempo;
    const status = sisa <= 0 ? 'Lunas' : !r.tgl_invoice ? 'Belum ditagih' : lewat ? (diterima > 0 ? 'Sebagian - lewat tempo' : 'Lewat tempo') : diterima > 0 ? 'Sebagian' : 'Menunggu bayar';
    const umur = r.tgl_invoice && r.jatuh_tempo && sisa > 0 ? Math.max(0, hari(today, r.jatuh_tempo)) : null;
    const kelompok = umur == null ? '' : umur <= 30 ? '0-30' : umur <= 60 ? '31-60' : umur <= 90 ? '61-90' : '>90';
    return {...r, nama_proyek: np(r.kode), nilai, diterima, sisa, status, umur, kelompok};
  });

  const kontrak = t('kontrak').map((k) => {
    const tk = termin.filter((x) => x.kode === k.kode);
    const total = totalKontrak[k.kode];
    const ditagih = jumlah(tk.filter((x) => x.tgl_invoice), 'nilai');
    const diterima = jumlah(tk, 'diterima');
    return {...k, ...denganKlien(k), nama_proyek: np(k.kode), total, ditagih, diterima, piutang: ditagih - diterima, belum_ditagih: total - ditagih, pct_terbayar: total ? diterima / total : null};
  });

  const vendor = t('vendor').map((v) => {
    const dasar = n(v.nilai) * n(v.opname);
    const hak = dasar * (1 - n(v.retensi));
    return {...v, nama_proyek: np(v.kode), hak, hutang: hak - n(v.dibayar), retensi_ditahan: dasar * n(v.retensi), sisa_kontrak: n(v.nilai) - n(v.dibayar)};
  });

  const hutang_lain = t('hutang_lain').map((h) => {
    const sisa = n(h.total) - n(h.dibayar);
    const alert = !h.jatuh_tempo || sisa <= 0 ? '' : h.jatuh_tempo < today ? 'LEWAT' : hari(h.jatuh_tempo, today) <= 14 ? '≤14 hari' : '';
    return {...h, sisa, alert};
  });

  const sdm = t('sdm').map((s) => {
    const sisa_hari = s.kontrak_berakhir ? hari(s.kontrak_berakhir, today) : null;
    return {
      ...s, sisa_hari,
      alert_kontrak: sisa_hari == null ? '' : sisa_hari < 0 ? 'HABIS' : sisa_hari <= 60 ? '≤60 hari' : '',
      masa_kerja: s.tgl_masuk ? hari(today, s.tgl_masuk) / 365.25 : null,
      alert_sertifikat: batasHari(s.skk_berlaku, today, 90, '≤90 hari'),
    };
  });

  const aset = t('aset').map((a) => {
    const susut = n(a.umur) ? n(a.harga) / n(a.umur) : null;
    const nilai_buku = susut == null || !a.tgl_beli ? n(a.harga) : Math.max(0, n(a.harga) - susut * hari(today, a.tgl_beli) / 365.25);
    return {...a, susut, nilai_buku, alert: batasHari(a.lisensi_sd, today, 60, '≤60 hari')};
  });

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

  return {proyek, tahap, masalah, klien, tim: t('tim'), kontrak, termin, vendor, hutang_lain, sdm, aset, legal};
}

// Angka ringkasan untuk dashboard, dari hasil hitung().
export function ringkasan(d) {
  const berjalan = d.proyek.filter((p) => p.status === 'Berjalan');
  const terbuka = d.masalah.filter((m) => m.status !== 'Selesai');
  const nilai = jumlah(d.kontrak, 'total'), diterima = jumlah(d.kontrak, 'diterima');
  const umur = ['0-30', '31-60', '61-90', '>90'].map((k) => {
    const rows = d.termin.filter((x) => x.kelompok === k);
    return {kelompok: k, sisa: jumlah(rows, 'sisa'), jumlah: rows.length};
  });
  const progresBerjalan = berjalan.filter((p) => p.progres != null);
  return {
    jumlah_kontrak: d.kontrak.length, nilai_kontrak: nilai, ditagih: jumlah(d.kontrak, 'ditagih'), diterima,
    pct_diterima: nilai ? diterima / nilai : 0,
    piutang: jumlah(d.kontrak, 'piutang'), belum_ditagih: jumlah(d.kontrak, 'belum_ditagih'), umur,
    hutang_vendor: jumlah(d.vendor, 'hutang'), retensi: jumlah(d.vendor, 'retensi_ditahan'), hutang_lain: jumlah(d.hutang_lain, 'sisa'),
    gaji_bulanan: jumlah(d.sdm, (s) => n(s.gaji) + n(s.tunjangan)), nilai_buku_aset: jumlah(d.aset, 'nilai_buku'),
    proyek_total: d.proyek.length, proyek_berjalan: berjalan.length,
    proyek_tertunda: d.proyek.filter((p) => /^Tertunda/.test(p.status || '')).length,
    proyek_selesai: d.proyek.filter((p) => p.status === 'Selesai').length,
    proyek_terlambat: berjalan.filter((p) => p.status_jadwal === 'Terlambat').length,
    proyek_terlambat_ringan: berjalan.filter((p) => p.status_jadwal === 'Terlambat ringan').length,
    rata_progres: progresBerjalan.length ? jumlah(progresBerjalan, 'progres') / progresBerjalan.length : null,
    masalah_terbuka: terbuka.length, masalah_tinggi: terbuka.filter((m) => m.dampak === 'Tinggi').length,
    masalah_lewat: terbuka.filter((m) => m.lewat === 'LEWAT').length,
  };
}

// Temuan administrasi yang perlu ditindaklanjuti. Bagian keuangan hanya diisi bila datanya ada (admin).
export function temuan(d, fmtTanggal = (x) => x) {
  const butir = (area, hal, rows, nama) => ({area, hal, jumlah: rows.length, rincian: rows.map(nama).join('; ')});
  return [
    butir('Kontrak', 'Kontrak tanpa dokumen bertanda tangan', d.kontrak.filter((k) => !/ditandatangani/i.test(k.bentuk_dokumen || '')), (k) => k.nama_proyek + ' (' + (k.bentuk_dokumen || 'belum diisi') + ')'),
    butir('Proyek', 'Perubahan di luar kontrak yang belum tertulis', d.proyek.filter((p) => p.perubahan_belum_tertulis === 'Ya'), (p) => p.nama),
    butir('Proyek', 'Proyek dengan data jadwal belum lengkap', d.proyek.filter((p) => p.status_jadwal === 'Data belum lengkap' && p.status !== 'Batal'), (p) => p.nama),
    butir('Vendor', 'Vendor tanpa perjanjian tertulis', d.vendor.filter((v) => v.dokumen_tertulis === 'Tidak'), (v) => v.vendor + ' (' + v.nama_proyek + ')'),
    butir('Hutang', 'Kewajiban lewat jatuh tempo', d.hutang_lain.filter((h) => h.alert === 'LEWAT'), (h) => h.uraian || h.kreditur),
    butir('Hutang', 'Kewajiban jatuh tempo dalam 14 hari', d.hutang_lain.filter((h) => h.alert && h.alert !== 'LEWAT'), (h) => h.uraian || h.kreditur),
    butir('SDM', 'Kontrak kerja habis atau berakhir dalam 60 hari', d.sdm.filter((s) => s.alert_kontrak), (s) => s.nama + ' (' + s.sisa_hari + ' hari)'),
    butir('SDM', 'Tanpa dokumen kontrak kerja', d.sdm.filter((s) => s.dokumen_kontrak === 'Tidak'), (s) => s.nama),
    butir('SDM', 'Belum terdaftar BPJS Ketenagakerjaan', d.sdm.filter((s) => s.bpjs_tk === 'Tidak'), (s) => s.nama),
    butir('SDM', 'SKK/STRA habis atau berakhir dalam 90 hari', d.sdm.filter((s) => s.alert_sertifikat), (s) => s.nama + ' (s.d. ' + fmtTanggal(s.skk_berlaku) + ')'),
    butir('Aset', 'Lisensi atau pajak aset habis atau berakhir dalam 60 hari', d.aset.filter((a) => a.alert), (a) => a.nama + ' (s.d. ' + fmtTanggal(a.lisensi_sd) + ')'),
    butir('Aset', 'Aset tidak dalam kondisi baik', d.aset.filter((a) => a.kondisi && a.kondisi !== 'Baik'), (a) => a.nama + ' (' + a.kondisi + ')'),
    butir('Legal', 'Dokumen legal belum ada atau perlu dicek', d.legal.filter((l) => l.status === 'BELUM ADA / CEK'), (l) => l.dokumen),
    butir('Legal', 'Dokumen legal habis atau berakhir dalam 90 hari', d.legal.filter((l) => l.status === 'HABIS' || l.status === '≤90 hari'), (l) => l.dokumen),
  ].filter((b) => b.jumlah > 0);
}
