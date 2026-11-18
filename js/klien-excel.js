// Ekspor, template, dan impor Excel untuk klien. Fungsi di sini tidak menyentuh layar atau
// database; pustaka ExcelJS diberikan sebagai argumen sehingga bisa diuji di luar browser.
import {JENIS_KLIEN, SUMBER_KLIEN, validasiKlien, cariDuplikat, kontakDari} from './klien-util.js';

export const NAMA_SHEET = 'Data Klien';
const KOLOM_DASAR = [
  {k: 'nama', judul: 'Nama klien *', lebar: 34, ket: 'Wajib. Nama perorangan atau badan usaha.'},
  {k: 'jenis', judul: 'Jenis klien *', lebar: 26, pilihan: JENIS_KLIEN, ket: 'Wajib. Pilih dari daftar.'},
  {k: 'pic', judul: 'Nama PIC', lebar: 24, ket: 'Opsional. Nama kontak utama.'},
  {k: 'jabatan', judul: 'Jabatan PIC', lebar: 20, ket: 'Opsional. Misalnya Owner, Procurement, Keuangan.'},
  {k: 'hp', judul: 'No. HP / WA', lebar: 20, teks: true, ket: 'Opsional. Boleh 08…, 8…, 62…, atau +62…, dengan atau tanpa spasi/tanda hubung. Disimpan sebagai 628….'},
  {k: 'email', judul: 'Email', lebar: 28, ket: 'Opsional. Format email, misalnya nama@contoh.com.'},
  {k: 'alamat', judul: 'Alamat penagihan', lebar: 40, ket: 'Opsional.'},
  {k: 'npwp', judul: 'NPWP', lebar: 22, teks: true, ket: 'Opsional. 16 digit (format baru) atau 15 digit (format lama); titik dan strip diabaikan. Untuk perorangan dapat diisi NIK.'},
  {k: 'sumber', judul: 'Sumber klien', lebar: 20, pilihan: SUMBER_KLIEN, ket: 'Opsional. Pilih dari daftar.'},
  {k: 'referensi_oleh', judul: 'Direferensikan oleh', lebar: 24, ket: 'Opsional. Hanya dipakai bila Sumber klien = Referensi.'},
  {k: 'sumber_lain', judul: 'Sebutkan sumber', lebar: 24, ket: 'Opsional. Hanya dipakai bila Sumber klien = Lainnya.'},
  {k: 'afiliasi', judul: 'Pihak afiliasi', lebar: 14, pilihan: ['Ya', 'Tidak'], ket: 'Opsional, bawaan Tidak. Ya bila klien punya hubungan istimewa dengan perusahaan (untuk laporan pihak berelasi).'},
  {k: 'catatan', judul: 'Catatan', lebar: 36, ket: 'Opsional.'},
];
const kolomKontak = (i) => [
  {k: 'k' + i + '_nama', judul: 'Kontak ' + i + ' - Nama', lebar: 24, ket: 'Opsional. Kontak tambahan ke-' + i + '.'},
  {k: 'k' + i + '_jabatan', judul: 'Kontak ' + i + ' - Jabatan', lebar: 20, ket: 'Opsional.'},
  {k: 'k' + i + '_hp', judul: 'Kontak ' + i + ' - HP', lebar: 20, teks: true, ket: 'Opsional. Format sama dengan No. HP / WA.'},
  {k: 'k' + i + '_email', judul: 'Kontak ' + i + ' - Email', lebar: 28, ket: 'Opsional.'},
];
const susunKolom = (jmlKontak) => {
  const kolom = KOLOM_DASAR.slice();
  for (let i = 2; i <= Math.max(2, jmlKontak); i++) kolom.push(...kolomKontak(i));
  return kolom;
};
const CONTOH = {nama: 'CONTOH - PT Maju Jaya', jenis: JENIS_KLIEN[1], pic: 'Ibu Sari', jabatan: 'Owner', hp: '081234567890', email: 'sari@contoh.com', alamat: 'Jl. Contoh No. 1, Denpasar', npwp: '1234567890123456', sumber: 'Referensi', referensi_oleh: 'Bpk. Made', catatan: 'Baris contoh ini diabaikan saat impor.'};

// Klien -> satu baris datar (kontak utama di kolom PIC, kontak lain di "Kontak 2", "Kontak 3", ...).
export function klienKeBaris(k) {
  const kontak = kontakDari(k), utama = kontak.find((c) => c.utama), lain = kontak.filter((c) => !c.utama);
  const baris = {nama: k.nama, jenis: k.jenis, pic: utama?.nama, jabatan: utama?.jabatan, hp: utama?.hp, email: utama?.email, alamat: k.alamat, npwp: k.npwp, sumber: k.sumber, referensi_oleh: k.referensi_oleh, sumber_lain: k.sumber_lain, afiliasi: k.afiliasi ? 'Ya' : 'Tidak', catatan: k.catatan};
  lain.forEach((c, i) => Object.assign(baris, {['k' + (i + 2) + '_nama']: c.nama, ['k' + (i + 2) + '_jabatan']: c.jabatan, ['k' + (i + 2) + '_hp']: c.hp, ['k' + (i + 2) + '_email']: c.email}));
  return baris;
}
// Baris datar -> masukan untuk validasiKlien.
export function barisKeMasuk(b) {
  const kontak = [{nama: b.pic, jabatan: b.jabatan, hp: b.hp, email: b.email, utama: true}];
  const nomor = [...new Set(Object.keys(b).map((k) => /^k(\d+)_/.exec(k)).filter(Boolean).map((m) => +m[1]))].sort((x, y) => x - y);
  for (const i of nomor) kontak.push({nama: b['k' + i + '_nama'], jabatan: b['k' + i + '_jabatan'], hp: b['k' + i + '_hp'], email: b['k' + i + '_email']});
  return {nama: b.nama, jenis: b.jenis, kontak: kontak.filter(Boolean), alamat: b.alamat, npwp: b.npwp, sumber: b.sumber, referensi_oleh: b.referensi_oleh, sumber_lain: b.sumber_lain, afiliasi: b.afiliasi, catatan: b.catatan};
}

// Membuat workbook. baris: daftar baris datar; opsi.contoh: sertakan baris contoh abu-abu;
// opsi.galat: daftar teks error sejajar dengan baris (menambah kolom "Error").
export function buatWorkbook(ExcelJS, baris, opsi = {}) {
  const jmlKontak = Math.max(2, ...baris.flatMap((b) => Object.keys(b).filter((k) => /^k\d+_/.test(k) && b[k]).map((k) => +/^k(\d+)_/.exec(k)[1])));
  const kolom = susunKolom(jmlKontak);
  if (opsi.galat) kolom.push({k: '__galat', judul: 'Error', lebar: 60});
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(NAMA_SHEET, {views: [{state: 'frozen', ySplit: 1}]});
  ws.columns = kolom.map((c) => ({header: c.judul, key: c.k, width: c.lebar, style: c.teks ? {numFmt: '@'} : {}}));
  ws.getRow(1).font = {bold: true};
  const tulis = (b) => {
    const row = ws.addRow(Object.fromEntries(kolom.map((c) => [c.k, b[c.k] == null ? '' : String(b[c.k])])));
    kolom.forEach((c, i) => { if (c.teks) row.getCell(i + 1).numFmt = '@'; });
    return row;
  };
  if (opsi.contoh) {
    const row = tulis(CONTOH);
    row.eachCell({includeEmpty: true}, (cell) => {
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
  p.columns = [{header: 'Kolom', width: 26}, {header: 'Wajib?', width: 10}, {header: 'Format dan keterangan', width: 100}];
  p.getRow(1).font = {bold: true};
  for (const c of kolom.filter((x) => x.k !== '__galat')) p.addRow([c.judul.replace(' *', ''), c.judul.endsWith('*') ? 'Wajib' : 'Opsional', c.ket + (c.pilihan ? ' Pilihan: ' + c.pilihan.join(' | ') + '.' : '')]);
  p.addRow([]);
  for (const t of [
    'Isi data mulai baris 2 di sheet "Data Klien". Satu baris = satu klien. Jangan mengubah judul kolom.',
    'Baris yang Nama klien-nya diawali "CONTOH" diabaikan saat impor.',
    'Kolom No. HP dan NPWP berformat TEXT. Jangan diubah menjadi angka: Excel hanya presisi 15 digit, dan angka 0 di depan No. HP akan hilang.',
    'Saat impor, aplikasi menampilkan pratinjau lebih dulu. Tidak ada data yang tersimpan sebelum Anda menekan tombol Simpan.',
    'File hasil Ekspor memakai susunan kolom yang sama, sehingga bisa diedit lalu diimpor kembali.',
  ]) p.addRow([t]);
  return wb;
}

const normJudul = (s) => String(s ?? '').replace(/\*/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const PETA_JUDUL = Object.fromEntries(KOLOM_DASAR.map((c) => [normJudul(c.judul), c.k]));
const kunciDariJudul = (judul) => {
  const j = normJudul(judul);
  if (PETA_JUDUL[j]) return PETA_JUDUL[j];
  const m = /^kontak (\d+) - (nama|jabatan|hp|email)$/.exec(j);
  return m ? 'k' + m[1] + '_' + m[2] : null;
};
const teksSel = (cell) => {
  const v = cell.value;
  if (v == null) return '';
  if (typeof v === 'object' && !(v instanceof Date)) return String(v.text ?? v.result ?? (v.richText || []).map((r) => r.text).join('') ?? '').trim();
  return String(cell.text ?? v).trim();
};

// Membaca file .xlsx -> [{no: nomor baris Excel, nilai: baris datar}]. Baris kosong dan CONTOH dilewati.
export async function bacaWorkbook(ExcelJS, buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.getWorksheet(NAMA_SHEET) || wb.worksheets[0];
  if (!ws) throw new Error('File tidak berisi sheet.');
  const kunci = {};
  ws.getRow(1).eachCell((cell, col) => { const k = kunciDariJudul(teksSel(cell)); if (k) kunci[col] = k; });
  if (!Object.values(kunci).includes('nama')) throw new Error('Kolom "Nama klien" tidak ditemukan di baris pertama. Pakai file dari tombol Unduh Template.');
  const hasil = [];
  ws.eachRow((row, no) => {
    if (no === 1) return;
    const nilai = {};
    for (const [col, k] of Object.entries(kunci)) { const t = teksSel(row.getCell(+col)); if (t) nilai[k] = t; }
    if (!Object.keys(nilai).length || /^contoh/i.test(nilai.nama || '')) return;
    hasil.push({no, nilai});
  });
  return hasil;
}

// Menilai tiap baris impor: siap, error, atau duplikat (di dalam file / dengan data yang sudah ada).
export function evaluasiImpor(baris, klienAda) {
  const sebelumnya = [];
  return baris.map(({no, nilai}) => {
    const {data, galat} = validasiKlien(barisKeMasuk(nilai));
    if (galat.length) return {no, nilai, data, galat, status: 'error'};
    const cocokAda = (() => {
      const d = cariDuplikat(data, klienAda);
      for (const [alasan, label] of [['npwp', 'NPWP sama'], ['nama', 'nama mirip'], ['hp', 'No. HP sama'], ['email', 'email sama']]) if (d[alasan].length) return {klien: d[alasan][0], alasan: label};
      return null;
    })();
    const dFile = cariDuplikat(data, sebelumnya);
    const cocokFile = dFile.npwp[0] || dFile.nama[0] || dFile.hp[0] || dFile.email[0];
    sebelumnya.push({...data, id: 'baris-' + no, __no: no});
    if (cocokAda) return {no, nilai, data, galat, status: 'duplikat', jenisDup: 'ada', cocok: cocokAda.klien, alasan: cocokAda.alasan + ' dengan klien "' + cocokAda.klien.nama + '"', aksi: 'lewati'};
    if (cocokFile) return {no, nilai, data, galat, status: 'duplikat', jenisDup: 'file', alasan: 'sama dengan baris ' + cocokFile.__no + ' di file ini', aksi: 'lewati'};
    return {no, nilai, data, galat, status: 'siap'};
  });
}
