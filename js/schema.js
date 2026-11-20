// Definisi tabel, kolom isian, dan daftar pilihan. Menambah kolom cukup di sini;
// database menyimpan tiap baris sebagai JSON sehingga tidak perlu migrasi.

import {SUMBER_KLIEN, SUMBER_BAWAAN, aturSumberKlien} from './klien-util.js';
import {STATUS_KERJA} from './sdm-util.js';

export const TAHAP = [
  {nama: '1. Konsep Rancangan', bobot: 0.1},
  {nama: '2. Pra Rancangan', bobot: 0.2},
  {nama: '3. Pengembangan Rancangan', bobot: 0.25},
  {nama: '4. Gambar Kerja', bobot: 0.25},
  {nama: '5. Pengadaan Pelaksana', bobot: 0.05},
  {nama: '6. Pengawasan Berkala', bobot: 0.15},
];

// Batas deviasi progres terhadap waktu terpakai (sama dengan tab Daftar di Excel).
export const TOLERANSI = {ringan: -0.05, terlambat: -0.15};

export const OPSI = {
  yt: ['Ya', 'Tidak'],
  tahap: TAHAP.map((t) => t.nama),
  jenisBangunan: ['Rumah tinggal', 'Villa', 'Hotel / Resort', 'Restoran / Kafe', 'Klinik / Rumah sakit', 'Kantor', 'Sekolah', 'Komersial lain', 'Lainnya'],
  layanan: ['Desain arsitektur', 'Desain interior', 'Desain arsitektur + interior', 'Desain + pengawasan berkala', 'Turn-key (desain + bangun)', 'Pengawasan saja', 'Lainnya'],
  statusProyek: ['Berjalan', 'Tertunda - klien', 'Tertunda - internal', 'Selesai', 'Batal'],
  lokasi: ['Denpasar', 'Badung', 'Gianyar', 'Tabanan', 'Buleleng', 'Karangasem', 'Bangli', 'Klungkung', 'Jembrana', 'Luar Bali'],
  kategoriMasalah: ['Revisi / permintaan klien', 'Perubahan lingkup', 'Jadwal', 'Pembayaran', 'Lapangan / tukang', 'Perizinan (PBG dll)', 'Internal tim', 'Lainnya'],
  dampak: ['Rendah', 'Sedang', 'Tinggi'],
  statusMasalah: ['Terbuka', 'Proses', 'Selesai'],
  jenisPerjanjian: ['Lump sum (harga tetap)', '% dari RAB / nilai konstruksi', 'Per m²', 'Borongan konstruksi', 'Cost plus fee', 'Lainnya'],
  bentukDokumen: ['Kontrak ditandatangani', 'SPK / PO ditandatangani', 'Hanya penawaran disetujui', 'Hanya chat / email', 'Tidak ada'],
  ppn: ['Termasuk PPN', 'Belum termasuk PPN', 'Tanpa PPN'],
  jenisVendor: ['Mandor / tukang borongan', 'Tukang harian', 'Supplier material', 'Subkon (MEP, baja, dll)', 'Konsultan lain (struktur, MEP)', 'Lainnya'],
  perjanjianVendor: ['Borongan per pekerjaan', 'Harian', 'PO material', 'Kontrak subkon', 'Lisan'],
  sumberDana: ['Dana titipan klien', 'Kas Alinea'],
  jenisHutang: ['Pinjaman bank', 'Pinjaman pribadi', 'Sewa kantor', 'Pajak terutang', 'Cicilan aset', 'Lainnya'],
  statusPegawai: STATUS_KERJA.slice(),
  jenisDokumenKerja: ['Perjanjian kerja (PKWTT)', 'SK pengangkatan', 'Perjanjian magang', 'SK perubahan jabatan / gaji', 'Addendum perjanjian kerja', 'Lainnya'],
  peranTim: ['PIC', 'Pengawas', 'Desainer', 'Drafter', 'Mandor', 'Tukang', 'Lainnya'],
  kategoriAset: ['Komputer / laptop', 'Software / lisensi', 'Kendaraan', 'Printer / plotter', 'Peralatan lapangan', 'Furnitur kantor', 'Lainnya'],
  kondisi: ['Baik', 'Perlu servis', 'Rusak', 'Hilang'],
  // Tahap 2: master
  keahlianVendor: ['Kayu / kusen', 'Pasangan batu & beton', 'Besi & las', 'Cat & finishing', 'Keramik & lantai', 'Atap', 'Listrik', 'Plumbing', 'Gypsum & plafon', 'Furniture / interior', 'Taman', 'Lainnya'],
  kategoriBarang: ['Kayu & Panel', 'Besi & Logam', 'Keramik & Batu', 'HPL & Finishing', 'Cat', 'Lampu & Elektrikal', 'Sanitair', 'Hardware & Aksesori', 'Kaca', 'Kain & Upholstery', 'Lainnya'],
  kategoriPekerjaan: ['Kitchen set', 'Lemari & furniture built-in', 'Plafon', 'Partisi & dinding', 'Lantai', 'Pengecatan', 'Elektrikal', 'Plumbing', 'Lainnya'],
  satuanBarang: ['m²', "m'", 'm³', 'lembar', 'batang', 'unit', 'set', 'kg', 'liter', 'dus', 'sak', 'roll', 'buah', 'titik', 'ls'],
};

// Pilihan yang boleh diubah admin dari menu Pengaturan. Daftar lain (status proyek, status masalah,
// dampak, bentuk dokumen, sumber dana, kondisi, tahap, jenis klien, status kerja) dipakai oleh rumus
// sehingga tetap. Jabatan SDM punya bagian sendiri di Pengaturan.
export const OPSI_BISA_DIATUR = {
  sumberKlien: 'Sumber klien (Klien)',
  lokasi: 'Lokasi kab/kota (Proyek)',
  jenisBangunan: 'Jenis bangunan (Proyek)',
  layanan: 'Jenis layanan (Proyek)',
  kategoriMasalah: 'Kategori masalah (Masalah & Risiko)',
  jenisPerjanjian: 'Jenis perjanjian (Kontrak)',
  ppn: 'PPN (Kontrak)',
  jenisVendor: 'Jenis vendor (Vendor & Tukang)',
  perjanjianVendor: 'Jenis perjanjian vendor (Vendor & Tukang)',
  jenisHutang: 'Jenis hutang (Hutang Lain)',
  peranTim: 'Peran di Tim Proyek (Proyek)',
  jenisDokumenKerja: 'Jenis dokumen kerja (SDM)',
  keahlianVendor: 'Keahlian (Vendor & Tukang)',
  kategoriBarang: 'Kategori barang (Barang & Harga, Supplier)',
  kategoriPekerjaan: 'Kategori pekerjaan (Barang & Harga → Harga Pekerjaan)',
  satuanBarang: 'Satuan (Barang & Harga)',
};
const BAWAAN = Object.fromEntries(Object.entries(OPSI).map(([k, v]) => [k, v.slice()]));
export const opsiBawaan = (k) => (k === 'sumberKlien' ? SUMBER_BAWAAN : BAWAAN[k]).slice();
export const opsiSekarang = (k) => (k === 'sumberKlien' ? SUMBER_KLIEN : OPSI[k]).slice();
// Memasang pilihan hasil pengaturan admin; kunci yang tidak diatur kembali ke bawaan.
export function terapkanOpsi(atur = {}) {
  for (const k of Object.keys(OPSI_BISA_DIATUR)) {
    const daftar = Array.isArray(atur?.[k]) && atur[k].length ? atur[k].map(String) : opsiBawaan(k);
    if (k === 'sumberKlien') aturSumberKlien(daftar); else OPSI[k] = daftar;
  }
}

// Jenis isian (t): teks, catatan, angka, uang, persen, tanggal, pilih, yt,
// hp, email, npwp (ketiganya dicek langsung saat mengetik dan disimpan dalam bentuk seragam),
// proyek (kode proyek), klien (id klien, dipilih dari daftar), tim (nama orang internal),
// timproyek (daftar anggota Tim Proyek), anggota (nama, dipilih dari Tim Proyek di formulir yang sama).
// akses: 'umum' = admin dan arsitek, 'admin' = hanya admin.
// kolom: [kunci, judul, format] untuk daftar; kunci boleh hasil hitungan (lihat calc.js).
export const TABEL = {
  proyek: {
    label: 'Proyek', satuan: 'proyek', grup: 'Proyek', akses: 'umum', urut: 'kode',
    bantuan: 'Satu baris per proyek. Kode proyek (format A5-YY-NNN) dibuat sekali di sini dan dipakai di semua tabel lain. Jangan ganti kode setelah dipakai.',
    isian: [
      {k: 'kode', label: 'Kode proyek', t: 'teks', wajib: true, contoh: 'A5-26-001', pola: 'A5-\\d{2}-\\d{3}', unik: true},
      {k: 'nama', label: 'Nama proyek', t: 'teks', wajib: true},
      {k: 'klien_id', label: 'Klien', t: 'klien', wajib: true},
      {k: 'lokasi', label: 'Lokasi (kab/kota)', t: 'pilih', opsi: 'lokasi'},
      {k: 'jenis_bangunan', label: 'Jenis bangunan', t: 'pilih', opsi: 'jenisBangunan'},
      {k: 'layanan', label: 'Jenis layanan', t: 'pilih', opsi: 'layanan'},
      {k: 'tim', label: 'Tim Proyek', t: 'timproyek'},
      {k: 'pic', label: 'Arsitek PIC', t: 'anggota', bantuan: 'Dipilih dari anggota Tim Proyek di atas.'},
      {k: 'pengawas', label: 'Pengawas lapangan', t: 'anggota', bantuan: 'Dipilih dari anggota Tim Proyek di atas.'},
      {k: 'ada_vendor', label: 'Ada tim tukang / mandor / vendor?', t: 'yt'},
      {k: 'vendor', label: 'Mandor / vendor / tukang', t: 'teks'},
      {k: 'mulai', label: 'Tanggal mulai', t: 'tanggal'},
      {k: 'target', label: 'Target selesai (kontrak)', t: 'tanggal'},
      {k: 'perkiraan', label: 'Perkiraan selesai (sekarang)', t: 'tanggal'},
      {k: 'tahap_sekarang', label: 'Tahap sekarang', t: 'pilih', opsi: 'tahap'},
      {k: 'status', label: 'Status proyek', t: 'pilih', opsi: 'statusProyek'},
      {k: 'perubahan_belum_tertulis', label: 'Ada perubahan di luar kontrak yang belum tertulis?', t: 'yt'},
      {k: 'catatan', label: 'Catatan', t: 'catatan'},
    ],
    kolom: [['kode', 'Kode'], ['nama', 'Nama proyek'], ['klien', 'Klien'], ['pic', 'PIC'], ['tahap_sekarang', 'Tahap'], ['progres', 'Progres', 'progres'], ['target', 'Target', 'tanggal'], ['mundur', 'Mundur (hari)', 'angka'], ['status', 'Status', 'pill'], ['status_jadwal', 'Jadwal', 'pill']],
  },
  tahap: {
    label: 'Progres Tahap', satuan: 'tahap', grup: 'Proyek', akses: 'umum', urut: ['kode', 'tahap'],
    bantuan: 'Satu baris per tahap per proyek. % selesai: 0% belum mulai, 25% dikerjakan, 50% draft internal selesai, 75% sudah dipresentasikan ke klien, 100% disetujui klien secara tertulis. Tanpa persetujuan tertulis, maksimal 75%.',
    isian: [
      {k: 'kode', label: 'Proyek', t: 'proyek', wajib: true},
      {k: 'tahap', label: 'Tahap', t: 'pilih', opsi: 'tahap', wajib: true},
      {k: 'pic', label: 'Arsitek PIC tahap', t: 'tim'},
      {k: 'bobot', label: 'Bobot', t: 'persen', bantuan: 'Kosongkan untuk memakai bobot default tahap.'},
      {k: 'rencana_mulai', label: 'Rencana mulai', t: 'tanggal'},
      {k: 'rencana_selesai', label: 'Rencana selesai', t: 'tanggal'},
      {k: 'selesai', label: '% selesai aktual', t: 'persen'},
      {k: 'tgl_disetujui', label: 'Tanggal disetujui klien', t: 'tanggal'},
      {k: 'catatan', label: 'Catatan / output tahap', t: 'catatan'},
    ],
    kolom: [['kode', 'Kode'], ['nama_proyek', 'Proyek'], ['tahap', 'Tahap'], ['pic', 'PIC'], ['bobot', 'Bobot', 'persen'], ['rencana_selesai', 'Rencana selesai', 'tanggal'], ['selesai', '% selesai', 'progres'], ['status_tahap', 'Status', 'pill'], ['kontribusi', 'Kontribusi', 'persen1']],
  },
  masalah: {
    label: 'Masalah & Risiko', satuan: 'masalah', grup: 'Proyek', akses: 'umum', urut: '-tanggal',
    bantuan: 'Catat setiap kendala: revisi klien, perubahan lingkup, pembayaran, lapangan, perizinan.',
    isian: [
      {k: 'tanggal', label: 'Tanggal', t: 'tanggal', wajib: true},
      {k: 'kode', label: 'Proyek', t: 'proyek', wajib: true},
      {k: 'kategori', label: 'Kategori', t: 'pilih', opsi: 'kategoriMasalah'},
      {k: 'uraian', label: 'Uraian masalah', t: 'catatan', wajib: true},
      {k: 'dampak', label: 'Dampak', t: 'pilih', opsi: 'dampak'},
      {k: 'dokumen_tertulis', label: 'Ada dokumen / persetujuan tertulis?', t: 'yt'},
      {k: 'tindakan', label: 'Tindakan / solusi', t: 'catatan'},
      {k: 'pic', label: 'PIC', t: 'tim'},
      {k: 'target', label: 'Target selesai', t: 'tanggal'},
      {k: 'status', label: 'Status', t: 'pilih', opsi: 'statusMasalah'},
    ],
    kolom: [['tanggal', 'Tanggal', 'tanggal'], ['nama_proyek', 'Proyek'], ['kategori', 'Kategori'], ['uraian', 'Uraian', 'lebar'], ['dampak', 'Dampak', 'pill'], ['pic', 'PIC'], ['target', 'Target', 'tanggal'], ['status', 'Status', 'pill'], ['umur', 'Umur (hari)', 'angka'], ['lewat', 'Lewat target?', 'pill']],
  },
  // Klien punya halaman, formulir, dan impor sendiri (js/klien.js); di sini hanya identitasnya.
  klien: {
    label: 'Klien', satuan: 'klien', grup: 'Master', akses: 'admin', urut: 'nama',
    bantuan: 'Satu baris per klien. Nama di sini menjadi pilihan di Proyek dan Kontrak.',
    isian: [], kolom: [],
  },
  // Direktori orang internal, diisi otomatis dari SDM (tanpa gaji dan data pribadi) agar arsitek bisa
  // memilih anggota Tim Proyek. Tidak tampil di menu.
  tim: {
    label: 'Tim', satuan: 'orang', grup: 'Master', akses: 'umum', urut: 'nama', tersembunyi: true,
    bantuan: '', isian: [{k: 'nama', label: 'Nama', t: 'teks', wajib: true}], kolom: [['nama', 'Nama']],
  },
  kontrak: {
    label: 'Kontrak', satuan: 'kontrak', grup: 'Keuangan', akses: 'admin', urut: 'kode', tersembunyi: true, // sejak Tahap 3 di tabel kontrak_klien
    bantuan: 'Satu baris per kontrak. Setiap perubahan permintaan klien yang menambah pekerjaan dicatat sebagai addendum tertulis di kolom Nilai addendum.',
    isian: [
      {k: 'kode', label: 'Proyek', t: 'proyek', wajib: true},
      {k: 'klien_id', label: 'Klien', t: 'klien', wajib: true},
      {k: 'no_kontrak', label: 'No. kontrak / SPK', t: 'teks'},
      {k: 'tgl_kontrak', label: 'Tanggal kontrak', t: 'tanggal'},
      {k: 'jenis_perjanjian', label: 'Jenis perjanjian', t: 'pilih', opsi: 'jenisPerjanjian'},
      {k: 'bentuk_dokumen', label: 'Bentuk dokumen', t: 'pilih', opsi: 'bentukDokumen'},
      {k: 'nilai_awal', label: 'Nilai kontrak awal', t: 'uang'},
      {k: 'nilai_addendum', label: 'Nilai addendum', t: 'uang'},
      {k: 'ppn', label: 'PPN', t: 'pilih', opsi: 'ppn'},
      {k: 'lokasi_file', label: 'Lokasi file kontrak', t: 'teks'},
      {k: 'catatan', label: 'Catatan', t: 'catatan'},
    ],
    kolom: [['kode', 'Kode'], ['nama_proyek', 'Proyek'], ['klien', 'Klien'], ['bentuk_dokumen', 'Dokumen'], ['total', 'Nilai total', 'uang'], ['ditagih', 'Ditagih', 'uang'], ['diterima', 'Diterima', 'uang'], ['piutang', 'Piutang', 'uang'], ['belum_ditagih', 'Belum ditagih', 'uang'], ['pct_terbayar', '% terbayar', 'persen']],
  },
  termin: {
    label: 'Termin & Piutang', satuan: 'termin', grup: 'Keuangan', akses: 'admin', urut: ['kode', 'termin_ke'], tersembunyi: true, // sejak Tahap 3 di tabel termin
    bantuan: 'Satu baris per tagihan. Nilai tagihan = % dari nilai kontrak total. Status dan umur piutang dihitung dari jatuh tempo dan jumlah diterima.',
    isian: [
      {k: 'kode', label: 'Proyek', t: 'proyek', wajib: true},
      {k: 'termin_ke', label: 'Termin ke', t: 'angka', wajib: true},
      {k: 'milestone', label: 'Milestone / syarat tagih', t: 'teks'},
      {k: 'persen', label: '% dari kontrak', t: 'persen', wajib: true},
      {k: 'tgl_invoice', label: 'Tanggal invoice', t: 'tanggal', bantuan: 'Kosong berarti belum ditagih.'},
      {k: 'no_invoice', label: 'No. invoice', t: 'teks'},
      {k: 'jatuh_tempo', label: 'Jatuh tempo', t: 'tanggal'},
      {k: 'tgl_bayar', label: 'Tanggal bayar', t: 'tanggal'},
      {k: 'diterima', label: 'Jumlah diterima', t: 'uang'},
      {k: 'catatan', label: 'Catatan', t: 'catatan'},
    ],
    kolom: [['kode', 'Kode'], ['nama_proyek', 'Proyek'], ['termin_ke', 'Ke', 'angka'], ['milestone', 'Milestone'], ['nilai', 'Nilai tagihan', 'uang'], ['no_invoice', 'No. invoice'], ['jatuh_tempo', 'Jatuh tempo', 'tanggal'], ['diterima', 'Diterima', 'uang'], ['sisa', 'Sisa', 'uang'], ['status', 'Status', 'pill'], ['umur', 'Umur (hari)', 'angka']],
  },
  vendor: {
    label: 'Pihak Proyek', satuan: 'pihak proyek', grup: 'Keuangan', akses: 'admin', urut: ['kode', 'vendor'], tersembunyi: true, // Tahap 4: menu Pihak Proyek (tabel keuangan)
    bantuan: 'Satu baris per vendor per proyek. Uang material/tukang dari klien (turn-key) adalah dana titipan, bukan pendapatan: tandai di Sumber dana.',
    isian: [
      {k: 'kode', label: 'Proyek', t: 'proyek', wajib: true},
      {k: 'vendor', label: 'Mandor / vendor / tukang', t: 'teks', wajib: true, saran: true},
      {k: 'jenis', label: 'Jenis', t: 'pilih', opsi: 'jenisVendor'},
      {k: 'lingkup', label: 'Lingkup pekerjaan', t: 'teks'},
      {k: 'perjanjian', label: 'Jenis perjanjian', t: 'pilih', opsi: 'perjanjianVendor'},
      {k: 'dokumen_tertulis', label: 'Dokumen tertulis?', t: 'yt'},
      {k: 'sumber_dana', label: 'Sumber dana', t: 'pilih', opsi: 'sumberDana'},
      {k: 'nilai', label: 'Nilai kontrak vendor', t: 'uang'},
      {k: 'retensi', label: 'Retensi', t: 'persen'},
      {k: 'opname', label: 'Progres opname', t: 'persen'},
      {k: 'dibayar', label: 'Sudah dibayar', t: 'uang'},
      {k: 'tgl_bayar_terakhir', label: 'Tanggal bayar terakhir', t: 'tanggal'},
      {k: 'catatan', label: 'Catatan', t: 'catatan'},
    ],
    kolom: [['nama_proyek', 'Proyek'], ['vendor', 'Vendor'], ['jenis', 'Jenis'], ['sumber_dana', 'Sumber dana', 'pill'], ['nilai', 'Nilai kontrak', 'uang'], ['opname', 'Opname', 'persen'], ['hak', 'Hak s.d. kini', 'uang'], ['dibayar', 'Dibayar', 'uang'], ['hutang', 'Hutang', 'uang'], ['retensi_ditahan', 'Retensi ditahan', 'uang'], ['dokumen_tertulis', 'Tertulis?', 'pill']],
  },
  hutang_lain: {
    label: 'Hutang Lain', satuan: 'kewajiban', grup: 'Keuangan', akses: 'admin', urut: 'jatuh_tempo', tersembunyi: true, // sejak Tahap 6 di tabel hutang (menu Hutang Lain)
    bantuan: 'Hutang dan kewajiban di luar vendor proyek: pinjaman, sewa, pajak, cicilan.',
    isian: [
      {k: 'kreditur', label: 'Kreditur', t: 'teks', wajib: true},
      {k: 'jenis', label: 'Jenis', t: 'pilih', opsi: 'jenisHutang'},
      {k: 'uraian', label: 'Uraian', t: 'teks'},
      {k: 'total', label: 'Total kewajiban', t: 'uang'},
      {k: 'dibayar', label: 'Sudah dibayar', t: 'uang'},
      {k: 'cicilan', label: 'Cicilan per bulan', t: 'uang'},
      {k: 'jatuh_tempo', label: 'Jatuh tempo berikut', t: 'tanggal'},
      {k: 'catatan', label: 'Catatan', t: 'catatan'},
    ],
    kolom: [['kreditur', 'Kreditur'], ['jenis', 'Jenis'], ['uraian', 'Uraian'], ['total', 'Total', 'uang'], ['dibayar', 'Dibayar', 'uang'], ['sisa', 'Sisa', 'uang'], ['cicilan', 'Cicilan / bulan', 'uang'], ['jatuh_tempo', 'Jatuh tempo', 'tanggal'], ['alert', 'Peringatan', 'pill']],
  },
  // Tahap 2: master dengan halaman sendiri (js/master.js, js/barang.js).
  vendor_tukang: {label: 'Vendor & Tukang', satuan: 'vendor', grup: 'Master', akses: 'admin', urut: 'nama', tersembunyi: true, bantuan: '', isian: [], kolom: []},
  supplier: {label: 'Supplier', satuan: 'supplier', grup: 'Master', akses: 'admin', urut: 'nama', tersembunyi: true, bantuan: '', isian: [], kolom: []},
  barang: {label: 'Barang & Harga', satuan: 'barang', grup: 'Master', akses: 'admin', urut: 'kode', tersembunyi: true, bantuan: '', isian: [], kolom: []},
  harga: {label: 'Riwayat harga', satuan: 'harga', grup: 'Master', akses: 'admin', urut: 'tanggal', tersembunyi: true, bantuan: '', isian: [], kolom: []},
  // SDM punya halaman, formulir, dan halaman detail sendiri (js/sdm.js).
  sdm: {
    label: 'SDM', satuan: 'pegawai', grup: 'Administrasi', akses: 'admin', urut: 'nama',
    bantuan: 'Data kepegawaian dan kontrak kerja. Peringatan diatur di Pengaturan.',
    isian: [], kolom: [],
  },
  aset: {
    label: 'Aset', satuan: 'aset', grup: 'Administrasi', akses: 'admin', urut: 'kode_aset', tersembunyi: true, // sejak Tahap 5 di tabel aset
    bantuan: 'Penyusutan memakai garis lurus sederhana untuk kontrol internal, bukan perhitungan pajak.',
    isian: [
      {k: 'kode_aset', label: 'Kode aset', t: 'teks', contoh: 'AS-001'},
      {k: 'nama', label: 'Nama aset', t: 'teks', wajib: true},
      {k: 'kategori', label: 'Kategori', t: 'pilih', opsi: 'kategoriAset'},
      {k: 'tgl_beli', label: 'Tanggal beli', t: 'tanggal'},
      {k: 'harga', label: 'Harga beli', t: 'uang'},
      {k: 'umur', label: 'Umur ekonomis (tahun)', t: 'angka'},
      {k: 'pemegang', label: 'Pemegang / lokasi', t: 'teks'},
      {k: 'kondisi', label: 'Kondisi', t: 'pilih', opsi: 'kondisi'},
      {k: 'lisensi_sd', label: 'Lisensi / pajak berlaku s.d.', t: 'tanggal'},
      {k: 'catatan', label: 'Catatan', t: 'catatan'},
    ],
    kolom: [['kode_aset', 'Kode'], ['nama', 'Nama aset'], ['kategori', 'Kategori'], ['tgl_beli', 'Tgl beli', 'tanggal'], ['harga', 'Harga beli', 'uang'], ['susut', 'Penyusutan / thn', 'uang'], ['nilai_buku', 'Nilai buku', 'uang'], ['pemegang', 'Pemegang'], ['kondisi', 'Kondisi', 'pill'], ['lisensi_sd', 'Lisensi s.d.', 'tanggal'], ['alert', 'Peringatan', 'pill']],
  },
  legal: {
    label: 'Legal & Izin', satuan: 'dokumen', grup: 'Administrasi', akses: 'admin', urut: null,
    bantuan: 'Legalitas dan izin perusahaan. Dokumen tanpa nomor dan tanggal terbit ditandai belum ada / perlu dicek.',
    isian: [
      {k: 'dokumen', label: 'Dokumen', t: 'teks', wajib: true},
      {k: 'nomor', label: 'Nomor', t: 'teks'},
      {k: 'tgl_terbit', label: 'Tanggal terbit', t: 'tanggal'},
      {k: 'berlaku_sd', label: 'Berlaku s.d.', t: 'tanggal', bantuan: 'Kosongkan jika berlaku selama usaha berjalan.'},
      {k: 'lokasi_file', label: 'Lokasi file', t: 'teks'},
      {k: 'catatan', label: 'Catatan', t: 'catatan'},
    ],
    kolom: [['dokumen', 'Dokumen'], ['nomor', 'Nomor'], ['tgl_terbit', 'Tgl terbit', 'tanggal'], ['berlaku_sd', 'Berlaku s.d.', 'tanggal'], ['sisa_hari', 'Sisa hari', 'angka'], ['status', 'Status', 'pill'], ['catatan', 'Catatan', 'lebar']],
  },
};

export const NAMA_TABEL = Object.keys(TABEL);
export const TABEL_UMUM = NAMA_TABEL.filter((t) => TABEL[t].akses === 'umum');
export const bolehAkses = (tabel, role) => role === 'admin' || TABEL[tabel].akses === 'umum';
