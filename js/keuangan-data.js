// Data keuangan Tahap 1: Bagan Akun, rekening Kas & Bank, transaksi kas umum, transfer, jurnal,
// tutup buku, pengaturan akuntansi, profil perusahaan, peran, status notifikasi, dan audit log.
// Dua mesin dengan antarmuka yang sama:
//  - Supabase: aturan dijaga database (supabase/migrasi/1-fondasi.sql); aplikasi hanya membaca dan menulis.
//  - Lokal (mode demo): aturan yang SAMA ditiru di sini agar layar bisa diuji tanpa database.
// Uang selalu rupiah utuh (bilangan bulat).
import {idBaru} from './store.js';
import {PERAN_BAWAAN} from './akses.js';

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
].map(([jenis, urut, nama, sisi, akun, keterangan]) => ({jenis, urut, nama, sisi, akun, keterangan}));
export const ISI_PEMETAAN = {
  REKENING: 'Rekening yang dipilih', AKUN_DIPILIH: 'Akun yang dipilih di transaksi',
  REKENING_ASAL: 'Rekening asal', REKENING_TUJUAN: 'Rekening tujuan',
};
export const GOLONGAN = {1: 'Aset', 2: 'Kewajiban', 3: 'Ekuitas', 4: 'Pendapatan', 5: 'Beban proyek', 6: 'Beban operasional', 7: 'Beban lain-lain'};
export const saldoNormal = (gol) => (gol === 1 || gol >= 5 ? 'D' : 'K');
export const JENIS_REKENING = ['Giro', 'Tabungan', 'Deposito', 'Kas tunai'];
export const SUMBER_JURNAL = {manual: 'Jurnal manual', saldo_awal: 'Saldo awal', kas: 'Kas umum', transfer: 'Transfer'};
export const AKUNTANSI_BAWAAN = {basis: 'kas', bulan_awal_buku: 1, batas_kapitalisasi: 10000000};
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

export function mesinLokal({email = 'Mode demo', hariIni}) {
  let K;
  try { K = JSON.parse(localStorage.getItem(KUNCI)); } catch { K = null; }
  if (!K?.akun?.length) K = keadaanAwal();
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
        s.tutup_buku = (p.tutup_buku || []).map((t) => ({bulan: t.bulan, ditutup_oleh: email, ditutup_pada: sekarang()}));
        if (p.akuntansi) s.akuntansi = {...s.akuntansi, ...p.akuntansi};
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
        return {siap: true, akun, rekening, kas_transaksi, transfer, jurnal, jurnal_baris, pemetaan_jurnal, tutup_buku, tutup_buku_riwayat,
          akuntansi: akuntansi[0] || {...AKUNTANSI_BAWAAN}, perusahaan: perusahaan[0] || {data: {}}, peran};
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
  tutup_buku: [], tutup_buku_riwayat: [], akuntansi: {...AKUNTANSI_BAWAAN}, perusahaan: {data: {}}, peran: []});

// Pesan database yang teknis -> kalimat untuk pengguna.
function terjemah(m) {
  if (/rekening_satu_utama/.test(m)) return 'Rekening utama invoice hanya boleh satu.';
  if (/rekening_nama_key/.test(m)) return 'Nama rekening itu sudah dipakai.';
  if (/akun_kode_key/.test(m)) return 'Kode akun itu sudah dipakai.';
  if (/peran_nama_key/.test(m)) return 'Nama peran itu sudah dipakai.';
  if (/row-level security|permission denied/i.test(m)) return 'Anda tidak punya hak untuk perubahan ini.';
  if (/foreign key/i.test(m)) return 'Data ini masih dipakai data lain, jadi tidak bisa dihapus.';
  return m;
}
