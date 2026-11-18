// Data keuangan Tahap 1: Bagan Akun, rekening Kas & Bank, transaksi kas umum, transfer, jurnal,
// tutup buku, pengaturan akuntansi, profil perusahaan, peran, status notifikasi, dan audit log.
// Dua mesin dengan antarmuka yang sama:
//  - Supabase: aturan dijaga database (supabase/migrasi/1-fondasi.sql); aplikasi hanya membaca dan menulis.
//  - Lokal (mode demo): aturan yang SAMA ditiru di sini agar layar bisa diuji tanpa database.
// Uang selalu rupiah utuh (bilangan bulat).
import {idBaru} from './store.js';
import {PERAN_BAWAAN} from './akses.js';
import {hitungTermin, isiRetensi, periksaKontrak, nomorInvoice, periksaFormatInvoice, alokasiPenerimaan, tglPencairanRetensi, pkpPada, tambahHari,
  FORMAT_INVOICE_BAWAAN, JATUH_TEMPO_BAWAAN, TARIF_PPN_BAWAAN} from './kontrak-util.js';
import {periksaKontrakVendor, nilaiOpname, retensiDari, periksaPembelian, hitungPembelian, subtotalBaris, kali, volumeSah, ringkasPinjaman} from './proyek-util.js';
import {faktorSatuan} from './master-util.js';

// ---------- data standar (sama dengan migrasi) ----------
export const AKUN_STANDAR = [
  ['1', 'ASET'], ['1-1', 'Kas dan Setara Kas'], ['1-2', 'Piutang Usaha'], ['1-3', 'Pajak Dibayar di Muka'], ['1-4', 'PPN Masukan'],
  ['1-5', 'Biaya Dibayar di Muka'], ['1-6', 'Persediaan'], ['1-7', 'Aset Tetap'], ['1-8', 'Akumulasi Penyusutan'],
  ['1-9', 'Aset Tak Berwujud & Akumulasi Amortisasi'],
  ['2', 'KEWAJIBAN'], ['2-1', 'Hutang Vendor / Tukang / Pihak Proyek'], ['2-2', 'Hutang Retensi Vendor'], ['2-3', 'Hutang Supplier'],
  ['2-4', 'Hutang Dana Titipan Klien'], ['2-5', 'PPN Keluaran'], ['2-6', 'Hutang Pajak Lainnya'], ['2-7', 'Hutang Bank – Jangka Pendek'],
  ['2-8', 'Hutang Bank / Leasing – Jangka Panjang'], ['2-9', 'Hutang kepada Pemilik / Pihak Afiliasi'], ['2-10', 'Hutang Gaji & Lainnya'],
  ['3', 'EKUITAS'], ['3-1', 'Modal Disetor'], ['3-2', 'Laba Ditahan'], ['3-3', 'Laba Tahun Berjalan'],
  ['4', 'PENDAPATAN'], ['4-1', 'Pendapatan Jasa Desain'], ['4-2', 'Pendapatan Jasa Pelaksanaan / Turn-key'], ['4-3', 'Pendapatan Lain-lain'],
  ['5', 'BEBAN PROYEK'], ['5-1', 'Material Proyek'], ['5-2', 'Upah / Vendor / Tukang'], ['5-3', 'Sewa Alat Proyek'], ['5-4', 'Beban Proyek Lainnya'],
  ['6', 'BEBAN OPERASIONAL'], ['6-1', 'Gaji & Tunjangan'], ['6-2', 'Sewa Kantor'], ['6-3', 'Listrik, Air, Internet, Telepon'],
  ['6-4', 'Beban Penyusutan & Amortisasi'], ['6-5', 'Perawatan & Servis'], ['6-6', 'Software & Langganan'], ['6-7', 'Pemasaran'],
  ['6-8', 'Administrasi & Umum'],
  ['7', 'BEBAN LAIN-LAIN'], ['7-1', 'Beban Bunga'], ['7-2', 'Rugi Pelepasan Aset'], ['7-3', 'Denda'], ['7-4', 'Biaya Administrasi Bank'],
];
export const PEMETAAN = [
  ['saldo_awal', 1, 'Saldo awal rekening', 'D', 'REKENING', 'Sub-akun Kas dan Setara Kas milik rekening (kredit bila saldo awal minus)'],
  ['saldo_awal', 2, 'Saldo awal rekening', 'K', '3-2-01', 'Ekuitas saldo awal'],
  ['kas_masuk', 1, 'Transaksi kas umum – pemasukan', 'D', 'REKENING', 'Rekening penerima'],
  ['kas_masuk', 2, 'Transaksi kas umum – pemasukan', 'K', 'AKUN_DIPILIH', 'Akun yang dipilih di transaksi (mis. 4-3 Pendapatan Lain-lain, 3-1 Modal Disetor)'],
  ['kas_keluar', 1, 'Transaksi kas umum – pengeluaran', 'D', 'AKUN_DIPILIH', 'Akun yang dipilih di transaksi (mis. 6-3 Listrik, 6-1 Gaji)'],
  ['kas_keluar', 2, 'Transaksi kas umum – pengeluaran', 'K', 'REKENING', 'Rekening pembayar'],
  ['transfer', 1, 'Transfer antar rekening', 'D', 'REKENING_TUJUAN', 'Rekening tujuan'],
  ['transfer', 2, 'Transfer antar rekening', 'K', 'REKENING_ASAL', 'Rekening asal'],
  ['transfer_biaya', 1, 'Biaya admin transfer', 'D', '7-4', 'Biaya Administrasi Bank'],
  ['transfer_biaya', 2, 'Biaya admin transfer', 'K', 'REKENING_ASAL', 'Rekening asal'],
  // Tahap 3: satu sisi per jenis; jurnal tetap wajib seimbang.
  ['terima_rekening', 1, 'Penerimaan termin – uang masuk', 'D', 'REKENING', 'Rekening penerima (jumlah yang diterima)'],
  ['terima_potongan', 1, 'Penerimaan termin – pajak dipotong klien', 'D', '1-3', 'Pajak Dibayar di Muka (potongan pajak oleh klien)'],
  ['terima_pendapatan', 1, 'Penerimaan termin – porsi jasa (basis kas)', 'K', 'AKUN_PENDAPATAN', '4-1 atau 4-2 sesuai pilihan di kontrak, di luar PPN'],
  ['terima_titipan', 1, 'Penerimaan termin – porsi titipan (basis kas)', 'K', '2-4', 'Hutang Dana Titipan Klien (material/tukang turn-key)'],
  ['terima_ppn', 1, 'Penerimaan termin – PPN (basis kas)', 'K', '2-5', 'PPN Keluaran (bila PKP dan ada PPN)'],
  ['terima_piutang', 1, 'Penerimaan termin – pelunasan piutang (basis akrual)', 'K', '1-2', 'Piutang Usaha'],
  ['invoice_piutang', 1, 'Invoice termin (basis akrual)', 'D', '1-2', 'Piutang Usaha sebesar nilai tagihan'],
  ['invoice_pendapatan', 1, 'Invoice termin – porsi jasa (basis akrual)', 'K', 'AKUN_PENDAPATAN', '4-1 atau 4-2 sesuai kontrak, di luar PPN dan retensi'],
  ['invoice_titipan', 1, 'Invoice termin – porsi titipan (basis akrual)', 'K', '2-4', 'Hutang Dana Titipan Klien'],
  ['invoice_ppn', 1, 'Invoice termin – PPN (basis akrual)', 'K', '2-5', 'PPN Keluaran'],
  // Tahap 4: pihak proyek (opname, pembayaran vendor) dan pembelian material.
  ['opname_beban', 1, 'Opname vendor – dana perusahaan', 'D', '5-2', 'Beban Upah / Vendor / Tukang sebesar nilai opname'],
  ['opname_titipan', 1, 'Opname vendor – dana titipan klien', 'D', '2-4', 'Mengurangi Hutang Dana Titipan Klien (bukan beban)'],
  ['opname_hutang', 1, 'Opname vendor – hutang ke vendor', 'K', '2-1', 'Hutang Vendor / Tukang (nilai opname dikurangi retensi)'],
  ['opname_retensi', 1, 'Opname vendor – retensi ditahan', 'K', '2-2', 'Hutang Retensi Vendor'],
  ['bayar_vendor_hutang', 1, 'Pembayaran vendor – pelunasan hutang', 'D', '2-1', 'Hutang Vendor / Tukang (jumlah dibayar + potongan pajak)'],
  ['bayar_vendor_retensi', 1, 'Pencairan retensi vendor', 'D', '2-2', 'Hutang Retensi Vendor'],
  ['bayar_vendor_kas', 1, 'Pembayaran vendor – uang keluar', 'K', 'REKENING', 'Rekening pembayar'],
  ['bayar_vendor_pajak', 1, 'Pembayaran vendor – pajak dipotong', 'K', '2-6', 'Hutang Pajak Lainnya (PPh yang dipotong, disetor kemudian)'],
  ['beli_material', 1, 'Pembelian material proyek – dana perusahaan', 'D', '5-1', 'Material Proyek (termasuk PPN yang tidak dapat dikreditkan)'],
  ['beli_persediaan', 1, 'Pembelian stok kantor', 'D', '1-6', 'Persediaan'],
  ['beli_ppn', 1, 'Pembelian – PPN masukan', 'D', '1-4', 'PPN Masukan (bila perusahaan PKP dan supplier PKP)'],
  ['beli_titipan', 1, 'Pembelian material – dana titipan klien', 'D', '2-4', 'Mengurangi Hutang Dana Titipan Klien (bukan beban)'],
  ['beli_kas', 1, 'Pembelian – dibayar tunai / transfer', 'K', 'REKENING', 'Rekening pembayar'],
  ['beli_hutang', 1, 'Pembelian – tempo', 'K', '2-3', 'Hutang Supplier'],
  ['bayar_supplier_hutang', 1, 'Pembayaran hutang supplier', 'D', '2-3', 'Hutang Supplier'],
  ['bayar_supplier_kas', 1, 'Pembayaran hutang supplier – uang keluar', 'K', 'REKENING', 'Rekening pembayar'],
].map(([jenis, urut, nama, sisi, akun, keterangan]) => ({jenis, urut, nama, sisi, akun, keterangan}));
export const ISI_PEMETAAN = {
  REKENING: 'Rekening yang dipilih', AKUN_DIPILIH: 'Akun yang dipilih di transaksi',
  REKENING_ASAL: 'Rekening asal', REKENING_TUJUAN: 'Rekening tujuan', AKUN_PENDAPATAN: 'Akun pendapatan di kontrak (4-1 / 4-2)',
};
export const GOLONGAN = {1: 'Aset', 2: 'Kewajiban', 3: 'Ekuitas', 4: 'Pendapatan', 5: 'Beban proyek', 6: 'Beban operasional', 7: 'Beban lain-lain'};
export const saldoNormal = (gol) => (gol === 1 || gol >= 5 ? 'D' : 'K');
export const JENIS_REKENING = ['Giro', 'Tabungan', 'Deposito', 'Kas tunai'];
export const SUMBER_JURNAL = {manual: 'Jurnal manual', saldo_awal: 'Saldo awal', kas: 'Kas umum', transfer: 'Transfer', penerimaan: 'Penerimaan termin', invoice: 'Invoice',
  opname: 'Opname vendor', bayar_vendor: 'Pembayaran vendor', pembelian: 'Pembelian material', bayar_supplier: 'Pembayaran supplier'};
export const AKUNTANSI_BAWAAN = {basis: 'kas', bulan_awal_buku: 1, batas_kapitalisasi: 10000000, tarif_ppn_bp: TARIF_PPN_BAWAAN, format_invoice: FORMAT_INVOICE_BAWAAN, jatuh_tempo_hari: JATUH_TEMPO_BAWAAN,
  batas_pinjam_titipan_persen: null};
// Kolom kontrak yang diisi dari formulir (sisanya diisi sistem).
export const KOLOM_KONTRAK = ['proyek_kode', 'no_kontrak', 'tanggal', 'jenis_perjanjian', 'bentuk_dokumen', 'file', 'nilai_jasa', 'nilai_titipan', 'ppn', 'akun_pendapatan',
  'mulai', 'selesai', 'denda_alinea_persen', 'denda_alinea_maks', 'denda_alinea_maks_jenis', 'denda_klien_persen', 'denda_klien_satuan', 'denda_klien_maks',
  'denda_klien_maks_jenis', 'retensi_bp', 'masa_pemeliharaan_hari', 'tgl_serah_terima', 'garansi_bulan', 'garansi_mulai', 'klausul'];
export const TABEL_KONTRAK = ['kontrak_klien', 'kontrak_addendum', 'termin', 'penerimaan'];
// Tahap 4. Kolom kontrak vendor yang diisi dari formulir.
export const TABEL_PROYEK = ['kontrak_vendor', 'kontrak_vendor_item', 'kontrak_vendor_termin', 'opname', 'pembayaran_vendor', 'pembelian', 'pembelian_baris',
  'pembayaran_supplier', 'pinjaman_proyek', 'pengembalian_pinjaman'];
export const KOLOM_KONTRAK_VENDOR = ['proyek_kode', 'vendor_id', 'lingkup', 'no_spk', 'tanggal', 'file', 'sumber_dana', 'skema', 'nilai', 'upah_harian', 'perkiraan_hari',
  'retensi_bp', 'masa_retensi_hari', 'tgl_selesai', 'catatan'];
export const KOLOM_PEMBELIAN = ['tanggal', 'supplier_id', 'no_nota', 'tujuan', 'proyek_kode', 'sumber_dana', 'cara_bayar', 'rekening_id', 'jatuh_tempo', 'ppn', 'ongkir',
  'ppn_kredit', 'file', 'catatan'];
// Perkiraan nomor invoice berikutnya (nomor pasti diberikan saat disimpan).
export function nomorInvoiceBerikut(K, tanggal) {
  const f = K.akuntansi?.format_invoice || FORMAT_INVOICE_BAWAAN;
  return periksaFormatInvoice(f) ? '—' : nomorInvoice(f, tanggal, (K.termin || []).map((t) => t.no_invoice));
}
const NAMA_BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
export const NAMA_BULAN_PANJANG = NAMA_BULAN;
export const bulanDari = (t) => String(t).slice(0, 7) + '-01';
export const namaBulan = (b) => (b ? NAMA_BULAN[+String(b).slice(5, 7) - 1] + ' ' + String(b).slice(0, 4) : '—');
const fmt = (x) => Number(x).toLocaleString('id-ID');

// ---------- perhitungan bersama ----------
export const akunKode = (K, kode) => K.akun.find((a) => a.kode === kode);
export const akunRekening = (K, rid) => K.akun.find((a) => a.rekening_id === rid);
export const terkunci = (K, t) => !!t && K.tutup_buku.some((x) => x.bulan === bulanDari(t));
export const urutKode = (a, b) => {
  const x = a.kode.split('-').map(Number), y = b.kode.split('-').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? -1) !== (y[i] ?? -1)) return (x[i] ?? -1) - (y[i] ?? -1);
  return 0;
};
// Akun yang boleh dipakai di baris jurnal / transaksi kas umum: level 2 ke bawah, aktif, bukan kas.
export const akunTransaksi = (K, {tanpaKas = true} = {}) => K.akun.filter((a) => a.aktif && a.kode.includes('-') && a.kode !== '1-1'
  && !(tanpaKas && a.kode.startsWith('1-1-')) && !K.akun.some((c) => c.induk_id === a.id)).sort(urutKode);

const barisJurnal = (K) => {
  const per = new Map();
  for (const b of K.jurnal_baris) (per.get(b.jurnal_id) || per.set(b.jurnal_id, []).get(b.jurnal_id)).push(b);
  return per;
};
// Mutasi satu rekening dari jurnal: tanggal, uraian, sumber, masuk, keluar, saldo berjalan.
export function mutasiRekening(K, rid) {
  const akun = akunRekening(K, rid);
  if (!akun) return [];
  const jurnal = new Map(K.jurnal.map((j) => [j.id, j]));
  const rows = K.jurnal_baris.filter((b) => b.akun_id === akun.id).map((b) => ({b, j: jurnal.get(b.jurnal_id)})).filter((x) => x.j)
    .sort((a, b) => a.j.tanggal.localeCompare(b.j.tanggal) || (a.j.sumber === 'saldo_awal' ? -1 : b.j.sumber === 'saldo_awal' ? 1 : 0) || a.j.no - b.j.no);
  let saldo = 0;
  return rows.map(({b, j}) => {
    saldo += b.debit - b.kredit;
    return {tanggal: j.tanggal, uraian: j.uraian, sumber: j.sumber, sumber_id: j.sumber_id, jurnal_id: j.id, masuk: b.debit, keluar: b.kredit, saldo};
  });
}
export const saldoRekening = (K, rid, sampai) => {
  const akun = akunRekening(K, rid);
  if (!akun) return 0;
  const tgl = new Map(K.jurnal.map((j) => [j.id, j.tanggal]));
  return K.jurnal_baris.filter((b) => b.akun_id === akun.id && (!sampai || tgl.get(b.jurnal_id) <= sampai)).reduce((s, b) => s + b.debit - b.kredit, 0);
};
// Jurnal lengkap dengan barisnya, terbaru dulu.
export function daftarJurnal(K) {
  const per = barisJurnal(K);
  return K.jurnal.map((j) => ({...j, baris: (per.get(j.id) || []).slice().sort((a, b) => (b.debit > 0) - (a.debit > 0) || a.id - b.id)}))
    .sort((a, b) => b.tanggal.localeCompare(a.tanggal) || b.no - a.no);
}

// ---------- mesin lokal (mode demo) ----------
const KUNCI = 'alinea5:keuangan';
const sekarang = () => new Date().toISOString();

function keadaanAwal() {
  const s = {
    akun: [], rekening: [], kas_transaksi: [], transfer: [], jurnal: [], jurnal_baris: [], pemetaan_jurnal: PEMETAAN.map((m) => ({...m})),
    tutup_buku: [], tutup_buku_riwayat: [], akuntansi: {...AKUNTANSI_BAWAAN}, audit_log: [], perusahaan: {id: 'lokal', data: {}},
    peran: [], notifikasi_status: [], seq: {jurnal: 0, baris: 0, audit: 0, riwayat: 0},
    kontrak_klien: [], kontrak_addendum: [], termin: [], penerimaan: [],
    ...Object.fromEntries(TABEL_PROYEK.map((t) => [t, []])),
  };
  const id = {};
  for (const [kode, nama] of AKUN_STANDAR) {
    id[kode] = idBaru();
    s.akun.push({id: id[kode], kode, nama, induk_id: kode.includes('-') ? id[kode.split('-')[0]] : null, golongan: +kode[0], standar: true, sistem: false, rekening_id: null, aktif: true});
  }
  s.akun.push({id: idBaru(), kode: '3-2-01', nama: 'Ekuitas saldo awal', induk_id: id['3-2'], golongan: 3, standar: false, sistem: true, rekening_id: null, aktif: true});
  for (const [nama, p] of Object.entries(PERAN_BAWAAN)) s.peran.push({id: idBaru(), nama, hak: {...p.hak}, khusus: {...p.khusus}});
  return s;
}

// master(): records data master (vendor_tukang, supplier, barang); tulisHarga(sumberId, rows): ganti riwayat harga otomatis.
export function mesinLokal({email = 'Mode demo', hariIni, proyek = () => [], master = () => [], tulisHarga = async () => {}}) {
  let K;
  try { K = JSON.parse(localStorage.getItem(KUNCI)); } catch { K = null; }
  if (!K?.akun?.length) K = keadaanAwal();
  // Data demo dari sebelum Tahap 3.
  for (const t of [...TABEL_KONTRAK, ...TABEL_PROYEK]) K[t] ||= [];
  K.akuntansi = {...AKUNTANSI_BAWAAN, ...K.akuntansi};
  for (const m of PEMETAAN) if (!K.pemetaan_jurnal.some((x) => x.jenis === m.jenis && x.urut === m.urut)) K.pemetaan_jurnal.push({...m});
  const tulis = () => localStorage.setItem(KUNCI, JSON.stringify(K));
  tulis();

  const audit = (s, tabel, aksi, lama, baru) => {
    if (aksi === 'update' && JSON.stringify(lama) === JSON.stringify(baru)) return;
    s.audit_log.push({id: ++s.seq.audit, waktu: sekarang(), email, tabel, baris_id: String((baru || lama)?.id ?? (baru || lama)?.bulan ?? ''), aksi, lama: lama ?? null, baru: baru ?? null});
  };
  const cekBuka = (s, t) => {
    if (s.pulihkan || !t) return;
    if (terkunci(s, t)) throw new Error('Bulan ' + namaBulan(bulanDari(t)) + ' sudah ditutup. Transaksi bertanggal di bulan itu tidak bisa ditambah, diubah, atau dihapus.');
  };
  const periksaSeimbang = (s) => {
    const per = barisJurnal(s);
    for (const j of s.jurnal) {
      const b = per.get(j.id) || [], d = b.reduce((x, y) => x + y.debit, 0), k = b.reduce((x, y) => x + y.kredit, 0);
      if (b.length < 2 || d !== k || d === 0) throw new Error('Jurnal tidak seimbang: debit Rp ' + fmt(d) + ' dan kredit Rp ' + fmt(k) + ' (minimal 2 baris, debit harus sama dengan kredit).');
    }
  };
  // Semua perubahan berjalan pada salinan; bila ada aturan yang dilanggar, tidak ada yang tersimpan.
  const ubah = (fn) => {
    const s = structuredClone(K);
    const hasil = fn(s);
    periksaSeimbang(s);
    delete s.pulihkan;
    K = s; tulis();
    return hasil;
  };
  const bulat = (v, label, {min = null} = {}) => {
    const x = Number(v);
    if (!Number.isInteger(x)) throw new Error(label + ' harus rupiah utuh.');
    if (min != null && x < min) throw new Error(label + (min > 0 ? ' harus lebih dari 0.' : ' tidak boleh minus.'));
    return x;
  };

  const hapusJurnal = (s, id) => {
    const j = s.jurnal.find((x) => x.id === id);
    if (!j) return;
    cekBuka(s, j.tanggal);
    for (const b of s.jurnal_baris.filter((x) => x.jurnal_id === id)) audit(s, 'jurnal_baris', 'delete', b, null);
    s.jurnal_baris = s.jurnal_baris.filter((x) => x.jurnal_id !== id);
    s.jurnal = s.jurnal.filter((x) => x.id !== id);
    audit(s, 'jurnal', 'delete', j, null);
  };
  const tambahBaris = (s, b) => {
    const a = s.akun.find((x) => x.id === b.akun_id);
    if (!a) throw new Error('Akun tidak ditemukan.');
    if (!a.kode.includes('-')) throw new Error('Akun ' + a.kode + ' adalah akun kelompok; pilih akun di bawahnya.');
    if (a.kode === '1-1') throw new Error('Pilih rekening (sub-akun 1-1), bukan akun induk Kas dan Setara Kas.');
    if (!a.aktif && !s.pulihkan) throw new Error('Akun ' + a.kode + ' sudah nonaktif.');
    const debit = bulat(b.debit || 0, 'Debit', {min: 0}), kredit = bulat(b.kredit || 0, 'Kredit', {min: 0});
    if ((debit > 0) === (kredit > 0)) throw new Error('Setiap baris jurnal diisi debit ATAU kredit (salah satu, lebih dari 0).');
    const baris = {id: ++s.seq.baris, jurnal_id: b.jurnal_id, akun_id: a.id, debit, kredit, proyek_kode: b.proyek_kode || null, keterangan: b.keterangan || null};
    s.jurnal_baris.push(baris);
    audit(s, 'jurnal_baris', 'insert', null, baris);
  };
  const buatJurnal = (s, data) => {
    cekBuka(s, data.tanggal);
    if (!String(data.uraian || '').trim()) throw new Error('Uraian jurnal wajib diisi.');
    const j = {id: data.id || idBaru(), no: ++s.seq.jurnal, tanggal: data.tanggal, uraian: data.uraian, sumber: data.sumber, sumber_id: data.sumber_id || null, bukti: data.bukti || null, dibuat: sekarang(), dibuat_oleh: email};
    s.jurnal.push(j);
    audit(s, 'jurnal', 'insert', null, j);
    return j;
  };
  // Jurnal otomatis dari pemetaan: [{jenis, jumlah}] + nilai kata BESAR (id akun).
  const jurnalOtomatis = (s, sumber, sumberId, tanggal, uraian, rincian, isiAkun, proyek) => {
    const lama = s.jurnal.find((j) => j.sumber === sumber && j.sumber_id === sumberId);
    if (lama) hapusJurnal(s, lama.id);
    if (!tanggal || !rincian || !rincian.some((r) => r.jumlah)) return;
    const j = buatJurnal(s, {tanggal, uraian, sumber, sumber_id: sumberId});
    for (const r of rincian) {
      if (!r.jumlah) continue;
      for (const m of s.pemetaan_jurnal.filter((x) => x.jenis === r.jenis).sort((a, b) => a.urut - b.urut)) {
        const akunId = /^\d/.test(m.akun) ? akunKode(s, m.akun)?.id : isiAkun[m.akun];
        if (!akunId) throw new Error('Pemetaan jurnal ' + m.jenis + ' (' + m.sisi + '): akun ' + m.akun + ' tidak ditemukan.');
        const plus = r.jumlah > 0, debit = (m.sisi === 'D') === plus;
        tambahBaris(s, {jurnal_id: j.id, akun_id: akunId, debit: debit ? Math.abs(r.jumlah) : 0, kredit: debit ? 0 : Math.abs(r.jumlah), proyek_kode: proyek});
      }
    }
  };
  const kodeBerikut = (s, induk) => {
    const pola = new RegExp('^' + induk.kode.replace(/-/g, '\\-') + '-(\\d+)$');
    const maks = Math.max(0, ...s.akun.filter((a) => a.induk_id === induk.id).map((a) => +(pola.exec(a.kode)?.[1] || 0)));
    return induk.kode + '-' + String(maks + 1).padStart(2, '0');
  };
  const dipakaiJurnal = (s, akunId, kecuali) => s.jurnal_baris.some((b) => b.akun_id === akunId && (!kecuali || s.jurnal.find((j) => j.id === b.jurnal_id)?.sumber !== kecuali));

  const simpanAkunDi = (s, id, d, {dariRekening = null} = {}) => {
    const lama = id ? s.akun.find((a) => a.id === id) : null;
    if (id && !lama) throw new Error('Akun tidak ditemukan.');
    const baru = {...(lama || {id: idBaru(), standar: false, sistem: false, rekening_id: dariRekening, aktif: true}), ...d};
    if (lama && (lama.standar || lama.sistem)) {
      if (baru.kode !== lama.kode || baru.induk_id !== lama.induk_id) throw new Error('Kode dan induk akun standar ' + lama.kode + ' tidak bisa diubah.');
    } else {
      const induk = s.akun.find((a) => a.id === baru.induk_id);
      if (!induk) throw new Error('Sub-akun wajib menginduk ke akun lain.');
      if (!induk.kode.includes('-')) throw new Error('Sub-akun harus menginduk ke akun level 2 atau di bawahnya (mis. 6-3), bukan ke ' + induk.kode + '.');
      if ((induk.kode === '1-1' || induk.kode.startsWith('1-1-')) && !baru.rekening_id) throw new Error('Sub-akun Kas dan Setara Kas dibuat otomatis lewat menu Kas & Bank (tambah rekening).');
      if (lama && baru.kode !== lama.kode && dipakaiJurnal(s, lama.id)) throw new Error('Kode akun ' + lama.kode + ' sudah dipakai di jurnal dan tidak bisa diubah.');
      baru.golongan = induk.golongan;
      if (!baru.kode) baru.kode = kodeBerikut(s, induk);
      if (!baru.kode.startsWith(induk.kode + '-')) throw new Error('Kode sub-akun harus diawali ' + induk.kode + '- (kode induknya).');
    }
    if (!String(baru.nama || '').trim()) throw new Error('Nama akun wajib diisi.');
    if (s.akun.some((a) => a.id !== baru.id && a.kode === baru.kode)) throw new Error('Kode akun ' + baru.kode + ' sudah dipakai.');
    const salin = lama && {...lama};
    if (lama) Object.assign(lama, baru); else s.akun.push(baru);
    audit(s, 'akun', lama ? 'update' : 'insert', salin, {...baru});
    return baru;
  };
  const hapusAkunDi = (s, id) => {
    const a = s.akun.find((x) => x.id === id);
    if (!a) return;
    if (a.standar || a.sistem) throw new Error('Akun standar ' + a.kode + ' tidak bisa dihapus.');
    if (s.akun.some((c) => c.induk_id === id)) throw new Error('Akun ' + a.kode + ' masih punya sub-akun.');
    if (dipakaiJurnal(s, id)) throw new Error('Akun ' + a.kode + ' sudah dipakai di jurnal; nonaktifkan saja.');
    if (s.kas_transaksi.some((k) => k.akun_id === id)) throw new Error('Akun ' + a.kode + ' sudah dipakai transaksi; nonaktifkan saja.');
    s.akun = s.akun.filter((x) => x.id !== id);
    audit(s, 'akun', 'delete', a, null);
  };

  const simpanRekeningDi = (s, id, d) => {
    const lama = id ? s.rekening.find((r) => r.id === id) : null;
    if (id && !lama) throw new Error('Rekening tidak ditemukan.');
    const r = {...(lama || {id: idBaru(), dibuat: sekarang(), mata_uang: 'IDR', di_invoice: false, utama_invoice: false, aktif: true}), ...d};
    delete r.__no;
    if (!String(r.nama || '').trim()) throw new Error('Nama akun rekening wajib diisi.');
    if (s.rekening.some((x) => x.id !== r.id && x.nama.toLowerCase() === r.nama.trim().toLowerCase())) throw new Error('Nama rekening "' + r.nama + '" sudah dipakai.');
    if (!JENIS_REKENING.includes(r.jenis)) throw new Error('Jenis rekening wajib dipilih.');
    if (r.mata_uang !== 'IDR') throw new Error('Mata uang saat ini hanya IDR.');
    if (!r.tgl_saldo_awal) throw new Error('Tanggal saldo awal wajib diisi.');
    r.saldo_awal = bulat(r.saldo_awal || 0, 'Saldo awal');
    if (r.utama_invoice && !(r.di_invoice && r.aktif)) throw new Error('Rekening utama invoice harus aktif dan ditampilkan di invoice.');
    if (r.utama_invoice && s.rekening.some((x) => x.id !== r.id && x.utama_invoice)) throw new Error('Rekening utama invoice hanya boleh satu.');
    const bukuBerubah = !lama || lama.saldo_awal !== r.saldo_awal || lama.tgl_saldo_awal !== r.tgl_saldo_awal;
    if (bukuBerubah) { if (lama) cekBuka(s, lama.tgl_saldo_awal); cekBuka(s, r.tgl_saldo_awal); }
    const salin = lama && {...lama};
    if (lama) Object.assign(lama, r); else s.rekening.push(r);
    audit(s, 'rekening', lama ? 'update' : 'insert', salin, {...r});
    const akun = akunRekening(s, r.id);
    if (!akun) simpanAkunDi(s, null, {kode: '', nama: r.nama, induk_id: akunKode(s, '1-1').id, aktif: r.aktif}, {dariRekening: r.id});
    else if (akun.nama !== r.nama || akun.aktif !== r.aktif) Object.assign(akun, {nama: r.nama, aktif: r.aktif});
    if (bukuBerubah) jurnalOtomatis(s, 'saldo_awal', r.id, r.tgl_saldo_awal, 'Saldo awal ' + r.nama, [{jenis: 'saldo_awal', jumlah: r.saldo_awal}], {REKENING: akunRekening(s, r.id).id});
    return r;
  };

  const periksaKas = (s, k) => {
    if (!k.tanggal) throw new Error('Tanggal wajib diisi.');
    if (!['masuk', 'keluar'].includes(k.jenis)) throw new Error('Jenis transaksi wajib dipilih.');
    if (!s.rekening.some((r) => r.id === k.rekening_id)) throw new Error('Rekening wajib dipilih.');
    const a = s.akun.find((x) => x.id === k.akun_id);
    if (!a) throw new Error('Akun wajib dipilih.');
    if (a.kode === '1-1' || a.kode.startsWith('1-1-')) throw new Error('Perpindahan uang antar rekening dicatat lewat Transfer antar rekening, bukan transaksi kas umum.');
    k.jumlah = bulat(k.jumlah, 'Jumlah', {min: 1});
    if (!String(k.uraian || '').trim()) throw new Error('Uraian wajib diisi.');
  };
  const simpanKasDi = (s, id, d) => {
    const lama = id ? s.kas_transaksi.find((x) => x.id === id) : null;
    const k = {...(lama || {id: idBaru(), dibuat: sekarang(), dibuat_oleh: email}), ...d};
    delete k.__no;
    periksaKas(s, k);
    if (lama) cekBuka(s, lama.tanggal);
    cekBuka(s, k.tanggal);
    const salin = lama && {...lama};
    if (lama) Object.assign(lama, k); else s.kas_transaksi.push(k);
    audit(s, 'kas_transaksi', lama ? 'update' : 'insert', salin, {...k});
    jurnalOtomatis(s, 'kas', k.id, k.tanggal, k.uraian, [{jenis: k.jenis === 'masuk' ? 'kas_masuk' : 'kas_keluar', jumlah: k.jumlah}],
      {REKENING: akunRekening(s, k.rekening_id).id, AKUN_DIPILIH: k.akun_id}, k.proyek_kode);
    return k;
  };


  // ---------- Tahap 3: kontrak, termin, invoice, penerimaan (aturan sama dengan 3-kontrak.sql) ----------
  const kontrakDari = (s, id) => s.kontrak_klien.find((x) => x.id === id);
  const NILAI = ['dpp', 'ppn', 'ret_jasa', 'ret_titipan', 'tagihan', 'titipan'];
  const hitungBaris = (s, t) => {
    const v = hitungTermin(t, kontrakDari(s, t.kontrak_id));
    Object.assign(t, {dpp: v.dpp, ppn: v.ppn, ret_jasa: v.ret_jasa, ret_titipan: v.ret_titipan, tagihan: v.tagihan});
  };
  const ubahTermin = (s, t, perubahan) => {
    const lama = {...t};
    Object.assign(t, perubahan);
    hitungBaris(s, t);
    if (lama.no_invoice && !s.pulihkan && NILAI.some((k) => lama[k] !== t[k])) {
      Object.assign(t, lama);
      throw new Error((lama.jenis === 'retensi' ? 'Retensi' : 'Termin ke-' + lama.ke) + ' sudah ditagih (invoice ' + lama.no_invoice + '), jadi nilainya tidak bisa diubah lagi.');
    }
    audit(s, 'termin', 'update', lama, {...t});
  };
  const tambahTermin = (s, d) => {
    const t = {id: idBaru(), addendum_id: null, jenis: 'termin', ke: null, milestone: null, jasa: 0, titipan: 0, perkiraan_tagih: null,
      no_invoice: null, tgl_invoice: null, jatuh_tempo: null, rekening_id: null, dibuat: sekarang(), dibuat_oleh: email, ...d};
    hitungBaris(s, t);
    s.termin.push(t);
    audit(s, 'termin', 'insert', null, {...t});
    return t;
  };
  const hapusTerminDi = (s, t) => { s.termin = s.termin.filter((x) => x.id !== t.id); audit(s, 'termin', 'delete', t, null); };
  const susunRetensi = (s, kid) => {
    const k = kontrakDari(s, kid);
    for (const t of s.termin.filter((x) => x.kontrak_id === kid && x.jenis === 'termin')) ubahTermin(s, t, {});
    const {jasa, titipan} = isiRetensi(s.termin.filter((x) => x.kontrak_id === kid), k);
    const r = s.termin.find((x) => x.kontrak_id === kid && x.jenis === 'retensi');
    const cair = tglPencairanRetensi(k);
    if (jasa + titipan === 0) {
      if (r) {
        if (r.no_invoice) throw new Error('Retensi sudah ditagih (invoice ' + r.no_invoice + '), jadi retensi tidak bisa dihapus.');
        hapusTerminDi(s, r);
      }
    } else if (!r) tambahTermin(s, {kontrak_id: kid, jenis: 'retensi', milestone: 'Retensi', jasa, titipan, perkiraan_tagih: cair});
    else ubahTermin(s, r, {jasa, titipan, perkiraan_tagih: cair});
  };
  const nomoriTermin = (s, kid) => {
    s.termin.filter((x) => x.kontrak_id === kid && x.jenis === 'termin').sort((a, b) => (a.ke ?? 1e9) - (b.ke ?? 1e9) || String(a.dibuat).localeCompare(String(b.dibuat)))
      .forEach((t, i) => { if (t.ke !== i + 1) ubahTermin(s, t, {ke: i + 1}); });
  };
  const cekTotal = (s, kid) => {
    const k = kontrakDari(s, kid), add = s.kontrak_addendum.filter((a) => a.kontrak_id === kid);
    const tj = k.nilai_jasa + add.reduce((x, a) => x + a.tambah_jasa, 0), tt = k.nilai_titipan + add.reduce((x, a) => x + a.tambah_titipan, 0);
    if (tj <= 0) throw new Error('Nilai jasa setelah addendum harus lebih dari 0.');
    if (tt < 0) throw new Error('Nilai titipan setelah addendum tidak boleh minus.');
    const rows = s.termin.filter((x) => x.kontrak_id === kid && x.jenis === 'termin');
    if (!rows.length) throw new Error('Jadwal termin wajib diisi (minimal 1 termin).');
    if (rows.some((t) => t.jasa + t.titipan <= 0)) throw new Error('Setiap termin harus bernilai lebih dari 0.');
    const sj = rows.reduce((x, t) => x + t.jasa, 0), st = rows.reduce((x, t) => x + t.titipan, 0);
    if (sj !== tj || st !== tt) throw new Error('Total termin harus 100% dari nilai kontrak. Porsi jasa Rp ' + fmt(sj) + ' dari Rp ' + fmt(tj) + ', porsi titipan Rp ' + fmt(st) + ' dari Rp ' + fmt(tt) + '.');
  };
  const angkaAtauNull = (v) => (v == null || v === '' ? null : +v);
  const simpanKontrakDi = (s, id, d, termin) => {
    const lama = id ? kontrakDari(s, id) : null;
    if (id && !lama) throw new Error('Kontrak tidak ditemukan.');
    if (!proyek().includes(d.proyek_kode)) throw new Error('Proyek wajib dipilih.');
    const ada = !!lama && s.termin.some((t) => t.kontrak_id === id && t.no_invoice);
    if (ada && (lama.ppn !== d.ppn || lama.retensi_bp !== (d.retensi_bp || 0) || lama.proyek_kode !== d.proyek_kode)) {
      throw new Error('Sudah ada tagihan yang terbit: proyek, perlakuan PPN, dan retensi tidak bisa diubah lagi.');
    }
    const tarif = d.ppn === 'tidak' ? 0 : lama && lama.ppn === d.ppn && lama.tarif_ppn_bp > 0 ? lama.tarif_ppn_bp : s.akuntansi.tarif_ppn_bp;
    const k = {...(lama || {id: idBaru(), dibuat: sekarang(), dibuat_oleh: email})};
    for (const c of KOLOM_KONTRAK) k[c] = d[c] === '' || d[c] === undefined ? null : d[c];
    Object.assign(k, {no_kontrak: String(k.no_kontrak || '').trim(), nilai_jasa: +k.nilai_jasa, nilai_titipan: +(k.nilai_titipan || 0), ppn: k.ppn || 'tidak', retensi_bp: +(k.retensi_bp || 0), tarif_ppn_bp: tarif,
      masa_pemeliharaan_hari: angkaAtauNull(k.masa_pemeliharaan_hari), garansi_bulan: angkaAtauNull(k.garansi_bulan)});
    const salah = periksaKontrak(k, termin.map((t) => ({...t, jenis: 'termin', jasa: +t.jasa, titipan: +t.titipan})),
      {kontrak: s.kontrak_klien, proyek: proyek(), profil: s.perusahaan.data, addendum: s.kontrak_addendum.filter((a) => a.kontrak_id === k.id)});
    if (salah.length) throw new Error(salah[0]);
    const salin = lama && {...lama};
    if (lama) Object.assign(lama, k); else s.kontrak_klien.push(k);
    audit(s, 'kontrak_klien', lama ? 'update' : 'insert', salin, {...k});
    const ids = [];
    termin.forEach((t, i) => {
      const ada = t.id && s.termin.find((x) => x.id === t.id && x.kontrak_id === k.id && x.jenis === 'termin');
      const isi = {ke: i + 1, milestone: t.milestone || null, jasa: +t.jasa, titipan: +t.titipan, perkiraan_tagih: t.perkiraan_tagih || null};
      ids.push(ada ? (ubahTermin(s, ada, isi), ada.id) : tambahTermin(s, {kontrak_id: k.id, ...isi}).id);
    });
    const buang = s.termin.filter((x) => x.kontrak_id === k.id && x.jenis === 'termin' && !ids.includes(x.id));
    if (buang.some((x) => x.no_invoice)) throw new Error('Termin yang sudah ditagih tidak bisa dihapus dari jadwal.');
    for (const x of buang) hapusTerminDi(s, x);
    susunRetensi(s, k.id);
    cekTotal(s, k.id);
    return k;
  };
  const jurnalInvoice = (s, t) => {
    const k = kontrakDari(s, t.kontrak_id);
    if (!t.no_invoice || s.akuntansi.basis !== 'akrual') return jurnalOtomatis(s, 'invoice', t.id, null);
    jurnalOtomatis(s, 'invoice', t.id, t.tgl_invoice, 'Invoice ' + t.no_invoice + ' · ' + k.proyek_kode,
      [{jenis: 'invoice_piutang', jumlah: t.tagihan}, {jenis: 'invoice_pendapatan', jumlah: t.dpp - t.ret_jasa}, {jenis: 'invoice_titipan', jumlah: t.titipan - t.ret_titipan}, {jenis: 'invoice_ppn', jumlah: t.ppn}],
      {AKUN_PENDAPATAN: akunKode(s, k.akun_pendapatan).id}, k.proyek_kode);
  };
  const jurnalPenerimaan = (s, p) => {
    const t = s.termin.find((x) => x.id === p.termin_id), k = kontrakDari(s, t.kontrak_id);
    const rincian = [{jenis: 'terima_rekening', jumlah: p.jumlah}, {jenis: 'terima_potongan', jumlah: p.potongan_pajak}];
    if (s.akuntansi.basis === 'akrual') rincian.push({jenis: 'terima_piutang', jumlah: p.jumlah + p.potongan_pajak});
    else rincian.push({jenis: 'terima_pendapatan', jumlah: p.alok_pendapatan}, {jenis: 'terima_titipan', jumlah: p.alok_titipan}, {jenis: 'terima_ppn', jumlah: p.alok_ppn});
    jurnalOtomatis(s, 'penerimaan', p.id, p.tanggal, 'Penerimaan ' + t.no_invoice + ' · ' + k.proyek_kode + (t.jenis === 'retensi' ? ' retensi' : ' termin ' + t.ke),
      rincian, {REKENING: p.rekening_id ? akunRekening(s, p.rekening_id)?.id : null, AKUN_PENDAPATAN: akunKode(s, k.akun_pendapatan).id}, k.proyek_kode);
  };
  const urutBuat = (a, b) => String(a.dibuat).localeCompare(String(b.dibuat)) || String(a.id).localeCompare(String(b.id));
  const terakhir = (s, terminId) => s.penerimaan.filter((x) => x.termin_id === terminId).sort(urutBuat).at(-1);
  const waktuBaru = (s) => {
    const maks = s.penerimaan.reduce((m, x) => (x.dibuat > m ? x.dibuat : m), '');
    let w = sekarang();
    if (w <= maks) w = new Date(Date.parse(maks) + 1).toISOString();
    return w;
  };

  // ---------- Tahap 4: pihak proyek, pembelian, pinjaman antar proyek (aturan sama dengan 4-proyek.sql) ----------
  const dariMaster = (tabel, id) => { const r = master().find((x) => x.tabel === tabel && x.id === id); return r ? {...r.data, id: r.id} : null; };
  const faktorDari = (bid, satuan) => { const b = dariMaster('barang', bid); return b ? faktorSatuan(b, satuan) : null; };
  const waktuDi = (s, tabel) => {
    const maks = s[tabel].reduce((m, x) => (x.dibuat > m ? x.dibuat : m), '');
    let w = sekarang();
    if (w <= maks) w = new Date(Date.parse(maks) + 1).toISOString();
    return w;
  };
  const tglId = (t) => String(t).split('-').reverse().join('-');
  const urutOp = (a, b) => a.tanggal.localeCompare(b.tanggal) || urutBuat(a, b);
  const kvDari = (s, id) => s.kontrak_vendor.find((x) => x.id === id);
  const itemKv = (s, kid) => s.kontrak_vendor_item.filter((x) => x.kontrak_id === kid).sort((a, b) => a.urut - b.urut);
  const terminKv = (s, kid) => s.kontrak_vendor_termin.filter((x) => x.kontrak_id === kid).sort((a, b) => a.ke - b.ke);
  const disetujui = (s, kid, kecuali) => s.opname.filter((o) => o.kontrak_id === kid && o.status === 'disetujui' && o.id !== kecuali);
  const hapusBaris = (s, tabel, row) => { s[tabel] = s[tabel].filter((x) => x.id !== row.id); audit(s, tabel, 'delete', row, null); };
  const simpanBaris = (s, tabel, lama, baru) => {
    const salin = lama && {...lama};
    if (lama) Object.assign(lama, baru); else s[tabel].push(baru);
    audit(s, tabel, lama ? 'update' : 'insert', salin, {...baru});
    return lama || baru;
  };
  const rekeningAktif = (s, id) => s.rekening.some((r) => r.id === id && r.aktif);
  // Riwayat harga otomatis ditulis ke data master setelah perubahan keuangan berhasil tersimpan.
  let hargaTunda = [];
  const ubahHarga = async (fn) => {
    hargaTunda = [];
    let hasil;
    try { hasil = ubah(fn); } catch (e) { hargaTunda = []; throw e; }
    const tunda = hargaTunda;
    hargaTunda = [];
    for (const [sid, rows] of tunda) await tulisHarga(sid, rows);
    return hasil;
  };
  const hargaKontrakVendor = (s, k) => hargaTunda.push([k.id, itemKv(s, k.id).map((i) => ({barang_id: i.barang_id, tanggal: k.tanggal, pihak_id: k.vendor_id, pihak_nama: k.vendor_nama,
    harga: i.harga, satuan: i.satuan, faktor: faktorDari(i.barang_id, i.satuan) ?? 1, ppn: false, sumber: 'Kontrak vendor', proyek_kode: k.proyek_kode,
    ref: {id: k.id, nomor: k.no_spk || k.vendor_nama, tanggal: k.tanggal}}))]);
  const idTetap = (s, tabel, id, kid) => (id && s[tabel].some((y) => y.id === id && y.kontrak_id === kid) ? id : idBaru());

  const simpanKontrakVendorDi = (s, id, d, items = [], termin = []) => {
    const lama = id ? kvDari(s, id) : null;
    if (id && !lama) throw new Error('Kontrak vendor tidak ditemukan.');
    const v = dariMaster('vendor_tukang', d.vendor_id);
    const k = {...(lama || {id: idBaru(), dibuat: sekarang(), dibuat_oleh: email})};
    for (const c of KOLOM_KONTRAK_VENDOR) k[c] = d[c] === '' || d[c] === undefined ? null : d[c];
    Object.assign(k, {vendor_nama: v?.nama || '', no_spk: String(k.no_spk || '').trim() || null, retensi_bp: +(k.retensi_bp || 0),
      masa_retensi_hari: angkaAtauNull(k.masa_retensi_hari), perkiraan_hari: k.skema === 'harian' ? angkaAtauNull(k.perkiraan_hari) : null,
      upah_harian: k.skema === 'harian' ? angkaAtauNull(k.upah_harian) : null, nilai: ['termin', 'persen'].includes(k.skema) ? +(k.nilai || 0) : 0});
    const kunci = !!lama && disetujui(s, lama.id).length > 0;
    if (kunci && (lama.proyek_kode !== k.proyek_kode || lama.vendor_id !== k.vendor_id || lama.skema !== k.skema || lama.sumber_dana !== k.sumber_dana || lama.retensi_bp !== k.retensi_bp
      || (['termin', 'persen'].includes(k.skema) && lama.nilai !== k.nilai) || (k.skema === 'harian' && lama.upah_harian !== k.upah_harian))) {
      throw new Error('Sudah ada opname disetujui: proyek, vendor, skema, sumber dana, nilai, upah, dan retensi tidak bisa diubah lagi.');
    }
    const it = kunci ? itemKv(s, k.id) : k.skema !== 'volume' ? [] : items.map((x, i) => ({id: idTetap(s, 'kontrak_vendor_item', x.id, k.id), kontrak_id: k.id, urut: i + 1,
      barang_id: x.barang_id, uraian: String(x.uraian || '').trim() || '-', satuan: x.satuan, volume: +x.volume, harga: +x.harga}));
    const tr = kunci ? terminKv(s, k.id) : k.skema !== 'termin' ? [] : termin.map((x, i) => ({id: idTetap(s, 'kontrak_vendor_termin', x.id, k.id), kontrak_id: k.id, ke: i + 1,
      milestone: String(x.milestone || '').trim() || null, persen_bp: +x.persen_bp}));
    const salah = periksaKontrakVendor(k, it, tr, {proyek: proyek()});
    if (k.vendor_id && !v) salah.unshift('Vendor wajib dipilih dari master Vendor & Tukang.');
    if (!kunci) it.forEach((x, i) => {
      const b = dariMaster('barang', x.barang_id);
      if (x.barang_id && (!b || b.jenis !== 'pekerjaan')) salah.push('Item ' + (i + 1) + ': pilih item pekerjaan dari master (Barang & Harga → Harga Pekerjaan).');
      else if (b && faktorSatuan(b, x.satuan) == null) salah.push('Item ' + (i + 1) + ': satuan "' + x.satuan + '" belum punya konversi di master.');
    });
    if (salah.length) throw new Error(salah[0]);
    const hasil = simpanBaris(s, 'kontrak_vendor', lama, k);
    if (!kunci) {
      for (const [tabel, baru] of [['kontrak_vendor_item', it], ['kontrak_vendor_termin', tr]]) {
        for (const x of s[tabel].filter((y) => y.kontrak_id === k.id && !baru.some((b) => b.id === y.id))) hapusBaris(s, tabel, x);
        for (const x of baru) simpanBaris(s, tabel, s[tabel].find((y) => y.id === x.id), x);
      }
    }
    hargaKontrakVendor(s, hasil);
    return hasil;
  };
  const jurnalOpname = (s, o) => {
    const k = kvDari(s, o.kontrak_id);
    if (o.status !== 'disetujui') return jurnalOtomatis(s, 'opname', o.id, null);
    jurnalOtomatis(s, 'opname', o.id, o.tanggal, 'Opname ' + k.vendor_nama + ' · ' + k.proyek_kode,
      [{jenis: k.sumber_dana === 'titipan' ? 'opname_titipan' : 'opname_beban', jumlah: o.nilai}, {jenis: 'opname_hutang', jumlah: o.nilai - o.retensi}, {jenis: 'opname_retensi', jumlah: o.retensi}],
      {}, k.proyek_kode);
  };
  const simpanOpnameDi = (s, id, d) => {
    const lama = id ? s.opname.find((x) => x.id === id) : null;
    if (id && !lama) throw new Error('Opname tidak ditemukan.');
    const k = kvDari(s, lama?.kontrak_id || d.kontrak_id);
    if (!k) throw new Error('Kontrak vendor tidak ditemukan.');
    const st = d.status || 'draft', tgl = d.tanggal, det = d.detail || {};
    if (!tgl) throw new Error('Tanggal opname wajib diisi.');
    if (!['draft', 'disetujui'].includes(st)) throw new Error('Status opname tidak dikenal.');
    if (st === 'disetujui' && !String(d.diperiksa_oleh || '').trim()) throw new Error('Isi siapa yang memeriksa (Tim Proyek: pengawas / PIC) sebelum menyetujui opname.');
    const lain = disetujui(s, k.id, id).sort(urutOp), akhir = lain.at(-1);
    if (lama?.status === 'disetujui' && akhir && urutOp(akhir, lama) > 0) throw new Error('Hanya opname disetujui terakhir yang bisa diubah. Batalkan dulu opname sesudahnya.');
    if (st === 'disetujui' && akhir && tgl < akhir.tanggal) throw new Error('Tanggal opname yang disetujui tidak boleh sebelum opname disetujui terakhir (' + tglId(akhir.tanggal) + ').');
    const sebelum = Math.max(0, ...lain.map((o) => +o.detail?.persen_bp || 0));
    if (k.skema === 'volume') {
      if (Object.values(det.volume || {}).some((v) => !volumeSah(v))) throw new Error('Volume opname harus angka 0 atau lebih (maksimal 3 desimal).');
    } else if (k.skema === 'harian') {
      if (!/^\d+$/.test(String(det.hari ?? '')) || +det.hari <= 0) throw new Error('Jumlah hari kerja harus angka bulat lebih dari 0.');
    } else if (k.skema === 'persen') {
      const pct = +det.persen_bp || 0;
      if (!(pct > 0 && pct <= 10000)) throw new Error('Persen progres kumulatif harus di atas 0 sampai 100%.');
      if (st === 'disetujui' && pct <= sebelum) throw new Error('Persen progres kumulatif harus lebih besar dari opname disetujui sebelumnya (' + (sebelum / 100).toLocaleString('id-ID') + ' persen).');
    } else {
      if (!(det.termin || []).length) throw new Error('Pilih milestone termin yang tercapai.');
      for (const t of det.termin) {
        if (!terminKv(s, k.id).some((x) => x.id === t)) throw new Error('Milestone tidak ditemukan.');
        if (st === 'disetujui' && lain.some((o) => (o.detail?.termin || []).includes(t))) throw new Error('Milestone itu sudah tercatat di opname disetujui lain.');
      }
    }
    const nilai = nilaiOpname({detail: det}, k, itemKv(s, k.id), terminKv(s, k.id), sebelum);
    if (st === 'disetujui' && nilai <= 0) throw new Error('Nilai opname 0; tidak ada yang bisa disetujui.');
    if (lama) cekBuka(s, lama.tanggal);
    cekBuka(s, tgl);
    const o = {...(lama || {id: idBaru(), kontrak_id: k.id, dibuat: waktuDi(s, 'opname'), dibuat_oleh: email}), tanggal: tgl, status: st, detail: det, nilai, retensi: retensiDari(nilai, k),
      diperiksa_oleh: d.diperiksa_oleh || null, diperiksa_nama: d.diperiksa_nama || null, foto: d.foto || null, catatan: d.catatan || null};
    const hasil = simpanBaris(s, 'opname', lama, o);
    jurnalOpname(s, hasil);
    return hasil;
  };
  const jurnalBayarVendor = (s, b) => {
    const k = kvDari(s, b.kontrak_id);
    jurnalOtomatis(s, 'bayar_vendor', b.id, b.tanggal, (b.jenis === 'retensi' ? 'Pencairan retensi ' : 'Pembayaran ') + k.vendor_nama + ' · ' + k.proyek_kode,
      [{jenis: b.jenis === 'retensi' ? 'bayar_vendor_retensi' : 'bayar_vendor_hutang', jumlah: b.jumlah + b.potongan_pajak}, {jenis: 'bayar_vendor_kas', jumlah: b.jumlah},
        {jenis: 'bayar_vendor_pajak', jumlah: b.potongan_pajak}],
      {REKENING: b.rekening_id ? akunRekening(s, b.rekening_id)?.id : null}, k.proyek_kode);
  };
  const simpanBayarVendorDi = (s, id, d) => {
    const lama = id ? s.pembayaran_vendor.find((x) => x.id === id) : null;
    if (id && !lama) throw new Error('Pembayaran tidak ditemukan.');
    const k = kvDari(s, lama?.kontrak_id || d.kontrak_id);
    if (!k) throw new Error('Kontrak vendor tidak ditemukan.');
    const jenis = d.jenis || 'bayar';
    if (!d.tanggal) throw new Error('Tanggal pembayaran wajib diisi.');
    if (!['bayar', 'retensi'].includes(jenis)) throw new Error('Jenis pembayaran tidak dikenal.');
    const jumlah = bulat(d.jumlah || 0, 'Jumlah dibayar', {min: 0}), pot = bulat(d.potongan_pajak || 0, 'Potongan pajak', {min: 0});
    if (jumlah + pot <= 0) throw new Error('Isi jumlah dibayar dan/atau potongan pajak (lebih dari 0).');
    if (jumlah > 0 && !rekeningAktif(s, d.rekening_id)) throw new Error('Rekening pembayar wajib dipilih (rekening aktif).');
    if (jenis === 'retensi') {
      if (!k.tgl_selesai || k.masa_retensi_hari == null) throw new Error('Isi tanggal selesai pekerjaan dan masa retensi di kontrak vendor dulu.');
      const cair = tambahHari(k.tgl_selesai, +k.masa_retensi_hari);
      if (d.tanggal < cair) throw new Error('Retensi baru bisa dicairkan mulai ' + tglId(cair) + '.');
      const ditahan = disetujui(s, k.id).reduce((x, o) => x + o.retensi, 0)
        - s.pembayaran_vendor.filter((b) => b.kontrak_id === k.id && b.jenis === 'retensi' && b.id !== id).reduce((x, b) => x + b.jumlah + b.potongan_pajak, 0);
      if (jumlah + pot > ditahan) throw new Error('Pencairan melebihi retensi yang ditahan (Rp ' + fmt(ditahan) + ').');
    }
    if (lama) cekBuka(s, lama.tanggal);
    cekBuka(s, d.tanggal);
    const b = {...(lama || {id: idBaru(), kontrak_id: k.id, dibuat: waktuDi(s, 'pembayaran_vendor'), dibuat_oleh: email}), jenis, tanggal: d.tanggal, jumlah, potongan_pajak: pot,
      rekening_id: jumlah > 0 ? d.rekening_id : null, bukti_potong: d.bukti_potong || null, bukti_transfer: d.bukti_transfer || null, catatan: d.catatan || null};
    const hasil = simpanBaris(s, 'pembayaran_vendor', lama, b);
    jurnalBayarVendor(s, hasil);
    return hasil;
  };
  const jurnalPembelian = (s, b) => {
    const rincian = b.sumber_dana === 'titipan' ? [{jenis: 'beli_titipan', jumlah: b.total}]
      : [{jenis: b.tujuan === 'stok' ? 'beli_persediaan' : 'beli_material', jumlah: b.biaya}, {jenis: 'beli_ppn', jumlah: b.ppn_kredit_nilai}];
    rincian.push({jenis: b.cara_bayar === 'tempo' ? 'beli_hutang' : 'beli_kas', jumlah: b.total});
    jurnalOtomatis(s, 'pembelian', b.id, b.tanggal, 'Pembelian ' + b.supplier_nama + (b.no_nota ? ' · ' + b.no_nota : '') + (b.proyek_kode ? ' · ' + b.proyek_kode : ' · stok kantor'),
      rincian, {REKENING: b.rekening_id ? akunRekening(s, b.rekening_id)?.id : null}, b.proyek_kode);
  };
  const simpanPembelianDi = (s, id, d, baris = []) => {
    const lama = id ? s.pembelian.find((x) => x.id === id) : null;
    if (id && !lama) throw new Error('Pembelian tidak ditemukan.');
    const sup = dariMaster('supplier', d.supplier_id);
    const p = {...(lama || {id: idBaru(), dibuat: sekarang(), dibuat_oleh: email})};
    for (const c of KOLOM_PEMBELIAN) p[c] = d[c] === '' || d[c] === undefined ? null : d[c];
    Object.assign(p, {supplier_nama: sup?.nama || '', no_nota: String(p.no_nota || '').trim() || null, ppn: +(p.ppn || 0), ongkir: +(p.ongkir || 0), ppn_kredit: !!p.ppn_kredit});
    if (p.sumber_dana === 'titipan' || !p.ppn) p.ppn_kredit = false;
    if (p.tujuan !== 'proyek') p.proyek_kode = null;
    if (p.cara_bayar !== 'tunai') p.rekening_id = null;
    if (p.cara_bayar !== 'tempo') p.jatuh_tempo = null;
    const br = baris.map((x, i) => ({id: idBaru(), pembelian_id: p.id, urut: i + 1, barang_id: x.barang_id, barang_nama: dariMaster('barang', x.barang_id)?.nama || '',
      qty: +x.qty, satuan: x.satuan, faktor: faktorDari(x.barang_id, x.satuan), harga: +x.harga, diskon: +(x.diskon || 0)}));
    for (const b of br) b.subtotal = subtotalBaris(b);
    const salah = periksaPembelian(p, br, {proyek: proyek()});
    if (p.supplier_id && !sup) salah.unshift('Supplier wajib dipilih dari master Supplier.');
    br.forEach((b, i) => {
      const m = dariMaster('barang', b.barang_id);
      if (b.barang_id && (!m || (m.jenis || 'barang') !== 'barang')) salah.push('Baris ' + (i + 1) + ': barang wajib dipilih dari master Barang & Harga.');
      else if (m && b.faktor == null) salah.push('Baris ' + (i + 1) + ': satuan "' + b.satuan + '" belum punya konversi di barang ini.');
    });
    if (p.cara_bayar === 'tunai' && p.rekening_id && !rekeningAktif(s, p.rekening_id)) salah.push('Rekening pembayaran wajib dipilih (rekening aktif).');
    if (salah.length) throw new Error(salah[0]);
    if (p.ppn_kredit && !pkpPada(s.perusahaan.data, p.tanggal)) throw new Error('PPN masukan hanya bisa dikreditkan bila perusahaan sudah PKP pada tanggal pembelian (lihat Pengaturan → Profil perusahaan).');
    const v = hitungPembelian(p, br);
    Object.assign(p, {subtotal: v.subtotal, total: v.total, ppn_kredit_nilai: v.ppn_kredit_nilai, biaya: v.biaya});
    if (lama) {
      const dibayar = s.pembayaran_supplier.filter((x) => x.pembelian_id === id).reduce((a, x) => a + x.jumlah, 0);
      if (dibayar > 0 && (p.cara_bayar !== 'tempo' || p.total < dibayar)) {
        throw new Error('Pembelian ini sudah punya pembayaran hutang Rp ' + fmt(dibayar) + ': cara bayar harus tetap tempo dan total tidak boleh di bawah yang sudah dibayar.');
      }
      cekBuka(s, lama.tanggal);
    }
    cekBuka(s, p.tanggal);
    const hasil = simpanBaris(s, 'pembelian', lama, p);
    for (const x of s.pembelian_baris.filter((y) => y.pembelian_id === p.id)) hapusBaris(s, 'pembelian_baris', x);
    for (const x of br) simpanBaris(s, 'pembelian_baris', null, x);
    jurnalPembelian(s, hasil);
    hargaTunda.push([p.id, br.filter((b) => b.subtotal > 0).map((b) => ({barang_id: b.barang_id, tanggal: p.tanggal, pihak_id: p.supplier_id, pihak_nama: p.supplier_nama,
      harga: Math.round(b.subtotal / b.qty), satuan: b.satuan, faktor: b.faktor, ppn: p.ppn > 0, sumber: 'Pembelian', proyek_kode: p.proyek_kode,
      ref: {id: p.id, nomor: p.no_nota || p.supplier_nama, tanggal: p.tanggal}}))]);
    return hasil;
  };
  const jurnalBayarSupplier = (s, x) => {
    const b = s.pembelian.find((y) => y.id === x.pembelian_id);
    jurnalOtomatis(s, 'bayar_supplier', x.id, x.tanggal, 'Bayar hutang ' + b.supplier_nama + (b.no_nota ? ' · ' + b.no_nota : ''),
      [{jenis: 'bayar_supplier_hutang', jumlah: x.jumlah}, {jenis: 'bayar_supplier_kas', jumlah: x.jumlah}], {REKENING: akunRekening(s, x.rekening_id)?.id}, b.proyek_kode);
  };
  const simpanBayarSupplierDi = (s, id, d) => {
    const lama = id ? s.pembayaran_supplier.find((x) => x.id === id) : null;
    if (id && !lama) throw new Error('Pembayaran tidak ditemukan.');
    const b = s.pembelian.find((x) => x.id === (lama?.pembelian_id || d.pembelian_id));
    if (!b) throw new Error('Pembelian tidak ditemukan.');
    if (b.cara_bayar !== 'tempo') throw new Error('Pembelian tunai sudah lunas saat dicatat.');
    if (!d.tanggal) throw new Error('Tanggal pembayaran wajib diisi.');
    if (d.tanggal < b.tanggal) throw new Error('Tanggal pembayaran tidak boleh sebelum tanggal pembelian.');
    const jumlah = bulat(d.jumlah, 'Jumlah dibayar', {min: 1});
    if (!rekeningAktif(s, d.rekening_id)) throw new Error('Rekening pembayar wajib dipilih (rekening aktif).');
    const sudah = s.pembayaran_supplier.filter((x) => x.pembelian_id === b.id && x.id !== id).reduce((a, x) => a + x.jumlah, 0);
    if (sudah + jumlah > b.total) throw new Error('Pembayaran melebihi sisa hutang (sisa Rp ' + fmt(b.total - sudah) + ').');
    if (lama) cekBuka(s, lama.tanggal);
    cekBuka(s, d.tanggal);
    const x = {...(lama || {id: idBaru(), pembelian_id: b.id, dibuat: waktuDi(s, 'pembayaran_supplier'), dibuat_oleh: email}), tanggal: d.tanggal, jumlah, rekening_id: d.rekening_id,
      bukti: d.bukti || null, catatan: d.catatan || null};
    const hasil = simpanBaris(s, 'pembayaran_supplier', lama, x);
    jurnalBayarSupplier(s, hasil);
    return hasil;
  };
  // Saldo dana titipan proyek (sama dengan public.saldo_titipan_proyek dan dompetProyek().saldo_titipan).
  const saldoTitipan = (s, kode, kecuali) => {
    const kontrak = new Set(s.kontrak_klien.filter((k) => k.proyek_kode === kode).map((k) => k.id));
    const tk = new Map(s.termin.map((t) => [t.id, t.kontrak_id]));
    const masuk = s.penerimaan.filter((p) => kontrak.has(tk.get(p.termin_id))).reduce((a, p) => a + p.alok_titipan, 0);
    const kv = new Set(s.kontrak_vendor.filter((k) => k.proyek_kode === kode && k.sumber_dana === 'titipan').map((k) => k.id));
    const vendor = s.pembayaran_vendor.filter((b) => kv.has(b.kontrak_id)).reduce((a, b) => a + b.jumlah + b.potongan_pajak, 0);
    const beli = s.pembelian.filter((b) => b.proyek_kode === kode && b.sumber_dana === 'titipan')
      .reduce((a, b) => a + (b.cara_bayar === 'tunai' ? b.total : s.pembayaran_supplier.filter((x) => x.pembelian_id === b.id).reduce((c, x) => c + x.jumlah, 0)), 0);
    const pinjam = ringkasPinjaman({...s, pinjaman_proyek: s.pinjaman_proyek.filter((x) => x.dari_proyek === kode && x.id !== kecuali)}, '').reduce((a, x) => a + x.sisa, 0);
    return masuk - vendor - beli - pinjam;
  };
  const simpanPinjamanDi = (s, id, d) => {
    const lama = id ? s.pinjaman_proyek.find((x) => x.id === id) : null;
    if (id && !lama) throw new Error('Pinjaman tidak ditemukan.');
    const dari = d.dari_proyek || null, ke = d.ke_proyek || null;
    if (!d.tanggal) throw new Error('Tanggal wajib diisi.');
    if (!ke || !proyek().includes(ke)) throw new Error('Proyek penerima pinjaman wajib dipilih.');
    if (dari && !proyek().includes(dari)) throw new Error('Sumber pinjaman tidak ditemukan.');
    if (dari === ke) throw new Error('Proyek pemberi dan penerima pinjaman tidak boleh sama.');
    const jumlah = bulat(d.jumlah, 'Jumlah pinjaman', {min: 1});
    if (!String(d.alasan || '').trim()) throw new Error('Alasan wajib diisi.');
    if (!d.rencana_kembali || d.rencana_kembali < d.tanggal) throw new Error('Rencana kembali wajib diisi dan tidak boleh sebelum tanggal pinjaman.');
    if (!String(d.disetujui_oleh || '').trim()) throw new Error('Isi siapa yang menyetujui pinjaman.');
    if (lama) {
      const kembali = s.pengembalian_pinjaman.filter((x) => x.pinjaman_id === id).reduce((a, x) => a + x.jumlah, 0);
      if (jumlah < kembali) throw new Error('Jumlah pinjaman tidak boleh di bawah yang sudah dikembalikan (Rp ' + fmt(kembali) + ').');
    }
    const pct = s.akuntansi.batas_pinjam_titipan_persen;
    if (dari && pct != null) {
      const batas = Math.floor(Math.max(0, saldoTitipan(s, dari, id)) * pct / 100);
      if (jumlah > batas && !d.konfirmasi_pemilik) {
        throw new Error('Pinjaman melebihi batas ' + pct + ' persen saldo titipan proyek ' + dari + ' (maksimal Rp ' + fmt(batas) + '). Perlu konfirmasi pemilik (super admin).');
      }
    }
    const x = {...(lama || {id: idBaru(), dibuat: sekarang(), dibuat_oleh: email}), tanggal: d.tanggal, dari_proyek: dari, ke_proyek: ke, jumlah, alasan: d.alasan.trim(),
      rencana_kembali: d.rencana_kembali, disetujui_oleh: d.disetujui_oleh.trim(), konfirmasi_pemilik: !!d.konfirmasi_pemilik, catatan: d.catatan || null};
    return simpanBaris(s, 'pinjaman_proyek', lama, x);
  };
  const simpanPengembalianDi = (s, id, d) => {
    const lama = id ? s.pengembalian_pinjaman.find((x) => x.id === id) : null;
    if (id && !lama) throw new Error('Pengembalian tidak ditemukan.');
    const p = s.pinjaman_proyek.find((x) => x.id === (lama?.pinjaman_id || d.pinjaman_id));
    if (!p) throw new Error('Pinjaman tidak ditemukan.');
    if (!d.tanggal) throw new Error('Tanggal wajib diisi.');
    if (d.tanggal < p.tanggal) throw new Error('Tanggal pengembalian tidak boleh sebelum tanggal pinjaman.');
    const jumlah = bulat(d.jumlah, 'Jumlah dikembalikan', {min: 1});
    const sudah = s.pengembalian_pinjaman.filter((x) => x.pinjaman_id === p.id && x.id !== id).reduce((a, x) => a + x.jumlah, 0);
    if (sudah + jumlah > p.jumlah) throw new Error('Pengembalian melebihi sisa pinjaman (sisa Rp ' + fmt(p.jumlah - sudah) + ').');
    const x = {...(lama || {id: idBaru(), pinjaman_id: p.id, dibuat: waktuDi(s, 'pengembalian_pinjaman'), dibuat_oleh: email}), tanggal: d.tanggal, jumlah, catatan: d.catatan || null};
    return simpanBaris(s, 'pengembalian_pinjaman', lama, x);
  };
  return {
    mode: 'lokal',
    async muat() { return {...structuredClone(K), siap: true}; },
    async identitas() { return K.perusahaan.data || {}; },
    async simpanAkun(id, d) { return ubah((s) => simpanAkunDi(s, id, d)); },
    async hapusAkun(id) { return ubah((s) => hapusAkunDi(s, id)); },
    async simpanRekening(id, d) { return ubah((s) => simpanRekeningDi(s, id, d)); },
    async hapusRekening(id) {
      return ubah((s) => {
        const r = s.rekening.find((x) => x.id === id);
        if (!r) return;
        const akun = akunRekening(s, id);
        if (s.kas_transaksi.some((k) => k.rekening_id === id) || s.transfer.some((t) => t.dari_rekening === id || t.ke_rekening === id) || (akun && dipakaiJurnal(s, akun.id, 'saldo_awal'))) {
          throw new Error('Rekening "' + r.nama + '" sudah dipakai transaksi, jadi tidak bisa dihapus. Nonaktifkan saja.');
        }
        cekBuka(s, r.tgl_saldo_awal);
        jurnalOtomatis(s, 'saldo_awal', id, null);
        s.rekening = s.rekening.filter((x) => x.id !== id);
        audit(s, 'rekening', 'delete', r, null);
        if (akun) { s.akun = s.akun.filter((x) => x.id !== akun.id); audit(s, 'akun', 'delete', akun, null); }
      });
    },
    async simpanKas(id, d) { return ubah((s) => simpanKasDi(s, id, d)); },
    // Impor Excel: semua baris tersimpan bersama, atau tidak ada sama sekali bila satu baris ditolak.
    async imporRekening(daftar) { return ubah((s) => daftar.map((d, i) => { try { return simpanRekeningDi(s, null, d); } catch (e) { throw new Error('Baris ' + (d.__no ?? i + 1) + ': ' + e.message); } })); },
    async imporKas(daftar) { return ubah((s) => daftar.map((d, i) => { try { return simpanKasDi(s, null, d); } catch (e) { throw new Error('Baris ' + (d.__no ?? i + 1) + ': ' + e.message); } })); },
    async hapusKas(id) {
      return ubah((s) => {
        const k = s.kas_transaksi.find((x) => x.id === id);
        if (!k) return;
        cekBuka(s, k.tanggal);
        jurnalOtomatis(s, 'kas', id, null);
        s.kas_transaksi = s.kas_transaksi.filter((x) => x.id !== id);
        audit(s, 'kas_transaksi', 'delete', k, null);
      });
    },
    async simpanTransfer(id, d) {
      return ubah((s) => {
        const lama = id ? s.transfer.find((x) => x.id === id) : null;
        const t = {...(lama || {id: idBaru(), dibuat: sekarang(), dibuat_oleh: email}), ...d};
        if (!t.tanggal) throw new Error('Tanggal wajib diisi.');
        if (!s.rekening.some((r) => r.id === t.dari_rekening) || !s.rekening.some((r) => r.id === t.ke_rekening)) throw new Error('Rekening asal dan tujuan wajib dipilih.');
        if (t.dari_rekening === t.ke_rekening) throw new Error('Rekening asal dan tujuan tidak boleh sama.');
        t.jumlah = bulat(t.jumlah, 'Jumlah transfer', {min: 1});
        t.biaya_admin = bulat(t.biaya_admin || 0, 'Biaya admin', {min: 0});
        if (lama) cekBuka(s, lama.tanggal);
        cekBuka(s, t.tanggal);
        const salin = lama && {...lama};
        if (lama) Object.assign(lama, t); else s.transfer.push(t);
        audit(s, 'transfer', lama ? 'update' : 'insert', salin, {...t});
        jurnalOtomatis(s, 'transfer', t.id, t.tanggal, String(t.uraian || '').trim() || 'Transfer antar rekening',
          [{jenis: 'transfer', jumlah: t.jumlah}, {jenis: 'transfer_biaya', jumlah: t.biaya_admin}],
          {REKENING_ASAL: akunRekening(s, t.dari_rekening).id, REKENING_TUJUAN: akunRekening(s, t.ke_rekening).id});
        return t;
      });
    },
    async hapusTransfer(id) {
      return ubah((s) => {
        const t = s.transfer.find((x) => x.id === id);
        if (!t) return;
        cekBuka(s, t.tanggal);
        jurnalOtomatis(s, 'transfer', id, null);
        s.transfer = s.transfer.filter((x) => x.id !== id);
        audit(s, 'transfer', 'delete', t, null);
      });
    },
    async simpanJurnalManual(id, {tanggal, uraian, baris, bukti}) {
      return ubah((s) => {
        if (!String(uraian || '').trim()) throw new Error('Uraian jurnal wajib diisi.');
        let j;
        if (id) {
          j = s.jurnal.find((x) => x.id === id);
          if (!j || j.sumber !== 'manual') throw new Error('Jurnal otomatis tidak bisa diubah langsung; ubah transaksi sumbernya.');
          cekBuka(s, j.tanggal); cekBuka(s, tanggal);
          const lama = {...j};
          Object.assign(j, {tanggal, uraian, bukti: bukti || null});
          audit(s, 'jurnal', 'update', lama, {...j});
          for (const b of s.jurnal_baris.filter((x) => x.jurnal_id === id)) audit(s, 'jurnal_baris', 'delete', b, null);
          s.jurnal_baris = s.jurnal_baris.filter((x) => x.jurnal_id !== id);
        } else j = buatJurnal(s, {tanggal, uraian, sumber: 'manual', bukti});
        for (const b of baris) tambahBaris(s, {...b, jurnal_id: j.id});
        return j;
      });
    },
    async hapusJurnalManual(id) {
      return ubah((s) => {
        const j = s.jurnal.find((x) => x.id === id);
        if (!j || j.sumber !== 'manual') throw new Error('Jurnal otomatis tidak bisa dihapus langsung; hapus transaksi sumbernya.');
        hapusJurnal(s, id);
      });
    },
    async tutupBulan(bulan) {
      return ubah((s) => {
        const b = bulanDari(bulan);
        if (b >= bulanDari(hariIni())) throw new Error('Bulan ' + namaBulan(b) + ' belum berakhir, jadi belum bisa ditutup.');
        if (s.tutup_buku.some((x) => x.bulan === b)) throw new Error('Bulan ' + namaBulan(b) + ' sudah ditutup.');
        const baris = {bulan: b, ditutup_oleh: email, ditutup_pada: sekarang()};
        s.tutup_buku.push(baris);
        s.tutup_buku_riwayat.push({id: ++s.seq.riwayat, bulan: b, aksi: 'tutup', email, alasan: null, pada: sekarang()});
        audit(s, 'tutup_buku', 'insert', null, baris);
      });
    },
    async bukaBulan(bulan, alasan) {
      return ubah((s) => {
        const b = bulanDari(bulan);
        if (!String(alasan || '').trim()) throw new Error('Alasan membuka kembali wajib diisi.');
        const ada = s.tutup_buku.find((x) => x.bulan === b);
        if (!ada) throw new Error('Bulan ' + namaBulan(b) + ' belum ditutup.');
        s.tutup_buku = s.tutup_buku.filter((x) => x.bulan !== b);
        s.tutup_buku_riwayat.push({id: ++s.seq.riwayat, bulan: b, aksi: 'buka', email, alasan, pada: sekarang()});
        audit(s, 'tutup_buku', 'delete', ada, null);
      });
    },
    async aturAkuntansi(d) {
      return ubah((s) => {
        const lama = {...s.akuntansi}, baru = {...lama, ...d};
        if (!['kas', 'akrual'].includes(baru.basis)) throw new Error('Basis tidak dikenal.');
        if (!(baru.bulan_awal_buku >= 1 && baru.bulan_awal_buku <= 12)) throw new Error('Bulan awal tahun buku tidak sah.');
        baru.batas_kapitalisasi = bulat(baru.batas_kapitalisasi, 'Batas kapitalisasi', {min: 0});
        if (!Number.isInteger(baru.tarif_ppn_bp) || baru.tarif_ppn_bp < 0 || baru.tarif_ppn_bp > 9999) throw new Error('Tarif PPN harus 0 sampai 99,99%.');
        const gf = periksaFormatInvoice(baru.format_invoice);
        if (gf) throw new Error(gf);
        if (!Number.isInteger(baru.jatuh_tempo_hari) || baru.jatuh_tempo_hari < 0 || baru.jatuh_tempo_hari > 365) throw new Error('Jatuh tempo bawaan harus 0 sampai 365 hari.');
        if (baru.batas_pinjam_titipan_persen === '' || baru.batas_pinjam_titipan_persen === undefined) baru.batas_pinjam_titipan_persen = null;
        if (baru.batas_pinjam_titipan_persen != null && !(Number.isInteger(baru.batas_pinjam_titipan_persen) && baru.batas_pinjam_titipan_persen >= 0 && baru.batas_pinjam_titipan_persen <= 100)) {
          throw new Error('Batas pinjaman dari dana titipan harus 0 sampai 100% (kosongkan bila tanpa batas).');
        }
        if (baru.basis !== lama.basis && +hariIni().slice(5, 7) !== lama.bulan_awal_buku && s.jurnal.length) {
          throw new Error('Basis pengakuan pendapatan hanya bisa diubah di awal periode buku (bulan pertama tahun buku).');
        }
        s.akuntansi = baru;
        audit(s, 'akuntansi', 'update', lama, baru);
      });
    },
    async simpanProfil(data) {
      return ubah((s) => { const lama = structuredClone(s.perusahaan); s.perusahaan.data = data; audit(s, 'perusahaan', 'update', lama, s.perusahaan); });
    },
    async simpanPeran(id, d) {
      return ubah((s) => {
        if (!String(d.nama || '').trim()) throw new Error('Nama peran wajib diisi.');
        if (s.peran.some((p) => p.id !== id && p.nama.toLowerCase() === d.nama.trim().toLowerCase())) throw new Error('Nama peran "' + d.nama + '" sudah dipakai.');
        const lama = id ? s.peran.find((p) => p.id === id) : null;
        const baru = {...(lama || {id: idBaru()}), ...d}, salin = lama && {...lama};
        if (lama) Object.assign(lama, baru); else s.peran.push(baru);
        audit(s, 'peran', lama ? 'update' : 'insert', salin, {...baru});
        return baru;
      });
    },
    async hapusPeran(id) { return ubah((s) => { const p = s.peran.find((x) => x.id === id); s.peran = s.peran.filter((x) => x.id !== id); if (p) audit(s, 'peran', 'delete', p, null); }); },
    async pengguna() { return []; },
    async aturPengguna() { throw new Error('Pengguna hanya ada bila memakai Supabase.'); },
    // ---------- Tahap 3 ----------
    async simpanKontrak(id, d, termin) { return ubah((s) => simpanKontrakDi(s, id, d, termin)); },
    async hapusKontrak(id) {
      return ubah((s) => {
        const k = kontrakDari(s, id);
        if (!k) return;
        if (s.termin.some((t) => t.kontrak_id === id && t.no_invoice)) throw new Error('Kontrak yang sudah punya invoice tidak bisa dihapus.');
        for (const t of s.termin.filter((x) => x.kontrak_id === id)) hapusTerminDi(s, t);
        for (const a of s.kontrak_addendum.filter((x) => x.kontrak_id === id)) { s.kontrak_addendum = s.kontrak_addendum.filter((x) => x.id !== a.id); audit(s, 'kontrak_addendum', 'delete', a, null); }
        s.kontrak_klien = s.kontrak_klien.filter((x) => x.id !== id);
        audit(s, 'kontrak_klien', 'delete', k, null);
      });
    },
    async simpanAddendum(kid, id, d, termin = []) {
      return ubah((s) => {
        if (!kontrakDari(s, kid)) throw new Error('Kontrak tidak ditemukan.');
        if (!String(d.no || '').trim()) throw new Error('No. addendum wajib diisi.');
        if (!d.tanggal) throw new Error('Tanggal addendum wajib diisi.');
        if (s.kontrak_addendum.some((a) => a.kontrak_id === kid && a.id !== id && a.no.trim().toLowerCase() === d.no.trim().toLowerCase())) throw new Error('No. addendum "' + d.no.trim() + '" sudah dipakai di kontrak ini.');
        if (id) {
          const a = s.kontrak_addendum.find((x) => x.id === id && x.kontrak_id === kid);
          if (!a) throw new Error('Addendum tidak ditemukan.');
          const lama = {...a};
          Object.assign(a, {no: d.no.trim(), tanggal: d.tanggal, selesai_baru: d.selesai_baru || null, uraian: d.uraian || null, file: d.file || null});
          audit(s, 'kontrak_addendum', 'update', lama, {...a});
          return a;
        }
        if (!['tambah', 'sesuaikan'].includes(d.cara_termin)) throw new Error('Pilih cara menyesuaikan termin.');
        const tj = bulat(d.tambah_jasa || 0, 'Perubahan nilai jasa'), tt = bulat(d.tambah_titipan || 0, 'Perubahan nilai titipan');
        const a = {id: idBaru(), kontrak_id: kid, no: d.no.trim(), tanggal: d.tanggal, tambah_jasa: tj, tambah_titipan: tt, selesai_baru: d.selesai_baru || null,
          uraian: d.uraian || null, file: d.file || null, cara_termin: d.cara_termin, penyesuaian: null, dibuat: waktuDi(s, 'kontrak_addendum'), dibuat_oleh: email};
        s.kontrak_addendum.push(a);
        if (a.cara_termin === 'tambah') {
          if (tj < 0 || tt < 0) throw new Error('Pengurangan nilai kontrak memakai pilihan "sesuaikan termin yang belum ditagih".');
          let urut = Math.max(0, ...s.termin.filter((x) => x.kontrak_id === kid && x.jenis === 'termin').map((x) => x.ke || 0));
          let sj = 0, st = 0;
          for (const t of termin) {
            tambahTermin(s, {kontrak_id: kid, addendum_id: a.id, ke: ++urut, milestone: t.milestone || null, jasa: bulat(t.jasa, 'Porsi jasa', {min: 0}), titipan: bulat(t.titipan, 'Porsi titipan', {min: 0}), perkiraan_tagih: t.perkiraan_tagih || null});
            sj += +t.jasa; st += +t.titipan;
          }
          if ((tj || tt) && (sj !== tj || st !== tt)) throw new Error('Termin tambahan harus sama dengan perubahan nilai addendum (jasa Rp ' + fmt(tj) + ', titipan Rp ' + fmt(tt) + ').');
        } else {
          a.penyesuaian = [];
          for (const x of termin) {
            const t = s.termin.find((y) => y.id === x.id && y.kontrak_id === kid && y.jenis === 'termin');
            if (!t) throw new Error('Termin yang disesuaikan tidak ditemukan.');
            if (t.no_invoice) throw new Error('Termin ke-' + t.ke + ' sudah ditagih dan tidak bisa disesuaikan.');
            a.penyesuaian.push({id: t.id, delta_jasa: x.jasa - t.jasa, delta_titipan: x.titipan - t.titipan});
            ubahTermin(s, t, {jasa: bulat(x.jasa, 'Porsi jasa', {min: 0}), titipan: bulat(x.titipan, 'Porsi titipan', {min: 0})});
          }
        }
        audit(s, 'kontrak_addendum', 'insert', null, {...a});
        susunRetensi(s, kid);
        cekTotal(s, kid);
        return a;
      });
    },
    async hapusAddendum(id) {
      return ubah((s) => {
        const a = s.kontrak_addendum.find((x) => x.id === id);
        if (!a) throw new Error('Addendum tidak ditemukan.');
        if (s.kontrak_addendum.some((x) => x.kontrak_id === a.kontrak_id && urutBuat(x, a) > 0)) throw new Error('Hanya addendum terakhir yang bisa dihapus.');
        if (a.cara_termin === 'tambah') {
          const rows = s.termin.filter((t) => t.addendum_id === a.id);
          if (rows.some((t) => t.no_invoice)) throw new Error('Termin dari addendum ini sudah ditagih, jadi addendum tidak bisa dihapus.');
          for (const t of rows) hapusTerminDi(s, t);
        } else {
          for (const x of a.penyesuaian || []) {
            const t = s.termin.find((y) => y.id === x.id);
            if (!t) continue;
            if (t.no_invoice) throw new Error('Termin yang disesuaikan addendum ini sudah ditagih, jadi addendum tidak bisa dihapus.');
            ubahTermin(s, t, {jasa: t.jasa - x.delta_jasa, titipan: t.titipan - x.delta_titipan});
          }
        }
        s.kontrak_addendum = s.kontrak_addendum.filter((x) => x.id !== a.id);
        audit(s, 'kontrak_addendum', 'delete', a, null);
        nomoriTermin(s, a.kontrak_id);
        susunRetensi(s, a.kontrak_id);
        cekTotal(s, a.kontrak_id);
      });
    },
    async terbitkanInvoice(terminId, {tanggal, jatuh_tempo, rekening_id}) {
      return ubah((s) => {
        const t = s.termin.find((x) => x.id === terminId);
        if (!t) throw new Error('Tagihan tidak ditemukan.');
        const k = kontrakDari(s, t.kontrak_id);
        if (!tanggal) throw new Error('Tanggal invoice wajib diisi.');
        if (!jatuh_tempo || jatuh_tempo < tanggal) throw new Error('Jatuh tempo wajib diisi dan tidak boleh sebelum tanggal invoice.');
        if (!s.rekening.some((r) => r.id === rekening_id && r.aktif)) throw new Error('Rekening tujuan wajib dipilih (rekening aktif).');
        if (t.tagihan <= 0) throw new Error('Nilai tagihan 0; tidak ada yang bisa ditagih.');
        if (t.jenis === 'retensi') {
          const cair = tglPencairanRetensi(k);
          if (!cair) throw new Error('Isi tanggal serah terima di kontrak dulu; retensi bisa ditagih setelah masa pemeliharaan selesai.');
          if (tanggal < cair) throw new Error('Retensi baru bisa ditagih mulai ' + cair.split('-').reverse().join('-') + '.');
        }
        cekBuka(s, tanggal);
        const lama = {...t};
        if (t.no_invoice) {
          if (s.penerimaan.some((p) => p.termin_id === t.id)) throw new Error('Invoice yang sudah ada penerimaannya tidak bisa diubah.');
          cekBuka(s, t.tgl_invoice);
          Object.assign(t, {tgl_invoice: tanggal, jatuh_tempo, rekening_id});
        } else {
          const f = s.akuntansi.format_invoice;
          const galatFormat = periksaFormatInvoice(f);
          if (galatFormat) throw new Error('Format nomor invoice di Pengaturan → Akuntansi: ' + galatFormat);
          Object.assign(t, {no_invoice: nomorInvoice(f, tanggal, s.termin.map((x) => x.no_invoice)), tgl_invoice: tanggal, jatuh_tempo, rekening_id});
        }
        audit(s, 'termin', 'update', lama, {...t});
        jurnalInvoice(s, t);
        return t.no_invoice;
      });
    },
    async batalInvoice(terminId) {
      return ubah((s) => {
        const t = s.termin.find((x) => x.id === terminId);
        if (!t?.no_invoice) throw new Error('Tagihan ini belum punya invoice.');
        if (s.penerimaan.some((p) => p.termin_id === t.id)) throw new Error('Invoice yang sudah ada penerimaannya tidak bisa dibatalkan.');
        cekBuka(s, t.tgl_invoice);
        const lama = {...t};
        Object.assign(t, {no_invoice: null, tgl_invoice: null, jatuh_tempo: null, rekening_id: null});
        audit(s, 'termin', 'update', lama, {...t});
        jurnalInvoice(s, t);
      });
    },
    async simpanPenerimaan(id, d) {
      return ubah((s) => {
        const lama = id ? s.penerimaan.find((x) => x.id === id) : null;
        if (id && !lama) throw new Error('Penerimaan tidak ditemukan.');
        const t = s.termin.find((x) => x.id === (lama?.termin_id || d.termin_id));
        if (!t) throw new Error('Tagihan tidak ditemukan.');
        if (!t.no_invoice) throw new Error('Terbitkan invoice dulu sebelum mencatat penerimaan.');
        if (!d.tanggal) throw new Error('Tanggal penerimaan wajib diisi.');
        const jumlah = bulat(d.jumlah || 0, 'Jumlah diterima', {min: 0}), pot = bulat(d.potongan_pajak || 0, 'Potongan pajak', {min: 0});
        if (jumlah + pot <= 0) throw new Error('Isi jumlah diterima dan/atau potongan pajak (lebih dari 0).');
        if (jumlah > 0 && !s.rekening.some((r) => r.id === d.rekening_id && r.aktif)) throw new Error('Rekening penerima wajib dipilih (rekening aktif).');
        if (lama && terakhir(s, t.id)?.id !== lama.id) throw new Error('Hanya penerimaan terakhir yang bisa diubah. Hapus dulu penerimaan sesudahnya.');
        const sebelum = s.penerimaan.filter((x) => x.termin_id === t.id && x.id !== id).reduce((x, p) => x + p.jumlah + p.potongan_pajak, 0);
        if (sebelum + jumlah + pot > t.tagihan) throw new Error('Jumlah diterima + potongan pajak melebihi sisa tagihan (sisa Rp ' + fmt(t.tagihan - sebelum) + ').');
        if (lama) cekBuka(s, lama.tanggal);
        cekBuka(s, d.tanggal);
        const p = {...(lama || {id: idBaru(), termin_id: t.id, dibuat: waktuBaru(s), dibuat_oleh: email}), tanggal: d.tanggal, jumlah, potongan_pajak: pot,
          rekening_id: jumlah > 0 ? d.rekening_id : null, bukti_potong: d.bukti_potong || null, bukti_transfer: d.bukti_transfer || null, catatan: d.catatan || null,
          ...alokasiPenerimaan(t, sebelum, jumlah + pot)};
        const salin = lama && {...lama};
        if (lama) Object.assign(lama, p); else s.penerimaan.push(p);
        audit(s, 'penerimaan', lama ? 'update' : 'insert', salin, {...p});
        jurnalPenerimaan(s, p);
        return p;
      });
    },
    async hapusPenerimaan(id) {
      return ubah((s) => {
        const p = s.penerimaan.find((x) => x.id === id);
        if (!p) return;
        if (terakhir(s, p.termin_id)?.id !== p.id) throw new Error('Hanya penerimaan terakhir yang bisa dihapus. Hapus dulu penerimaan sesudahnya.');
        cekBuka(s, p.tanggal);
        jurnalOtomatis(s, 'penerimaan', p.id, null);
        s.penerimaan = s.penerimaan.filter((x) => x.id !== id);
        audit(s, 'penerimaan', 'delete', p, null);
      });
    },
    // ---------- Tahap 4 ----------
    async simpanKontrakVendor(id, d, items, termin) { return ubahHarga((s) => simpanKontrakVendorDi(s, id, d, items, termin)); },
    async hapusKontrakVendor(id) {
      return ubahHarga((s) => {
        const k = kvDari(s, id);
        if (!k) return;
        if (disetujui(s, id).length || s.pembayaran_vendor.some((b) => b.kontrak_id === id)) throw new Error('Kontrak vendor yang sudah punya opname disetujui atau pembayaran tidak bisa dihapus.');
        for (const o of s.opname.filter((x) => x.kontrak_id === id)) { cekBuka(s, o.tanggal); hapusBaris(s, 'opname', o); }
        for (const t of ['kontrak_vendor_item', 'kontrak_vendor_termin']) for (const x of s[t].filter((y) => y.kontrak_id === id)) hapusBaris(s, t, x);
        hapusBaris(s, 'kontrak_vendor', k);
        hargaTunda.push([id, []]);
      });
    },
    async simpanOpname(id, d) { return ubah((s) => simpanOpnameDi(s, id, d)); },
    async hapusOpname(id) {
      return ubah((s) => {
        const o = s.opname.find((x) => x.id === id);
        if (!o) return;
        if (o.status === 'disetujui' && disetujui(s, o.kontrak_id, o.id).some((x) => urutOp(x, o) > 0)) throw new Error('Hanya opname disetujui terakhir yang bisa dihapus. Hapus dulu opname sesudahnya.');
        cekBuka(s, o.tanggal);
        jurnalOtomatis(s, 'opname', o.id, null);
        hapusBaris(s, 'opname', o);
      });
    },
    async simpanBayarVendor(id, d) { return ubah((s) => simpanBayarVendorDi(s, id, d)); },
    async hapusBayarVendor(id) {
      return ubah((s) => {
        const b = s.pembayaran_vendor.find((x) => x.id === id);
        if (!b) return;
        cekBuka(s, b.tanggal);
        jurnalOtomatis(s, 'bayar_vendor', b.id, null);
        hapusBaris(s, 'pembayaran_vendor', b);
      });
    },
    async simpanPembelian(id, d, baris) { return ubahHarga((s) => simpanPembelianDi(s, id, d, baris)); },
    async hapusPembelian(id) {
      return ubahHarga((s) => {
        const b = s.pembelian.find((x) => x.id === id);
        if (!b) return;
        if (s.pembayaran_supplier.some((x) => x.pembelian_id === id)) throw new Error('Hapus dulu pembayaran hutang pembelian ini.');
        cekBuka(s, b.tanggal);
        jurnalOtomatis(s, 'pembelian', b.id, null);
        for (const x of s.pembelian_baris.filter((y) => y.pembelian_id === id)) hapusBaris(s, 'pembelian_baris', x);
        hapusBaris(s, 'pembelian', b);
        hargaTunda.push([id, []]);
      });
    },
    async simpanBayarSupplier(id, d) { return ubah((s) => simpanBayarSupplierDi(s, id, d)); },
    async hapusBayarSupplier(id) {
      return ubah((s) => {
        const x = s.pembayaran_supplier.find((y) => y.id === id);
        if (!x) return;
        cekBuka(s, x.tanggal);
        jurnalOtomatis(s, 'bayar_supplier', x.id, null);
        hapusBaris(s, 'pembayaran_supplier', x);
      });
    },
    async simpanPinjaman(id, d) { return ubah((s) => simpanPinjamanDi(s, id, d)); },
    async hapusPinjaman(id) {
      return ubah((s) => {
        const p = s.pinjaman_proyek.find((x) => x.id === id);
        if (!p) return;
        if (s.pengembalian_pinjaman.some((x) => x.pinjaman_id === id)) throw new Error('Hapus dulu riwayat pengembalian pinjaman ini.');
        hapusBaris(s, 'pinjaman_proyek', p);
      });
    },
    async simpanPengembalian(id, d) { return ubah((s) => simpanPengembalianDi(s, id, d)); },
    async hapusPengembalian(id) { return ubah((s) => { const x = s.pengembalian_pinjaman.find((y) => y.id === id); if (x) hapusBaris(s, 'pengembalian_pinjaman', x); }); },
    async statusNotifikasi() { return K.notifikasi_status.slice(); },
    async aturStatusNotifikasi(daftar) {
      for (const st of daftar) {
        K.notifikasi_status = K.notifikasi_status.filter((x) => x.kunci !== st.kunci).concat({...K.notifikasi_status.find((x) => x.kunci === st.kunci), ...st});
      }
      tulis();
    },
    async auditLog() { return K.audit_log.slice().reverse().slice(0, 500); },
    async cadangan() { return cadanganDari(K); },
    async pulihkan(p) {
      return ubah((s) => {
        s.pulihkan = true;
        const standar = s.akun.filter((a) => a.standar || a.sistem);
        const petaStandar = new Map((p.akun || []).filter((a) => a.standar || a.sistem).map((a) => [a.id, standar.find((x) => x.kode === a.kode)?.id]));
        const peta = (id) => petaStandar.get(id) || id;
        s.akun = standar.concat((p.akun || []).filter((a) => !a.standar && !a.sistem).map((a) => ({...a, induk_id: peta(a.induk_id)})));
        s.rekening = (p.rekening || []).map((r) => ({...r}));
        s.kas_transaksi = [];
        s.transfer = [];
        s.jurnal = []; s.jurnal_baris = [];
        s.tutup_buku = [];
        for (const r of s.rekening) {
          if (!akunRekening(s, r.id)) simpanAkunDi(s, null, {kode: '', nama: r.nama, induk_id: akunKode(s, '1-1').id, aktif: r.aktif}, {dariRekening: r.id});
          jurnalOtomatis(s, 'saldo_awal', r.id, r.tgl_saldo_awal, 'Saldo awal ' + r.nama, [{jenis: 'saldo_awal', jumlah: r.saldo_awal}], {REKENING: akunRekening(s, r.id).id});
        }
        for (const k of p.kas_transaksi || []) {
          const x = {...k, akun_id: peta(k.akun_id)};
          s.kas_transaksi.push(x);
          jurnalOtomatis(s, 'kas', x.id, x.tanggal, x.uraian, [{jenis: x.jenis === 'masuk' ? 'kas_masuk' : 'kas_keluar', jumlah: x.jumlah}], {REKENING: akunRekening(s, x.rekening_id).id, AKUN_DIPILIH: x.akun_id}, x.proyek_kode);
        }
        for (const t of p.transfer || []) {
          s.transfer.push({...t});
          jurnalOtomatis(s, 'transfer', t.id, t.tanggal, String(t.uraian || '').trim() || 'Transfer antar rekening', [{jenis: 'transfer', jumlah: t.jumlah}, {jenis: 'transfer_biaya', jumlah: t.biaya_admin}],
            {REKENING_ASAL: akunRekening(s, t.dari_rekening).id, REKENING_TUJUAN: akunRekening(s, t.ke_rekening).id});
        }
        for (const j of p.jurnal_manual || []) {
          const baru = buatJurnal(s, {id: j.id, tanggal: j.tanggal, uraian: j.uraian, sumber: 'manual', bukti: j.bukti});
          for (const b of j.baris || []) tambahBaris(s, {...b, akun_id: peta(b.akun_id), jurnal_id: baru.id});
        }
        if (p.akuntansi) s.akuntansi = {...s.akuntansi, ...p.akuntansi};
        s.kontrak_klien = (p.kontrak_klien || []).map((x) => ({...x}));
        s.kontrak_addendum = (p.kontrak_addendum || []).map((x) => ({...x}));
        s.termin = (p.termin || []).map((x) => ({...x}));
        for (const t of s.termin) { hitungBaris(s, t); if (t.no_invoice) jurnalInvoice(s, t); }
        s.penerimaan = (p.penerimaan || []).map((x) => ({...x})).sort(urutBuat);
        for (const x of s.penerimaan) jurnalPenerimaan(s, x);
        for (const t of TABEL_PROYEK) s[t] = (p[t] || []).map((x) => ({...x}));
        for (const o of s.opname.slice().sort(urutBuat)) jurnalOpname(s, o);
        for (const b of s.pembayaran_vendor) jurnalBayarVendor(s, b);
        for (const b of s.pembelian) jurnalPembelian(s, b);
        for (const b of s.pembayaran_supplier) jurnalBayarSupplier(s, b);
        s.tutup_buku = (p.tutup_buku || []).map((t) => ({bulan: t.bulan, ditutup_oleh: email, ditutup_pada: sekarang()}));
        if (p.perusahaan) s.perusahaan.data = p.perusahaan;
      });
    },
  };
}

// Isi file cadangan bagian keuangan (sama untuk kedua mesin).
export function cadanganDari(K) {
  const per = barisJurnal(K);
  return {
    akun: K.akun, rekening: K.rekening, kas_transaksi: K.kas_transaksi, transfer: K.transfer,
    jurnal_manual: K.jurnal.filter((j) => j.sumber === 'manual').map((j) => ({...j, baris: (per.get(j.id) || []).map(({akun_id, debit, kredit, proyek_kode, keterangan}) => ({akun_id, debit, kredit, proyek_kode, keterangan}))})),
    tutup_buku: K.tutup_buku.map((t) => ({bulan: t.bulan})), akuntansi: K.akuntansi, perusahaan: K.perusahaan?.data || {},
    kontrak_klien: K.kontrak_klien || [], kontrak_addendum: K.kontrak_addendum || [], termin: K.termin || [], penerimaan: K.penerimaan || [],
    ...Object.fromEntries(TABEL_PROYEK.map((t) => [t, K[t] || []])),
  };
}

// ---------- mesin Supabase ----------
export function mesinSupabase(sb) {
  const cek = ({data, error}) => { if (error) throw new Error(terjemah(error.message)); return data; };
  const semua = async (tabel, urut = 'id') => {
    const hasil = [];
    for (let dari = 0; ; dari += 1000) {
      const bagian = cek(await sb.from(tabel).select('*').order(urut).range(dari, dari + 999));
      hasil.push(...bagian);
      if (bagian.length < 1000) return hasil;
    }
  };
  let perusahaanId = null;
  const tulisBaris = async (tabel, id, d) => (id ? cek(await sb.from(tabel).update(d).eq('id', id).select().single()) : cek(await sb.from(tabel).insert(d).select().single()));
  return {
    mode: 'supabase',
    async muat() {
      try {
        const [akun, rekening, kas_transaksi, transfer, jurnal, jurnal_baris, pemetaan_jurnal, tutup_buku, tutup_buku_riwayat, akuntansi, perusahaan, peran] = await Promise.all([
          semua('akun', 'kode'), semua('rekening', 'nama'), semua('kas_transaksi'), semua('transfer'), semua('jurnal', 'no'), semua('jurnal_baris'),
          semua('pemetaan_jurnal', 'jenis'), semua('tutup_buku', 'bulan'), semua('tutup_buku_riwayat'), semua('akuntansi', 'perusahaan_id'), semua('perusahaan'), semua('peran', 'nama')]);
        perusahaanId = perusahaan[0]?.id || akuntansi[0]?.perusahaan_id || null;
        // Tahap 3: tabel kontrak; bila migrasinya belum dijalankan, menu kontrak menampilkan petunjuk.
        let kontrak = {kontrak_siap: false, kontrak_klien: [], kontrak_addendum: [], termin: [], penerimaan: []};
        try {
          const [kontrak_klien, kontrak_addendum, termin, penerimaan] = await Promise.all([semua('kontrak_klien', 'tanggal'), semua('kontrak_addendum', 'tanggal'), semua('termin', 'ke'), semua('penerimaan', 'dibuat')]);
          kontrak = {kontrak_siap: true, kontrak_klien, kontrak_addendum, termin, penerimaan};
        } catch (e) {
          if (!/does not exist|schema cache|Could not find/i.test(e.message)) throw e;
        }
        // Tahap 4: pihak proyek, pembelian, pinjaman antar proyek.
        let proyekKeu = {proyek_siap: false, ...Object.fromEntries(TABEL_PROYEK.map((t) => [t, []]))};
        try {
          const isi = await Promise.all(TABEL_PROYEK.map((t) => semua(t, ['kontrak_vendor_item', 'pembelian_baris'].includes(t) ? 'urut' : t === 'kontrak_vendor_termin' ? 'ke' : 'dibuat')));
          proyekKeu = {proyek_siap: true, ...Object.fromEntries(TABEL_PROYEK.map((t, i) => [t, isi[i]]))};
        } catch (e) {
          if (!/does not exist|schema cache|Could not find/i.test(e.message)) throw e;
        }
        return {siap: true, akun, rekening, kas_transaksi, transfer, jurnal, jurnal_baris, pemetaan_jurnal, tutup_buku, tutup_buku_riwayat,
          akuntansi: {...AKUNTANSI_BAWAAN, ...akuntansi[0]}, perusahaan: perusahaan[0] || {data: {}}, peran, ...kontrak, ...proyekKeu};
      } catch (e) {
        if (/does not exist|schema cache|Could not find/i.test(e.message)) return {...kosongKeuangan(), siap: false};
        throw e;
      }
    },
    async identitas() {
      const {data, error} = await sb.rpc('identitas_aplikasi');
      return error ? {} : data || {};
    },
    async simpanAkun(id, d) { return tulisBaris('akun', id, id ? d : {kode: '', ...d}); },
    async hapusAkun(id) { cek(await sb.from('akun').delete().eq('id', id)); },
    async simpanRekening(id, d) { return tulisBaris('rekening', id, d); },
    async hapusRekening(id) { cek(await sb.from('rekening').delete().eq('id', id)); },
    async simpanKas(id, d) { return tulisBaris('kas_transaksi', id, d); },
    // Satu perintah insert = satu transaksi database: bila satu baris ditolak, tidak ada yang tersimpan.
    async imporRekening(daftar) { return cek(await sb.from('rekening').insert(daftar.map(({__no, ...d}) => d)).select()); },
    async imporKas(daftar) { return cek(await sb.from('kas_transaksi').insert(daftar.map(({__no, ...d}) => d)).select()); },
    async hapusKas(id) { cek(await sb.from('kas_transaksi').delete().eq('id', id)); },
    async simpanTransfer(id, d) { return tulisBaris('transfer', id, d); },
    async hapusTransfer(id) { cek(await sb.from('transfer').delete().eq('id', id)); },
    async simpanJurnalManual(id, {tanggal, uraian, baris, bukti}) {
      return cek(await sb.rpc('simpan_jurnal_manual', {p_id: id || null, p_tanggal: tanggal, p_uraian: uraian, p_baris: baris, p_bukti: bukti || null}));
    },
    async hapusJurnalManual(id) { cek(await sb.rpc('hapus_jurnal_manual', {p_id: id})); },
    async tutupBulan(bulan) { cek(await sb.rpc('tutup_bulan', {p_bulan: bulanDari(bulan)})); },
    async bukaBulan(bulan, alasan) { cek(await sb.rpc('buka_bulan', {p_bulan: bulanDari(bulan), p_alasan: alasan})); },
    async aturAkuntansi(d) { cek(await sb.from('akuntansi').update(d).eq('perusahaan_id', perusahaanId)); },
    async simpanProfil(data) { cek(await sb.from('perusahaan').update({data}).eq('id', perusahaanId)); },
    async simpanPeran(id, d) { return tulisBaris('peran', id, d); },
    async hapusPeran(id) { cek(await sb.from('peran').delete().eq('id', id)); },
    async pengguna() { return cek(await sb.from('profiles').select('id,email,role,aktif,super_admin,peran_id,created_at').order('email')); },
    async aturPengguna(id, perubahan) { cek(await sb.from('profiles').update(perubahan).eq('id', id)); },
    async simpanKontrak(id, d, termin) {
      const isi = Object.fromEntries(KOLOM_KONTRAK.map((c) => [c, d[c] ?? null]));
      return cek(await sb.rpc('simpan_kontrak', {p_id: id || null, p: isi, p_termin: termin.map(({id: tid, milestone, jasa, titipan, perkiraan_tagih}) => ({id: tid || null, milestone, jasa, titipan, perkiraan_tagih}))}));
    },
    async hapusKontrak(id) { cek(await sb.rpc('hapus_kontrak', {p_id: id})); },
    async simpanAddendum(kid, id, d, termin = []) { return cek(await sb.rpc('simpan_addendum', {p_kontrak: kid, p_id: id || null, p: d, p_termin: termin})); },
    async hapusAddendum(id) { cek(await sb.rpc('hapus_addendum', {p_id: id})); },
    async terbitkanInvoice(terminId, {tanggal, jatuh_tempo, rekening_id}) {
      return cek(await sb.rpc('terbitkan_invoice', {p_termin: terminId, p_tanggal: tanggal, p_jatuh_tempo: jatuh_tempo, p_rekening: rekening_id}));
    },
    async batalInvoice(terminId) { cek(await sb.rpc('batal_invoice', {p_termin: terminId})); },
    async simpanPenerimaan(id, d) { return cek(await sb.rpc('simpan_penerimaan', {p_id: id || null, p: d})); },
    async hapusPenerimaan(id) { cek(await sb.rpc('hapus_penerimaan', {p_id: id})); },
    async simpanKontrakVendor(id, d, items = [], termin = []) {
      const isi = Object.fromEntries(KOLOM_KONTRAK_VENDOR.map((c) => [c, d[c] ?? null]));
      return cek(await sb.rpc('simpan_kontrak_vendor', {p_id: id || null, p: isi,
        p_item: items.map(({id: iid, barang_id, uraian, satuan, volume, harga}) => ({id: iid || null, barang_id, uraian, satuan, volume, harga})),
        p_termin: termin.map(({id: tid, milestone, persen_bp}) => ({id: tid || null, milestone, persen_bp}))}));
    },
    async hapusKontrakVendor(id) { cek(await sb.rpc('hapus_kontrak_vendor', {p_id: id})); },
    async simpanOpname(id, d) { return cek(await sb.rpc('simpan_opname', {p_id: id || null, p: d})); },
    async hapusOpname(id) { cek(await sb.rpc('hapus_opname', {p_id: id})); },
    async simpanBayarVendor(id, d) { return cek(await sb.rpc('simpan_bayar_vendor', {p_id: id || null, p: d})); },
    async hapusBayarVendor(id) { cek(await sb.rpc('hapus_bayar_vendor', {p_id: id})); },
    async simpanPembelian(id, d, baris) {
      const isi = Object.fromEntries(KOLOM_PEMBELIAN.map((c) => [c, d[c] ?? null]));
      return cek(await sb.rpc('simpan_pembelian', {p_id: id || null, p: isi, p_baris: baris.map(({barang_id, qty, satuan, harga, diskon}) => ({barang_id, qty: String(qty), satuan, harga, diskon: diskon || 0}))}));
    },
    async hapusPembelian(id) { cek(await sb.rpc('hapus_pembelian', {p_id: id})); },
    async simpanBayarSupplier(id, d) { return cek(await sb.rpc('simpan_bayar_supplier', {p_id: id || null, p: d})); },
    async hapusBayarSupplier(id) { cek(await sb.rpc('hapus_bayar_supplier', {p_id: id})); },
    async simpanPinjaman(id, d) { return cek(await sb.rpc('simpan_pinjaman', {p_id: id || null, p: d})); },
    async hapusPinjaman(id) { cek(await sb.rpc('hapus_pinjaman', {p_id: id})); },
    async simpanPengembalian(id, d) { return cek(await sb.rpc('simpan_pengembalian', {p_id: id || null, p: d})); },
    async hapusPengembalian(id) { cek(await sb.rpc('hapus_pengembalian', {p_id: id})); },
    async statusNotifikasi() {
      const {data, error} = await sb.from('notifikasi_status').select('kunci,dibaca,tunda_sampai');
      return error ? [] : data;
    },
    async aturStatusNotifikasi(daftar) { cek(await sb.from('notifikasi_status').upsert(daftar, {onConflict: 'user_id,kunci'})); },
    async auditLog() { return cek(await sb.from('audit_log').select('*').order('waktu', {ascending: false}).limit(500)); },
    async cadangan() { return cadanganDari(await this.muat()); },
    async pulihkan(p) {
      cek(await sb.rpc('pulihkan_keuangan', {p}));
      if (p.perusahaan) await this.simpanProfil(p.perusahaan);
    },
  };
}
export const kosongKeuangan = () => ({akun: [], rekening: [], kas_transaksi: [], transfer: [], jurnal: [], jurnal_baris: [], pemetaan_jurnal: PEMETAAN,
  tutup_buku: [], tutup_buku_riwayat: [], akuntansi: {...AKUNTANSI_BAWAAN}, perusahaan: {data: {}}, peran: [],
  kontrak_siap: false, kontrak_klien: [], kontrak_addendum: [], termin: [], penerimaan: [],
  proyek_siap: false, ...Object.fromEntries(TABEL_PROYEK.map((t) => [t, []]))});

// Pesan database yang teknis -> kalimat untuk pengguna.
function terjemah(m) {
  if (/rekening_satu_utama/.test(m)) return 'Rekening utama invoice hanya boleh satu.';
  if (/rekening_nama_key/.test(m)) return 'Nama rekening itu sudah dipakai.';
  if (/akun_kode_key/.test(m)) return 'Kode akun itu sudah dipakai.';
  if (/peran_nama_key/.test(m)) return 'Nama peran itu sudah dipakai.';
  if (/kontrak_klien_no_unik/.test(m)) return 'No. kontrak itu sudah dipakai kontrak lain.';
  if (/kontrak_addendum_no_unik/.test(m)) return 'No. addendum itu sudah dipakai di kontrak ini.';
  if (/termin_invoice_unik/.test(m)) return 'Nomor invoice bentrok dengan invoice lain. Coba simpan lagi.';
  if (/Could not find the function|schema cache/i.test(m)) return 'Database belum diperbarui. Jalankan SQL migrasi terbaru (4-proyek.sql) di Supabase.';
  if (/row-level security|permission denied/i.test(m)) return 'Anda tidak punya hak untuk perubahan ini.';
  if (/foreign key/i.test(m)) return 'Data ini masih dipakai data lain, jadi tidak bisa dihapus.';
  return m;
}
