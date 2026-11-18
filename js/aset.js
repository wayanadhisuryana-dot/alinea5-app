// Tahap 5 — Aset: daftar aset dengan nilai per tanggal, detail (informasi, penyusutan komersial & fiskal, mutasi, servis,
// dokumen, pelepasan), formulir aset / servis / dokumen, Laporan Pajak (penyusutan fiskal, rekonsiliasi, barang modal
// di bawah batas kapitalisasi), pengaturan aset, dan pembukuan penyusutan bulanan otomatis.
// Rumus ada di aset-util.js; aturan dan jurnal dijaga database (supabase/migrasi/5-aset.sql) dan mesin demo.
import {S, segarkanKeuangan} from './state.js';
import {store, BUCKET_BUKTI, idBaru} from './store.js';
import {hariIni} from './calc.js';
import {bisaUbah, hak, modulAktif} from './akses.js';
import {h, idn, rp, rpRingkas, tgl, isi, pill, pesan, aman, dialog, sambilMenyimpan, pilihCari, kepalaUrut, bandingkan, ukuranFile, unduh} from './ui.js';
import {medan, teks, tanggal, pilihan, uang, centang, kaki, tombolHapus, catatanKunci, batasUnggah, namaRekening, tombolBukti, pilihBukti, bukaFormJurnal, kartuBelumSiap} from './keuangan.js';
import {terkunci, akunKode, namaBulan, daftarJurnal, KOLOM_ASET} from './keuangan-data.js';
import {
  KONDISI_ASET, STATUS_ASET, CARA_PEROLEHAN, JENIS_DOKUMEN_ASET, METODE_FISKAL, JENIS_KATEGORI, idxBulan, bulanKe, akhirBulan, nilaiPerolehan, totalBayar,
  akumulasiSampai, susutBulan, jadwalKomersial, bulanAkhirSusut, sisaUmurPada, hitungPelepasan, hitungFiskal, rekonsiliasi, kodeAsetBerikut, prefixSah,
  tahunKeBulan, bulanKeTahun, perolehanPada, servisKap,
} from './aset-util.js';
import {pkpPada, bpKePersen, persenKeBp} from './kontrak-util.js';
import {K, ubin, dialogLebar, opsiSupplier, rincian} from './proyek-bersama.js';
import {eksporExcel, muatExcelJS} from './excel.js';
import {bacaTanggal, bacaRupiah} from './keuangan-excel.js';

const bisa = () => bisaUbah('aset');
const bisaAtur = () => bisaUbah('aset') || bisaUbah('pengaturan');
const asetDari = (id) => S.d.aset.find((a) => a.id === id);
const katDari = (id) => K().aset_kategori.find((k) => k.id === id);
const kelDari = (id) => K().kelompok_fiskal.find((k) => k.id === id);
const metode = () => K().akuntansi?.metode_fiskal || 'garis_lurus';
const batasKap = () => +K().akuntansi?.batas_kapitalisasi || 0;
const urutUrut = (a, b) => (a.urut ?? 0) - (b.urut ?? 0) || bandingkan(a.nama, b.nama);
const nmAkun = (id) => { const a = K().akun.find((x) => x.id === id); return a ? a.kode + ' ' + a.nama : '—'; };
const istilah = (a) => (a?.jenis_kategori === 'tak_berwujud' || a?.kat?.jenis === 'tak_berwujud' || a?.jenis === 'tak_berwujud' ? 'Amortisasi' : 'Penyusutan');
const tahunTeks = (b) => (b == null ? '—' : idn(b / 12, 2) + ' tahun' + (b % 12 ? ' (' + b + ' bulan)' : ''));
const rekAktif = (kecuali) => K().rekening.filter((r) => r.aktif || r.id === kecuali).map((r) => [r.id, r.nama]);
const opsiSdm = (kecuali) => (S.d.sdm || []).filter((s) => s.aktif !== 'Keluar' || s.id === kecuali).sort((a, b) => bandingkan(a.nama, b.nama))
  .map((s) => ({v: s.id, label: s.nama || '—', sub: s.jabatan_nama || ''}));
const teksPeringatan = (p) => (p.jenis === 'kondisi' ? p.kondisi : p.dokumen.jenis + (p.habis ? ' habis ' : ' s.d. ') + tgl(p.tanggal));
const baris0 = (n, teksKosong) => h('tr', null, h('td', {colspan: String(n), class: 'redup'}, teksKosong));
const tabel = (kepala, rows, kanan = []) => h('div', {class: 'gulir'}, h('table', {class: 'tabel'},
  h('thead', null, h('tr', null, kepala.map((x, i) => h('th', {class: kanan.includes(i) ? 'kanan' : null}, x)))), h('tbody', null, rows)));
const td = (v, kanan) => h('td', {class: kanan ? 'kanan nw' : null}, v);

// Database Tahap 5 belum dipasang di Supabase.
function belumSiapAset(el) {
  if (!K().siap) { kartuBelumSiap(el); return true; }
  if (K().aset_siap === false) {
    el.append(h('div', {class: 'kartu'}, h('h2', null, 'Database aset belum dipasang'),
      h('p', null, 'Menu Aset memerlukan pembaruan database Tahap 5. Jalankan SQL file supabase/migrasi/5-aset.sql di Supabase SQL Editor, lalu muat ulang halaman.')));
    return true;
  }
  return false;
}

// Data aset untuk dikirim ke mesin (formulir lain yang mengubah sebagian isi, mis. kondisi setelah servis).
const dataAset = (a) => ({...Object.fromEntries(KOLOM_ASET.map((c) => [c, a[c] ?? null])), tetap_aset: !!a.di_bawah_batas});

// =====================================================================
// Penyusutan bulanan otomatis (dipanggil saat admin membuka aplikasi)
// =====================================================================
// Membukukan penyusutan sampai akhir bulan lalu. true bila ada jurnal yang dibuat / diperbarui.
export async function bukukanOtomatis() {
  if (!bisa() || !modulAktif('aset') || !K().siap || K().aset_siap === false || !K().aset?.length) return false;
  try { return (await store.keu.bukukanPenyusutan(akhirBulan(idxBulan(hariIni()) - 1))) > 0; }
  catch (e) { console.error('Penyusutan otomatis gagal', e); return false; }
}
async function bukukanSekarang(sampai = akhirBulan(idxBulan(hariIni()))) {
  const n = await store.keu.bukukanPenyusutan(sampai);
  await segarkanKeuangan();
  pesan(n ? 'Penyusutan dibukukan: ' + n + ' bulan dibuat / diperbarui.' : 'Penyusutan sudah terbukukan sampai ' + namaBulan(sampai) + '. Tidak ada perubahan.');
}

// =====================================================================
// Daftar aset
// =====================================================================
S.saringAset = S.saringAset || {kategori: '', status: 'Aktif', peringatan: false, q: '', tanggal: ''};
S.urutAset = S.urutAset || {k: 'kode', arah: 1};
export function renderAset(el) {
  el.append(h('div', {class: 'kepala'}, h('h1', null, 'Aset'),
    h('p', {class: 'redup'}, 'Daftar aset tetap dan tak berwujud perusahaan: nilai perolehan, penyusutan (garis lurus, bulanan), pemegang, kondisi, dokumen, dan servis. Buku pajak (fiskal) dihitung terpisah di Laporan Pajak.')));
  if (belumSiapAset(el)) return;
  const sr = S.saringAset;
  const t = sr.tanggal || hariIni();
  const semua = S.d.aset.map((a) => (t === hariIni() ? a : nilaiAsetPada(a, t)));
  const ada = semua.filter((a) => a.ada);
  const tglEl = tanggal('as-per', t, {'aria-label': 'Nilai per tanggal', onchange: (ev) => { sr.tanggal = ev.target.value || ''; S.render(); }});
  el.append(h('div', {class: 'alat'},
    h('label', {for: 'as-per', class: 'kecil'}, 'Nilai per tanggal'), tglEl, t !== hariIni() && h('button', {class: 'btn btn-kecil', type: 'button', onclick: () => { sr.tanggal = ''; S.render(); }}, 'Hari ini'),
    h('span', {class: 'pegas'}),
    h('a', {class: 'btn', href: '#aset-pajak'}, 'Laporan Pajak'),
    bisa() && h('button', {class: 'btn', type: 'button', title: 'Membuat / memperbarui jurnal penyusutan sampai akhir bulan ini. Bulan yang sudah ditutup dilewati.', onclick: aman(() => bukukanSekarang())}, 'Bukukan penyusutan sekarang'),
    bisa() && h('button', {class: 'btn btn-utama', type: 'button', onclick: () => bukaFormAset(null)}, '+ Aset')));
  const jml = (rows, k) => rows.reduce((s, a) => s + (a[k] || 0), 0);
  el.append(h('section', {class: 'ubin-grid', 'aria-label': 'Ringkasan aset'},
    ubin('Aset dimiliki', idn(ada.length) + ' aset', 'per ' + tgl(t)),
    ubin('Nilai perolehan', rpRingkas(jml(ada, 'perolehan_pada')), rp(jml(ada, 'perolehan_pada')) + ' · termasuk servis yang dikapitalisasi'),
    ubin('Akumulasi penyusutan', rpRingkas(jml(ada, 'akumulasi')), rp(jml(ada, 'akumulasi')) + ' · komersial'),
    ubin('Nilai buku', rpRingkas(jml(ada, 'buku')), rp(jml(ada, 'buku')) + ' · perolehan − akumulasi'),
    ubin('Peringatan', idn(semua.filter((a) => a.peringatan.length).length) + ' aset', 'dokumen akan habis atau kondisi bukan Baik', {buruk: semua.some((a) => a.peringatan.length)})));
  // Rincian per kategori
  const perKat = K().aset_kategori.slice().sort(urutUrut).map((k) => ({k, rows: ada.filter((a) => a.kategori_id === k.id)})).filter((x) => x.rows.length);
  el.append(h('details', {class: 'kartu'}, h('summary', null, h('b', null, 'Rincian per kategori'), ' ', h('span', {class: 'kecil redup'}, perKat.length + ' kategori')),
    tabel(['Kategori', 'Jumlah', 'Nilai perolehan', 'Akumulasi', 'Nilai buku'], perKat.length ? [
      ...perKat.map(({k, rows}) => h('tr', null, td(k.nama + (k.disusutkan ? '' : ' (tidak disusutkan)')), td(idn(rows.length), 1), td(rp(jml(rows, 'perolehan_pada')), 1), td(rp(jml(rows, 'akumulasi')), 1), td(rp(jml(rows, 'buku')), 1))),
      h('tr', null, h('th', null, 'Total'), h('th', {class: 'kanan'}, idn(ada.length)), h('th', {class: 'kanan'}, rp(jml(ada, 'perolehan_pada'))), h('th', {class: 'kanan'}, rp(jml(ada, 'akumulasi'))), h('th', {class: 'kanan'}, rp(jml(ada, 'buku')))),
    ] : [baris0(5, 'Belum ada aset pada tanggal ini.')], [1, 2, 3, 4])));

  const wadah = h('div'), hitungan = h('span', {class: 'redup kecil'});
  const KOLOM = [['kode', 'Kode'], ['nama', 'Nama'], ['kategori_nama', 'Kategori'], ['tgl_perolehan', 'Tgl perolehan'], ['perolehan_pada', 'Nilai perolehan', true], ['akumulasi', 'Akumulasi', true],
    ['buku', 'Nilai buku', true], ['pemegang_nama', 'Pemegang'], ['kondisi', 'Kondisi'], [null, 'Peringatan']];
  const saring = () => {
    const q = sr.q.trim().toLowerCase();
    return semua.filter((a) => (!sr.kategori || a.kategori_id === sr.kategori)
      && (sr.status === 'Semua' || (sr.status === 'Aktif' ? a.ada : a.status !== 'Aktif'))
      && (!sr.peringatan || a.peringatan.length)
      && (!q || [a.kode, a.nama, a.no_seri, a.pemegang_nama, a.lokasi_nama].some((x) => String(x || '').toLowerCase().includes(q))));
  };
  const gambar = () => {
    const rows = saring().sort((a, b) => bandingkan(a[S.urutAset.k], b[S.urutAset.k]) * S.urutAset.arah || bandingkan(a.kode, b.kode));
    hitungan.textContent = rows.length + ' aset · nilai buku ' + rp(jml(rows, 'buku'));
    const badan = h('tbody', null, rows.length ? rows.map((a) => {
      const buka = () => { location.hash = '#aset-' + a.id; };
      return h('tr', {class: 'bisa-klik', tabindex: '0', onclick: buka, onkeydown: (ev) => { if (ev.key === 'Enter') buka(); }},
        h('td', {class: 'nw'}, a.kode), h('td', null, a.nama, a.status !== 'Aktif' && h('span', {class: 'kecil redup blok'}, a.status + ' ' + tgl(a.tgl_pelepasan))),
        td(a.kategori_nama), h('td', {class: 'nw'}, tgl(a.tgl_perolehan)), td(rp(a.perolehan_pada), 1), td(rp(a.akumulasi), 1), td(rp(a.buku), 1),
        td(isi(a.pemegang_nama)), td(pill(a.kondisi)), h('td', null, a.peringatan.length ? a.peringatan.map((p) => h('span', {class: 'pill pill-buruk blok'}, teksPeringatan(p))) : '—'));
    }) : [baris0(KOLOM.length, S.d.aset.length ? 'Tidak ada aset yang cocok dengan saringan.' : 'Belum ada aset. Klik "+ Aset".')]);
    const tb = h('table', {class: 'tabel'}, kepalaUrut(KOLOM, S.urutAset, gambar), badan);
    wadah.replaceChildren(h('div', {class: 'gulir'}, tb));
  };
  const berkas = h('input', {type: 'file', accept: '.xlsx', hidden: true, 'aria-label': 'File Excel aset', onchange: aman(async () => {
    const f = berkas.files[0];
    berkas.value = '';
    if (f) bukaPratinjauImporAset(await bacaImporAset(await f.arrayBuffer()));
  })});
  el.append(h('div', {class: 'kartu'},
    h('div', {class: 'alat'},
      h('input', {type: 'search', placeholder: 'Cari kode / nama / pemegang…', 'aria-label': 'Cari aset', value: sr.q, oninput: (ev) => { sr.q = ev.target.value; gambar(); }}),
      pilihan('as-skat', [['', 'Semua kategori'], ...K().aset_kategori.slice().sort(urutUrut).map((k) => [k.id, k.nama])], sr.kategori, {'aria-label': 'Saring kategori', onchange: (ev) => { sr.kategori = ev.target.value; gambar(); }}),
      pilihan('as-sstatus', [['Aktif', 'Aktif (dimiliki)'], ['Dilepas', 'Sudah dilepas'], ['Semua', 'Semua']], sr.status, {'aria-label': 'Saring status', onchange: (ev) => { sr.status = ev.target.value; gambar(); }}),
      h('label', {class: 'centang kecil'}, h('input', {type: 'checkbox', checked: sr.peringatan, onchange: (ev) => { sr.peringatan = ev.target.checked; gambar(); }}), ' Hanya yang ada peringatan'),
      hitungan, h('span', {class: 'pegas'}),
      h('button', {class: 'btn', type: 'button', onclick: aman(() => eksporAset(saring(), t))}, 'Ekspor Excel'),
      h('button', {class: 'btn', type: 'button', onclick: aman(() => unduhTemplateAset())}, 'Unduh Template'),
      bisa() && h('button', {class: 'btn', type: 'button', onclick: () => berkas.click()}, 'Impor Excel'), bisa() && berkas),
    wadah));
  gambar();
}

// Nilai aset pada tanggal lain (daftar dengan "Nilai per tanggal").
function nilaiAsetPada(a, t) {
  if (!a.tgl_perolehan || a.tgl_perolehan > t || (a.status !== 'Aktif' && a.tgl_pelepasan && a.tgl_pelepasan <= t)) return {...a, perolehan_pada: 0, akumulasi: 0, buku: 0, ada: false};
  const perolehan = perolehanPada(a, a.servis, t);
  const X = akhirBulan(idxBulan(t)) === t ? idxBulan(t) : idxBulan(t) - 1;
  const akumulasi = akumulasiSampai(a, a.kat, a.servis, X);
  return {...a, perolehan_pada: perolehan, akumulasi, buku: perolehan - akumulasi, ada: true};
}

// =====================================================================
// Detail satu aset
// =====================================================================
S.tabAset = S.tabAset || 'info';
export function renderDetailAset(el, id) {
  if (belumSiapAset(el)) return;
  const a = asetDari(id);
  const kembali = h('a', {href: '#aset', class: 'kecil'}, '← Daftar aset');
  if (!a) { el.append(h('div', {class: 'kepala'}, kembali, h('h1', null, 'Aset tidak ditemukan'), h('p', {class: 'redup'}, 'Data ini mungkin sudah dihapus.'))); return; }
  const aktif = a.status === 'Aktif';
  el.append(h('div', {class: 'kepala'}, kembali,
    h('div', {class: 'judul-baris'}, h('h1', null, a.kode + ' · ' + a.nama), pill(a.status), aktif && pill(a.kondisi), h('span', {class: 'pegas'}),
      h('button', {class: 'btn', type: 'button', onclick: () => bukaFormAset(a)}, bisa() ? 'Ubah' : 'Lihat isian'),
      bisa() && aktif && h('button', {class: 'btn', type: 'button', onclick: () => bukaFormServis(a, null)}, '+ Servis'),
      bisa() && h('button', {class: 'btn', type: 'button', onclick: () => bukaFormDokumen(a, null)}, '+ Dokumen')),
    h('p', {class: 'redup'}, [a.kategori_nama, 'diperoleh ' + tgl(a.tgl_perolehan), CARA_PEROLEHAN[a.cara], a.pemegang_nama && 'dipegang ' + a.pemegang_nama, a.lokasi_nama].filter(Boolean).join(' · '))));
  if (a.peringatan.length) el.append(h('div', {class: 'kotak-galat'}, 'Peringatan: ' + a.peringatan.map(teksPeringatan).join(' · ')));
  el.append(h('section', {class: 'ubin-grid', 'aria-label': 'Nilai aset'},
    ubin('Nilai perolehan', rp(a.perolehan_pada || (aktif ? a.nilai_perolehan : hitungPelepasan(a, a.kat, a.servis)?.perolehan)), a.ppn_kredit ? 'PPN ' + rp(a.ppn) + ' dikreditkan' : a.ppn ? 'termasuk PPN ' + rp(a.ppn) : 'tanpa PPN'),
    ubin('Akumulasi ' + istilah(a).toLowerCase(), rp(aktif ? a.akumulasi : a.akumulasi_lepas), aktif ? 'per hari ini' : 'sampai bulan sebelum pelepasan'),
    ubin('Nilai buku', rp(aktif ? a.buku : a.nilai_buku_lepas), aktif ? 'per hari ini' : 'saat dilepas'),
    !aktif && ubin(a.laba_lepas >= 0 ? 'Laba pelepasan' : 'Rugi pelepasan', rp(Math.abs(a.laba_lepas || 0)), a.status + ' ' + tgl(a.tgl_pelepasan), {buruk: a.laba_lepas < 0})));
  const TAB = [['info', 'Informasi'], ['nilai', 'Nilai & penyusutan'], ['mutasi', 'Mutasi'], ['servis', 'Servis'], ['dokumen', 'Dokumen'], ['lepas', 'Pelepasan']];
  if (!TAB.some(([k]) => k === S.tabAset)) S.tabAset = 'info';
  const panel = h('div', {class: 'kartu', role: 'tabpanel'});
  el.append(h('div', {class: 'tabs', role: 'tablist'}, TAB.map(([k, label]) => h('button', {class: 'tab', type: 'button', role: 'tab', 'aria-selected': String(S.tabAset === k),
    onclick: () => { S.tabAset = k; S.render(); }}, label + (k === 'servis' && a.servis.length ? ' (' + a.servis.length + ')' : k === 'dokumen' && a.dokumen.length ? ' (' + a.dokumen.length + ')' : '')))), panel);
  panel.append(...[].concat({info: tabInfo, nilai: tabNilai, mutasi: tabMutasi, servis: tabServis, dokumen: tabDokumen, lepas: tabLepas}[S.tabAset](a)).flat(3).filter(Boolean));
}

function tabInfo(a) {
  const kat = a.kat, servisId = new Set(a.servis.map((s) => s.id));
  const jurnal = daftarJurnal(K()).filter((j) => (['aset', 'pelepasan_aset'].includes(j.sumber) && j.sumber_id === a.id) || (j.sumber === 'servis_aset' && servisId.has(j.sumber_id)));
  const berkas = (daftar) => (daftar?.length ? h('div', {class: 'baris-tombol'}, daftar.map((b) => tombolBukti(b))) : '—');
  return [
    h('h3', null, 'Identitas'),
    rincian([['Kode', a.kode], ['Nama', a.nama], ['Kategori', a.kategori_nama + ' · ' + JENIS_KATEGORI[a.jenis_kategori]], ['No. seri / plat / lisensi', a.no_seri],
      ['Supplier', a.supplier_nama], ['Faktur / nota', berkas(a.faktur)], ['Foto', berkas(a.foto)]]),
    h('h3', null, 'Nilai perolehan'),
    rincian([['Tanggal perolehan', tgl(a.tgl_perolehan)], ['Harga sebelum PPN', rp(a.harga)], ['PPN', a.ppn ? rp(a.ppn) + (a.ppn_kredit ? ' (dikreditkan, tidak masuk nilai)' : ' (masuk nilai perolehan)') : '—'],
      ['Biaya tambahan', a.biaya_tambahan ? rp(a.biaya_tambahan) : '—'], ['Diskon', a.diskon ? rp(a.diskon) : '—'], ['Nilai perolehan', h('b', null, rp(a.nilai_perolehan))],
      a.di_bawah_batas && ['Catatan', 'Di bawah batas kapitalisasi, tetap dicatat sebagai aset'],
      ['Cara perolehan', CARA_PEROLEHAN[a.cara] + (a.cara === 'tunai' ? ' dari ' + namaRekening(a.rekening_id) : ' · Hutang aset (2-8) ' + rp(totalBayar(a)))],
      a.cara !== 'tunai' && ['Tautan hutang', a.hutang_id ? 'Tertaut' : pill('Menunggu tautan hutang')]]),
    h('h3', null, istilah(a) + ' komersial'),
    kat?.disusutkan ? rincian([['Mulai digunakan', tgl(a.tgl_mulai)], ['Umur ekonomis', tahunTeks(a.umur_bulan)], ['Nilai residu', rp(a.residu)], ['Metode', 'Garis lurus, bulanan'],
      ['Akun', nmAkun(kat.akun_aset_id) + ' · akumulasi ' + nmAkun(kat.akun_akumulasi_id) + ' · beban ' + nmAkun(kat.akun_beban_id)]])
      : h('p', {class: 'redup'}, 'Kategori ' + a.kategori_nama + ' tidak disusutkan.'),
    h('h3', null, 'Fiskal (buku pajak)'),
    kat?.disusutkan ? rincian([['Kelompok', a.kelompok ? a.kelompok.nama + ' · ' + a.kelompok.masa_tahun + ' tahun' : pill('Belum diisi')], ['Mulai penyusutan fiskal', namaBulan(a.bulan_fiskal)],
      ['Metode', a.kelompok && a.kelompok.tarif_sm_bp == null ? 'Garis lurus (bangunan selalu garis lurus)' : METODE_FISKAL[metode()] + ' (Pengaturan → Aset)']])
      : h('p', {class: 'redup'}, 'Tidak disusutkan secara fiskal.'),
    h('h3', null, 'Penempatan & kondisi'),
    rincian([['Pemegang', a.pemegang_nama], ['Lokasi', a.lokasi_nama], ['Kondisi', pill(a.kondisi)], ['Status', pill(a.status)], ['Catatan', a.catatan]]),
    h('h3', null, 'Jurnal'),
    tabel(['No.', 'Tanggal', 'Uraian', 'Jumlah'], jurnal.length ? jurnal.map((j) => h('tr', {class: 'bisa-klik', tabindex: '0', onclick: () => bukaFormJurnal(j)},
      td(j.no), h('td', {class: 'nw'}, tgl(j.tanggal)), td(j.uraian), td(rp(j.baris.reduce((s, b) => s + (+b.debit || 0), 0)), 1))) : [baris0(4, 'Belum ada jurnal.')], [3]),
    h('p', {class: 'kecil redup'}, 'Jurnal penyusutan bulanan digabung untuk semua aset (lihat tab Nilai & penyusutan dan menu Jurnal).'),
  ];
}

function tabNilai(a) {
  const kat = a.kat;
  if (!kat?.disusutkan) return h('p', null, 'Kategori ' + a.kategori_nama + ' tidak disusutkan, jadi nilai bukunya tetap sebesar nilai perolehan.');
  const jadwal = jadwalKomersial(a, kat, a.servis);
  const fis = hitungFiskal(a, kat, a.servis, a.kelompok, metode());
  const fisBulan = new Map((fis?.bulanan || []).map((x) => [x.bulan, x.susut]));
  const bulanPb = new Map(K().penyusutan_bulan.map((b) => [b.id, b.bulan]));
  const dibukukan = new Map(K().penyusutan_aset.filter((x) => x.aset_id === a.id).map((x) => [bulanPb.get(x.bulan_id), x.jumlah]));
  const bulanIni = bulanKe(idxBulan(hariIni()));
  const semuaBulan = [...new Set([...jadwal.map((r) => r.bulan), ...fisBulan.keys()])].sort();
  const kom = new Map(jadwal.map((r) => [r.bulan, r]));
  const akhir = bulanAkhirSusut(a, kat, a.servis);
  return [
    h('p', null, istilah(a) + ' komersial garis lurus: (nilai perolehan − residu) ÷ umur, mulai bulan ' + namaBulan(a.tgl_mulai) + ' sampai ' + (akhir != null ? namaBulan(bulanKe(akhir)) : '—') + '.',
      a.servis.some((s) => s.kapitalisasi) ? ' Servis yang dikapitalisasi menambah nilai dan disusutkan ulang mulai bulan berikutnya selama sisa umur baru.' : '',
      a.status !== 'Aktif' ? ' Bulan pelepasan tidak disusutkan.' : ''),
    h('h3', null, 'Jadwal bulanan'),
    h('div', {class: 'gulir gulir-pendek'}, h('table', {class: 'tabel'},
      h('thead', null, h('tr', null, ['Bulan', istilah(a) + ' komersial', 'Akumulasi', 'Nilai buku', 'Fiskal', 'Jurnal'].map((x, i) => h('th', {class: i && i < 5 ? 'kanan' : null}, x)))),
      h('tbody', null, semuaBulan.length ? semuaBulan.map((b) => {
        const r = kom.get(b), j = dibukukan.get(b);
        const st = j != null ? (j === r?.susut ? pill('Dibukukan') : h('span', {class: 'pill pill-waspada', title: 'Termasuk susulan bulan yang sudah ditutup / koreksi'}, 'Dibukukan ' + rp(j)))
          : !r?.susut || b > bulanIni ? '—' : terkunci(K(), b) ? h('span', {class: 'pill pill-netral', title: 'Bulan sudah ditutup; penyusutannya dibukukan sekaligus di bulan terbuka pertama'}, 'Disusulkan')
            : h('span', {class: 'pill pill-waspada'}, 'Belum');
        return h('tr', {class: b === bulanIni ? 'baris-sorot' : null}, td(namaBulan(b)), td(r ? rp(r.susut) : '—', 1), td(r ? rp(r.akumulasi) : '—', 1), td(r ? rp(r.buku) : '—', 1), td(fisBulan.has(b) ? rp(fisBulan.get(b)) : '—', 1), td(st));
      }) : baris0(6, 'Isi tanggal mulai digunakan dan umur ekonomis.')))),
    h('h3', null, 'Fiskal per tahun'),
    !a.kelompok ? h('p', {class: 'kotak-info'}, 'Kelompok fiskal belum diisi. Pilih kelompok di formulir aset (Ubah → Fiskal) agar penyusutan pajak bisa dihitung.')
      : [h('p', {class: 'kecil redup'}, a.kelompok.nama + ' · masa ' + a.kelompok.masa_tahun + ' tahun · ' + METODE_FISKAL[fis.metode] + ' ' + idn(bpKePersen(fis.tarif_bp), 2) + '% per tahun · mulai ' + namaBulan(a.bulan_fiskal)
          + '. Tahun pertama dihitung proporsional jumlah bulan; tahun terakhir masa manfaat: sisa disusutkan sekaligus.'),
        tabel(['Tahun', 'Bulan', 'Nilai sisa awal', 'Penyusutan fiskal', 'Nilai sisa akhir', 'Tambahan (servis)'], fis.tahun.map((x) => h('tr', null,
          td(String(x.tahun)), td(String(x.bulan), 1), td(rp(x.nsb_awal), 1), td(rp(x.susut), 1), td(rp(x.nsb_akhir), 1), td(x.tambahan ? rp(x.tambahan) : '—', 1))), [1, 2, 3, 4, 5]),
        fis.lepas && h('p', {class: 'kecil'}, 'Saat dilepas: nilai sisa buku fiskal ' + rp(fis.lepas.nsb) + ', ' + (fis.lepas.laba >= 0 ? 'laba' : 'rugi') + ' fiskal ' + rp(Math.abs(fis.lepas.laba)) + '.')],
  ];
}

function tabMutasi(a) {
  return [h('p', {class: 'kecil redup'}, 'Riwayat pemegang dan lokasi. Mutasi baru dicatat otomatis saat pemegang atau lokasi diubah lewat tombol Ubah.'),
    tabel(['Tanggal', 'Pemegang', 'Lokasi', 'Catatan'], a.mutasi.length ? a.mutasi.map((m) => h('tr', null, h('td', {class: 'nw'}, tgl(m.tanggal)),
      td((m.dari_pemegang || m.ke_pemegang) ? isi(m.dari_pemegang) + ' → ' + isi(m.ke_pemegang) : '—'), td((m.dari_lokasi || m.ke_lokasi) ? isi(m.dari_lokasi) + ' → ' + isi(m.ke_lokasi) : '—'), h('td', {class: 'lebar'}, isi(m.catatan))))
      : [baris0(4, 'Belum ada mutasi.')])];
}

function tabServis(a) {
  return [h('div', {class: 'alat'}, h('span', {class: 'kecil redup'}, 'Servis biasa dibebankan ke 6-5 Pemeliharaan. Servis besar (minimal batas kapitalisasi) bisa dikapitalisasi: menambah nilai aset dan disusutkan ulang.'),
    h('span', {class: 'pegas'}), bisa() && a.status === 'Aktif' && h('button', {class: 'btn btn-kecil btn-utama', type: 'button', onclick: () => bukaFormServis(a, null)}, '+ Servis')),
  tabel(['Tanggal', 'Uraian', 'Vendor / bengkel', 'Biaya', 'Perlakuan', 'Nota', ''], a.servis.length ? a.servis.slice().reverse().map((s) => h('tr', null,
    h('td', {class: 'nw'}, tgl(s.tanggal), terkunci(K(), s.tanggal) && ' 🔒'), h('td', {class: 'lebar'}, s.uraian), td(isi(s.vendor_nama)), td(rp(s.biaya), 1),
    td(s.kapitalisasi ? 'Dikapitalisasi' + (s.sisa_umur_bulan ? ' · sisa umur ' + s.sisa_umur_bulan + ' bln' : '') : s.biaya ? 'Beban 6-5' : '—'), td(tombolBukti(s.nota)),
    td(h('button', {class: 'btn btn-kecil', type: 'button', onclick: () => bukaFormServis(a, s)}, bisa() ? 'Ubah' : 'Lihat')))) : [baris0(7, 'Belum ada servis.')], [3])];
}

function tabDokumen(a) {
  const terbaru = new Set(a.peringatan.filter((p) => p.dokumen).map((p) => p.dokumen.id));
  return [h('div', {class: 'alat'}, h('span', {class: 'kecil redup'}, 'Pajak tahunan, STNK, lisensi, garansi, asuransi. Pengingat muncul di lonceng 🔔 sesuai Pengaturan → Notifikasi (dokumen terbaru per jenis).'),
    h('span', {class: 'pegas'}), bisa() && h('button', {class: 'btn btn-kecil btn-utama', type: 'button', onclick: () => bukaFormDokumen(a, null)}, '+ Dokumen')),
  tabel(['Jenis', 'Berlaku s.d.', 'File', 'Catatan', ''], a.dokumen.length ? a.dokumen.map((d) => h('tr', null, td(d.jenis),
    h('td', {class: 'nw'}, tgl(d.berlaku_sd), terbaru.has(d.id) && ' ', terbaru.has(d.id) && h('span', {class: 'pill pill-buruk'}, d.berlaku_sd < hariIni() ? 'Habis' : 'Segera habis')),
    td(tombolBukti(d.file)), h('td', {class: 'lebar'}, isi(d.catatan)),
    td(h('button', {class: 'btn btn-kecil', type: 'button', onclick: () => bukaFormDokumen(a, d)}, bisa() ? 'Ubah' : 'Lihat')))) : [baris0(5, 'Belum ada dokumen.')])];
}

function tabLepas(a) {
  if (a.status === 'Aktif') {
    return [h('p', null, 'Aset ini masih aktif. Untuk mencatat aset dijual, dihapuskan (rusak / dibuang), atau hilang, klik tombol di bawah lalu isi bagian "Kondisi & status".'),
      h('p', {class: 'kecil redup'}, 'Saat dilepas: penyusutan berhenti (bulan pelepasan tidak disusutkan), aset keluar dari daftar aktif, dan selisih nilai jual dengan nilai buku dicatat sebagai laba (4-4) atau rugi (7-2).'),
      bisa() && h('button', {class: 'btn btn-utama', type: 'button', onclick: () => bukaFormAset(a, {lepas: true})}, 'Lepaskan aset…')];
  }
  const lp = hitungPelepasan(a, a.kat, a.servis);
  return rincian([['Status', pill(a.status)], ['Tanggal pelepasan', tgl(a.tgl_pelepasan)], ['Alasan', a.alasan_pelepasan],
    ['Nilai perolehan', rp(lp?.perolehan)], ['Akumulasi ' + istilah(a).toLowerCase(), rp(a.akumulasi_lepas)], ['Nilai buku saat dilepas', rp(a.nilai_buku_lepas)],
    ['Nilai jual', a.nilai_jual ? rp(a.nilai_jual) + ' ke ' + namaRekening(a.rekening_jual_id) : 'Rp 0'],
    [a.laba_lepas >= 0 ? 'Laba pelepasan (4-4)' : 'Rugi pelepasan (7-2)', h('b', null, rp(Math.abs(a.laba_lepas || 0)))]]);
}

// =====================================================================
// Berkas banyak (faktur, foto)
// =====================================================================
function pilihBerkas(id, lama, label, {gambar = false} = {}) {
  const TIPE = gambar ? ['image/jpeg', 'image/png'] : ['application/pdf', 'image/jpeg', 'image/png'];
  const simpan = (lama || []).slice();
  const daftar = h('div', {class: 'baris-tombol'});
  const ket = h('span', {class: 'kecil redup'}, (gambar ? 'JPG atau PNG' : 'PDF, JPG, atau PNG') + ', boleh lebih dari satu, maksimal ' + ukuranFile(batasUnggah()) + ' per file.');
  const inp = h('input', {id, type: 'file', multiple: true, accept: gambar ? '.jpg,.jpeg,.png,image/jpeg,image/png' : '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png'});
  const gambarDaftar = () => daftar.replaceChildren(...simpan.map((b, i) => h('span', {class: 'baris-tombol'}, tombolBukti(b), h('span', {class: 'kecil'}, b.nama),
    h('button', {class: 'btn btn-kecil', type: 'button', onclick: () => { simpan.splice(i, 1); gambarDaftar(); }}, 'Lepas'))));
  gambarDaftar();
  inp.addEventListener('change', () => {
    ket.classList.remove('form-galat');
    const salah = [...inp.files].find((f) => !TIPE.includes(f.type) || f.size > batasUnggah());
    if (salah) {
      ket.textContent = salah.name + ': ' + (!TIPE.includes(salah.type) ? (gambar ? 'hanya JPG atau PNG.' : 'hanya PDF, JPG, atau PNG.') : 'terlalu besar (' + ukuranFile(salah.size) + ').');
      ket.classList.add('form-galat'); inp.value = '';
    } else ket.textContent = [...inp.files].map((f) => f.name).join(', ');
  });
  return {
    el: h('div', {class: 'medan medan-lebar'}, h('label', {for: id}, label), daftar, inp, ket),
    async ambil(folder) {
      const baru = [];
      for (const f of inp.files) {
        const path = folder + '/' + idBaru() + '-' + f.name.replace(/[^\w.-]+/g, '_');
        await store.unggah(path, f, BUCKET_BUKTI);
        baru.push({path, nama: f.name, ukuran: f.size, tipe: f.type});
      }
      return simpan.concat(baru);
    },
  };
}

// Konfirmasi nilai di bawah batas kapitalisasi. true = tetap simpan sebagai aset.
function konfirmasiBatas(nilai, batas) {
  return new Promise((ok) => {
    let jawab = false;
    const dlg = dialog('Di bawah batas kapitalisasi', h('div', {class: 'form'},
      h('p', null, 'Nilai perolehan ', h('b', null, rp(nilai)), ' di bawah batas kapitalisasi ', h('b', null, rp(batas)), ' (Pengaturan → Akuntansi).'),
      h('p', null, 'Sebaiknya dicatat sebagai biaya (OPEX) lewat Kas & Bank → Kas umum, dan centang "Barang modal di bawah batas kapitalisasi" agar masuk Laporan Pajak.'),
      kaki(h('span', {class: 'pegas'}), h('button', {class: 'btn', type: 'button', onclick: () => dlg.close()}, 'Batal'),
        h('button', {class: 'btn btn-utama', type: 'button', onclick: () => { jawab = true; dlg.close(); }}, 'Tetap simpan sebagai aset'))));
    dlg.addEventListener('close', () => ok(jawab));
  });
}

// =====================================================================
// Formulir aset
// =====================================================================
export function bukaFormAset(lama, {lepas = false} = {}) {
  const x = lama || {};
  const boleh = bisa();
  const kunciBeli = !!lama && terkunci(K(), lama.tgl_perolehan);
  const sudahLepas = !!lama && lama.status !== 'Aktif';
  const galat = h('p', {class: 'form-galat', role: 'alert'});
  // 1. Identitas
  const nama = teks('as-nama', x.nama, {required: true, placeholder: 'mis. Toyota Avanza 2024 / Laptop Lenovo ThinkPad'});
  const katPilih = K().aset_kategori.filter((k) => k.aktif || k.id === x.kategori_id).sort(urutUrut);
  const kat = pilihan('as-kat', [['', 'Pilih kategori…'], ...katPilih.map((k) => [k.id, k.nama + ' (' + k.prefix + ')'])], x.kategori_id || '', {required: true});
  const kodeEl = h('input', {id: 'as-kode', type: 'text', readonly: true, value: x.kode || '', class: 'angka-pendek'});
  const seri = teks('as-seri', x.no_seri, {placeholder: 'No. seri / plat nomor / kunci lisensi'});
  const supplier = pilihCari('as-sup', opsiSupplier(x.supplier_id), x.supplier_id || '', {label: 'Cari supplier', placeholder: 'Ketik nama supplier (opsional)', kosongTeks: 'Tidak ada. Tambahkan dulu di menu Supplier.'});
  const faktur = pilihBerkas('as-faktur', x.faktur, 'Faktur / nota pembelian');
  const foto = pilihBerkas('as-foto', x.foto, 'Foto aset', {gambar: true});
  // 2. Nilai perolehan
  const tglP = tanggal('as-tgl', x.tgl_perolehan || hariIni(), {required: true});
  const harga = uang('as-harga', x.harga ?? '');
  const ppn = uang('as-ppn', x.ppn || '');
  const kredit = centang('as-kredit', x.ppn_kredit, 'PPN masukan dapat dikreditkan');
  const kreditInp = kredit.querySelector('input');
  let kreditDiubah = !!lama;
  kreditInp.addEventListener('change', () => { kreditDiubah = true; });
  const bt = uang('as-bt', x.biaya_tambahan || '');
  const diskon = uang('as-diskon', x.diskon || '');
  const nilaiBox = h('div', {class: 'kotak-info'}), pkpInfo = h('span', {class: 'kecil redup'}), batasBox = h('div', {class: 'kotak-galat'});
  // 3. Cara perolehan
  const cara = pilihan('as-cara', Object.entries(CARA_PEROLEHAN), x.cara || 'tunai');
  const rekDaftar = rekAktif(x.rekening_id);
  const rek = pilihan('as-rek', [['', 'Pilih rekening…'], ...rekDaftar], x.rekening_id || (rekDaftar.length === 1 ? rekDaftar[0][0] : ''));
  const mRek = medan('Dibayar dari rekening', rek, {wajib: true});
  const caraInfo = h('p', {class: 'kecil redup medan-lebar'});
  // 4. Penyusutan komersial
  const mulai = tanggal('as-mulai', x.tgl_mulai || '');
  let mulaiDiubah = !!x.tgl_mulai;
  mulai.addEventListener('change', () => { mulaiDiubah = true; });
  const umur = h('input', {id: 'as-umur', type: 'text', inputmode: 'decimal', class: 'angka-pendek', autocomplete: 'off', value: x.umur_bulan ? String(bulanKeTahun(x.umur_bulan)).replace('.', ',') : ''});
  let umurDiubah = !!x.umur_bulan;
  umur.addEventListener('input', () => { umurDiubah = true; });
  const residu = uang('as-residu', x.residu || '');
  const susutInfo = h('div', {class: 'kotak-info kecil medan-lebar'});
  const judulSusut = h('h3', null, '4. Penyusutan komersial');
  const bagSusut = h('div', {class: 'form-grid'}, medan('Tanggal mulai digunakan', mulai, {wajib: true, bantuan: 'Penyusutan mulai bulan ini (sebulan penuh).'}),
    medan('Umur ekonomis', h('div', {class: 'berakhiran'}, umur, h('span', null, 'tahun')), {wajib: true, id: 'as-umur', bantuan: 'Boleh desimal, mis. 2,5. Bawaan dari kategori.'}),
    medan('Nilai residu', residu.el, {id: 'as-residu', bantuan: 'Perkiraan nilai di akhir umur; biasanya 0.'}), susutInfo);
  const tanpaSusut = h('p', {class: 'redup'});
  // 5. Fiskal
  const kelPilih = K().kelompok_fiskal.filter((k) => k.aktif || k.id === x.kelompok_id).sort(urutUrut);
  const kel = pilihan('as-kel', [['', 'Belum dipilih'], ...kelPilih.map((k) => [k.id, k.nama + ' · ' + k.masa_tahun + ' tahun'])], x.kelompok_id || '');
  let kelDiubah = !!x.kelompok_id;
  kel.addEventListener('change', () => { kelDiubah = true; });
  const blnF = h('input', {id: 'as-blnf', type: 'month', value: (x.bulan_fiskal || '').slice(0, 7)});
  let blnFDiubah = !!x.bulan_fiskal && x.bulan_fiskal.slice(0, 7) !== String(x.tgl_perolehan || '').slice(0, 7);
  blnF.addEventListener('change', () => { blnFDiubah = true; });
  const fisInfo = h('div', {class: 'kotak-info kecil medan-lebar'});
  const judulFis = h('h3', null, '5. Fiskal (buku pajak)');
  const bagFis = h('div', {class: 'form-grid'}, medan('Kelompok harta', kel, {bantuan: 'Menentukan masa manfaat dan tarif pajak. Bawaan dari kategori.'}),
    medan('Mulai penyusutan fiskal', blnF, {bantuan: 'Bulan perolehan, atau bulan mulai digunakan / menghasilkan.'}), fisInfo);
  // 6. Penempatan
  const pem = pilihCari('as-pem', opsiSdm(x.pemegang_id), x.pemegang_id || '', {label: 'Cari pegawai', placeholder: 'Ketik nama pegawai (opsional)', kosongTeks: 'Tidak ada di data SDM.'});
  const pemId = pem.querySelector('input[type=hidden]');
  const lokPilih = K().aset_lokasi.filter((l) => l.aktif || l.id === x.lokasi_id).sort((a, b) => bandingkan(a.nama, b.nama));
  const lok = pilihan('as-lok', [['', '—'], ...lokPilih.map((l) => [l.id, l.nama])], x.lokasi_id || '');
  const tglMut = tanggal('as-tglmut', hariIni());
  const catMut = teks('as-catmut', '', {placeholder: 'mis. Serah terima ke site Ubud'});
  const bagMut = h('div', {class: 'form-grid medan-lebar'}, medan('Tanggal mutasi', tglMut), medan('Catatan mutasi', catMut));
  // 7. Kondisi & status
  const kondisi = pilihan('as-kondisi', KONDISI_ASET.map((k) => [k, k]), x.kondisi || 'Baik');
  const status = pilihan('as-status', STATUS_ASET.map((k) => [k, k === 'Aktif' ? 'Aktif (dimiliki)' : k]), lepas ? 'Dijual' : x.status || 'Aktif');
  const tglLepas = tanggal('as-tgllepas', x.tgl_pelepasan || hariIni());
  const jual = uang('as-jual', x.nilai_jual || '');
  const rekJualDaftar = rekAktif(x.rekening_jual_id);
  const rekJual = pilihan('as-rekjual', [['', 'Pilih rekening…'], ...rekJualDaftar], x.rekening_jual_id || (rekJualDaftar.length === 1 ? rekJualDaftar[0][0] : ''));
  const alasan = teks('as-alasan', x.alasan_pelepasan, {placeholder: 'mis. Dijual karena diganti unit baru / rusak berat / hilang di lokasi proyek'});
  const mJual = medan('Nilai jual', jual.el, {wajib: true, id: 'as-jual'}), mRekJual = medan('Diterima di rekening', rekJual, {wajib: true});
  const lepasInfo = h('div', {class: 'kotak-info kecil medan-lebar'});
  const bagLepas = h('div', {class: 'form-grid medan-lebar'}, medan('Tanggal pelepasan', tglLepas, {wajib: true}), mJual, mRekJual,
    medan('Alasan', alasan, {wajib: true, lebar: true}), lepasInfo);
  const catatan = h('textarea', {id: 'as-catatan', rows: '2'}, x.catatan ?? '');

  const katSek = () => katDari(kat.value);
  const umurBulan = () => { const s = umur.value.trim().replace(',', '.'); return s === '' ? null : /^\d+(\.\d+)?$/.test(s) ? tahunKeBulan(+s) : NaN; };
  const baca = () => ({nama: nama.value.trim(), kategori_id: kat.value || null, no_seri: seri.value.trim() || null, supplier_id: supplier.querySelector('input[type=hidden]').value || null,
    tgl_perolehan: tglP.value || null, harga: harga.nilai(), ppn: ppn.nilai() || 0, ppn_kredit: kreditInp.checked && !kreditInp.disabled && (ppn.nilai() || 0) > 0,
    biaya_tambahan: bt.nilai() || 0, diskon: diskon.nilai() || 0, cara: cara.value, rekening_id: cara.value === 'tunai' ? rek.value || null : null,
    tgl_mulai: katSek()?.disusutkan ? mulai.value || null : null, umur_bulan: katSek()?.disusutkan ? umurBulan() : null, residu: katSek()?.disusutkan ? residu.nilai() || 0 : 0,
    kelompok_id: katSek()?.disusutkan ? kel.value || null : null, bulan_fiskal: blnF.value ? blnF.value + '-01' : tglP.value || null,
    pemegang_id: pemId.value || null, lokasi_id: lok.value || null, tgl_mutasi: tglMut.value || null, catatan_mutasi: catMut.value.trim() || null,
    kondisi: kondisi.value, status: status.value, tgl_pelepasan: status.value !== 'Aktif' ? tglLepas.value || null : null,
    nilai_jual: status.value === 'Dijual' ? jual.nilai() : 0, rekening_jual_id: status.value === 'Dijual' && (jual.nilai() || 0) > 0 ? rekJual.value || null : null,
    alasan_pelepasan: status.value !== 'Aktif' ? alasan.value.trim() || null : null, catatan: catatan.value.trim() || null});

  const segar = (dariKategori) => {
    const k = katSek(), d = baca();
    // kode
    if (!lama) kodeEl.value = k ? kodeAsetBerikut(k.prefix, K().aset.map((a) => a.kode)) : '';
    else if (k && k.id !== lama.kategori_id) kodeEl.value = lama.kode + ' (tetap)';
    else kodeEl.value = lama.kode;
    // bawaan dari kategori
    if (dariKategori && k) {
      if (!umurDiubah) umur.value = k.umur_bulan ? String(bulanKeTahun(k.umur_bulan)).replace('.', ',') : '';
      if (!kelDiubah) kel.value = k.kelompok_id || '';
    }
    if (!mulaiDiubah) mulai.value = tglP.value;
    if (!blnFDiubah) blnF.value = (tglP.value || '').slice(0, 7);
    // PPN
    const pkp = pkpPada(K().perusahaan?.data || {}, tglP.value);
    kreditInp.disabled = !boleh || kunciBeli || !pkp || !(d.ppn > 0);
    if (!pkp) kreditInp.checked = false;
    else if (!kreditDiubah && !lama) kreditInp.checked = d.ppn > 0;
    pkpInfo.textContent = pkp ? 'Perusahaan PKP pada tanggal ini: PPN masukan bisa dikreditkan (tidak masuk nilai aset).' : 'Perusahaan belum PKP pada tanggal ini: PPN ikut menjadi nilai perolehan.';
    const dd = baca(), nilai = nilaiPerolehan(dd);
    nilaiBox.replaceChildren(h('div', null, 'Nilai perolehan: ', h('b', null, rp(nilai))),
      h('div', {class: 'kecil redup'}, 'Harga ' + rp(dd.harga || 0) + (dd.biaya_tambahan ? ' + biaya tambahan ' + rp(dd.biaya_tambahan) : '') + (dd.diskon ? ' − diskon ' + rp(dd.diskon) : '')
        + (dd.ppn ? (dd.ppn_kredit ? ' · PPN ' + rp(dd.ppn) + ' dikreditkan (masuk 1-4)' : ' + PPN ' + rp(dd.ppn)) : '') + ' · dibayar / dihutangkan ' + rp(totalBayar(dd))));
    const batas = batasKap();
    batasBox.hidden = !(nilai > 0 && nilai < batas);
    batasBox.textContent = 'Nilai perolehan di bawah batas kapitalisasi (' + rp(batas) + '). Sebaiknya dicatat sebagai biaya (OPEX) lewat Kas umum. Bila tetap disimpan, aplikasi meminta konfirmasi.';
    // cara
    mRek.hidden = cara.value !== 'tunai';
    caraInfo.textContent = cara.value === 'tunai' ? 'Jurnal: D akun aset / K rekening pembayar.' : 'Jurnal: D akun aset / K 2-8 Hutang aset. Status hutang: menunggu tautan hutang (fitur Hutang Lain menyusul di Tahap 6).';
    // penyusutan
    const susut = !!k?.disusutkan;
    judulSusut.textContent = '4. ' + (k?.jenis === 'tak_berwujud' ? 'Amortisasi' : 'Penyusutan') + ' komersial';
    [judulSusut, bagSusut, judulFis, bagFis].forEach((e) => { e.hidden = !k || !susut; });
    tanpaSusut.hidden = !k || susut;
    tanpaSusut.textContent = k ? '4–5. Penyusutan: kategori ' + k.nama + ' tidak disusutkan (komersial maupun fiskal); nilai bukunya tetap sebesar nilai perolehan.' : '';
    const servis = lama ? asetDari(lama.id)?.servis || [] : [];
    const contoh = {...dd, nilai_perolehan: nilai, status: 'Aktif', tgl_pelepasan: null};
    if (susut && dd.tgl_mulai && dd.umur_bulan > 0 && nilai > 0) {
      const X = idxBulan(dd.tgl_mulai), akhir = bulanAkhirSusut(contoh, k, servis);
      susutInfo.textContent = (k.jenis === 'tak_berwujud' ? 'Amortisasi' : 'Penyusutan') + ' ± ' + rp(susutBulan(contoh, k, servis, X)) + ' per bulan, mulai ' + namaBulan(bulanKe(X)) + ' sampai ' + namaBulan(bulanKe(akhir))
        + ' (' + tahunTeks(dd.umur_bulan) + '). Jurnal bulanan: D ' + nmAkun(k.akun_beban_id) + ' / K ' + nmAkun(k.akun_akumulasi_id) + '.';
    } else susutInfo.textContent = 'Isi tanggal mulai dan umur ekonomis untuk melihat penyusutan per bulan.';
    const kl = kelDari(kel.value);
    if (susut && kl && nilai > 0) {
      const fis = hitungFiskal({...contoh, kelompok_id: kl.id}, k, servis, kl, metode());
      fisInfo.textContent = METODE_FISKAL[fis.metode] + (kl.tarif_sm_bp == null ? ' (bangunan selalu garis lurus)' : '') + ', tarif ' + idn(bpKePersen(fis.tarif_bp), 2) + '% per tahun, masa ' + kl.masa_tahun + ' tahun. '
        + fis.tahun.slice(0, 3).map((t) => t.tahun + ': ' + rp(t.susut)).join(' · ') + (fis.tahun.length > 3 ? ' · …' : '');
    } else fisInfo.textContent = susut ? 'Pilih kelompok harta untuk menghitung penyusutan fiskal (Laporan Pajak).' : '';
    // mutasi
    bagMut.hidden = !lama || (pemId.value === (lama.pemegang_id || '') && lok.value === (lama.lokasi_id || ''));
    // pelepasan
    bagLepas.hidden = status.value === 'Aktif';
    mJual.hidden = mRekJual.hidden = status.value !== 'Dijual';
    if (status.value === 'Dijual') mRekJual.hidden = !((jual.nilai() || 0) > 0);
    if (status.value !== 'Aktif' && dd.tgl_pelepasan && nilai > 0) {
      const lp = hitungPelepasan({...contoh, status: status.value, tgl_pelepasan: dd.tgl_pelepasan, nilai_jual: dd.nilai_jual || 0}, k, servis);
      lepasInfo.replaceChildren(h('div', null, 'Nilai buku saat dilepas ', h('b', null, rp(lp.buku)), ' (perolehan ' + rp(lp.perolehan) + ' − akumulasi ' + rp(lp.akumulasi) + ' sampai ' + namaBulan(bulanKe(idxBulan(dd.tgl_pelepasan) - 1)) + ').'),
        h('div', null, lp.laba >= 0 ? 'Laba pelepasan ' : 'Rugi pelepasan ', h('b', null, rp(Math.abs(lp.laba))), lp.laba >= 0 ? ' → 4-4 Laba Pelepasan Aset.' : ' → 7-2 Beban lain-lain.'),
        h('div', {class: 'redup'}, 'Bulan pelepasan tidak disusutkan. Aset keluar dari daftar aktif.'));
    } else lepasInfo.replaceChildren();
  };
  kat.addEventListener('change', () => segar(true));
  [tglP, cara, kel, blnF, mulai, status, tglLepas, lok, rek].forEach((e) => e.addEventListener('change', () => segar()));
  [harga.inp, ppn.inp, bt.inp, diskon.inp, residu.inp, jual.inp, umur].forEach((e) => e.addEventListener('input', () => segar()));
  [kreditInp, pemId].forEach((e) => e.addEventListener('change', () => segar()));
  segar(!lama);

  const simpan = h('button', {class: 'btn btn-utama', type: 'button', onclick: aman(async () => {
    galat.textContent = '';
    const d = baca();
    if (!d.nama) { galat.textContent = 'Nama aset wajib diisi.'; nama.focus(); return; }
    if (!d.kategori_id) { galat.textContent = 'Kategori wajib dipilih.'; kat.focus(); return; }
    if (d.harga == null) { galat.textContent = 'Harga sebelum PPN wajib diisi.'; harga.inp.focus(); return; }
    if (Number.isNaN(d.umur_bulan)) { galat.textContent = 'Umur ekonomis ditulis dalam tahun, mis. 4 atau 2,5.'; umur.focus(); return; }
    if (d.status === 'Dijual' && d.nilai_jual == null) { galat.textContent = 'Nilai jual wajib diisi (boleh 0).'; jual.inp.focus(); return; }
    const nilai = nilaiPerolehan(d), batas = batasKap();
    d.tetap_aset = nilai < batas;
    if (nilai > 0 && nilai < batas && !lama?.di_bawah_batas && !(await konfirmasiBatas(nilai, batas))) return;
    try {
      const hasil = await sambilMenyimpan(simpan, async () => {
        d.faktur = await faktur.ambil('aset'); d.foto = await foto.ambil('aset');
        return store.keu.simpanAset(lama?.id, d);
      });
      const id = typeof hasil === 'string' ? hasil : hasil?.id || lama?.id;
      dlg.close();
      await bukukanOtomatis();
      if (!lama && id) location.hash = '#aset-' + id;
      await segarkanKeuangan();
      pesan(lama ? 'Aset tersimpan.' : 'Aset ' + (asetDari(id)?.kode || '') + ' tersimpan dan dijurnal otomatis.');
    } catch (e) { galat.textContent = e.message; }
  })}, 'Simpan');
  const hapus = lama && boleh && tombolHapus(async () => {
    try { await store.keu.hapusAset(lama.id); } catch (e) { galat.textContent = e.message; return; }
    dlg.close(); location.hash = '#aset'; await bukukanOtomatis(); await segarkanKeuangan(); pesan('Aset dihapus beserta jurnalnya.');
  });
  const dlg = dialogLebar(lama ? 'Aset ' + lama.kode : 'Aset baru', h('div', {class: 'form'},
    h('p', {class: 'kecil redup'}, 'Isi bertahap dari atas. Kode aset dibuat otomatis dari prefix kategori. Nilai perolehan, penyusutan, dan jurnal dihitung otomatis. Dokumen dan servis ditambahkan dari halaman detail setelah aset tersimpan.'),
    kunciBeli && h('div', {class: 'kotak-info'}, '🔒 Bulan perolehan ' + namaBulan(lama.tgl_perolehan) + ' sudah ditutup: nilai perolehan dan cara bayar tidak bisa diubah. Pemegang, lokasi, kondisi, dokumen, dan status masih bisa diubah.'),
    sudahLepas && h('div', {class: 'kotak-info'}, 'Aset ini sudah dilepas: nilai perolehan dan penyusutannya tidak bisa diubah. Ubah status ke Aktif dulu bila perlu koreksi.'),
    h('h3', null, '1. Identitas'),
    h('div', {class: 'form-grid'}, medan('Nama aset', nama, {wajib: true}), medan('Kategori', kat, {wajib: true}), medan('Kode aset', kodeEl, {bantuan: lama ? 'Kode tidak berubah.' : 'Otomatis, nomor pasti diberikan saat disimpan.'}),
      medan('No. seri / plat / lisensi', seri), medan('Supplier', supplier, {id: 'as-sup-cari'}), faktur.el, foto.el),
    h('h3', null, '2. Nilai perolehan'),
    h('div', {class: 'form-grid'}, medan('Tanggal perolehan', tglP, {wajib: true}), medan('Harga sebelum PPN', harga.el, {wajib: true, id: 'as-harga'}), medan('PPN', ppn.el, {id: 'as-ppn'}),
      h('div', {class: 'medan'}, kredit, pkpInfo), medan('Biaya tambahan', bt.el, {id: 'as-bt', bantuan: 'Ongkir, pemasangan, balik nama, dll.'}), medan('Diskon', diskon.el, {id: 'as-diskon'}),
      h('div', {class: 'medan medan-lebar'}, nilaiBox, batasBox)),
    h('h3', null, '3. Cara perolehan'),
    h('div', {class: 'form-grid'}, medan('Cara', cara, {wajib: true}), mRek, caraInfo),
    h('div', null, judulSusut, bagSusut, tanpaSusut),
    h('div', null, judulFis, bagFis),
    h('h3', null, '6. Penempatan'),
    h('div', {class: 'form-grid'}, medan('Pemegang', pem, {id: 'as-pem-cari', bantuan: 'Dari data SDM.'}), medan('Lokasi', lok, {bantuan: 'Daftar lokasi diatur di Pengaturan → Aset.'}), bagMut),
    h('h3', null, '7. Kondisi & status'),
    h('div', {class: 'form-grid'}, medan('Kondisi', kondisi), medan('Status', status, {bantuan: 'Dijual / Dihapuskan / Hilang = aset dilepas.'}), bagLepas),
    h('h3', null, '8–9. Dokumen & servis'),
    h('p', {class: 'kecil redup'}, lama ? 'Dokumen (pajak, STNK, lisensi, garansi, asuransi) dan riwayat servis dikelola di tab Dokumen dan Servis pada halaman aset ini.' : 'Setelah aset disimpan, tambahkan dokumen dan servis lewat tombol + Dokumen dan + Servis di halaman aset.'),
    medan('Catatan', catatan, {lebar: true}),
    galat,
    kaki(hapus, h('span', {class: 'pegas'}), h('button', {class: 'btn', type: 'button', onclick: () => dlg.close()}, boleh ? 'Batal' : 'Tutup'), boleh && simpan)));
  if (!boleh) dlg.querySelectorAll('input, select, textarea').forEach((e) => { e.disabled = true; });
  if (boleh && (kunciBeli || sudahLepas)) [tglP, harga.inp, ppn.inp, kreditInp, bt.inp, diskon.inp, cara, rek, kat].forEach((e) => { e.disabled = true; });
  if (boleh && sudahLepas) [mulai, umur, residu.inp].forEach((e) => { e.disabled = true; });
  if (lepas) status.focus();
}

// =====================================================================
// Formulir servis
// =====================================================================
export function bukaFormServis(a, lama) {
  const x = lama || {};
  const kunci = lama && terkunci(K(), lama.tanggal);
  const boleh = bisa() && !kunci;
  const galat = h('p', {class: 'form-galat', role: 'alert'});
  const tglEl = tanggal('sv-tgl', x.tanggal || hariIni(), {required: true});
  const uraian = teks('sv-uraian', x.uraian, {required: true, placeholder: 'mis. Ganti oli & tune up / Ganti mesin'});
  const biaya = uang('sv-biaya', x.biaya ?? '');
  const vendor = pilihCari('sv-ven', opsiSupplier(x.vendor_id), x.vendor_id || '', {label: 'Cari vendor', placeholder: 'Ketik nama bengkel / vendor (opsional)', kosongTeks: 'Tidak ada. Tambahkan dulu di menu Supplier.'});
  const nota = pilihBukti('sv-nota', x.nota, {label: 'Nota servis'});
  const rekDaftar = rekAktif(x.rekening_id);
  const rek = pilihan('sv-rek', [['', 'Pilih rekening…'], ...rekDaftar], x.rekening_id || (rekDaftar.length === 1 ? rekDaftar[0][0] : ''));
  const mRek = medan('Dibayar dari rekening', rek, {wajib: true});
  const kap = centang('sv-kap', x.kapitalisasi, 'Kapitalisasi (servis besar: menambah nilai aset)');
  const kapInp = kap.querySelector('input');
  const sisa = h('input', {id: 'sv-sisa', type: 'number', min: '1', max: '1200', step: '1', class: 'angka-pendek', value: x.sisa_umur_bulan ?? ''});
  let sisaDiubah = x.sisa_umur_bulan != null;
  sisa.addEventListener('input', () => { sisaDiubah = true; });
  const mSisa = medan('Sisa umur setelah servis', h('div', {class: 'berakhiran'}, sisa, h('span', null, 'bulan')), {wajib: true, id: 'sv-sisa', bantuan: 'Bawaan: sisa umur yang sedang berjalan.'});
  const baik = a.status === 'Aktif' && a.kondisi !== 'Baik' && !lama && centang('sv-baik', true, 'Ubah kondisi aset menjadi Baik setelah servis');
  const info = h('div', {class: 'kotak-info kecil medan-lebar'});
  const susut = a.kat?.disusutkan && a.umur_bulan;
  const segar = () => {
    const b = biaya.nilai() || 0, batas = batasKap();
    mRek.hidden = b <= 0;
    kapInp.disabled = !boleh || b < batas || a.status !== 'Aktif';
    if (b < batas) kapInp.checked = false;
    mSisa.hidden = !kapInp.checked || !susut;
    const lain = a.servis.filter((s) => s.id !== x.id);
    if (kapInp.checked && susut && !sisaDiubah && tglEl.value) sisa.value = String(Math.max(1, sisaUmurPada(a, a.kat, lain, tglEl.value) ?? 1));
    info.textContent = kapInp.checked
      ? 'Dikapitalisasi: D ' + nmAkun(a.kat?.akun_aset_id) + ' / K rekening. Nilai buku + biaya disusutkan ulang mulai bulan berikutnya selama sisa umur. Di buku pajak, biaya ditambahkan ke nilai sisa mulai tahun berikutnya.'
      : b > 0 ? 'Biaya biasa: D 6-5 Pemeliharaan / K rekening.' + (b >= batas ? ' Biaya mencapai batas kapitalisasi; centang Kapitalisasi bila servis menambah umur / kapasitas aset.' : '') : 'Tanpa biaya: hanya dicatat di riwayat servis.';
  };
  biaya.inp.addEventListener('input', segar);
  [kapInp, tglEl].forEach((e) => e.addEventListener('change', segar));
  segar();
  const simpan = h('button', {class: 'btn btn-utama', type: 'button', onclick: aman(async () => {
    galat.textContent = '';
    const d = {aset_id: a.id, tanggal: tglEl.value || null, uraian: uraian.value.trim(), biaya: biaya.nilai() || 0, vendor_id: vendor.querySelector('input[type=hidden]').value || null,
      rekening_id: (biaya.nilai() || 0) > 0 ? rek.value || null : null, kapitalisasi: kapInp.checked, sisa_umur_bulan: kapInp.checked && susut ? (sisa.value === '' ? null : +sisa.value) : null};
    if (!d.uraian) { galat.textContent = 'Uraian servis wajib diisi.'; uraian.focus(); return; }
    try {
      await sambilMenyimpan(simpan, async () => {
        d.nota = await nota.ambil('aset');
        await store.keu.simpanServisAset(lama?.id, d);
        if (baik && baik.querySelector('input').checked) await store.keu.simpanAset(a.id, {...dataAset(asetDari(a.id)), kondisi: 'Baik'});
      });
    } catch (e) { galat.textContent = e.message; return; }
    dlg.close(); S.tabAset = 'servis'; await bukukanOtomatis(); await segarkanKeuangan(); pesan('Servis tersimpan' + (d.biaya ? ' dan dijurnal.' : '.'));
  })}, 'Simpan');
  const hapus = lama && boleh && tombolHapus(async () => {
    try { await store.keu.hapusServisAset(lama.id); } catch (e) { galat.textContent = e.message; return; }
    dlg.close(); await bukukanOtomatis(); await segarkanKeuangan(); pesan('Servis dihapus beserta jurnalnya.');
  });
  const dlg = dialog((lama ? 'Servis' : 'Servis baru') + ' · ' + a.kode, h('div', {class: 'form'},
    kunci && catatanKunci(lama.tanggal),
    h('div', {class: 'form-grid'}, medan('Tanggal', tglEl, {wajib: true}), medan('Uraian', uraian, {wajib: true}), medan('Biaya', biaya.el, {id: 'sv-biaya', bantuan: 'Kosongkan / 0 bila gratis (garansi).'}),
      medan('Vendor / bengkel', vendor, {id: 'sv-ven-cari'}), mRek, h('div', {class: 'medan'}, kap), mSisa, nota.el, baik && h('div', {class: 'medan medan-lebar'}, baik), info),
    galat,
    kaki(hapus, h('span', {class: 'pegas'}), h('button', {class: 'btn', type: 'button', onclick: () => dlg.close()}, boleh ? 'Batal' : 'Tutup'), boleh && simpan)));
  if (!boleh) dlg.querySelectorAll('input, select, textarea').forEach((e) => { e.disabled = true; });
}

// =====================================================================
// Formulir dokumen
// =====================================================================
export function bukaFormDokumen(a, lama) {
  const x = lama || {};
  const boleh = bisa();
  const galat = h('p', {class: 'form-galat', role: 'alert'});
  const jenis = pilihan('dk-jenis', [['', 'Pilih jenis…'], ...JENIS_DOKUMEN_ASET.map((j) => [j, j])], x.jenis || '', {required: true});
  const berlaku = tanggal('dk-sd', x.berlaku_sd || '');
  const file = pilihBukti('dk-file', x.file, {label: 'File dokumen'});
  const catatan = teks('dk-catatan', x.catatan, {placeholder: 'mis. No. polis / No. STNK'});
  const simpan = h('button', {class: 'btn btn-utama', type: 'button', onclick: aman(async () => {
    galat.textContent = '';
    if (!jenis.value) { galat.textContent = 'Jenis dokumen wajib dipilih.'; jenis.focus(); return; }
    try {
      await sambilMenyimpan(simpan, async () => store.keu.simpanDokumenAset(lama?.id, {aset_id: a.id, jenis: jenis.value, berlaku_sd: berlaku.value || null, file: await file.ambil('aset'), catatan: catatan.value.trim() || null}));
    } catch (e) { galat.textContent = e.message; return; }
    dlg.close(); S.tabAset = 'dokumen'; await segarkanKeuangan(); pesan('Dokumen tersimpan.');
  })}, 'Simpan');
  const hapus = lama && boleh && tombolHapus(async () => {
    try { await store.keu.hapusDokumenAset(lama.id); } catch (e) { galat.textContent = e.message; return; }
    dlg.close(); await segarkanKeuangan(); pesan('Dokumen dihapus.');
  });
  const dlg = dialog((lama ? 'Dokumen' : 'Dokumen baru') + ' · ' + a.kode, h('div', {class: 'form'},
    h('div', {class: 'form-grid'}, medan('Jenis', jenis, {wajib: true}), medan('Berlaku s.d.', berlaku, {bantuan: 'Pengingat muncul sebelum tanggal ini. Perpanjangan: tambahkan dokumen baru dengan tanggal baru.'}),
      medan('Catatan', catatan, {lebar: true}), file.el),
    galat,
    kaki(hapus, h('span', {class: 'pegas'}), h('button', {class: 'btn', type: 'button', onclick: () => dlg.close()}, boleh ? 'Batal' : 'Tutup'), boleh && simpan)));
  if (!boleh) dlg.querySelectorAll('input, select, textarea').forEach((e) => { e.disabled = true; });
}

// =====================================================================
// Laporan Pajak
// =====================================================================
S.tahunPajak = S.tahunPajak || +hariIni().slice(0, 4);
S.tabPajak = S.tabPajak || 'daftar';
// (a) Daftar penyusutan fiskal tahun y.
export function daftarFiskal(y, K0 = K(), aset = S.d.aset, met = metode()) {
  return aset.filter((a) => a.kat?.disusutkan && a.tgl_perolehan <= y + '-12-31' && !(a.status !== 'Aktif' && a.tgl_pelepasan < y + '-01-01')).map((a) => {
    const fis = hitungFiskal(a, a.kat, a.servis, a.kelompok, met);
    const t = fis?.tahun.find((x) => x.tahun === y);
    const sebelum = fis ? fis.tahun.filter((x) => x.tahun < y) : [];
    const perolehan = a.nilai_perolehan + sebelum.reduce((s, x) => s + x.tambahan, 0);
    const akum = fis ? fis.tahun.filter((x) => x.tahun <= y).reduce((s, x) => s + x.susut, 0) : null;
    return {a, kode: a.kode, nama: a.nama, kategori: a.kategori_nama, kelompok: a.kelompok?.nama || null, bulan_perolehan: namaBulan(a.bulan_fiskal || a.tgl_perolehan),
      perolehan, metode: fis ? METODE_FISKAL[fis.metode] : null, tarif: fis ? idn(bpKePersen(fis.tarif_bp), 2) + '%' : null,
      nsb_awal: t ? t.nsb_awal : fis ? Math.max(0, perolehan - akum) : null, susut: t?.susut || 0, akumulasi: akum, nsb_akhir: t ? t.nsb_akhir + t.tambahan : fis ? Math.max(0, perolehan - akum) : null,
      ket: [!a.kelompok && 'Kelompok fiskal belum diisi', a.status !== 'Aktif' && +a.tgl_pelepasan.slice(0, 4) === y && a.status + ' ' + tgl(a.tgl_pelepasan), t?.tambahan && 'Servis dikapitalisasi ' + rp(t.tambahan) + ' (mulai tahun depan)'].filter(Boolean).join('; ')};
  });
}
// (c) Barang modal di bawah batas kapitalisasi (dibebankan).
export function barangModalBawahBatas(y, K0 = K()) {
  const akun = (id) => { const a = K0.akun.find((x) => x.id === id); return a ? a.kode + ' ' + a.nama : ''; };
  const kas = (K0.kas_transaksi || []).filter((k) => k.barang_modal && k.tanggal?.startsWith(String(y))).map((k) => ({tanggal: k.tanggal, sumber: 'Kas umum', uraian: k.uraian, pihak: k.pihak, akun: akun(k.akun_id), jumlah: k.jumlah}));
  const beli = (S.d.pembelian || []).filter((b) => b.barang_modal && b.tanggal?.startsWith(String(y))).map((b) => ({tanggal: b.tanggal, sumber: 'Pembelian stok kantor', uraian: (b.no_nota ? b.no_nota + ' · ' : '') + b.baris.map((x) => x.barang_nama).join(', '),
    pihak: b.supplier_nama, akun: '1-6 Persediaan', jumlah: b.biaya ?? b.total}));
  return kas.concat(beli).sort((a, b) => a.tanggal.localeCompare(b.tanggal));
}
export function renderLaporanPajak(el) {
  el.append(h('div', {class: 'kepala'}, h('a', {href: '#aset', class: 'kecil'}, '← Daftar aset'), h('h1', null, 'Laporan Pajak · Aset'),
    h('p', {class: 'redup'}, 'Buku pajak (fiskal) dihitung paralel dari buku komersial dan tidak membuat jurnal. Tahun pajak = tahun kalender.')));
  if (belumSiapAset(el)) return;
  const y = S.tahunPajak;
  const tahunAda = [...new Set([+hariIni().slice(0, 4), ...S.d.aset.map((a) => +a.tgl_perolehan.slice(0, 4))])];
  const tahunPilih = [];
  for (let t = Math.max(...tahunAda); t >= Math.min(...tahunAda); t--) tahunPilih.push(t);
  const daftar = daftarFiskal(y);
  const rek = rekonsiliasi(S.d.aset.filter((a) => a.kat?.disusutkan).map((a) => ({a, kat: a.kat, servis: a.servis, kelompok: a.kelompok, metode: metode()})), y);
  const bawah = barangModalBawahBatas(y);
  const jml = (rows, k) => rows.reduce((s, r) => s + (r[k] || 0), 0);
  el.append(h('div', {class: 'alat'}, h('label', {for: 'pj-tahun', class: 'kecil'}, 'Tahun pajak'),
    pilihan('pj-tahun', tahunPilih.map((t) => [String(t), String(t)]), String(y), {onchange: (ev) => { S.tahunPajak = +ev.target.value; S.render(); }}),
    h('span', {class: 'kecil redup'}, 'Metode fiskal: ' + METODE_FISKAL[metode()] + ' (bangunan selalu garis lurus) · ubah di Pengaturan → Aset'),
    h('span', {class: 'pegas'}),
    h('button', {class: 'btn', type: 'button', onclick: aman(() => eksporPajak(y, daftar, rek, bawah))}, 'Ekspor Excel (3 laporan)')));
  el.append(h('section', {class: 'ubin-grid', 'aria-label': 'Ringkasan pajak'},
    ubin('Penyusutan fiskal ' + y, rpRingkas(rek.total.fis), rp(rek.total.fis) + ' · ' + daftar.length + ' aset'),
    ubin('Penyusutan komersial ' + y, rpRingkas(rek.total.kom), rp(rek.total.kom)),
    ubin('Koreksi fiskal', (rek.total.koreksi >= 0 ? '+ ' : '− ') + rpRingkas(Math.abs(rek.total.koreksi)), rek.total.koreksi >= 0 ? 'koreksi positif (menambah laba kena pajak)' : 'koreksi negatif (mengurangi laba kena pajak)'),
    ubin('Barang modal di bawah batas', rp(jml(bawah, 'jumlah')), bawah.length + ' transaksi dibebankan')));
  const TAB = [['daftar', '(a) Daftar penyusutan fiskal'], ['rekon', '(b) Rekonsiliasi komersial vs fiskal'], ['bawah', '(c) Di bawah batas kapitalisasi']];
  const panel = h('div', {class: 'kartu', role: 'tabpanel'});
  el.append(h('div', {class: 'tabs', role: 'tablist'}, TAB.map(([k, label]) => h('button', {class: 'tab', type: 'button', role: 'tab', 'aria-selected': String(S.tabPajak === k),
    onclick: () => { S.tabPajak = k; S.render(); }}, label))), panel);
  if (S.tabPajak === 'rekon') {
    panel.append(h('p', {class: 'kecil redup'}, 'Selisih penyusutan = komersial − fiskal; selisih pelepasan = laba fiskal − laba komersial. Jumlah positif = koreksi fiskal positif (menambah penghasilan kena pajak), negatif = koreksi negatif.'),
      tabel(['Kode', 'Nama', 'Susut komersial', 'Susut fiskal', 'Selisih susut', 'Laba/rugi lepas komersial', 'Laba/rugi lepas fiskal', 'Selisih lepas', 'Koreksi fiskal'],
        rek.rows.length ? [...rek.rows.map((r) => h('tr', null, h('td', {class: 'nw'}, h('a', {href: '#aset-' + r.a.id}, r.a.kode)), td(r.a.nama + (r.tanpa_kelompok ? ' (kelompok belum diisi)' : '')),
          td(rp(r.kom), 1), td(rp(r.fis), 1), td(rpTanda(r.koreksi_susut), 1), td(r.laba_kom == null ? '—' : rpTanda(r.laba_kom), 1), td(r.laba_fis == null ? '—' : rpTanda(r.laba_fis), 1),
          td(r.laba_kom == null ? '—' : rpTanda(r.koreksi_lepas), 1), h('td', {class: 'kanan nw'}, h('b', null, rpTanda(r.koreksi))))),
        h('tr', null, h('th', {colspan: '2'}, 'Total'), ...['kom', 'fis', 'koreksi_susut', 'laba_kom', 'laba_fis', 'koreksi_lepas', 'koreksi'].map((k) => h('th', {class: 'kanan nw'}, k === 'kom' || k === 'fis' ? rp(rek.total[k]) : rpTanda(rek.total[k]))))]
          : [baris0(9, 'Tidak ada penyusutan atau pelepasan di tahun ' + y + '.')], [2, 3, 4, 5, 6, 7, 8]));
  } else if (S.tabPajak === 'bawah') {
    panel.append(h('p', {class: 'kecil redup'}, 'Barang modal yang dibebankan langsung karena nilainya di bawah batas kapitalisasi (' + rp(batasKap()) + '). Diambil dari transaksi Kas umum dan Pembelian stok kantor yang dicentang "Barang modal di bawah batas kapitalisasi".'),
      tabel(['Tanggal', 'Sumber', 'Uraian', 'Pihak', 'Akun', 'Jumlah'], bawah.length ? [...bawah.map((r) => h('tr', null, h('td', {class: 'nw'}, tgl(r.tanggal)), td(r.sumber), h('td', {class: 'lebar'}, r.uraian), td(isi(r.pihak)), td(r.akun), td(rp(r.jumlah), 1))),
        h('tr', null, h('th', {colspan: '5'}, 'Total'), h('th', {class: 'kanan'}, rp(jml(bawah, 'jumlah'))))] : [baris0(6, 'Tidak ada transaksi bertanda barang modal di bawah batas di tahun ' + y + '.')], [5]));
  } else {
    panel.append(h('p', {class: 'kecil redup'}, 'Harta berwujud & tak berwujud yang disusutkan secara fiskal pada tahun ' + y + '. Tanah tidak disusutkan. Tahun pertama proporsional bulan; tahun terakhir masa manfaat disusutkan sekaligus.'),
      tabel(['Kode', 'Nama', 'Kelompok', 'Mulai', 'Harga perolehan', 'Metode / tarif', 'Nilai sisa awal', 'Penyusutan ' + y, 'Akumulasi fiskal', 'Nilai sisa akhir', 'Keterangan'],
        daftar.length ? [...daftar.map((r) => h('tr', null, h('td', {class: 'nw'}, h('a', {href: '#aset-' + r.a.id}, r.kode)), td(r.nama), td(r.kelompok ? r.kelompok : pill('Belum diisi')), h('td', {class: 'nw'}, r.bulan_perolehan),
          td(rp(r.perolehan), 1), td(r.metode ? r.metode + ' ' + r.tarif : '—'), td(r.nsb_awal == null ? '—' : rp(r.nsb_awal), 1), td(rp(r.susut), 1), td(r.akumulasi == null ? '—' : rp(r.akumulasi), 1),
          td(r.nsb_akhir == null ? '—' : rp(r.nsb_akhir), 1), h('td', {class: 'kecil'}, r.ket))),
        h('tr', null, h('th', {colspan: '4'}, 'Total'), h('th', {class: 'kanan'}, rp(jml(daftar, 'perolehan'))), h('th'), h('th', {class: 'kanan'}, rp(jml(daftar, 'nsb_awal'))), h('th', {class: 'kanan'}, rp(jml(daftar, 'susut'))),
          h('th', {class: 'kanan'}, rp(jml(daftar, 'akumulasi'))), h('th', {class: 'kanan'}, rp(jml(daftar, 'nsb_akhir'))), h('th'))]
          : [baris0(11, 'Tidak ada aset yang disusutkan di tahun ' + y + '.')], [4, 6, 7, 8, 9]));
  }
}
const rpTanda = (v) => (v == null ? '—' : (v < 0 ? '− ' : '') + rp(Math.abs(v)));

async function eksporPajak(y, daftar, rek, bawah) {
  await eksporExcel('laporan-pajak-aset-' + y + '.xlsx', [
    {nama: '(a) Penyusutan fiskal ' + y, kolom: [{judul: 'Kode', k: 'kode'}, {judul: 'Nama', k: 'nama', lebar: 30}, {judul: 'Kategori', k: 'kategori', lebar: 22}, {judul: 'Kelompok', k: 'kelompok', lebar: 20},
      {judul: 'Mulai', k: 'bulan_perolehan', lebar: 16}, {judul: 'Harga perolehan', k: 'perolehan', jenis: 'uang', lebar: 16}, {judul: 'Metode', k: 'metode', lebar: 16}, {judul: 'Tarif', k: 'tarif'},
      {judul: 'Nilai sisa awal', k: 'nsb_awal', jenis: 'uang', lebar: 16}, {judul: 'Penyusutan ' + y, k: 'susut', jenis: 'uang', lebar: 16}, {judul: 'Akumulasi fiskal', k: 'akumulasi', jenis: 'uang', lebar: 16},
      {judul: 'Nilai sisa akhir', k: 'nsb_akhir', jenis: 'uang', lebar: 16}, {judul: 'Keterangan', k: 'ket', lebar: 40}], baris: daftar},
    {nama: '(b) Rekonsiliasi ' + y, kolom: [{judul: 'Kode', k: 'kode'}, {judul: 'Nama', k: 'nama', lebar: 30}, {judul: 'Susut komersial', k: 'kom', jenis: 'uang', lebar: 16}, {judul: 'Susut fiskal', k: 'fis', jenis: 'uang', lebar: 16},
      {judul: 'Selisih susut', k: 'koreksi_susut', jenis: 'uang', lebar: 16}, {judul: 'Laba/rugi lepas komersial', k: 'laba_kom', jenis: 'uang', lebar: 18}, {judul: 'Laba/rugi lepas fiskal', k: 'laba_fis', jenis: 'uang', lebar: 18},
      {judul: 'Selisih lepas', k: 'koreksi_lepas', jenis: 'uang', lebar: 16}, {judul: 'Koreksi fiskal', k: 'koreksi', jenis: 'uang', lebar: 16}],
    baris: [...rek.rows.map((r) => ({...r, kode: r.a.kode, nama: r.a.nama})), {kode: 'TOTAL', ...rek.total}]},
    {nama: '(c) Di bawah batas ' + y, kolom: [{judul: 'Tanggal', k: 'tanggal'}, {judul: 'Sumber', k: 'sumber', lebar: 22}, {judul: 'Uraian', k: 'uraian', lebar: 40}, {judul: 'Pihak', k: 'pihak', lebar: 20},
      {judul: 'Akun', k: 'akun', lebar: 26}, {judul: 'Jumlah', k: 'jumlah', jenis: 'uang', lebar: 16}], baris: bawah},
  ]);
}

// =====================================================================
// Ekspor, template, dan impor Excel daftar aset
// =====================================================================
const KOLOM_IMPOR = [
  {k: 'nama', judul: 'Nama aset *', lebar: 30, ket: 'Wajib.'},
  {k: 'kategori', judul: 'Kategori *', lebar: 26, ket: 'Wajib. Nama kategori atau prefix persis seperti di Pengaturan → Aset (lihat sheet "Daftar kategori").'},
  {k: 'no_seri', judul: 'No. seri / plat / lisensi', lebar: 20, teks: true, ket: 'Opsional.'},
  {k: 'tgl_perolehan', judul: 'Tanggal perolehan *', lebar: 16, ket: 'Wajib. YYYY-MM-DD atau DD/MM/YYYY. Tidak boleh di bulan yang sudah ditutup.'},
  {k: 'harga', judul: 'Harga sebelum PPN *', lebar: 18, uang: true, ket: 'Wajib. Rupiah utuh.'},
  {k: 'ppn', judul: 'PPN', lebar: 14, uang: true, ket: 'Opsional, bawaan 0.'},
  {k: 'ppn_kredit', judul: 'PPN dikreditkan', lebar: 14, ket: 'Ya / Tidak (bawaan Tidak). Ya hanya bila perusahaan PKP pada tanggal perolehan.'},
  {k: 'biaya_tambahan', judul: 'Biaya tambahan', lebar: 14, uang: true, ket: 'Opsional.'},
  {k: 'diskon', judul: 'Diskon', lebar: 14, uang: true, ket: 'Opsional.'},
  {k: 'cara', judul: 'Cara perolehan *', lebar: 16, ket: 'Wajib. Tunai / Kredit / Leasing.'},
  {k: 'rekening', judul: 'Rekening pembayar', lebar: 24, ket: 'Wajib bila Tunai. Nama rekening persis seperti di Kas & Bank.'},
  {k: 'tgl_mulai', judul: 'Tanggal mulai digunakan', lebar: 18, ket: 'Opsional, bawaan tanggal perolehan.'},
  {k: 'umur_tahun', judul: 'Umur ekonomis (tahun)', lebar: 16, ket: 'Opsional, bawaan dari kategori. Boleh desimal, mis. 2,5.'},
  {k: 'residu', judul: 'Nilai residu', lebar: 14, uang: true, ket: 'Opsional, bawaan 0.'},
  {k: 'kelompok', judul: 'Kelompok fiskal', lebar: 20, ket: 'Opsional, bawaan dari kategori. Nama kelompok, mis. Kelompok 2.'},
  {k: 'lokasi', judul: 'Lokasi', lebar: 18, ket: 'Opsional. Nama lokasi dari Pengaturan → Aset.'},
  {k: 'kondisi', judul: 'Kondisi', lebar: 12, ket: 'Opsional: Baik / Perlu servis / Rusak (bawaan Baik).'},
  {k: 'tetap_aset', judul: 'Tetap aset bila di bawah batas', lebar: 18, ket: 'Ya / Tidak (bawaan Tidak). Isi Ya agar barang di bawah batas kapitalisasi tetap dicatat sebagai aset.'},
  {k: 'catatan', judul: 'Catatan', lebar: 30, ket: 'Opsional.'},
];
const KOLOM_EKSPOR = [{judul: 'Kode', k: 'kode'}, {judul: 'Nama', k: 'nama', lebar: 30}, {judul: 'Kategori', k: 'kategori_nama', lebar: 24}, {judul: 'No. seri', k: 'no_seri', jenis: 'teks', lebar: 18},
  {judul: 'Tgl perolehan', k: 'tgl_perolehan', lebar: 14}, {judul: 'Nilai perolehan', k: 'perolehan_pada', jenis: 'uang', lebar: 16}, {judul: 'Akumulasi', k: 'akumulasi', jenis: 'uang', lebar: 16},
  {judul: 'Nilai buku', k: 'buku', jenis: 'uang', lebar: 16}, {judul: 'Umur (bulan)', k: 'umur_bulan'}, {judul: 'Kelompok fiskal', k: 'kelompok_nama', lebar: 18}, {judul: 'Pemegang', k: 'pemegang_nama', lebar: 20},
  {judul: 'Lokasi', k: 'lokasi_nama', lebar: 18}, {judul: 'Kondisi', k: 'kondisi'}, {judul: 'Status', k: 'status'}, {judul: 'Tgl pelepasan', k: 'tgl_pelepasan', lebar: 14}, {judul: 'Peringatan', k: 'peringatan_teks', lebar: 40}];
async function eksporAset(rows, t) {
  await eksporExcel('aset-' + t + '.xlsx', [{nama: 'Aset per ' + t, kolom: KOLOM_EKSPOR,
    baris: rows.map((a) => ({...a, kelompok_nama: a.kelompok?.nama, peringatan_teks: a.peringatan.map(teksPeringatan).join('; ')}))}]);
}
async function unduhTemplateAset() {
  const ExcelJS = await muatExcelJS(), wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data Aset', {views: [{state: 'frozen', ySplit: 1}]});
  ws.columns = KOLOM_IMPOR.map((c) => ({header: c.judul, key: c.k, width: c.lebar, style: c.teks ? {numFmt: '@'} : {}}));
  ws.getRow(1).font = {bold: true};
  const contoh = ws.addRow({nama: 'CONTOH - Laptop Lenovo ThinkPad', kategori: 'KMP', no_seri: 'SN123456', tgl_perolehan: '2026-01-15', harga: 15000000, ppn: 0, ppn_kredit: 'Tidak', cara: 'Tunai',
    rekening: K().rekening[0]?.nama || 'BCA Giro Operasional', umur_tahun: 4, kelompok: 'Kelompok 1', kondisi: 'Baik', catatan: 'Baris contoh ini diabaikan saat impor.'});
  contoh.eachCell({includeEmpty: true}, (c) => { c.fill = {type: 'pattern', pattern: 'solid', fgColor: {argb: 'FFD9D9D9'}}; c.font = {italic: true, color: {argb: 'FF666666'}}; });
  const p = wb.addWorksheet('Petunjuk');
  p.columns = [{header: 'Kolom', width: 30}, {header: 'Keterangan', width: 110}];
  p.getRow(1).font = {bold: true};
  for (const c of KOLOM_IMPOR) p.addRow([c.judul, c.ket]);
  p.addRow([]);
  for (const t of ['Satu baris = satu aset. Kode aset dibuat otomatis dari prefix kategori.', 'Setiap aset dijurnal otomatis: D akun aset / K rekening (Tunai) atau K 2-8 Hutang aset (Kredit / Leasing).',
    'Aplikasi menampilkan pratinjau lebih dulu; tidak ada yang tersimpan sebelum Anda menekan Simpan.', 'Pemegang, dokumen, dan servis diisi lewat aplikasi setelah impor.']) p.addRow([t]);
  const d = wb.addWorksheet('Daftar kategori');
  d.columns = [{header: 'Kategori', width: 34}, {header: 'Prefix', width: 10}, {header: 'Disusutkan', width: 12}, {header: 'Umur default (tahun)', width: 18}, {header: 'Kelompok default', width: 20}];
  d.getRow(1).font = {bold: true};
  for (const k of K().aset_kategori.filter((x) => x.aktif).sort(urutUrut)) d.addRow([k.nama, k.prefix, k.disusutkan ? 'Ya' : 'Tidak', k.umur_bulan ? bulanKeTahun(k.umur_bulan) : '', kelDari(k.kelompok_id)?.nama || '']);
  unduh('template-aset.xlsx', new Blob([await wb.xlsx.writeBuffer()], {type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
}
async function bacaImporAset(buffer) {
  const ExcelJS = await muatExcelJS(), wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer); } catch { throw new Error('File tidak bisa dibaca. Pastikan formatnya .xlsx (Excel).'); }
  const ws = wb.getWorksheet('Data Aset') || wb.worksheets[0];
  const norm = (s) => String(s ?? '').replace(/\*/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const peta = Object.fromEntries(KOLOM_IMPOR.map((c) => [norm(c.judul), c.k])), kunci = {};
  const nilai = (cell) => { let v = cell.value; if (v && typeof v === 'object' && !(v instanceof Date)) v = v.result ?? v.text ?? (v.richText ? v.richText.map((x) => x.text).join('') : null); return v instanceof Date || typeof v === 'number' ? v : v == null ? '' : String(v).trim(); };
  ws.getRow(1).eachCell((cell, col) => { const k = peta[norm(nilai(cell))]; if (k) kunci[col] = k; });
  const hilang = KOLOM_IMPOR.filter((c) => c.judul.endsWith('*') && !Object.values(kunci).includes(c.k));
  if (hilang.length) throw new Error('Kolom ' + hilang.map((c) => '"' + c.judul.replace(' *', '') + '"').join(', ') + ' tidak ditemukan. Pakai file dari tombol Unduh Template.');
  const hasil = [];
  ws.eachRow((row, no) => {
    if (no === 1) return;
    const v = {};
    for (const [col, k] of Object.entries(kunci)) { const x = nilai(row.getCell(+col)); if (x !== '') v[k] = x; }
    if (Object.keys(v).length && !/^contoh/i.test(String(v.nama || ''))) hasil.push({no, v});
  });
  return hasil.map(({no, v}) => evaluasiAset(no, v));
}
function evaluasiAset(no, v) {
  const galat = [], g = (k, p) => galat.push(k + ': ' + p);
  const tx = (x) => (x instanceof Date ? bacaTanggal(x) : String(x ?? '').trim());
  const ya = (x) => /^(ya|y|yes|true|1)$/i.test(tx(x));
  const cari = (daftar, s) => daftar.find((x) => x.nama.trim().toLowerCase() === s.toLowerCase() || x.prefix === s.toUpperCase());
  const nama = tx(v.nama); if (!nama) g('Nama', 'wajib diisi.');
  const kat = tx(v.kategori) && cari(K().aset_kategori.filter((k) => k.aktif), tx(v.kategori));
  if (!kat) g('Kategori', v.kategori ? '"' + tx(v.kategori) + '" tidak ada.' : 'wajib diisi.');
  const tp = v.tgl_perolehan === undefined ? null : bacaTanggal(v.tgl_perolehan);
  if (!tp) g('Tanggal perolehan', v.tgl_perolehan === undefined ? 'wajib diisi.' : 'bukan tanggal yang benar.');
  else if (terkunci(K(), tp)) g('Tanggal perolehan', 'bulan ' + namaBulan(tp) + ' sudah ditutup.');
  const uangK = (k, label, wajib) => { if (v[k] === undefined) { if (wajib) g(label, 'wajib diisi.'); return 0; } const x = bacaRupiah(v[k]); if (!Number.isInteger(x) || x < 0) { g(label, 'bukan rupiah utuh.'); return 0; } return x; };
  const harga = uangK('harga', 'Harga', true), ppn = uangK('ppn', 'PPN'), btam = uangK('biaya_tambahan', 'Biaya tambahan'), dis = uangK('diskon', 'Diskon'), res = uangK('residu', 'Residu');
  const caraT = tx(v.cara).toLowerCase(), cara = caraT.startsWith('tunai') || caraT.startsWith('transfer') ? 'tunai' : caraT.startsWith('kredit') || caraT.startsWith('cicil') ? 'kredit' : caraT.startsWith('leas') ? 'leasing' : null;
  if (!cara) g('Cara perolehan', 'isi Tunai, Kredit, atau Leasing.');
  const rek = cara === 'tunai' ? K().rekening.find((r) => r.aktif && r.nama.trim().toLowerCase() === tx(v.rekening).toLowerCase()) : null;
  if (cara === 'tunai' && !rek) g('Rekening pembayar', v.rekening ? '"' + tx(v.rekening) + '" tidak ada / nonaktif.' : 'wajib untuk Tunai.');
  const mulai = v.tgl_mulai === undefined ? tp : bacaTanggal(v.tgl_mulai);
  if (v.tgl_mulai !== undefined && !mulai) g('Tanggal mulai', 'bukan tanggal yang benar.');
  const umurS = String(v.umur_tahun ?? '').replace(',', '.');
  const umurB = umurS === '' ? kat?.umur_bulan ?? null : /^\d+(\.\d+)?$/.test(umurS) ? tahunKeBulan(+umurS) : NaN;
  if (kat?.disusutkan && !(umurB > 0)) g('Umur ekonomis', 'wajib (kategori ini tidak punya umur default).');
  const kel = v.kelompok === undefined ? kelDari(kat?.kelompok_id) : K().kelompok_fiskal.find((k) => k.nama.trim().toLowerCase() === tx(v.kelompok).toLowerCase());
  if (v.kelompok !== undefined && !kel) g('Kelompok fiskal', '"' + tx(v.kelompok) + '" tidak ada.');
  const lok = v.lokasi === undefined ? null : K().aset_lokasi.find((l) => l.nama.trim().toLowerCase() === tx(v.lokasi).toLowerCase());
  if (v.lokasi !== undefined && !lok) g('Lokasi', '"' + tx(v.lokasi) + '" tidak ada di Pengaturan → Aset.');
  const kondisi = v.kondisi === undefined ? 'Baik' : KONDISI_ASET.find((k) => k.toLowerCase() === tx(v.kondisi).toLowerCase());
  if (!kondisi) g('Kondisi', 'isi Baik, Perlu servis, atau Rusak.');
  const kredit = ya(v.ppn_kredit) && ppn > 0;
  if (kredit && tp && !pkpPada(K().perusahaan?.data || {}, tp)) g('PPN dikreditkan', 'perusahaan belum PKP pada tanggal perolehan.');
  const data = {nama, kategori_id: kat?.id, no_seri: tx(v.no_seri) || null, supplier_id: null, faktur: [], foto: [], tgl_perolehan: tp, harga, ppn, ppn_kredit: kredit, biaya_tambahan: btam, diskon: dis,
    cara, rekening_id: rek?.id || null, tgl_mulai: kat?.disusutkan ? mulai : null, umur_bulan: kat?.disusutkan ? umurB : null, residu: kat?.disusutkan ? res : 0, kelompok_id: kat?.disusutkan ? kel?.id || null : null,
    bulan_fiskal: tp, pemegang_id: null, lokasi_id: lok?.id || null, kondisi: kondisi || 'Baik', status: 'Aktif', catatan: tx(v.catatan) || null, tetap_aset: ya(v.tetap_aset)};
  const nilai = nilaiPerolehan(data);
  if (!galat.length && nilai < batasKap() && !data.tetap_aset) g('Nilai perolehan', rp(nilai) + ' di bawah batas kapitalisasi ' + rp(batasKap()) + '. Isi "Tetap aset bila di bawah batas" = Ya, atau catat sebagai biaya.');
  return {no, data, nilai, kategori: kat?.nama, galat};
}
function bukaPratinjauImporAset(hasil) {
  const siap = hasil.filter((r) => !r.galat.length), error = hasil.filter((r) => r.galat.length);
  const galat = h('p', {class: 'form-galat', role: 'alert'});
  let yakin = false;
  const tombol = h('button', {class: 'btn btn-utama', type: 'button', disabled: !siap.length}, 'Simpan ' + siap.length + ' aset');
  tombol.addEventListener('click', aman(async () => {
    if (!yakin) { yakin = true; tombol.textContent = 'Klik lagi untuk menyimpan ' + siap.length + ' aset'; return; }
    let n = 0;
    try {
      await sambilMenyimpan(tombol, async () => { for (const r of siap) { await store.keu.simpanAset(null, r.data); n++; } });
    } catch (e) {
      galat.textContent = n + ' aset tersimpan. Berhenti di baris ' + siap[n].no + ': ' + e.message + ' Baris setelahnya belum disimpan.';
      await segarkanKeuangan(); return;
    }
    dlg.close(); await segarkanKeuangan(); pesan('Impor selesai: ' + n + ' aset tersimpan dan dijurnal otomatis.');
  }));
  const dlg = dialogLebar('Pratinjau impor aset', h('div', {class: 'form'},
    h('p', null, h('b', null, siap.length + ' baris siap, ' + error.length + ' baris error.'), ' Belum ada yang disimpan.'),
    error.length > 0 && [h('h3', null, 'Baris error (tidak ikut disimpan)'), tabel(['Baris', 'Masalah'], error.map((r) => h('tr', null, td(String(r.no)), h('td', null, r.galat.map((x) => h('div', null, x))))))],
    siap.length > 0 && [h('h3', null, 'Baris siap disimpan · total ' + rp(siap.reduce((s, r) => s + r.nilai, 0))),
      tabel(['Baris', 'Nama', 'Kategori', 'Tgl perolehan', 'Nilai perolehan', 'Cara'], siap.map((r) => h('tr', null, td(String(r.no)), td(r.data.nama), td(r.kategori), td(tgl(r.data.tgl_perolehan)), td(rp(r.nilai), 1), td(CARA_PEROLEHAN[r.data.cara]))), [4]),
      h('p', {class: 'kecil redup'}, 'Disimpan satu per satu; bila satu baris ditolak, baris sebelumnya tetap tersimpan dan penyimpanan berhenti di baris itu.')],
    galat,
    kaki(h('span', {class: 'pegas'}), h('button', {class: 'btn', type: 'button', onclick: () => dlg.close()}, 'Batal'), tombol)));
}

// =====================================================================
// Pengaturan → Aset
// =====================================================================
export function bagianAset() {
  if (!K().siap || K().aset_siap === false) return h('section', {class: 'kartu'}, h('h2', null, 'Aset'), h('p', null, 'Memerlukan pembaruan database Tahap 5 (supabase/migrasi/5-aset.sql).'));
  const boleh = bisaAtur();
  const galat = h('p', {class: 'form-galat', role: 'alert'});
  const met = pilihan('at-metode', Object.entries(METODE_FISKAL), metode(), {disabled: !bisaUbah('pengaturan')});
  const kartuMetode = h('section', {class: 'kartu'}, h('h2', null, 'Aturan aset'),
    h('div', {class: 'form-grid'},
      medan('Metode penyusutan fiskal', met, {bantuan: 'Untuk buku pajak (Laporan Pajak). Bangunan selalu garis lurus. Buku komersial selalu garis lurus.'}),
      h('div', {class: 'medan'}, h('label', null, 'Batas kapitalisasi'), h('div', null, h('b', null, rp(batasKap())), ' · ', h('a', {href: '#pengaturan-akuntansi'}, 'ubah di Akuntansi'))),
      h('div', {class: 'medan'}, h('label', null, 'Pengingat dokumen & servis'), h('div', null, h('a', {href: '#pengaturan-notifikasi'}, 'Atur H-X di Notifikasi')))),
    galat,
    bisaUbah('pengaturan') && h('div', {class: 'baris-tombol'}, h('button', {class: 'btn btn-utama', type: 'button', onclick: aman(async () => {
      galat.textContent = '';
      try { await store.keu.aturAkuntansi({metode_fiskal: met.value}); } catch (e) { galat.textContent = e.message; return; }
      await segarkanKeuangan(); pesan('Metode penyusutan fiskal tersimpan.');
    })}, 'Simpan')));
  const kats = K().aset_kategori.slice().sort(urutUrut);
  const kartuKat = h('section', {class: 'kartu'}, h('div', {class: 'judul-baris'}, h('h2', null, 'Kategori aset'), h('span', {class: 'pegas'}),
    boleh && h('button', {class: 'btn btn-kecil btn-utama', type: 'button', onclick: () => bukaFormKategori(null)}, '+ Kategori')),
  h('p', {class: 'kecil redup'}, 'Prefix menjadi awal kode aset (mis. KND-001). Umur dan kelompok fiskal menjadi isian bawaan saat menambah aset. Akun dipakai untuk jurnal perolehan dan penyusutan.'),
  tabel(['Nama', 'Prefix', 'Jenis', 'Disusutkan', 'Umur bawaan', 'Kelompok bawaan', 'Akun aset / akumulasi / beban', 'Status', ''], kats.map((k) => h('tr', null, td(k.nama), td(k.prefix), td(JENIS_KATEGORI[k.jenis]),
    td(k.disusutkan ? 'Ya' : 'Tidak'), td(k.umur_bulan ? tahunTeks(k.umur_bulan) : '—'), td(kelDari(k.kelompok_id)?.nama || '—'),
    h('td', {class: 'kecil'}, nmAkun(k.akun_aset_id) + (k.disusutkan ? ' / ' + nmAkun(k.akun_akumulasi_id) + ' / ' + nmAkun(k.akun_beban_id) : '')), td(k.aktif ? 'Aktif' : 'Nonaktif'),
    td(h('button', {class: 'btn btn-kecil', type: 'button', onclick: () => bukaFormKategori(k)}, boleh ? 'Ubah' : 'Lihat'))))));
  const kartuKel = h('section', {class: 'kartu'}, h('div', {class: 'judul-baris'}, h('h2', null, 'Kelompok harta (fiskal)'), h('span', {class: 'pegas'}),
    boleh && h('button', {class: 'btn btn-kecil btn-utama', type: 'button', onclick: () => bukaFormKelompok(null)}, '+ Kelompok')),
  h('p', {class: 'kecil redup'}, 'Masa manfaat dan tarif penyusutan pajak per tahun. Tarif saldo menurun kosong = selalu garis lurus (bangunan).'),
  tabel(['Nama', 'Masa manfaat', 'Tarif garis lurus', 'Tarif saldo menurun', 'Status', ''], K().kelompok_fiskal.slice().sort(urutUrut).map((k) => h('tr', null, td(k.nama), td(k.masa_tahun + ' tahun'),
    td(idn(bpKePersen(k.tarif_gl_bp), 2) + '%'), td(k.tarif_sm_bp == null ? '— (garis lurus)' : idn(bpKePersen(k.tarif_sm_bp), 2) + '%'), td(k.aktif ? 'Aktif' : 'Nonaktif'),
    td(h('button', {class: 'btn btn-kecil', type: 'button', onclick: () => bukaFormKelompok(k)}, boleh ? 'Ubah' : 'Lihat'))))));
  const kartuLok = h('section', {class: 'kartu'}, h('div', {class: 'judul-baris'}, h('h2', null, 'Lokasi aset'), h('span', {class: 'pegas'}),
    boleh && h('button', {class: 'btn btn-kecil btn-utama', type: 'button', onclick: () => bukaFormLokasi(null)}, '+ Lokasi')),
  tabel(['Nama', 'Status', ''], K().aset_lokasi.length ? K().aset_lokasi.slice().sort((a, b) => bandingkan(a.nama, b.nama)).map((l) => h('tr', null, td(l.nama), td(l.aktif ? 'Aktif' : 'Nonaktif'),
    td(boleh && h('button', {class: 'btn btn-kecil', type: 'button', onclick: () => bukaFormLokasi(l)}, 'Ubah')))) : [baris0(3, 'Belum ada lokasi, mis. Kantor pusat, Gudang, Site proyek.')]));
  return [kartuMetode, kartuKat, kartuKel, kartuLok];
}

function bukaFormKategori(k) {
  const x = k || {jenis: 'berwujud', disusutkan: true, aktif: true};
  const boleh = bisaAtur();
  const galat = h('p', {class: 'form-galat', role: 'alert'});
  const nama = teks('kt-nama', x.nama, {required: true});
  const prefix = teks('kt-prefix', x.prefix, {required: true, maxlength: '6', class: 'angka-pendek', oninput: () => { prefix.value = prefix.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); }});
  const dipakai = k && K().aset.some((a) => a.kategori_id === k.id);
  const jenis = pilihan('kt-jenis', Object.entries(JENIS_KATEGORI), x.jenis);
  const susut = centang('kt-susut', x.disusutkan, 'Disusutkan / diamortisasi');
  const susutInp = susut.querySelector('input');
  const umur = h('input', {id: 'kt-umur', type: 'text', inputmode: 'decimal', class: 'angka-pendek', value: x.umur_bulan ? String(bulanKeTahun(x.umur_bulan)).replace('.', ',') : ''});
  const kel = pilihan('kt-kel', [['', '—'], ...K().kelompok_fiskal.filter((g) => g.aktif || g.id === x.kelompok_id).sort(urutUrut).map((g) => [g.id, g.nama])], x.kelompok_id || '');
  const opsiAkun = (gol) => [['', 'Pilih akun…'], ...K().akun.filter((a) => a.aktif && a.golongan === gol && !K().akun.some((b) => b.induk_id === a.id)).sort((a, b) => bandingkan(a.kode, b.kode)).map((a) => [a.id, a.kode + ' ' + a.nama])];
  const aAset = pilihan('kt-aset', opsiAkun(1), x.akun_aset_id || akunKode(K(), '1-7')?.id || '');
  const aAkum = pilihan('kt-akum', opsiAkun(1), x.akun_akumulasi_id || akunKode(K(), '1-8')?.id || '');
  const aBeban = pilihan('kt-beban', opsiAkun(6), x.akun_beban_id || akunKode(K(), '6-4')?.id || '');
  const mAkum = medan('Akun akumulasi', aAkum, {wajib: true}), mBeban = medan('Akun beban penyusutan', aBeban, {wajib: true}), mUmur = medan('Umur bawaan', h('div', {class: 'berakhiran'}, umur, h('span', null, 'tahun')), {id: 'kt-umur'});
  const mKel = medan('Kelompok fiskal bawaan', kel);
  const aktif = centang('kt-aktif', x.aktif !== false, 'Aktif (bisa dipilih untuk aset baru)');
  const segar = () => { [mAkum, mBeban, mUmur, mKel].forEach((m) => { m.hidden = !susutInp.checked; }); };
  susutInp.addEventListener('change', segar); segar();
  if (dipakai) [prefix, susutInp].forEach((e) => { e.disabled = true; });
  const simpan = h('button', {class: 'btn btn-utama', type: 'button', onclick: aman(async () => {
    galat.textContent = '';
    if (!nama.value.trim()) { galat.textContent = 'Nama kategori wajib diisi.'; return; }
    if (!prefixSah(prefix.value)) { galat.textContent = 'Prefix 1–6 huruf besar atau angka, mis. KND.'; prefix.focus(); return; }
    const s = umur.value.trim().replace(',', '.');
    if (s && !/^\d+(\.\d+)?$/.test(s)) { galat.textContent = 'Umur ditulis dalam tahun, mis. 4 atau 2,5.'; umur.focus(); return; }
    const d = {nama: nama.value.trim(), prefix: prefix.value, jenis: jenis.value, disusutkan: susutInp.checked, umur_bulan: susutInp.checked && s ? tahunKeBulan(+s) : null,
      kelompok_id: susutInp.checked ? kel.value || null : null, akun_aset_id: aAset.value || null, akun_akumulasi_id: susutInp.checked ? aAkum.value || null : null,
      akun_beban_id: susutInp.checked ? aBeban.value || null : null, aktif: aktif.querySelector('input').checked};
    try { await sambilMenyimpan(simpan, () => store.keu.simpanKategoriAset(k?.id, d)); } catch (e) { galat.textContent = e.message; return; }
    dlg.close(); await segarkanKeuangan(); pesan('Kategori tersimpan.');
  })}, 'Simpan');
  const dlg = dialog(k ? 'Kategori ' + k.nama : 'Kategori baru', h('div', {class: 'form'},
    h('div', {class: 'form-grid'}, medan('Nama', nama, {wajib: true}), medan('Prefix kode', prefix, {wajib: true, bantuan: dipakai ? 'Sudah dipakai aset: prefix tidak bisa diubah.' : '1–6 huruf besar / angka.'}),
      medan('Jenis', jenis), h('div', {class: 'medan'}, susut), mUmur, mKel, medan('Akun aset', aAset, {wajib: true}), mAkum, mBeban, h('div', {class: 'medan'}, aktif)),
    h('p', {class: 'kecil redup'}, 'Kategori tidak bisa dihapus; nonaktifkan bila tidak dipakai lagi.'),
    galat,
    kaki(h('span', {class: 'pegas'}), h('button', {class: 'btn', type: 'button', onclick: () => dlg.close()}, boleh ? 'Batal' : 'Tutup'), boleh && simpan)));
  if (!boleh) dlg.querySelectorAll('input, select').forEach((e) => { e.disabled = true; });
}

function bukaFormKelompok(k) {
  const x = k || {aktif: true};
  const boleh = bisaAtur();
  const galat = h('p', {class: 'form-galat', role: 'alert'});
  const nama = teks('kf-nama', x.nama, {required: true});
  const masa = h('input', {id: 'kf-masa', type: 'number', min: '1', max: '100', step: '1', class: 'angka-pendek', value: x.masa_tahun ?? ''});
  const gl = h('input', {id: 'kf-gl', type: 'text', inputmode: 'decimal', class: 'angka-pendek', value: x.tarif_gl_bp ? idn(bpKePersen(x.tarif_gl_bp), 2) : ''});
  const sm = h('input', {id: 'kf-sm', type: 'text', inputmode: 'decimal', class: 'angka-pendek', value: x.tarif_sm_bp ? idn(bpKePersen(x.tarif_sm_bp), 2) : ''});
  const aktif = centang('kf-aktif', x.aktif !== false, 'Aktif');
  const persen = (el) => h('div', {class: 'berakhiran'}, el, h('span', null, '%'));
  const simpan = h('button', {class: 'btn btn-utama', type: 'button', onclick: aman(async () => {
    galat.textContent = '';
    const bGl = persenKeBp(gl.value), bSm = sm.value.trim() ? persenKeBp(sm.value) : null;
    if (!nama.value.trim()) { galat.textContent = 'Nama wajib diisi.'; return; }
    if (!(+masa.value >= 1 && +masa.value <= 100 && Number.isInteger(+masa.value))) { galat.textContent = 'Masa manfaat 1–100 tahun.'; return; }
    if (!(bGl > 0 && bGl <= 10000)) { galat.textContent = 'Tarif garis lurus di atas 0 sampai 100%.'; return; }
    if (sm.value.trim() && !(bSm > 0 && bSm <= 10000)) { galat.textContent = 'Tarif saldo menurun di atas 0 sampai 100%, atau dikosongkan.'; return; }
    try { await sambilMenyimpan(simpan, () => store.keu.simpanKelompokFiskal(k?.id, {nama: nama.value.trim(), masa_tahun: +masa.value, tarif_gl_bp: bGl, tarif_sm_bp: bSm, aktif: aktif.querySelector('input').checked})); }
    catch (e) { galat.textContent = e.message; return; }
    dlg.close(); await segarkanKeuangan(); pesan('Kelompok fiskal tersimpan.');
  })}, 'Simpan');
  const dlg = dialog(k ? 'Kelompok ' + k.nama : 'Kelompok baru', h('div', {class: 'form'},
    h('div', {class: 'form-grid'}, medan('Nama', nama, {wajib: true}), medan('Masa manfaat', h('div', {class: 'berakhiran'}, masa, h('span', null, 'tahun')), {wajib: true, id: 'kf-masa'}),
      medan('Tarif garis lurus', persen(gl), {wajib: true, id: 'kf-gl'}), medan('Tarif saldo menurun', persen(sm), {id: 'kf-sm', bantuan: 'Kosongkan untuk bangunan (selalu garis lurus).'}), h('div', {class: 'medan'}, aktif)),
    h('p', {class: 'kecil redup'}, 'Perubahan tarif berlaku untuk perhitungan Laporan Pajak semua aset di kelompok ini.'),
    galat,
    kaki(h('span', {class: 'pegas'}), h('button', {class: 'btn', type: 'button', onclick: () => dlg.close()}, boleh ? 'Batal' : 'Tutup'), boleh && simpan)));
  if (!boleh) dlg.querySelectorAll('input').forEach((e) => { e.disabled = true; });
}

function bukaFormLokasi(l) {
  const galat = h('p', {class: 'form-galat', role: 'alert'});
  const nama = teks('lk-nama', l?.nama, {required: true, placeholder: 'mis. Kantor pusat'});
  const aktif = centang('lk-aktif', l ? l.aktif : true, 'Aktif');
  const simpan = h('button', {class: 'btn btn-utama', type: 'button', onclick: aman(async () => {
    galat.textContent = '';
    if (!nama.value.trim()) { galat.textContent = 'Nama lokasi wajib diisi.'; return; }
    try { await sambilMenyimpan(simpan, () => store.keu.simpanLokasiAset(l?.id, {nama: nama.value.trim(), aktif: aktif.querySelector('input').checked})); }
    catch (e) { galat.textContent = e.message; return; }
    dlg.close(); await segarkanKeuangan(); pesan('Lokasi tersimpan.');
  })}, 'Simpan');
  const dlg = dialog(l ? 'Lokasi ' + l.nama : 'Lokasi baru', h('div', {class: 'form'}, h('div', {class: 'form-grid'}, medan('Nama', nama, {wajib: true}), h('div', {class: 'medan'}, aktif)), galat,
    kaki(h('span', {class: 'pegas'}), h('button', {class: 'btn', type: 'button', onclick: () => dlg.close()}, 'Batal'), simpan)));
}
