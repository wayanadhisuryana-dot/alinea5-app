// Aturan data master Tahap 2 (tanpa layar): Vendor & Tukang, Supplier, Barang & riwayat harga.
// Dipakai formulir, impor Excel, dan uji otomatis.
import {OPSI} from './schema.js';
import {normNama, normHp, normNpwp, emailSah} from './klien-util.js';

export const JENIS_VENDOR = ['Mandor', 'Tukang', 'Subkontraktor', 'Freelance', 'Lainnya'];
// Jenis yang muncul di pilihan Tim Proyek (kelompok "Mandor, Tukang & Freelance").
export const JENIS_VENDOR_TIM = ['Mandor', 'Tukang', 'Freelance'];
export const BENTUK_PIHAK = ['Perorangan', 'Badan usaha'];
export const TERMIN_SUPPLIER = ['Tunai', 'Tempo'];
export const SUMBER_HARGA = ['Pembelian', 'Penawaran supplier', 'Input manual', 'Impor', 'Kontrak vendor'];
// Sumber yang diisi otomatis oleh modul lain (Tahap 4) dan tidak bisa diubah dari Barang & Harga.
export const SUMBER_OTOMATIS = ['Pembelian', 'Kontrak vendor'];
export const HARGA_LAMA_BAWAAN = 6;

const rapi = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const angkaSaja = (v) => String(v ?? '').replace(/[.\-\s]/g, '');
export const normNik = angkaSaja;
const pilihDari = (v, daftar) => {
  const s = rapi(v).toLowerCase();
  if (!s) return null;
  return daftar.find((o) => o.toLowerCase() === s) || undefined;
};
// "Ya"/"Tidak", true/false, kosong -> bawaan. undefined = tidak dikenal.
export const yaTidak = (v, bawaan = false) => {
  if (v === true || v === false) return v;
  const s = rapi(v).toLowerCase();
  if (!s) return bawaan;
  if (['ya', 'y', 'yes', 'true', '1', 'aktif'].includes(s)) return true;
  if (['tidak', 't', 'no', 'false', '0', 'nonaktif'].includes(s)) return false;
  return undefined;
};
// Daftar multi-pilih: larik atau teks dipisah koma / titik koma.
const daftarDari = (v) => (Array.isArray(v) ? v : String(v ?? '').split(/[;,\n]/)).map(rapi).filter(Boolean);

function isiUmum(masuk, data, salah) {
  const hp = normHp(masuk.hp);
  if (hp.galat) salah('No. HP / WA', hp.galat); else if (hp.nilai) data.hp = hp.nilai;
  const email = rapi(masuk.email);
  if (email && !emailSah(email)) salah('Email', 'Format email tidak benar'); else if (email) data.email = email.toLowerCase();
  const npwp = normNpwp(masuk.npwp);
  if (npwp.galat) salah('NPWP', npwp.galat); else if (npwp.nilai) data.npwp = npwp.nilai;
  for (const k of ['pic', 'bank', 'atas_nama']) if (rapi(masuk[k])) data[k] = rapi(masuk[k]);
  const norek = String(masuk.no_rekening ?? '').replace(/[\s.-]/g, '');
  if (norek && !/^\d+$/.test(norek)) salah('No. rekening', 'Hanya boleh angka (spasi, titik, dan strip diabaikan)'); else if (norek) data.no_rekening = norek;
  const alamat = String(masuk.alamat ?? '').trim(); if (alamat) data.alamat = alamat;
  const catatan = String(masuk.catatan ?? '').trim(); if (catatan) data.catatan = catatan;
  const afiliasi = yaTidak(masuk.afiliasi, false);
  if (afiliasi === undefined) salah('Pihak afiliasi', 'Isi Ya atau Tidak'); else if (afiliasi) data.afiliasi = true;
  const aktif = masuk.status != null && masuk.status !== '' ? yaTidak(masuk.status, true) : yaTidak(masuk.aktif, true);
  if (aktif === undefined) salah('Status', 'Isi Aktif atau Nonaktif'); else data.aktif = aktif;
}
function isiMulti(masuk, k, daftar, label, data, salah) {
  const pilih = daftarDari(masuk[k]);
  const salahPilih = pilih.filter((x) => !daftar.some((o) => o.toLowerCase() === x.toLowerCase()));
  if (salahPilih.length) salah(label, '"' + salahPilih.join('", "') + '" tidak ada di daftar (Pengaturan → Pilihan dropdown)');
  const benar = [...new Set(pilih.map((x) => daftar.find((o) => o.toLowerCase() === x.toLowerCase())).filter(Boolean))];
  if (benar.length) data[k] = benar;
}

// ---------- Vendor & Tukang ----------
export function validasiVendor(masuk) {
  const galat = [], salah = (kolom, pesan) => galat.push({kolom, pesan}), data = {};
  const nama = rapi(masuk.nama);
  if (!nama) salah('Nama', 'Nama wajib diisi'); else data.nama = nama;
  const jenis = pilihDari(masuk.jenis, JENIS_VENDOR);
  if (jenis === null) salah('Jenis', 'Jenis wajib dipilih');
  else if (jenis === undefined) salah('Jenis', 'Jenis harus salah satu dari: ' + JENIS_VENDOR.join(', '));
  else data.jenis = jenis;
  const bentuk = pilihDari(masuk.bentuk, BENTUK_PIHAK);
  if (bentuk === undefined) salah('Perorangan / Badan usaha', 'Isi Perorangan atau Badan usaha'); else data.bentuk = bentuk || 'Perorangan';
  isiMulti(masuk, 'keahlian', OPSI.keahlianVendor, 'Keahlian', data, salah);
  const nik = angkaSaja(masuk.nik);
  if (nik && !/^\d{16}$/.test(nik)) salah('NIK', 'NIK harus 16 digit angka'); else if (nik) data.nik = nik;
  isiUmum(masuk, data, salah);
  if (Array.isArray(masuk.dokumen) && masuk.dokumen.length) data.dokumen = masuk.dokumen;
  return {data, galat};
}

// blokir: NIK / NPWP sama dengan vendor lain. peringatan: NIK sama dengan pegawai SDM, nama mirip, HP sama.
export function duplikatVendor(calon, vendor, sdm = [], kecualiId) {
  const lain = vendor.filter((v) => v.id !== kecualiId);
  const nama = normNama(calon.nama);
  return {
    nik: calon.nik ? lain.filter((v) => normNik(v.nik) === calon.nik) : [],
    npwp: calon.npwp ? lain.filter((v) => normNpwp(v.npwp).nilai === calon.npwp) : [],
    nikSdm: calon.nik ? sdm.filter((s) => normNik(s.nik) === calon.nik) : [],
    nama: nama ? lain.filter((v) => normNama(v.nama) === nama) : [],
    hp: calon.hp ? lain.filter((v) => v.hp && v.hp === calon.hp) : [],
  };
}

// ---------- Supplier ----------
export function validasiSupplier(masuk) {
  const galat = [], salah = (kolom, pesan) => galat.push({kolom, pesan}), data = {};
  const nama = rapi(masuk.nama);
  if (!nama) salah('Nama', 'Nama wajib diisi'); else data.nama = nama;
  isiMulti(masuk, 'kategori', OPSI.kategoriBarang, 'Kategori barang', data, salah);
  const pkp = yaTidak(masuk.pkp, false);
  if (pkp === undefined) salah('Status PKP', 'Isi Ya atau Tidak'); else data.pkp = pkp;
  const termin = pilihDari(masuk.termin, TERMIN_SUPPLIER);
  if (termin === undefined) salah('Termin pembayaran', 'Isi Tunai atau Tempo');
  else {
    data.termin = termin || 'Tunai';
    if (data.termin === 'Tempo') {
      const hari = Number(String(masuk.tempo_hari ?? '').trim());
      if (!Number.isInteger(hari) || hari < 1) salah('Tempo (hari)', 'Isi jumlah hari tempo, angka bulat lebih dari 0');
      else data.tempo_hari = hari;
    }
  }
  isiUmum(masuk, data, salah);
  return {data, galat};
}
export function duplikatSupplier(calon, supplier, kecualiId) {
  const lain = supplier.filter((v) => v.id !== kecualiId);
  const nama = normNama(calon.nama);
  return {
    npwp: calon.npwp ? lain.filter((v) => normNpwp(v.npwp).nilai === calon.npwp) : [],
    nama: nama ? lain.filter((v) => normNama(v.nama) === nama) : [],
    hp: calon.hp ? lain.filter((v) => v.hp && v.hp === calon.hp) : [],
  };
}
export const teksTermin = (s) => (s?.termin === 'Tempo' ? 'Tempo ' + s.tempo_hari + ' hari' : 'Tunai');

// Nama mirip saat mengetik (dipakai vendor, supplier, barang).
export function mirip(teks, semua, kecualiId, ambil = (x) => x.nama, norm = normNama) {
  const n = norm(teks);
  if (n.length < 3) return [];
  return semua.filter((x) => {
    if (x.id === kecualiId) return false;
    const m = norm(ambil(x));
    return m && (m === n || (m.length >= 3 && (m.includes(n) || n.includes(m))));
  }).slice(0, 5);
}

// ---------- Barang & konversi satuan ----------
// Awalan kode per kategori: inisial kata ("Kayu & Panel" -> KP) atau 3 huruf pertama bila satu kata ("Cat" -> CAT).
export function awalanKategori(kategori, jenis = 'barang') {
  const kata = rapi(kategori).toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(' ').filter(Boolean);
  const dasar = !kata.length ? 'LN' : kata.length === 1 ? kata[0].slice(0, 3) : kata.map((k) => k[0]).join('').slice(0, 4);
  return (jenis === 'pekerjaan' ? 'P' : '') + dasar;
}
export function kodeBerikut(kategori, semua, jenis = 'barang') {
  const awal = awalanKategori(kategori, jenis);
  const pola = new RegExp('^' + awal + '-(\\d+)$');
  const maks = Math.max(0, ...semua.map((b) => +(pola.exec(b.kode || '')?.[1] || 0)));
  return awal + '-' + String(maks + 1).padStart(4, '0');
}
// Angka desimal Indonesia: "2,9768" / "2.9768" / 2.9768.
export function bacaDesimal(v) {
  if (typeof v === 'number') return v;
  let s = rapi(v).replace(/\s/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  return /^\d+(\.\d+)?$/.test(s) ? +s : NaN;
}
export const fmtDesimal = (x) => Number(x).toLocaleString('id-ID', {maximumFractionDigits: 6});

// Konversi: [{satuan, faktor}] artinya 1 satuan = faktor × satuan baku.
export function validasiBarang(masuk, jenis = 'barang') {
  const galat = [], salah = (kolom, pesan) => galat.push({kolom, pesan}), data = {jenis};
  const nama = rapi(masuk.nama);
  if (!nama) salah('Nama', 'Nama wajib diisi'); else data.nama = nama;
  const daftarKat = jenis === 'pekerjaan' ? OPSI.kategoriPekerjaan : OPSI.kategoriBarang;
  const kat = pilihDari(masuk.kategori, daftarKat);
  if (kat === null) salah('Kategori', 'Kategori wajib dipilih');
  else if (kat === undefined) salah('Kategori', '"' + rapi(masuk.kategori) + '" tidak ada di daftar kategori');
  else data.kategori = kat;
  const satuan = pilihDari(masuk.satuan, OPSI.satuanBarang);
  if (satuan === null) salah('Satuan baku', 'Satuan baku wajib dipilih');
  else if (satuan === undefined) salah('Satuan baku', '"' + rapi(masuk.satuan) + '" tidak ada di daftar satuan');
  else data.satuan = satuan;
  for (const k of ['merk', 'spesifikasi']) if (rapi(masuk[k])) data[k] = rapi(masuk[k]);
  const kode = rapi(masuk.kode); if (kode) data.kode = kode.toUpperCase();
  const konversi = [];
  for (const [i, c] of (masuk.konversi || []).entries()) {
    const s = pilihDari(c.satuan, OPSI.satuanBarang), f = bacaDesimal(c.faktor);
    if (!rapi(c.satuan) && (f == null || f === '')) continue;
    const label = 'Konversi ' + (i + 1);
    if (!s) { salah(label, 'Satuan "' + rapi(c.satuan) + '" tidak ada di daftar satuan'); continue; }
    if (s === data.satuan) { salah(label, 'Satuan konversi sama dengan satuan baku'); continue; }
    if (!(f > 0)) { salah(label, 'Isi berapa ' + (data.satuan || 'satuan baku') + ' dalam 1 ' + s + ' (angka lebih dari 0, mis. 2,9768)'); continue; }
    if (konversi.some((x) => x.satuan === s)) { salah(label, 'Satuan ' + s + ' tertulis dua kali'); continue; }
    konversi.push({satuan: s, faktor: f});
  }
  if (konversi.length) data.konversi = konversi;
  const aktif = yaTidak(masuk.aktif, true);
  if (aktif === undefined) salah('Status', 'Isi Aktif atau Nonaktif'); else data.aktif = aktif;
  if (masuk.foto) data.foto = masuk.foto;
  return {data, galat};
}
// Nama barang dibandingkan tanpa spasi dan tanda baca: "Multipleks 18mm" = "Multipleks 18 mm".
export const normNamaBarang = (s) => normNama(s).replace(/[^\p{L}\p{N}]/gu, '');
export function duplikatBarang(calon, semua, kecualiId) {
  const lain = semua.filter((b) => b.id !== kecualiId && (b.jenis || 'barang') === (calon.jenis || 'barang'));
  const nama = normNamaBarang(calon.nama);
  return {
    kode: calon.kode ? lain.filter((b) => (b.kode || '').toUpperCase() === calon.kode) : [],
    nama: nama ? lain.filter((b) => normNamaBarang(b.nama) === nama && (!calon.merk || !b.merk || normNamaBarang(b.merk) === normNamaBarang(calon.merk))) : [],
  };
}
// Faktor satuan terhadap satuan baku barang (1 untuk satuan baku). null bila tidak dikenal.
export const faktorSatuan = (b, satuan) => (!satuan || satuan === b.satuan ? 1 : (b.konversi || []).find((c) => c.satuan === satuan)?.faktor ?? null);
export const satuanBarang = (b) => [b.satuan, ...(b.konversi || []).map((c) => c.satuan)];

// ---------- riwayat harga ----------
// Baris harga: {barang_id, tanggal, pihak_id, pihak_nama, harga (rupiah utuh per `satuan`), satuan, faktor (salinan saat dicatat),
//  ppn (bool), ongkir (rupiah per `satuan`, opsional), sumber, proyek_kode, catatan}.
// Harga dalam satuan baku = harga / faktor (dihitung, tidak diketik).
export const hargaBaku = (r) => (+r.harga || 0) / (+r.faktor || 1);
export const ongkirBaku = (r) => (r.ongkir ? +r.ongkir / (+r.faktor || 1) : 0);
export const tambahBulan = (tanggal, n) => {
  const [y, m, d] = tanggal.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const akhir = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return t.getUTCFullYear() + '-' + String(t.getUTCMonth() + 1).padStart(2, '0') + '-' + String(Math.min(d, akhir)).padStart(2, '0');
};

export function validasiHarga(masuk, barang) {
  const galat = [], salah = (kolom, pesan) => galat.push({kolom, pesan});
  const data = {barang_id: barang?.id};
  if (!barang) salah('Barang', 'Barang tidak ditemukan');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(masuk.tanggal || '')) salah('Tanggal', 'Tanggal wajib diisi'); else data.tanggal = masuk.tanggal;
  const satuan = rapi(masuk.satuan) || barang?.satuan;
  const faktor = barang ? faktorSatuan(barang, satuan) : null;
  if (barang && faktor == null) salah('Satuan', 'Satuan "' + satuan + '" belum punya konversi di barang ini');
  else { data.satuan = satuan; data.faktor = faktor; }
  const harga = masuk.harga;
  if (!Number.isInteger(harga) || harga <= 0) salah('Harga satuan', 'Harga harus rupiah utuh lebih dari 0'); else data.harga = harga;
  if (masuk.ongkir != null && masuk.ongkir !== '') {
    if (!Number.isInteger(masuk.ongkir) || masuk.ongkir < 0) salah('Ongkir per satuan', 'Ongkir harus rupiah utuh, 0 atau lebih'); else if (masuk.ongkir) data.ongkir = masuk.ongkir;
  }
  const ppn = yaTidak(masuk.ppn, false);
  if (ppn === undefined) salah('Termasuk PPN?', 'Isi Ya atau Tidak'); else data.ppn = ppn;
  const sumber = pilihDari(masuk.sumber, SUMBER_HARGA);
  if (sumber === undefined) salah('Sumber', 'Sumber harus salah satu dari: ' + SUMBER_HARGA.join(', ')); else data.sumber = sumber || 'Input manual';
  if (masuk.pihak_id) data.pihak_id = masuk.pihak_id;
  if (rapi(masuk.pihak_nama)) data.pihak_nama = rapi(masuk.pihak_nama);
  if (rapi(masuk.proyek_kode)) data.proyek_kode = rapi(masuk.proyek_kode);
  const catatan = String(masuk.catatan ?? '').trim(); if (catatan) data.catatan = catatan;
  return {data, galat};
}

// Ringkasan harga satu barang (semua dalam satuan baku).
export function ringkasHarga(rows, today, bulanLama = HARGA_LAMA_BAWAAN) {
  const urut = rows.filter((r) => r.tanggal && r.harga > 0).slice().sort((a, b) => b.tanggal.localeCompare(a.tanggal) || String(b.dibuat || '').localeCompare(String(a.dibuat || '')));
  if (!urut.length) return {jumlah: 0, terakhir: null, lama: false, tren: [], perPihak: []};
  const nilai = urut.map(hargaBaku);
  const batas12 = tambahBulan(today, -12);
  const dua12 = urut.filter((r) => r.tanggal >= batas12 && r.tanggal <= today).map(hargaBaku);
  const rata = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
  const tahun = [...new Set(urut.map((r) => r.tanggal.slice(0, 4)))].sort();
  const tren = tahun.map((t) => {
    const xs = urut.filter((r) => r.tanggal.startsWith(t)).map(hargaBaku);
    return {tahun: t, jumlah: xs.length, rata: rata(xs), terendah: Math.min(...xs), tertinggi: Math.max(...xs)};
  });
  tren.forEach((x, i) => { x.perubahan = i ? (x.rata - tren[i - 1].rata) / tren[i - 1].rata : null; });
  const kunciPihak = (r) => r.pihak_id || 'nama:' + (r.pihak_nama || '');
  const perPihak = [...new Set(urut.map(kunciPihak))].map((k) => {
    const xs = urut.filter((r) => kunciPihak(r) === k);
    return {pihak_id: xs[0].pihak_id || null, pihak_nama: xs[0].pihak_nama || '', jumlah: xs.length, terakhir: hargaBaku(xs[0]), tanggal: xs[0].tanggal,
      rata: rata(xs.map(hargaBaku)), terendah: Math.min(...xs.map(hargaBaku))};
  }).sort((a, b) => a.terakhir - b.terakhir);
  const terakhir = urut[0];
  return {
    jumlah: urut.length, terakhir, hargaTerakhir: hargaBaku(terakhir), tanggalTerakhir: terakhir.tanggal,
    rata12: rata(dua12), jumlah12: dua12.length, terendah: Math.min(...nilai), tertinggi: Math.max(...nilai),
    lama: terakhir.tanggal < tambahBulan(today, -bulanLama), tren, perPihak,
  };
}
