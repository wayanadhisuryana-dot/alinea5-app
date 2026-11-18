// Ekspor tabel ke Excel (.xlsx) memakai ExcelJS dari CDN.
import {unduh} from './ui.js';

const EXCELJS = 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js';
export function muatExcelJS() {
  if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
  return new Promise((ok, gagal) => {
    const s = document.createElement('script');
    s.src = EXCELJS;
    s.onload = () => ok(window.ExcelJS);
    s.onerror = () => gagal(new Error('Pustaka Excel gagal dimuat. Periksa sambungan internet.'));
    document.head.append(s);
  });
}

// lembar: [{nama, kolom: [{judul, k, lebar?, jenis?: 'uang'|'tanggal'|'teks'}], baris: [{...}]}]
// Uang ditulis sebagai angka rupiah utuh; tanggal sebagai teks YYYY-MM-DD; nomor (rekening, NPWP) sebagai teks.
export async function eksporExcel(namaFile, lembar) {
  const ExcelJS = await muatExcelJS();
  const wb = new ExcelJS.Workbook();
  for (const l of lembar) {
    const ws = wb.addWorksheet(l.nama.slice(0, 31));
    ws.columns = l.kolom.map((c) => ({header: c.judul, key: c.k, width: c.lebar || Math.max(12, c.judul.length + 2)}));
    ws.getRow(1).font = {bold: true};
    ws.views = [{state: 'frozen', ySplit: 1}];
    for (const b of l.baris) {
      const row = ws.addRow(Object.fromEntries(l.kolom.map((c) => [c.k, c.jenis === 'uang' ? (b[c.k] == null || b[c.k] === '' ? null : Math.round(+b[c.k])) : b[c.k] ?? null])));
      l.kolom.forEach((c, i) => {
        const sel = row.getCell(i + 1);
        if (c.jenis === 'uang') sel.numFmt = '#,##0';
        else if (c.jenis === 'teks') { sel.numFmt = '@'; if (sel.value != null) sel.value = String(sel.value); }
      });
    }
  }
  const buf = await wb.xlsx.writeBuffer();
  unduh(namaFile, new Blob([buf], {type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
}
