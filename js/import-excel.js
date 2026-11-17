// Impor dari dua file Excel Alinea 5 (Back Office Admin dan Data Proyek Tim Arsitek).
// Hanya kolom ISIAN yang dibaca; kolom rumus dihitung ulang oleh aplikasi.
// Kolom dibaca menurut posisinya (A=0, B=1, ...), baris data mulai baris 5.

const SHEETJS = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
let memuat = null;
function muatSheetJS() {
  if (window.XLSX) return Promise.resolve();
  memuat ||= new Promise((ok, gagal) => {
    const s = document.createElement('script');
    s.src = SHEETJS;
    s.onload = ok;
    s.onerror = () => gagal(new Error('Pustaka pembaca Excel gagal dimuat. Periksa sambungan internet.'));
    document.head.append(s);
  });
  return memuat;
}

const teks = (v) => (v == null ? null : String(v).trim() || null);
const angka = (v) => (v == null || v === '' || isNaN(+v) ? null : +v);
const tanggal = (v) => {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 864e5).toISOString().slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
  return m ? m[0] : null;
};
const BACA = {t: teks, n: angka, d: tanggal};

// [kolom, jenis] per kunci; 'wajib' = kolom yang harus terisi agar baris dihitung.
const PETA = {
  admin: {
    'Kontrak': {tabel: 'kontrak', wajib: 0, k: {kode: [0, 't'], klien: [2, 't'], no_kontrak: [3, 't'], tgl_kontrak: [4, 'd'], jenis_perjanjian: [5, 't'], bentuk_dokumen: [6, 't'], nilai_awal: [7, 'n'], nilai_addendum: [8, 'n'], ppn: [10, 't'], lokasi_file: [16, 't'], catatan: [17, 't']}},
    'Termin': {tabel: 'termin', wajib: 0, k: {kode: [0, 't'], termin_ke: [2, 'n'], milestone: [3, 't'], persen: [4, 'n'], tgl_invoice: [6, 'd'], no_invoice: [7, 't'], jatuh_tempo: [8, 'd'], tgl_bayar: [9, 'd'], diterima: [10, 'n'], catatan: [15, 't']}},
    'Vendor & Tukang': {tabel: 'vendor', wajib: 2, k: {kode: [0, 't'], vendor: [2, 't'], jenis: [3, 't'], lingkup: [4, 't'], perjanjian: [5, 't'], dokumen_tertulis: [6, 't'], sumber_dana: [7, 't'], nilai: [8, 'n'], retensi: [9, 'n'], opname: [10, 'n'], dibayar: [12, 'n'], tgl_bayar_terakhir: [16, 'd'], catatan: [17, 't']}},
    'Hutang Lain': {tabel: 'hutang_lain', wajib: 0, k: {kreditur: [0, 't'], jenis: [1, 't'], uraian: [2, 't'], total: [3, 'n'], dibayar: [4, 'n'], cicilan: [6, 'n'], jatuh_tempo: [7, 'd'], catatan: [9, 't']}},
    'SDM': {tabel: 'sdm', wajib: 0, k: {nama: [0, 't'], jabatan: [1, 't'], status: [2, 't'], tgl_masuk: [3, 'd'], kontrak_mulai: [4, 'd'], kontrak_berakhir: [5, 'd'], dokumen_kontrak: [9, 't'], gaji: [10, 'n'], tunjangan: [11, 'n'], bpjs_kes: [12, 't'], bpjs_tk: [13, 't'], npwp: [14, 't'], no_skk: [15, 't'], skk_berlaku: [16, 'd'], catatan: [18, 't']}},
    'Aset': {tabel: 'aset', wajib: 1, k: {kode_aset: [0, 't'], nama: [1, 't'], kategori: [2, 't'], tgl_beli: [3, 'd'], harga: [4, 'n'], umur: [5, 'n'], pemegang: [8, 't'], kondisi: [9, 't'], lisensi_sd: [10, 'd'], catatan: [12, 't']}},
    'Legal & Izin': {tabel: 'legal', wajib: 0, k: {dokumen: [0, 't'], nomor: [1, 't'], tgl_terbit: [2, 'd'], berlaku_sd: [3, 'd'], lokasi_file: [6, 't'], catatan: [7, 't']}},
    'Daftar': {tabel: 'klien', wajib: 13, mulai: 3, k: {nama: [13, 't'], pic: [14, 't'], hp: [15, 't'], email: [16, 't'], alamat: [17, 't'], npwp: [18, 't'], sumber: [19, 't'], catatan: [20, 't']}},
  },
  proyek: {
    'Proyek': {tabel: 'proyek', wajib: 0, k: {kode: [0, 't'], nama: [1, 't'], klien: [2, 't'], lokasi: [3, 't'], jenis_bangunan: [4, 't'], layanan: [5, 't'], pic: [6, 't'], tim_pendukung: [7, 't'], pengawas: [8, 't'], ada_vendor: [9, 't'], vendor: [10, 't'], mulai: [11, 'd'], target: [12, 'd'], perkiraan: [13, 'd'], tahap_sekarang: [15, 't'], status: [18, 't'], perubahan_belum_tertulis: [20, 't'], catatan: [23, 't']}},
    'Progres Tahap': {tabel: 'tahap', wajib: 0, k: {kode: [0, 't'], pic: [2, 't'], tahap: [3, 't'], bobot: [4, 'n'], rencana_mulai: [5, 'd'], rencana_selesai: [6, 'd'], selesai: [7, 'n'], tgl_disetujui: [8, 'd'], catatan: [11, 't']}},
    'Masalah & Risiko': {tabel: 'masalah', wajib: 4, k: {tanggal: [0, 'd'], kode: [1, 't'], kategori: [3, 't'], uraian: [4, 't'], dampak: [5, 't'], dokumen_tertulis: [6, 't'], tindakan: [7, 't'], pic: [8, 't'], target: [9, 'd'], status: [10, 't']}},
    // Daftar nama tim di file ini tidak diimpor lagi: orang internal kini diambil dari SDM.
  },
};

// Mengembalikan {jenis, data: {tabel: [baris]}, masterProyek: [{kode, nama}]}.
export async function bacaExcel(arrayBuffer) {
  await muatSheetJS();
  const wb = window.XLSX.read(arrayBuffer, {type: 'array'});
  const jenis = wb.SheetNames.includes('Kontrak') ? 'admin' : wb.SheetNames.includes('Progres Tahap') ? 'proyek' : null;
  if (!jenis) throw new Error('File ini tidak dikenali. Pakai file Back Office (Admin) atau Data Proyek (Tim Arsitek) Alinea 5.');
  const lembar = (nama) => (wb.Sheets[nama] ? window.XLSX.utils.sheet_to_json(wb.Sheets[nama], {header: 1, raw: true, defval: null}) : []);
  const data = {};
  for (const [nama, peta] of Object.entries(PETA[jenis])) {
    const rows = lembar(nama).slice(peta.mulai ?? 4);
    const hasil = [];
    for (const r of rows) {
      const baris = {};
      for (const [kunci, [kolom, j]] of Object.entries(peta.k)) {
        const v = BACA[j](r[kolom]);
        if (v != null) baris[kunci] = v;
      }
      if (teks(r[peta.wajib]) != null) hasil.push(baris);
      else if (peta.tabel === 'proyek' && baris.tim_pendukung && hasil.length) {
        // Baris lanjutan: nama tim pendukung berikutnya untuk proyek di atasnya.
        const p = hasil[hasil.length - 1];
        p.tim_pendukung = [p.tim_pendukung, baris.tim_pendukung].filter(Boolean).join(', ');
      }
    }
    data[peta.tabel] = hasil;
  }
  const masterProyek = jenis === 'admin'
    ? lembar('Daftar').slice(3).map((r) => ({kode: teks(r[22]), nama: teks(r[23])})).filter((p) => p.kode)
    : [];
  return {jenis, data, masterProyek};
}
