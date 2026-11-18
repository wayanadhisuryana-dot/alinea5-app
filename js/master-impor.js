// Menilai baris impor Excel data master (tanpa layar). Hasil per baris:
// {no, nilai, data, galat: [{kolom, pesan}], status: 'siap'|'error'|'duplikat', cocok?, alasan?, aksi, pilihan: [[aksi, label]], peringatan?}
// Aksi: 'baru' (simpan sebagai data baru), 'lewati', 'timpa', 'isi' (isi yang kosong saja).
import {validasiVendor, duplikatVendor, validasiSupplier, duplikatSupplier, validasiBarang, duplikatBarang, validasiHarga, faktorSatuan, hargaBaku, yaTidak} from './master-util.js';
import {teksKeKonversi} from './master-excel.js';
import {bacaTanggal, bacaRupiah} from './keuangan-excel.js';

const PILIH_ADA = [['lewati', 'Lewati'], ['timpa', 'Timpa'], ['isi', 'Isi yang kosong saja']];
const PILIH_ADA_BARU = [...PILIH_ADA, ['baru', 'Simpan sebagai data baru']];
const PILIH_FILE = [['lewati', 'Lewati'], ['baru', 'Tetap simpan']];
const teks = (v) => (v instanceof Date ? bacaTanggal(v) : String(v ?? '').trim());

// Isi lama dilengkapi isi baru hanya pada kolom yang masih kosong.
export function isiKosong(lama, baru) {
  const hasil = {...lama};
  for (const [k, v] of Object.entries(baru)) {
    const kosong = hasil[k] == null || hasil[k] === '' || (Array.isArray(hasil[k]) && !hasil[k].length);
    if (kosong) hasil[k] = v;
  }
  return hasil;
}
// Timpa: isi baru menggantikan kolom yang sama; kolom yang tidak ada di file (dokumen, foto, kode) tetap.
export const timpa = (lama, baru) => ({...lama, ...baru});
export function gabungAksi(r) {
  if (r.aksi === 'timpa') return timpa(r.cocok, r.data);
  if (r.aksi === 'isi') return isiKosong(r.cocok, r.data);
  return r.data;
}

function nilai(jenis, b, opsi) {
  if (jenis === 'vendor') return validasiVendor({...b});
  if (jenis === 'supplier') return validasiSupplier({...b});
  if (jenis === 'barang') return validasiBarang({...b, aktif: b.status, konversi: teksKeKonversi(b.konversi)}, opsi.jenisBarang || 'barang');
  throw new Error('Jenis impor tidak dikenal: ' + jenis);
}

// ctx: {ada: data master yang sudah ada, sdm: pegawai (untuk vendor)}.
export function evaluasiMaster(jenis, baris, ctx, opsi = {}) {
  const dalamFile = [];
  return baris.map(({no, nilai: b}) => {
    const {data, galat} = nilai(jenis, b, opsi);
    const r = {no, nilai: b, data, galat, status: galat.length ? 'error' : 'siap', aksi: 'baru', pilihan: []};
    if (galat.length) return r;
    let dAda, dFile, blokir = [], mirip = [];
    if (jenis === 'vendor') {
      dAda = duplikatVendor(data, ctx.ada, ctx.sdm || []);
      dFile = duplikatVendor(data, dalamFile, []);
      blokir = [['NIK sama', dAda.nik], ['NPWP sama', dAda.npwp]];
      mirip = [['nama mirip', dAda.nama], ['No. HP sama', dAda.hp]];
      if (dAda.nikSdm.length) r.peringatan = 'NIK sama dengan pegawai SDM "' + dAda.nikSdm[0].nama + '"';
      dFile = [...dFile.nik, ...dFile.npwp].length ? {blok: [...dFile.nik, ...dFile.npwp]} : {mirip: [...dFile.nama, ...dFile.hp]};
    } else if (jenis === 'supplier') {
      dAda = duplikatSupplier(data, ctx.ada);
      const f = duplikatSupplier(data, dalamFile);
      blokir = [['NPWP sama', dAda.npwp]];
      mirip = [['nama mirip', dAda.nama], ['No. HP sama', dAda.hp]];
      dFile = f.npwp.length ? {blok: f.npwp} : {mirip: [...f.nama, ...f.hp]};
    } else {
      const sejenis = ctx.ada.filter((x) => (x.jenis || 'barang') === data.jenis);
      if (data.kode && !sejenis.some((x) => (x.kode || '').toUpperCase() === data.kode)) {
        galat.push({kolom: 'Kode', pesan: 'Kode "' + data.kode + '" belum ada. Kosongkan kolom Kode untuk ' + (data.jenis === 'pekerjaan' ? 'item' : 'barang') + ' baru (kode dibuat otomatis).'});
        r.status = 'error';
        return r;
      }
      dAda = duplikatBarang(data, sejenis);
      const f = duplikatBarang(data, dalamFile);
      blokir = [['kode sama', dAda.kode]];
      mirip = data.kode ? [] : [['nama mirip', dAda.nama]];
      dFile = f.kode.length ? {blok: f.kode} : {mirip: f.nama};
    }
    const blok = blokir.find(([, d]) => d.length), mrp = mirip.find(([, d]) => d.length);
    if (blok) Object.assign(r, {status: 'duplikat', cocok: blok[1][0], alasan: blok[0] + ' dengan "' + blok[1][0].nama + '" yang sudah ada', aksi: 'lewati', pilihan: PILIH_ADA});
    else if (mrp) Object.assign(r, {status: 'duplikat', cocok: mrp[1][0], alasan: mrp[0] + ' dengan "' + mrp[1][0].nama + '" yang sudah ada', aksi: 'lewati', pilihan: PILIH_ADA_BARU});
    else if (dFile.blok?.length) Object.assign(r, {status: 'duplikat', alasan: 'nomor identitas / kode sama dengan baris ' + dFile.blok[0].__no + ' di file ini', aksi: 'lewati', pilihan: [['lewati', 'Lewati']]});
    else if (dFile.mirip?.length) Object.assign(r, {status: 'duplikat', alasan: 'mirip dengan baris ' + dFile.mirip[0].__no + ' di file ini', aksi: 'lewati', pilihan: PILIH_FILE});
    dalamFile.push({...data, id: 'baris-' + no, __no: no});
    return r;
  });
}

// Riwayat harga. ctx: {barang (sejenis), pihak: supplier atau vendor, proyek: [kode], ada: baris harga yang sudah ada}.
export function evaluasiHargaImpor(baris, ctx) {
  const kunci = (d) => [d.barang_id, d.tanggal, d.pihak_id || d.pihak_nama || '', d.harga, d.satuan].join('|');
  const ada = new Set(ctx.ada.map(kunci));
  const dalamFile = new Map();
  const proyek = new Set((ctx.proyek || []).map((x) => String(x).toLowerCase()));
  return baris.map(({no, nilai: b}) => {
    const kode = teks(b.kode_barang).toUpperCase();
    const brg = ctx.barang.find((x) => (x.kode || '').toUpperCase() === kode);
    const galat = [];
    if (!kode) galat.push({kolom: 'Kode', pesan: 'wajib diisi'});
    else if (!brg) galat.push({kolom: 'Kode', pesan: '"' + kode + '" tidak ada di Barang & Harga'});
    const tanggal = b.tanggal === undefined ? null : bacaTanggal(b.tanggal);
    if (!tanggal) galat.push({kolom: 'Tanggal', pesan: b.tanggal === undefined ? 'wajib diisi' : '"' + teks(b.tanggal) + '" bukan tanggal yang benar'});
    const harga = b.harga === undefined ? null : bacaRupiah(b.harga);
    if (b.harga === undefined) galat.push({kolom: 'Harga satuan', pesan: 'wajib diisi'});
    else if (!Number.isInteger(harga)) galat.push({kolom: 'Harga satuan', pesan: '"' + teks(b.harga) + '" bukan rupiah utuh'});
    const ongkir = b.ongkir === undefined ? null : bacaRupiah(b.ongkir);
    if (b.ongkir !== undefined && !Number.isInteger(ongkir)) galat.push({kolom: 'Ongkir per satuan', pesan: '"' + teks(b.ongkir) + '" bukan rupiah utuh'});
    const pk = teks(b.proyek_kode);
    if (pk && !proyek.has(pk.toLowerCase())) galat.push({kolom: 'Kode proyek', pesan: '"' + pk + '" tidak ada di menu Proyek'});
    const namaPihak = teks(b.pihak);
    const pihak = namaPihak && ctx.pihak.find((x) => x.nama.trim().toLowerCase() === namaPihak.toLowerCase());
    let data = {};
    if (brg && tanggal && Number.isInteger(harga) && (b.ongkir === undefined || Number.isInteger(ongkir))) {
      const v = validasiHarga({tanggal, satuan: teks(b.satuan), harga, ongkir, ppn: b.ppn, sumber: 'Impor', pihak_id: pihak?.id, pihak_nama: pihak?.nama || namaPihak, proyek_kode: pk, catatan: b.catatan}, brg);
      data = v.data; galat.push(...v.galat);
    }
    if (yaTidak(b.ppn, false) === undefined && !galat.some((g) => g.kolom === 'Termasuk PPN?')) galat.push({kolom: 'Termasuk PPN?', pesan: 'Isi Ya atau Tidak'});
    const r = {no, nilai: b, data, galat, status: galat.length ? 'error' : 'siap', aksi: 'baru', pilihan: [], barang: brg};
    if (galat.length) return r;
    if (namaPihak && !pihak) r.peringatan = '"' + namaPihak + '" belum terdaftar; disimpan sebagai teks';
    const k = kunci(data);
    if (ada.has(k)) Object.assign(r, {status: 'duplikat', alasan: 'harga yang sama pada tanggal itu sudah tercatat', aksi: 'lewati', pilihan: PILIH_FILE});
    else if (dalamFile.has(k)) Object.assign(r, {status: 'duplikat', alasan: 'sama dengan baris ' + dalamFile.get(k) + ' di file ini', aksi: 'lewati', pilihan: PILIH_FILE});
    dalamFile.set(k, no);
    return r;
  });
}
export {faktorSatuan, hargaBaku};
