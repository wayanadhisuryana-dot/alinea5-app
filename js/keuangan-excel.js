// Template, ekspor, dan impor Excel untuk Rekening dan Transaksi kas umum. Fungsi di sini tidak menyentuh
// layar atau database; pustaka ExcelJS diberikan sebagai argumen sehingga bisa diuji di luar browser.
import {JENIS_REKENING, akunKode, akunRekening, akunTransaksi, terkunci, bulanDari, namaBulan} from './keuangan-data.js';

const YA_TIDAK = ['Ya', 'Tidak'];
const JENIS_KAS = ['Pengeluaran', 'Pemasukan'];

export const JENIS_IMPOR = {
  rekening: {
    sheet: 'Data Rekening', nama: 'rekening', kunciWajib: 'nama',
    kolom: [
      {k: 'nama', judul: 'Nama akun *', lebar: 30, ket: 'Wajib. Nama rekening di aplikasi, mis. BCA Giro Operasional. Tidak boleh sama dengan rekening lain.'},
      {k: 'jenis', judul: 'Jenis *', lebar: 14, pilihan: JENIS_REKENING, ket: 'Wajib. Pilih dari daftar.'},
      {k: 'bank', judul: 'Bank', lebar: 16, ket: 'Opsional. Dikosongkan untuk Kas tunai.'},
      {k: 'cabang', judul: 'Cabang', lebar: 16, ket: 'Opsional.'},
      {k: 'no_rekening', judul: 'No. rekening', lebar: 20, teks: true, ket: 'Opsional. Kolom berformat TEXT agar angka 0 di depan tidak hilang.'},
      {k: 'atas_nama', judul: 'Atas nama', lebar: 26, ket: 'Opsional. Nama pemilik rekening.'},
      {k: 'saldo_awal', judul: 'Saldo awal', lebar: 16, uang: true, ket: 'Opsional, bawaan 0. Rupiah utuh tanpa sen, mis. 15000000 atau 15.000.000. Boleh minus (cerukan). Dijurnal ke 3-2-01 Ekuitas saldo awal.'},
      {k: 'tgl_saldo_awal', judul: 'Tanggal saldo awal *', lebar: 18, tanggal: true, ket: 'Wajib. Format YYYY-MM-DD (mis. 2026-01-01) atau DD/MM/YYYY. Tidak boleh di bulan yang sudah ditutup.'},
      {k: 'di_invoice', judul: 'Tampil di invoice', lebar: 16, pilihan: YA_TIDAK, ket: 'Opsional, bawaan Tidak. Rekening utama invoice dipilih lewat formulir rekening.'},
      {k: 'aktif', judul: 'Aktif', lebar: 10, pilihan: YA_TIDAK, ket: 'Opsional, bawaan Ya.'},
      {k: 'catatan', judul: 'Catatan', lebar: 30, ket: 'Opsional.'},
    ],
    contoh: {nama: 'CONTOH - BCA Giro Operasional', jenis: 'Giro', bank: 'BCA', cabang: 'Denpasar', no_rekening: '0123456789', atas_nama: 'PT Contoh', saldo_awal: '15000000', tgl_saldo_awal: '2026-01-01', di_invoice: 'Ya', aktif: 'Ya', catatan: 'Baris contoh ini diabaikan saat impor.'},
  },
  kas: {
    sheet: 'Data Kas Umum', nama: 'transaksi kas', kunciWajib: 'uraian',
    kolom: [
      {k: 'tanggal', judul: 'Tanggal *', lebar: 14, tanggal: true, ket: 'Wajib. Format YYYY-MM-DD (mis. 2026-10-05) atau DD/MM/YYYY. Tidak boleh di bulan yang sudah ditutup.'},
      {k: 'jenis', judul: 'Jenis *', lebar: 14, pilihan: JENIS_KAS, ket: 'Wajib. Pengeluaran (uang keluar dari rekening) atau Pemasukan (uang masuk ke rekening).'},
      {k: 'rekening', judul: 'Rekening *', lebar: 26, ket: 'Wajib. Nama rekening persis seperti di Kas & Bank (lihat sheet "Daftar rekening"). Rekening harus aktif.'},
      {k: 'kode_akun', judul: 'Kode akun *', lebar: 12, teks: true, ket: 'Wajib. Kode akun lawan, mis. 6-3 untuk listrik (lihat sheet "Daftar akun"). Tidak boleh akun rekening 1-1-xx: perpindahan antar rekening dicatat lewat Transfer.'},
      {k: 'nama_akun', judul: 'Nama akun', lebar: 30, info: true, ket: 'Hanya keterangan agar mudah dibaca. Saat impor, yang dipakai adalah Kode akun.'},
      {k: 'proyek_kode', judul: 'Kode proyek', lebar: 14, teks: true, ket: 'Opsional. Kode proyek yang sudah ada di menu Proyek.'},
      {k: 'pihak', judul: 'Pihak', lebar: 22, ket: 'Opsional. Dibayar ke / diterima dari.'},
      {k: 'uraian', judul: 'Uraian *', lebar: 40, ket: 'Wajib. Keterangan transaksi; juga menjadi uraian jurnal.'},
      {k: 'jumlah', judul: 'Jumlah *', lebar: 16, uang: true, ket: 'Wajib. Rupiah utuh lebih dari 0, tanpa sen, mis. 500000 atau 500.000.'},
    ],
    contoh: {tanggal: '2026-10-05', jenis: 'Pengeluaran', rekening: 'BCA Giro Operasional', kode_akun: '6-3', nama_akun: 'Listrik, Air, Internet, Telepon', proyek_kode: '', pihak: 'PLN', uraian: 'CONTOH - Bayar listrik kantor Oktober', jumlah: '500000'},
  },
};
const lembarContoh = (j, b) => /^contoh/i.test(String(b[JENIS_IMPOR[j].kunciWajib] || '')) || /^contoh/i.test(String(b.nama || ''));

// ---------- membuat workbook ----------
// baris: baris datar sesuai kolom; opsi.contoh: sertakan baris contoh abu-abu; opsi.galat: teks error per baris.
// opsi.K: data keuangan untuk sheet daftar rekening / akun.
export function buatWorkbook(ExcelJS, jenis, baris, opsi = {}) {
  const def = JENIS_IMPOR[jenis];
  const kolom = def.kolom.slice();
  if (opsi.galat) kolom.push({k: '__galat', judul: 'Error', lebar: 60});
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(def.sheet, {views: [{state: 'frozen', ySplit: 1}]});
  ws.columns = kolom.map((c) => ({header: c.judul, key: c.k, width: c.lebar, style: c.teks ? {numFmt: '@'} : {}}));
  ws.getRow(1).font = {bold: true};
  const tulis = (b) => {
    const row = ws.addRow(Object.fromEntries(kolom.map((c) => [c.k, b[c.k] == null || b[c.k] === '' ? null : c.uang && Number.isFinite(+b[c.k]) ? +b[c.k] : String(b[c.k])])));
    kolom.forEach((c, i) => { if (c.teks) row.getCell(i + 1).numFmt = '@'; else if (c.uang) row.getCell(i + 1).numFmt = '#,##0'; });
    return row;
  };
  if (opsi.contoh) {
    tulis(def.contoh).eachCell({includeEmpty: true}, (cell) => {
      cell.fill = {type: 'pattern', pattern: 'solid', fgColor: {argb: 'FFD9D9D9'}};
      cell.font = {italic: true, color: {argb: 'FF666666'}};
    });
  }
  baris.forEach((b, i) => tulis(opsi.galat ? {...b, __galat: opsi.galat[i]} : b));
  const akhir = Math.max(ws.rowCount + 500, 1000);
  kolom.forEach((c, i) => {
    if (!c.pilihan) return;
    const huruf = ws.getColumn(i + 1).letter;
    ws.dataValidations.add(huruf + '2:' + huruf + akhir, {type: 'list', allowBlank: true, formulae: ['"' + c.pilihan.join(',') + '"'], showErrorMessage: true, errorTitle: 'Pilihan tidak dikenal', error: 'Pilih salah satu dari daftar.'});
  });

  const p = wb.addWorksheet('Petunjuk');
  p.columns = [{header: 'Kolom', width: 24}, {header: 'Wajib?', width: 10}, {header: 'Format dan keterangan', width: 110}];
  p.getRow(1).font = {bold: true};
  for (const c of def.kolom) p.addRow([c.judul.replace(' *', ''), c.judul.endsWith('*') ? 'Wajib' : c.info ? 'Diabaikan' : 'Opsional', c.ket + (c.pilihan ? ' Pilihan: ' + c.pilihan.join(' | ') + '.' : '')]);
  p.addRow([]);
  for (const t of [
    'Isi data mulai baris 2 di sheet "' + def.sheet + '". Satu baris = satu ' + def.nama + '. Jangan mengubah judul kolom.',
    'Baris contoh (diawali "CONTOH") diabaikan saat impor.',
    'Uang ditulis rupiah utuh tanpa sen. Angka dengan sen (mis. 1.500,50) ditolak.',
    'Saat impor, aplikasi menampilkan pratinjau lebih dulu. Tidak ada data yang tersimpan sebelum Anda menekan Simpan.',
    'Semua baris yang siap disimpan bersama-sama: bila database menolak satu baris, tidak ada yang tersimpan.',
    'Setiap baris otomatis dijurnal sesuai Tabel Pemetaan Jurnal (Pengaturan → Pemetaan jurnal).',
  ]) p.addRow([t]);

  if (opsi.K) {
    const r = wb.addWorksheet('Daftar rekening');
    r.columns = [{header: 'Nama rekening', width: 30}, {header: 'Kode akun', width: 12}, {header: 'Jenis', width: 14}, {header: 'Status', width: 10}];
    r.getRow(1).font = {bold: true};
    for (const x of opsi.K.rekening) r.addRow([x.nama, akunRekening(opsi.K, x.id)?.kode || '', x.jenis, x.aktif ? 'Aktif' : 'Nonaktif']);
    if (jenis === 'kas') {
      const a = wb.addWorksheet('Daftar akun');
      a.columns = [{header: 'Kode akun', width: 12, style: {numFmt: '@'}}, {header: 'Nama akun', width: 40}];
      a.getRow(1).font = {bold: true};
      for (const x of akunTransaksi(opsi.K)) a.addRow([x.kode, x.nama]);
    }
  }
  return wb;
}

// ---------- membaca workbook ----------
const normJudul = (s) => String(s ?? '').replace(/\*/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
// Nilai mentah sel: Date tetap Date, angka tetap angka, selain itu teks.
const nilaiSel = (cell) => {
  let v = cell.value;
  if (v && typeof v === 'object' && !(v instanceof Date)) v = v.result ?? v.text ?? (v.richText ? v.richText.map((x) => x.text).join('') : null);
  if (v instanceof Date || typeof v === 'number') return v;
  return v == null ? '' : String(v).trim();
};

export async function bacaWorkbook(ExcelJS, jenis, buffer) {
  const def = JENIS_IMPOR[jenis];
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer); } catch { throw new Error('File tidak bisa dibaca. Pastikan formatnya .xlsx (Excel), bukan .xls atau .csv.'); }
  const ws = wb.getWorksheet(def.sheet) || wb.worksheets[0];
  if (!ws) throw new Error('File tidak berisi sheet.');
  const peta = Object.fromEntries(def.kolom.map((c) => [normJudul(c.judul), c.k]));
  const kunci = {};
  ws.getRow(1).eachCell((cell, col) => { const k = peta[normJudul(nilaiSel(cell))]; if (k) kunci[col] = k; });
  const hilang = def.kolom.filter((c) => c.judul.endsWith('*') && !Object.values(kunci).includes(c.k));
  if (hilang.length) throw new Error('Kolom ' + hilang.map((c) => '"' + c.judul.replace(' *', '') + '"').join(', ') + ' tidak ditemukan di baris pertama. Pakai file dari tombol Unduh Template.');
  const hasil = [];
  ws.eachRow((row, no) => {
    if (no === 1) return;
    const nilai = {};
    for (const [col, k] of Object.entries(kunci)) { const v = nilaiSel(row.getCell(+col)); if (v !== '') nilai[k] = v; }
    if (!Object.keys(nilai).length || lembarContoh(jenis, nilai)) return;
    hasil.push({no, nilai});
  });
  return hasil;
}

// ---------- tafsir nilai ----------
const pad = (x) => String(x).padStart(2, '0');
const tanggalSah = (y, m, d) => { const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? y + '-' + pad(m) + '-' + pad(d) : null; };
export function bacaTanggal(v) {
  if (v instanceof Date) return isNaN(v) ? null : tanggalSah(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate());
  if (typeof v === 'number') { const t = new Date(Math.round((v - 25569) * 86400000)); return tanggalSah(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); }
  const s = String(v ?? '').trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(s);
  if (m) return tanggalSah(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) return tanggalSah(+m[3], +m[2], +m[1]);
  return null;
}
// Rupiah utuh. Teks: titik = pemisah ribuan, koma = desimal (harus ,00 / ,0 bila ada).
export function bacaRupiah(v) {
  if (typeof v === 'number') return Number.isInteger(v) ? v : Math.abs(v - Math.round(v)) < 1e-6 ? Math.round(v) : NaN;
  let s = String(v ?? '').replace(/rp\.?/i, '').replace(/\s/g, '');
  if (!s) return null;
  const minus = /^-|^\(.*\)$/.test(s);
  s = s.replace(/^[-(]|\)$/g, '');
  const m = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?$/.exec(s);
  if (!m || (m[2] && /[1-9]/.test(m[2]))) return NaN;
  const x = +m[1].replace(/\./g, '');
  return minus ? -x : x;
}
const bacaYaTidak = (v, bawaan) => {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return bawaan;
  if (['ya', 'y', 'yes', 'true', '1', 'aktif'].includes(s)) return true;
  if (['tidak', 't', 'no', 'false', '0', 'nonaktif'].includes(s)) return false;
  return undefined;
};
const teks = (v) => (v instanceof Date ? bacaTanggal(v) : String(v ?? '').trim());
const normNama = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const angka = (s) => String(s || '').replace(/\D/g, '');

// ---------- menilai baris ----------
// Hasil: [{no, nilai, data, galat: [{kolom, pesan}], status: 'siap'|'error'|'duplikat', alasan?, aksi?}]
export function evaluasiRekening(baris, K) {
  const dalamFile = [];
  return baris.map(({no, nilai}) => {
    const galat = [], g = (kolom, pesan) => galat.push({kolom, pesan});
    const nama = teks(nilai.nama);
    if (!nama) g('Nama akun', 'wajib diisi.');
    const jenis = JENIS_REKENING.find((j) => j.toLowerCase() === teks(nilai.jenis).toLowerCase());
    if (!jenis) g('Jenis', nilai.jenis ? '"' + teks(nilai.jenis) + '" tidak dikenal. Pilihan: ' + JENIS_REKENING.join(', ') + '.' : 'wajib diisi.');
    const saldo = nilai.saldo_awal === undefined ? 0 : bacaRupiah(nilai.saldo_awal);
    if (!Number.isInteger(saldo)) g('Saldo awal', '"' + teks(nilai.saldo_awal) + '" bukan rupiah utuh.');
    const tg = nilai.tgl_saldo_awal === undefined ? null : bacaTanggal(nilai.tgl_saldo_awal);
    if (!tg) g('Tanggal saldo awal', nilai.tgl_saldo_awal === undefined ? 'wajib diisi.' : '"' + teks(nilai.tgl_saldo_awal) + '" bukan tanggal yang benar (pakai YYYY-MM-DD).');
    else if (terkunci(K, tg)) g('Tanggal saldo awal', 'bulan ' + namaBulan(bulanDari(tg)) + ' sudah ditutup.');
    const diInvoice = bacaYaTidak(nilai.di_invoice, false), aktif = bacaYaTidak(nilai.aktif, true);
    if (diInvoice === undefined) g('Tampil di invoice', 'isi Ya atau Tidak.');
    if (aktif === undefined) g('Aktif', 'isi Ya atau Tidak.');
    const tunai = jenis === 'Kas tunai';
    const data = {
      nama, jenis: jenis || null, bank: tunai ? null : teks(nilai.bank) || null, cabang: tunai ? null : teks(nilai.cabang) || null,
      no_rekening: tunai ? null : teks(nilai.no_rekening) || null, atas_nama: teks(nilai.atas_nama) || null, mata_uang: 'IDR',
      saldo_awal: saldo, tgl_saldo_awal: tg, di_invoice: !!diInvoice, utama_invoice: false, aktif: aktif !== false, catatan: teks(nilai.catatan) || null,
    };
    const hasil = {no, nilai, data, galat, status: galat.length ? 'error' : 'siap'};
    if (!galat.length) {
      const sama = (x) => x.nama.trim().toLowerCase() === nama.toLowerCase() || (data.no_rekening && angka(x.no_rekening) === angka(data.no_rekening) && normNama(x.bank) === normNama(data.bank));
      const ada = K.rekening.find(sama), file = dalamFile.find(sama);
      if (ada) Object.assign(hasil, {status: 'duplikat', alasan: (ada.nama.toLowerCase() === nama.toLowerCase() ? 'nama' : 'no. rekening') + ' sama dengan rekening "' + ada.nama + '" yang sudah ada', aksi: 'lewati'});
      else if (file) Object.assign(hasil, {status: 'duplikat', alasan: 'sama dengan baris ' + file.__no + ' di file ini', aksi: 'lewati'});
    }
    // Rekening yang sudah ada selalu dilewati (nama rekening harus unik).
    hasil.bolehSimpanJuga = false;
    if (!galat.length) dalamFile.push({...data, __no: no});
    return hasil;
  });
}

export function evaluasiKas(baris, K, kodeProyek = []) {
  const dalamFile = [];
  const proyek = new Set(kodeProyek.map((x) => String(x).toLowerCase()));
  const bolehAkun = new Set(akunTransaksi(K).map((a) => a.id));
  const kunci = (k) => [k.tanggal, k.jenis, k.rekening_id, k.akun_id, k.jumlah, String(k.uraian).trim().toLowerCase()].join('|');
  const sudahAda = new Map(K.kas_transaksi.map((k) => [kunci(k), k]));
  return baris.map(({no, nilai}) => {
    const galat = [], g = (kolom, pesan) => galat.push({kolom, pesan});
    const tanggal = nilai.tanggal === undefined ? null : bacaTanggal(nilai.tanggal);
    if (!tanggal) g('Tanggal', nilai.tanggal === undefined ? 'wajib diisi.' : '"' + teks(nilai.tanggal) + '" bukan tanggal yang benar (pakai YYYY-MM-DD).');
    else if (terkunci(K, tanggal)) g('Tanggal', 'bulan ' + namaBulan(bulanDari(tanggal)) + ' sudah ditutup.');
    const j = teks(nilai.jenis).toLowerCase();
    const jenis = ['pengeluaran', 'keluar'].includes(j) ? 'keluar' : ['pemasukan', 'masuk'].includes(j) ? 'masuk' : null;
    if (!jenis) g('Jenis', j ? '"' + teks(nilai.jenis) + '" tidak dikenal. Isi Pengeluaran atau Pemasukan.' : 'wajib diisi.');
    const namaRek = teks(nilai.rekening);
    const rek = namaRek && (K.rekening.find((r) => r.nama.trim().toLowerCase() === namaRek.toLowerCase()) || K.rekening.find((r) => akunRekening(K, r.id)?.kode === namaRek));
    if (!namaRek) g('Rekening', 'wajib diisi.');
    else if (!rek) g('Rekening', '"' + namaRek + '" tidak ada di Kas & Bank.');
    else if (!rek.aktif) g('Rekening', '"' + rek.nama + '" sudah nonaktif.');
    const kode = teks(nilai.kode_akun);
    const akun = kode && akunKode(K, kode);
    if (nilai.kode_akun instanceof Date || typeof nilai.kode_akun === 'number') g('Kode akun', 'Excel mengubah kode akun menjadi tanggal/angka. Format kolom Kode akun sebagai Text, lalu ketik ulang kodenya (mis. 6-3).');
    else if (!kode) g('Kode akun', 'wajib diisi.');
    else if (!akun) g('Kode akun', '"' + kode + '" tidak ada di Bagan Akun.');
    else if (akun.kode === '1-1' || akun.kode.startsWith('1-1-')) g('Kode akun', akun.kode + ' adalah akun kas/bank. Perpindahan uang antar rekening dicatat lewat Transfer.');
    else if (!bolehAkun.has(akun.id)) g('Kode akun', akun.kode + ' ' + (akun.aktif ? 'adalah akun kelompok; pakai akun di bawahnya.' : 'sudah nonaktif.'));
    const pk = teks(nilai.proyek_kode);
    if (pk && !proyek.has(pk.toLowerCase())) g('Kode proyek', '"' + pk + '" tidak ada di menu Proyek.');
    const uraian = teks(nilai.uraian);
    if (!uraian) g('Uraian', 'wajib diisi.');
    const jumlah = nilai.jumlah === undefined ? null : bacaRupiah(nilai.jumlah);
    if (nilai.jumlah === undefined) g('Jumlah', 'wajib diisi.');
    else if (!Number.isInteger(jumlah)) g('Jumlah', '"' + teks(nilai.jumlah) + '" bukan rupiah utuh.');
    else if (jumlah <= 0) g('Jumlah', 'harus lebih dari 0.');
    const data = {tanggal, jenis, rekening_id: rek?.id || null, akun_id: akun?.id || null, proyek_kode: pk ? kodeProyek.find((x) => String(x).toLowerCase() === pk.toLowerCase()) : null, pihak: teks(nilai.pihak) || null, jumlah, uraian};
    const hasil = {no, nilai, data, galat, status: galat.length ? 'error' : 'siap', rekening: rek?.nama, akun: akun ? akun.kode + ' ' + akun.nama : null, bolehSimpanJuga: true};
    if (!galat.length) {
      const kk = kunci(data);
      const file = dalamFile.find((x) => x.k === kk);
      if (sudahAda.has(kk)) Object.assign(hasil, {status: 'duplikat', alasan: 'transaksi dengan tanggal, rekening, akun, jumlah, dan uraian yang sama sudah ada', aksi: 'lewati'});
      else if (file) Object.assign(hasil, {status: 'duplikat', alasan: 'sama dengan baris ' + file.no + ' di file ini', aksi: 'lewati'});
      dalamFile.push({k: kk, no});
    }
    return hasil;
  });
}

// Data -> baris datar untuk ekspor (susunan kolom sama dengan template, sehingga bisa diedit lalu diimpor).
export const rekeningKeBaris = (r) => ({nama: r.nama, jenis: r.jenis, bank: r.bank, cabang: r.cabang, no_rekening: r.no_rekening, atas_nama: r.atas_nama, saldo_awal: r.saldo_awal,
  tgl_saldo_awal: r.tgl_saldo_awal, di_invoice: r.di_invoice ? 'Ya' : 'Tidak', aktif: r.aktif ? 'Ya' : 'Tidak', catatan: r.catatan});
export const kasKeBaris = (K, k) => {
  const a = K.akun.find((x) => x.id === k.akun_id);
  return {tanggal: k.tanggal, jenis: k.jenis === 'masuk' ? 'Pemasukan' : 'Pengeluaran', rekening: K.rekening.find((r) => r.id === k.rekening_id)?.nama, kode_akun: a?.kode, nama_akun: a?.nama,
    proyek_kode: k.proyek_kode, pihak: k.pihak, uraian: k.uraian, jumlah: k.jumlah};
};
