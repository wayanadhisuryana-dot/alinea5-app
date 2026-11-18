// Template, ekspor, dan pembacaan Excel untuk data master Tahap 2. Tidak menyentuh layar atau database;
// pustaka ExcelJS diberikan sebagai argumen sehingga bisa diuji di luar browser.
import {OPSI} from './schema.js';
import {JENIS_VENDOR, BENTUK_PIHAK, TERMIN_SUPPLIER, fmtDesimal} from './master-util.js';

const YA_TIDAK = ['Ya', 'Tidak'];
const STATUS = ['Aktif', 'Nonaktif'];
const kolomRekening = [
  {k: 'bank', judul: 'Bank', lebar: 14, ket: 'Opsional.'},
  {k: 'no_rekening', judul: 'No. rekening', lebar: 20, teks: true, ket: 'Opsional. Kolom TEXT agar angka 0 di depan tidak hilang.'},
  {k: 'atas_nama', judul: 'Rekening atas nama', lebar: 24, ket: 'Opsional.'},
];
const kolomKontak = [
  {k: 'pic', judul: 'PIC', lebar: 20, ket: 'Opsional. Nama kontak.'},
  {k: 'hp', judul: 'No. HP / WA', lebar: 18, teks: true, ket: 'Opsional. 08…, 8…, 62…, atau +62…. Disimpan sebagai 628….'},
  {k: 'email', judul: 'Email', lebar: 26, ket: 'Opsional.'},
  {k: 'alamat', judul: 'Alamat', lebar: 34, ket: 'Opsional.'},
];
const kolomAkhir = [
  {k: 'afiliasi', judul: 'Pihak afiliasi', lebar: 14, pilihan: YA_TIDAK, ket: 'Opsional, bawaan Tidak. Ya bila punya hubungan istimewa dengan perusahaan (untuk laporan pihak berelasi).'},
  {k: 'status', judul: 'Status', lebar: 11, pilihan: STATUS, ket: 'Opsional, bawaan Aktif.'},
  {k: 'catatan', judul: 'Catatan', lebar: 30, ket: 'Opsional.'},
];

// Definisi tiap jenis impor. Fungsi agar daftar pilihan dari Pengaturan selalu yang terbaru.
export const DEF = {
  vendor: () => ({
    sheet: 'Data Vendor', nama: 'vendor', kunci: 'nama',
    kolom: [
      {k: 'nama', judul: 'Nama *', lebar: 28, ket: 'Wajib.'},
      {k: 'jenis', judul: 'Jenis *', lebar: 14, pilihan: JENIS_VENDOR, ket: 'Wajib. Mandor, Tukang, dan Freelance yang aktif muncul di pilihan Tim Proyek.'},
      {k: 'bentuk', judul: 'Perorangan / Badan usaha', lebar: 16, pilihan: BENTUK_PIHAK, ket: 'Opsional, bawaan Perorangan.'},
      {k: 'keahlian', judul: 'Keahlian', lebar: 30, ket: 'Opsional. Boleh lebih dari satu, dipisah koma. Pilihan: ' + OPSI.keahlianVendor.join(' | ') + '.'},
      ...kolomKontak,
      {k: 'nik', judul: 'NIK', lebar: 20, teks: true, ket: 'Opsional. 16 digit. NIK yang sama dengan vendor lain ditolak.'},
      {k: 'npwp', judul: 'NPWP', lebar: 20, teks: true, ket: 'Opsional. 15 atau 16 digit. NPWP yang sama dengan vendor lain ditolak.'},
      ...kolomRekening, ...kolomAkhir,
    ],
    contoh: {nama: 'CONTOH - Pak Made Tukang Kayu', jenis: 'Tukang', bentuk: 'Perorangan', keahlian: 'Kayu / kusen, Furniture / interior', hp: '081234567890', nik: '5171000000000001', status: 'Aktif'},
  }),
  supplier: () => ({
    sheet: 'Data Supplier', nama: 'supplier', kunci: 'nama',
    kolom: [
      {k: 'nama', judul: 'Nama *', lebar: 28, ket: 'Wajib.'},
      {k: 'kategori', judul: 'Kategori barang', lebar: 30, ket: 'Opsional. Boleh lebih dari satu, dipisah koma. Pilihan: ' + OPSI.kategoriBarang.join(' | ') + '.'},
      ...kolomKontak,
      {k: 'npwp', judul: 'NPWP', lebar: 20, teks: true, ket: 'Opsional. 15 atau 16 digit. NPWP yang sama dengan supplier lain ditolak.'},
      {k: 'pkp', judul: 'PKP', lebar: 8, pilihan: YA_TIDAK, ket: 'Opsional, bawaan Tidak. Ya bila supplier Pengusaha Kena Pajak.'},
      ...kolomRekening,
      {k: 'termin', judul: 'Termin pembayaran', lebar: 14, pilihan: TERMIN_SUPPLIER, ket: 'Opsional, bawaan Tunai.'},
      {k: 'tempo_hari', judul: 'Tempo (hari)', lebar: 10, ket: 'Wajib bila Termin = Tempo. Angka bulat, mis. 30.'},
      ...kolomAkhir,
    ],
    contoh: {nama: 'CONTOH - Toko Bangunan Sejahtera', kategori: 'Kayu & Panel, Cat', hp: '0361234567', pkp: 'Tidak', termin: 'Tempo', tempo_hari: '30', status: 'Aktif'},
  }),
  barang: (jenis = 'barang') => ({
    sheet: jenis === 'pekerjaan' ? 'Data Pekerjaan' : 'Data Barang', nama: jenis === 'pekerjaan' ? 'item pekerjaan' : 'barang', kunci: 'nama',
    kolom: [
      {k: 'kode', judul: 'Kode', lebar: 12, teks: true, ket: 'Kosongkan untuk barang baru: dibuat otomatis per kategori. Diisi hanya bila memperbarui barang yang sudah ada (hasil Ekspor).'},
      {k: 'nama', judul: 'Nama *', lebar: 30, ket: 'Wajib.'},
      {k: 'kategori', judul: 'Kategori *', lebar: 20, pilihan: jenis === 'pekerjaan' ? OPSI.kategoriPekerjaan : OPSI.kategoriBarang, ket: 'Wajib. Pilih dari daftar.'},
      {k: 'satuan', judul: 'Satuan baku *', lebar: 12, pilihan: OPSI.satuanBarang, ket: 'Wajib. Harga selalu bisa ditampilkan dalam satuan ini.'},
      ...(jenis === 'pekerjaan' ? [] : [{k: 'merk', judul: 'Merk', lebar: 16, ket: 'Opsional.'}]),
      {k: 'spesifikasi', judul: 'Spesifikasi', lebar: 30, ket: 'Opsional. Ukuran, tebal, warna, dll.'},
      {k: 'konversi', judul: 'Konversi satuan', lebar: 30, ket: 'Opsional. Format "1 lembar = 2,9768", pisahkan dengan titik koma bila lebih dari satu: "1 lembar = 2,9768; 1 dus = 1,44". Angka = jumlah satuan baku dalam 1 satuan itu.'},
      {k: 'status', judul: 'Status', lebar: 11, pilihan: STATUS, ket: 'Opsional, bawaan Aktif.'},
    ],
    contoh: jenis === 'pekerjaan'
      ? {nama: 'CONTOH - Kitchen set bawah HPL', kategori: OPSI.kategoriPekerjaan[0], satuan: "m'", spesifikasi: 'Multipleks 18 mm, finishing HPL', status: 'Aktif'}
      : {nama: 'CONTOH - Multipleks 18 mm', kategori: OPSI.kategoriBarang[0], satuan: 'm²', merk: '—', spesifikasi: '122 × 244 cm, tebal 18 mm', konversi: '1 lembar = 2,9768', status: 'Aktif'},
  }),
  harga: (jenis = 'barang') => ({
    sheet: 'Data Harga', nama: 'harga', kunci: 'kode_barang',
    kolom: [
      {k: 'kode_barang', judul: (jenis === 'pekerjaan' ? 'Kode pekerjaan' : 'Kode barang') + ' *', lebar: 14, teks: true, ket: 'Wajib. Kode yang sudah ada di Barang & Harga (lihat sheet "Daftar kode").'},
      {k: 'nama_barang', judul: 'Nama', lebar: 28, info: true, ket: 'Hanya keterangan; yang dipakai saat impor adalah kode.'},
      {k: 'tanggal', judul: 'Tanggal *', lebar: 12, tanggal: true, ket: 'Wajib. YYYY-MM-DD atau DD/MM/YYYY.'},
      {k: 'pihak', judul: jenis === 'pekerjaan' ? 'Vendor / tukang' : 'Supplier', lebar: 26, ket: 'Opsional. Nama persis seperti di menu ' + (jenis === 'pekerjaan' ? 'Vendor & Tukang' : 'Supplier') + '. Nama yang belum terdaftar tetap disimpan sebagai teks.'},
      {k: 'harga', judul: 'Harga satuan *', lebar: 16, uang: true, ket: 'Wajib. Rupiah utuh per satuan di kolom Satuan, mis. 450000 atau 450.000.'},
      {k: 'satuan', judul: 'Satuan', lebar: 10, ket: 'Opsional, bawaan satuan baku. Boleh satuan konversi barang itu (mis. lembar); harga per satuan baku dihitung otomatis.'},
      {k: 'ppn', judul: 'Termasuk PPN?', lebar: 12, pilihan: YA_TIDAK, ket: 'Opsional, bawaan Tidak.'},
      {k: 'ongkir', judul: 'Ongkir per satuan', lebar: 14, uang: true, ket: 'Opsional. Rupiah utuh per satuan yang sama.'},
      {k: 'proyek_kode', judul: 'Kode proyek', lebar: 12, teks: true, ket: 'Opsional.'},
      {k: 'catatan', judul: 'Catatan', lebar: 30, ket: 'Opsional.'},
    ],
    contoh: {kode_barang: 'CONTOH', nama_barang: 'Baris contoh diabaikan', tanggal: '2026-01-15', pihak: 'Toko Bangunan Sejahtera', harga: '450000', satuan: 'lembar', ppn: 'Tidak'},
  }),
};

const lembarContoh = (b) => Object.values(b).some((v) => /^contoh\b/i.test(String(v ?? '')));

// baris: baris datar; opsi.contoh: baris contoh abu-abu; opsi.galat: teks error per baris; opsi.daftar: [{judul, kolom: [..], baris: [[..]]}] sheet bantu.
export function buatWorkbook(ExcelJS, def, baris, opsi = {}) {
  const kolom = def.kolom.slice();
  if (opsi.galat) kolom.push({k: '__galat', judul: 'Error', lebar: 60});
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(def.sheet, {views: [{state: 'frozen', ySplit: 1}]});
  ws.columns = kolom.map((c) => ({header: c.judul, key: c.k, width: c.lebar, style: c.teks ? {numFmt: '@'} : {}}));
  ws.getRow(1).font = {bold: true};
  const tulis = (b) => {
    const row = ws.addRow(Object.fromEntries(kolom.map((c) => {
      const v = b[c.k];
      return [c.k, v == null || v === '' ? null : c.uang && Number.isFinite(+v) ? +v : Array.isArray(v) ? v.join(', ') : String(v)];
    })));
    kolom.forEach((c, i) => { if (c.teks) row.getCell(i + 1).numFmt = '@'; else if (c.uang) row.getCell(i + 1).numFmt = '#,##0'; });
    return row;
  };
  if (opsi.contoh) tulis(def.contoh).eachCell({includeEmpty: true}, (cell) => {
    cell.fill = {type: 'pattern', pattern: 'solid', fgColor: {argb: 'FFD9D9D9'}};
    cell.font = {italic: true, color: {argb: 'FF666666'}};
  });
  baris.forEach((b, i) => tulis(opsi.galat ? {...b, __galat: opsi.galat[i]} : b));
  const akhir = Math.max(ws.rowCount + 500, 1000);
  kolom.forEach((c, i) => {
    if (!c.pilihan) return;
    const daftar = '"' + c.pilihan.join(',') + '"';
    if (daftar.length > 255 || c.pilihan.some((x) => x.includes(','))) return; // batas Excel; isian tetap diperiksa saat impor
    const huruf = ws.getColumn(i + 1).letter;
    ws.dataValidations.add(huruf + '2:' + huruf + akhir, {type: 'list', allowBlank: true, formulae: [daftar], showErrorMessage: true, errorTitle: 'Pilihan tidak dikenal', error: 'Pilih salah satu dari daftar.'});
  });
  const p = wb.addWorksheet('Petunjuk');
  p.columns = [{header: 'Kolom', width: 24}, {header: 'Wajib?', width: 10}, {header: 'Format dan keterangan', width: 110}];
  p.getRow(1).font = {bold: true};
  for (const c of def.kolom) p.addRow([c.judul.replace(' *', ''), c.judul.endsWith('*') ? 'Wajib' : c.info ? 'Diabaikan' : 'Opsional', c.ket + (c.pilihan ? ' Pilihan: ' + c.pilihan.join(' | ') + '.' : '')]);
  p.addRow([]);
  for (const t of [
    'Isi data mulai baris 2 di sheet "' + def.sheet + '". Satu baris = satu ' + def.nama + '. Jangan mengubah judul kolom.',
    'Baris yang diawali "CONTOH" diabaikan saat impor.',
    'Kolom No. HP, NIK, NPWP, No. rekening, dan kode berformat TEXT. Jangan diubah menjadi angka: angka 0 di depan akan hilang.',
    'Saat impor, aplikasi menampilkan pratinjau lebih dulu. Tidak ada data yang tersimpan sebelum Anda menekan Simpan.',
    'File hasil Ekspor memakai susunan kolom yang sama, sehingga bisa diedit lalu diimpor kembali.',
  ]) p.addRow([t]);
  for (const d of opsi.daftar || []) {
    const s = wb.addWorksheet(d.judul);
    s.columns = d.kolom.map((judul) => ({header: judul, width: 28, style: {numFmt: '@'}}));
    s.getRow(1).font = {bold: true};
    d.baris.forEach((b) => s.addRow(b));
  }
  return wb;
}

const normJudul = (s) => String(s ?? '').replace(/\*/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const nilaiSel = (cell) => {
  let v = cell.value;
  if (v && typeof v === 'object' && !(v instanceof Date)) v = v.result ?? v.text ?? (v.richText ? v.richText.map((x) => x.text).join('') : null);
  if (v instanceof Date || typeof v === 'number') return v;
  return v == null ? '' : String(v).trim();
};
export async function bacaWorkbook(ExcelJS, def, buffer) {
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
    if (!Object.keys(nilai).length || lembarContoh(nilai)) return;
    hasil.push({no, nilai});
  });
  return hasil;
}

// Teks konversi "1 lembar = 2,9768; 1 dus = 1,44" <-> [{satuan, faktor}].
export const konversiKeTeks = (k = []) => k.map((c) => '1 ' + c.satuan + ' = ' + fmtDesimal(c.faktor)).join('; ');
export function teksKeKonversi(t) {
  return String(t ?? '').split(';').map((x) => x.trim()).filter(Boolean).map((x) => {
    const [kiri, kanan = ''] = x.split('=');
    const satuan = kiri.trim().replace(/^1\s+/, '');
    const m = /^([\d.,]+)(\s+\S+)?$/.exec(kanan.trim());
    return {satuan, faktor: m ? m[1] : kanan.trim() || 'kosong'};
  });
}
