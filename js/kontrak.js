// Tahap 3: Kontrak klien (arsip, formulir, addendum) dan Termin & Piutang (invoice, penerimaan, umur piutang).
// Data ada di tabel keuangan (S.keu); ringkasan per kontrak/termin dihitung di calc.js (S.d.kontrak, S.d.termin).
// Aturan dijaga dua kali: di layar (pesan cepat) dan di mesin data / database (penentu akhir).
import {S, segarkanKeuangan} from './state.js';
import {hariIni} from './calc.js';
import {store} from './store.js';
import {OPSI} from './schema.js';
import {bisaUbah} from './akses.js';
import {h, idn, rp, tgl, isi, pill, pesan, aman, dialog, bandingkan, sambilMenyimpan, pilihCari, kepalaUrut, formatUang} from './ui.js';
import {medan, teks, tanggal, pilihan, uang, kaki, tombolHapus, catatanKunci, opsiProyek, namaRekening, pilihBukti, tombolBukti, kartuBelumSiap} from './keuangan.js';
import {terkunci, akunKode, nomorInvoiceBerikut} from './keuangan-data.js';
import {tabelKontrakVendor, bukaFormKontrakVendor} from './pihak-proyek.js';
import {tawarkanPengembalian} from './dompet.js';
import {
  MODE_PPN, AKUN_PENDAPATAN, STATUS_TERMIN, KELOMPOK_UMUR, SATUAN_DENDA, akunPendapatanDari, bagi, bpKePersen, persenKeBp, tambahHari,
  hitungTermin, nilaiKontrak, periksaKontrak, pkpPada, sesuaikanTermin, ringkasUmur, alokasiPenerimaan, dendaAlinea,
} from './kontrak-util.js';

const K = () => S.keu;
const bisaKontrak = () => bisaUbah('kontrak');
const bisaTagih = () => bisaUbah('termin');
const proyekDari = (kode) => S.d.proyek.find((p) => p.kode === kode);
const kontrakDari = (id) => S.d.kontrak.find((k) => k.id === id);
const terminDari = (id) => S.d.termin.find((t) => t.id === id);
const pct = (x) => (x == null ? '—' : idn(x * 100, 1) + '%');
const persenBp = (bp) => idn(bpKePersen(bp), 2) + '%';
const labelTermin = (t) => (t.jenis === 'retensi' ? 'Retensi' : 'Termin ' + t.ke);
const angka = (v) => { const s = String(v ?? '').trim().replace(',', '.'); return s === '' ? null : Number(s); };
const rincian = (baris) => h('dl', {class: 'rincian'}, baris.filter((b) => b && b[1] != null && b[1] !== '').flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)]));
const ubin = (label, nilai, kakiTeks, o = {}) => h(o.onclick ? 'button' : 'div', {class: 'ubin' + (o.onclick ? ' ubin-tautan' : '') + (o.aktif ? ' aktif' : ''), type: o.onclick ? 'button' : null, onclick: o.onclick || null},
  h('span', {class: 'ubin-label'}, label), h('span', {class: 'ubin-nilai'}, nilai), h('span', {class: 'ubin-kaki'}, kakiTeks));
const rekeningInvoice = () => K().rekening.filter((r) => r.aktif && r.di_invoice);
const rekeningAktif = () => K().rekening.filter((r) => r.aktif);
const dialogLebar = (judul, isiDialog) => { const d = dialog(judul, isiDialog); d.classList.add('dialog-lebar'); return d; };

// Database belum dimigrasi untuk Tahap 3.
function belumSiap(el) {
  if (!K().siap) { kartuBelumSiap(el); return true; }
  if (K().kontrak_siap === false) {
    el.append(h('div', {class: 'kartu'}, h('h2', null, 'Database kontrak belum dipasang'),
      h('p', null, 'Bagian ini memerlukan pembaruan database Tahap 3. Jalankan SQL file supabase/migrasi/3-kontrak.sql di Supabase SQL Editor, lalu muat ulang halaman.')));
    return true;
  }
  return false;
}

// =====================================================================
// Daftar kontrak (menu Kontrak)
// =====================================================================
S.tabKontrak = S.tabKontrak || 'klien';
S.urutKontrak = S.urutKontrak || {k: 'tanggal', arah: -1};
S.saringKontrak = S.saringKontrak || {proyek: '', klien: '', tahun: '', status: '', q: ''};
const STATUS_KONTRAK = ['Belum ditagih', 'Berjalan', 'Lewat jatuh tempo', 'Lunas'];

export function renderKontrak(el) {
  el.append(h('div', {class: 'kepala'}, h('h1', null, 'Kontrak'),
    h('p', {class: 'redup'}, 'Arsip kontrak klien beserta jadwal termin, addendum, dan status pembayarannya. Klien mengikuti proyek yang dipilih.')));
  if (belumSiap(el)) return;
  const TAB = [['klien', 'Klien'], ['vendor', 'Vendor']];
  const panel = h('div', {class: 'kartu', role: 'tabpanel'});
  el.append(h('div', {class: 'tabs', role: 'tablist'}, TAB.map(([k, label]) => h('button', {class: 'tab', type: 'button', role: 'tab', 'aria-selected': String(S.tabKontrak === k),
    onclick: () => { S.tabKontrak = k; S.render(); }}, label))), panel);
  if (S.tabKontrak === 'vendor') {
    if (K().proyek_siap === false) { panel.append(h('p', null, 'Kontrak vendor memerlukan pembaruan database Tahap 4 (supabase/migrasi/4-proyek.sql).')); return; }
    panel.append(h('div', {class: 'alat'}, h('span', {class: 'redup kecil'}, S.d.vendor.length + ' kontrak vendor · dikelola di menu Pihak Proyek'), h('span', {class: 'pegas'}),
      h('a', {class: 'btn', href: '#pihak-proyek'}, 'Buka Pihak Proyek'),
      bisaUbah('pihak_proyek') && h('button', {class: 'btn btn-utama', type: 'button', onclick: () => bukaFormKontrakVendor(null)}, '+ Kontrak vendor')),
    tabelKontrakVendor(S.d.vendor));
    return;
  }
  panelKontrakKlien(panel);
}

function panelKontrakKlien(panel) {
  const sr = S.saringKontrak;
  const badan = h('tbody'), hitungan = h('span', {class: 'redup kecil'});
  const tabel = h('table', {class: 'tabel'}, h('thead'), badan);
  const KOLOM = [['kode', 'Kode'], ['nama_proyek', 'Proyek'], ['klien', 'Klien'], ['no_kontrak', 'No. kontrak'], ['tanggal', 'Tanggal'], ['total', 'Nilai total', true],
    ['ditagih', 'Ditagih', true], ['diterima', 'Diterima', true], ['sisa', 'Sisa', true], ['pct_terbayar', '% terbayar', true], ['status', 'Status'], [null, 'PDF']];
  const semua = S.d.kontrak;
  const gambar = () => {
    const q = sr.q.trim().toLowerCase();
    let rows = semua.filter((k) => (!sr.proyek || k.kode === sr.proyek) && (!sr.klien || k.klien_ref === sr.klien) && (!sr.tahun || String(k.tanggal).startsWith(sr.tahun)) && (!sr.status || k.status === sr.status));
    if (q) rows = rows.filter((k) => [k.no_kontrak, ...k.addendum.map((a) => a.no), ...k.termin.map((t) => t.no_invoice)].some((x) => String(x ?? '').toLowerCase().includes(q)));
    rows.sort((a, b) => bandingkan(a[S.urutKontrak.k], b[S.urutKontrak.k]) * S.urutKontrak.arah || bandingkan(a.no_kontrak, b.no_kontrak));
    hitungan.textContent = rows.length + ' kontrak · nilai ' + rp(rows.reduce((s, k) => s + k.total, 0)) + ' · sisa ' + rp(rows.reduce((s, k) => s + k.sisa, 0));
    tabel.querySelector('thead').replaceWith(kepalaUrut(KOLOM, S.urutKontrak, gambar));
    badan.replaceChildren(...(rows.length ? rows.map((k) => {
      const buka = () => { location.hash = '#kontrak-' + k.id; };
      return h('tr', {class: 'bisa-klik', tabindex: '0', onclick: buka, onkeydown: (ev) => { if (ev.key === 'Enter') buka(); }},
        h('td', {class: 'nw'}, k.kode), h('td', null, isi(k.nama_proyek)), h('td', null, isi(k.klien)), h('td', {class: 'nw'}, k.no_kontrak, k.addendum.length > 0 && h('span', {class: 'kecil redup'}, ' +' + k.addendum.length + ' addendum')),
        h('td', {class: 'nw'}, tgl(k.tanggal)), h('td', {class: 'kanan'}, rp(k.total)), h('td', {class: 'kanan'}, rp(k.ditagih)), h('td', {class: 'kanan'}, rp(k.diterima)),
        h('td', {class: 'kanan'}, rp(k.sisa)), h('td', {class: 'kanan'}, pct(k.pct_terbayar)), h('td', null, pill(k.status)), h('td', null, tombolBukti(k.file)));
    }) : [h('tr', null, h('td', {colspan: String(KOLOM.length), class: 'redup'}, semua.length ? 'Tidak ada kontrak yang cocok dengan saringan.' : 'Belum ada kontrak klien. Klik "+ Kontrak" untuk mencatat kontrak pertama.'))]));
  };
  const proyekAda = [...new Set(semua.map((k) => k.kode))].sort(bandingkan);
  const klienAda = [...new Map(semua.filter((k) => k.klien_ref).map((k) => [k.klien_ref, k.klien])).entries()].sort((a, b) => bandingkan(a[1], b[1]));
  const tahunAda = [...new Set(semua.map((k) => String(k.tanggal).slice(0, 4)))].sort().reverse();
  const saring = (id, label, daftar, kunci) => pilihan(id, [['', label], ...daftar], sr[kunci], {'aria-label': label, onchange: (ev) => { sr[kunci] = ev.target.value; gambar(); }});
  panel.append(
    h('div', {class: 'alat'},
      h('input', {type: 'search', placeholder: 'Cari nomor kontrak / addendum / invoice…', 'aria-label': 'Cari nomor', value: sr.q, oninput: (ev) => { sr.q = ev.target.value; gambar(); }}),
      saring('sk-proyek', 'Semua proyek', proyekAda.map((x) => [x, x + ' — ' + isi(proyekDari(x)?.nama)]), 'proyek'),
      saring('sk-klien', 'Semua klien', klienAda, 'klien'),
      saring('sk-tahun', 'Semua tahun', tahunAda.map((x) => [x, x]), 'tahun'),
      saring('sk-status', 'Semua status', STATUS_KONTRAK.map((x) => [x, x]), 'status'),
      hitungan, h('span', {class: 'pegas'}),
      bisaKontrak() && h('button', {class: 'btn btn-utama', type: 'button', onclick: () => bukaFormKontrak(null)}, '+ Kontrak')),
    h('div', {class: 'gulir'}, tabel));
  gambar();
}

// =====================================================================
// Detail kontrak
// =====================================================================
export function renderDetailKontrak(el, id) {
  if (belumSiap(el)) return;
  const k = kontrakDari(id);
  const kembali = h('a', {href: '#kontrak', class: 'kecil'}, '← Kontrak');
  if (!k) { el.append(h('div', {class: 'kepala'}, kembali, h('h1', null, 'Kontrak tidak ditemukan'), h('p', {class: 'redup'}, 'Kontrak ini mungkin sudah dihapus.'))); return; }
  const today = hariIni(), v = k.nilai;
  const adaTitipan = v.titipan > 0 || k.termin.some((t) => t.titipan > 0);
  const denda = !k.tgl_serah_terima ? dendaAlinea(k, k.selesai_berlaku, k.total, today) : null;
  const terakhirAdd = k.addendum.slice().sort((a, b) => bandingkan(a.dibuat, b.dibuat) || bandingkan(a.id, b.id)).at(-1);
  const dendaTeks = (persen, satuan, maks, jenis) => (+persen > 0 ? idn(+persen, 3) + '% ' + (satuan || 'per hari') + (maks != null && +maks > 0 ? ', maksimal ' + (jenis === 'rp' ? rp(maks) : idn(+maks, 2) + '% dari nilai') : '') : null);

  el.append(
    h('div', {class: 'kepala'}, kembali,
      h('div', {class: 'judul-baris'}, h('h1', null, k.no_kontrak), pill(k.status), h('span', {class: 'pegas'}),
        k.file && tombolBukti(k.file),
        bisaKontrak() && h('button', {class: 'btn', type: 'button', onclick: () => bukaFormAddendum(k, null)}, '+ Addendum'),
        bisaKontrak() && h('button', {class: 'btn btn-utama', type: 'button', onclick: () => bukaFormKontrak(k)}, 'Ubah kontrak')),
      h('p', {class: 'redup'}, [k.kode + ' — ' + isi(k.nama_proyek), k.klien ? 'Klien: ' + k.klien : 'Klien belum diisi di data proyek', tgl(k.tanggal)].join(' · '))),
    h('section', {class: 'ubin-grid', 'aria-label': 'Ringkasan kontrak'},
      ubin('Nilai total', rp(k.total), [v.titipan ? 'jasa ' + rp(v.jasa) + ' + titipan ' + rp(v.titipan) : 'jasa ' + rp(v.jasa), v.ppn ? 'PPN ' + rp(v.ppn) : null].filter(Boolean).join(' · ')),
      ubin('Ditagih', rp(k.ditagih), k.termin.filter((t) => t.no_invoice).length + ' dari ' + k.termin.length + ' tagihan'),
      ubin('Diterima', rp(k.diterima), pct(k.pct_terbayar) + ' dari nilai total'),
      ubin('Sisa', rp(k.sisa), 'piutang ' + rp(k.piutang) + ' · belum ditagih ' + rp(k.belum_ditagih))),
    denda && h('div', {class: 'kotak-galat'}, '⚠ Tenggat pekerjaan ' + tgl(k.selesai_berlaku) + ' sudah lewat ' + denda.hari + ' hari. Potensi denda keterlambatan menurut kontrak: ' + rp(denda.denda) + (denda.dibatasi ? ' (sudah mencapai batas maksimal)' : '') + '. Informasi saja, tidak dijurnal.'),
    h('section', {class: 'kartu'}, h('h2', null, 'Jadwal termin'),
      tabelTermin(k, adaTitipan),
      h('p', {class: 'kecil redup'}, 'Klik baris untuk menerbitkan invoice dan mencatat penerimaan. Retensi dipotong dari setiap termin (dari nilai sebelum PPN) dan ditagih terpisah setelah masa pemeliharaan selesai.')),
    h('section', {class: 'kartu'}, h('div', {class: 'judul-baris'}, h('h2', null, 'Addendum'), h('span', {class: 'pegas'}),
      bisaKontrak() && h('button', {class: 'btn btn-kecil', type: 'button', onclick: () => bukaFormAddendum(k, null)}, '+ Addendum')),
      h('div', {class: 'gulir'}, h('table', {class: 'tabel'},
        h('thead', null, h('tr', null, ['No. addendum', 'Tanggal', 'Perubahan jasa', 'Perubahan titipan', 'Selesai baru', 'Termin', 'Uraian', 'PDF'].map((x, i) => h('th', {class: i === 2 || i === 3 ? 'kanan' : null}, x)))),
        h('tbody', null, k.addendum.length ? k.addendum.map((a) => h('tr', {class: 'bisa-klik', tabindex: '0', onclick: () => bukaFormAddendum(k, a, a.id === terakhirAdd?.id)},
          h('td', {class: 'nw'}, a.no), h('td', {class: 'nw'}, tgl(a.tanggal)), h('td', {class: 'kanan'}, rpTanda(a.tambah_jasa)), h('td', {class: 'kanan'}, rpTanda(a.tambah_titipan)),
          h('td', {class: 'nw'}, a.selesai_baru ? tgl(a.selesai_baru) : '—'), h('td', null, a.cara_termin === 'tambah' ? 'Termin tambahan' : 'Termin disesuaikan'),
          h('td', {class: 'lebar'}, isi(a.uraian)), h('td', null, tombolBukti(a.file))))
          : h('tr', null, h('td', {colspan: '8', class: 'redup'}, 'Belum ada addendum. Perubahan nilai atau waktu pekerjaan dicatat sebagai addendum tertulis.')))))),
    h('section', {class: 'kartu'}, h('h2', null, 'Rincian kontrak'),
      rincian([
        ['Proyek', k.kode + ' — ' + isi(k.nama_proyek)], ['Klien', k.klien || '— (isi klien di data Proyek)'],
        ['Jenis perjanjian', k.jenis_perjanjian], ['Bentuk dokumen', k.bentuk_dokumen],
        ['Nilai jasa', rp(k.nilai_jasa) + (v.jasa !== k.nilai_jasa ? ' → ' + rp(v.jasa) + ' setelah addendum' : '')],
        (k.nilai_titipan || v.titipan) && ['Material & tukang (titipan)', rp(k.nilai_titipan) + (v.titipan !== k.nilai_titipan ? ' → ' + rp(v.titipan) + ' setelah addendum' : '') + ' — dicatat sebagai Hutang Dana Titipan Klien, bukan pendapatan'],
        ['PPN', MODE_PPN[k.ppn] + (k.ppn !== 'tidak' ? ' · tarif ' + persenBp(k.tarif_ppn_bp) + ' dari nilai jasa' : '')],
        ['Akun pendapatan', k.akun_pendapatan + ' ' + AKUN_PENDAPATAN[k.akun_pendapatan]],
        ['Masa pekerjaan', (k.mulai ? tgl(k.mulai) : '—') + ' s.d. ' + (k.selesai_berlaku ? tgl(k.selesai_berlaku) : '—') + (k.selesai_berlaku !== k.selesai && k.selesai ? ' (awal ' + tgl(k.selesai) + ', diubah addendum)' : '')],
        ['Denda keterlambatan Alinea', dendaTeks(k.denda_alinea_persen, 'per hari', k.denda_alinea_maks, k.denda_alinea_maks_jenis)],
        ['Denda keterlambatan bayar klien', dendaTeks(k.denda_klien_persen, SATUAN_DENDA[k.denda_klien_satuan], k.denda_klien_maks, k.denda_klien_maks_jenis)],
        ['Retensi', k.retensi_bp ? persenBp(k.retensi_bp) + ' · masa pemeliharaan ' + isi(k.masa_pemeliharaan_hari) + ' hari' : 'Tidak ada'],
        k.retensi_bp > 0 && ['Serah terima / pencairan', (k.tgl_serah_terima ? tgl(k.tgl_serah_terima) : 'belum serah terima') + (k.tgl_pencairan ? ' · retensi bisa ditagih mulai ' + tgl(k.tgl_pencairan) : '')],
        ['Garansi', +k.garansi_bulan > 0 ? k.garansi_bulan + ' bulan' + (k.garansi_mulai ? ' sejak ' + tgl(k.garansi_mulai) + ', berakhir ' + tgl(k.garansi_akhir) : ' (tanggal mulai belum diisi)') : null],
        ['Klausul penting', k.klausul],
      ])));
}
const rpTanda = (x) => (x > 0 ? '+' + rp(x) : x < 0 ? '−' + rp(-x) : '—');

function tabelTermin(k, adaTitipan) {
  const kol = ['Tagihan', 'Milestone / syarat tagih', 'Perkiraan tagih', 'Porsi jasa', adaTitipan && 'Titipan', 'PPN', 'Retensi', 'Nilai tagihan', 'No. invoice', 'Jatuh tempo', 'Diterima', 'Sisa', 'Status'].filter(Boolean);
  const kanan = new Set(['Porsi jasa', 'Titipan', 'PPN', 'Retensi', 'Nilai tagihan', 'Diterima', 'Sisa']);
  const jumlah = (f) => k.termin.reduce((s, t) => s + (typeof f === 'function' ? f(t) : t[f]), 0);
  return h('div', {class: 'gulir'}, h('table', {class: 'tabel'},
    h('thead', null, h('tr', null, kol.map((x) => h('th', {class: kanan.has(x) ? 'kanan' : null}, x)))),
    h('tbody', null, k.termin.length ? k.termin.map((t) => h('tr', {class: 'bisa-klik', tabindex: '0', onclick: () => bukaTermin(t.id), onkeydown: (ev) => { if (ev.key === 'Enter') bukaTermin(t.id); }},
      h('td', {class: 'nw'}, labelTermin(t)), h('td', {class: 'lebar'}, isi(t.milestone)), h('td', {class: 'nw'}, t.jenis === 'retensi' ? (t.tgl_pencairan ? tgl(t.tgl_pencairan) : 'setelah pemeliharaan') : tgl(t.perkiraan_tagih)),
      h('td', {class: 'kanan'}, rp(t.jasa)), adaTitipan && h('td', {class: 'kanan'}, rp(t.titipan)), h('td', {class: 'kanan'}, t.ppn ? rp(t.ppn) : '—'),
      h('td', {class: 'kanan'}, t.ret_jasa + t.ret_titipan ? '−' + rp(t.ret_jasa + t.ret_titipan) : '—'), h('td', {class: 'kanan'}, h('b', null, rp(t.tagihan))),
      h('td', {class: 'nw'}, isi(t.no_invoice)), h('td', {class: 'nw'}, tgl(t.jatuh_tempo)), h('td', {class: 'kanan'}, t.diterima ? rp(t.diterima) : '—'),
      h('td', {class: 'kanan'}, t.no_invoice ? rp(t.sisa) : '—'), h('td', null, pill(t.status))))
      : h('tr', null, h('td', {colspan: String(kol.length), class: 'redup'}, 'Belum ada termin.'))),
    k.termin.length > 0 && h('tfoot', null, h('tr', null, h('th', {colspan: '3'}, 'Total'), h('th', {class: 'kanan'}, rp(jumlah('jasa'))), adaTitipan && h('th', {class: 'kanan'}, rp(jumlah('titipan'))),
      h('th', {class: 'kanan'}, rp(jumlah('ppn'))), h('th', {class: 'kanan'}, '—'), h('th', {class: 'kanan'}, rp(jumlah('tagihan'))), h('th', {colspan: '2'}),
      h('th', {class: 'kanan'}, rp(jumlah('diterima'))), h('th', {class: 'kanan'}, rp(k.piutang)), h('th')))));
}

// =====================================================================
// Formulir kontrak
// =====================================================================
export function bukaFormKontrak(lama, awal = {}) {
  const bisa = bisaKontrak();
  const sudahTagih = !!lama?.termin.some((t) => t.no_invoice);
  const galat = h('p', {class: 'form-galat', role: 'alert'});
  const proyek = pilihCari('kt-proyek', opsiProyek(), lama?.proyek_kode || awal.proyek_kode || '', {wajib: true, label: 'Cari proyek', placeholder: 'Ketik kode atau nama proyek'});
  const proyekNilai = proyek.querySelector('input[type=hidden]');
  const klienEl = h('input', {id: 'kt-klien', type: 'text', readonly: true, tabindex: '-1'});
  const no = teks('kt-no', lama?.no_kontrak, {required: true, placeholder: 'mis. 012/A5/SPK/XI/2026'});
  const tglEl = tanggal('kt-tgl', lama?.tanggal || hariIni(), {required: true});
  const jenis = pilihan('kt-jenis', [['', 'Pilih…'], ...opsiTeks('jenisPerjanjian')], lama?.jenis_perjanjian || '');
  const bentuk = pilihan('kt-bentuk', [['', 'Pilih…'], ...opsiTeks('bentukDokumen')], lama?.bentuk_dokumen || '');
  const file = pilihBukti('kt-file', lama?.file, {label: 'File kontrak (PDF)', hanyaPdf: true});
  const jasa = uang('kt-jasa', lama?.nilai_jasa ?? '', {required: true});
  const titipan = uang('kt-titipan', lama?.nilai_titipan || '');
  const ppn = pilihan('kt-ppn', Object.entries(MODE_PPN), lama?.ppn || 'tidak');
  const ketPpn = h('span', {class: 'kecil redup'});
  const akun = pilihan('kt-akun', Object.entries(AKUN_PENDAPATAN).map(([k, l]) => [k, k + ' ' + l]), lama?.akun_pendapatan || '4-1');
  let akunDiubah = !!lama;
  akun.addEventListener('change', () => { akunDiubah = true; });
  const mulai = tanggal('kt-mulai', lama?.mulai), selesai = tanggal('kt-selesai', lama?.selesai);
  const dA = teks('kt-da', lama?.denda_alinea_persen ?? '', {inputmode: 'decimal', placeholder: 'mis. 0,1'});
  const dAMaks = teks('kt-da-maks', lama?.denda_alinea_maks ?? '', {inputmode: 'decimal', placeholder: 'opsional'});
  const dAJenis = pilihan('kt-da-jenis', [['persen', '% dari nilai kontrak'], ['rp', 'Rupiah']], lama?.denda_alinea_maks_jenis || 'persen');
  const dK = teks('kt-dk', lama?.denda_klien_persen ?? '', {inputmode: 'decimal', placeholder: 'mis. 1'});
  const dKSat = pilihan('kt-dk-sat', Object.entries(SATUAN_DENDA), lama?.denda_klien_satuan || 'bulan');
  const dKMaks = teks('kt-dk-maks', lama?.denda_klien_maks ?? '', {inputmode: 'decimal', placeholder: 'opsional'});
  const dKJenis = pilihan('kt-dk-jenis', [['persen', '% dari nilai tagihan'], ['rp', 'Rupiah']], lama?.denda_klien_maks_jenis || 'persen');
  const retensi = teks('kt-ret', lama?.retensi_bp ? idn(bpKePersen(lama.retensi_bp), 2) : '', {inputmode: 'decimal', placeholder: '0'});
  const masa = teks('kt-masa', lama?.masa_pemeliharaan_hari ?? '', {inputmode: 'numeric', placeholder: 'mis. 90'});
  const serah = tanggal('kt-serah', lama?.tgl_serah_terima);
  const garansi = teks('kt-garansi', lama?.garansi_bulan ?? '', {inputmode: 'numeric', placeholder: 'opsional'});
  const garansiMulai = tanggal('kt-garansi-mulai', lama?.garansi_mulai);
  const klausul = h('textarea', {id: 'kt-klausul', rows: '3', placeholder: 'Ringkasan klausul penting: lingkup, perubahan, force majeure, penyelesaian sengketa, dll.'}, lama?.klausul ?? '');
  const tarif = () => (ppn.value === 'tidak' ? 0 : lama && lama.ppn === ppn.value && lama.tarif_ppn_bp > 0 ? lama.tarif_ppn_bp : K().akuntansi.tarif_ppn_bp);

  if (sudahTagih) {
    for (const x of [ppn, retensi]) x.disabled = true;
    proyek.querySelectorAll('input').forEach((x) => { x.disabled = true; });
  }
  const kunciPpn = () => {
    const pkp = pkpPada(S.profil, tglEl.value);
    for (const o of ppn.options) if (o.value !== 'tidak') o.disabled = !pkp && !sudahTagih;
    if (!pkp && ppn.value !== 'tidak' && !sudahTagih) ppn.value = 'tidak';
    ketPpn.textContent = sudahTagih ? 'Sudah ada invoice: perlakuan PPN dan retensi dikunci.'
      : !pkp ? 'Perusahaan belum PKP pada tanggal kontrak (Pengaturan → Profil perusahaan), jadi tidak ada PPN.'
        : ppn.value === 'tidak' ? 'PPN hanya dikenakan pada nilai jasa.' : 'Tarif ' + persenBp(tarif()) + ' dari nilai jasa (material/tukang titipan tidak kena PPN).';
  };
  const isiKlien = () => {
    const p = proyekDari(proyekNilai.value);
    klienEl.value = p ? (p.klien || '— klien belum diisi di data Proyek') : '';
    if (p && !akunDiubah) akun.value = akunPendapatanDari(p.layanan);
  };

  // --- jadwal termin ---
  const addendum = lama?.addendum || [];
  const target = () => nilaiKontrak({nilai_jasa: jasa.nilai() || 0, nilai_titipan: titipan.nilai() || 0, ppn: 'tidak'}, addendum);
  let mode = lama ? 'rupiah' : 'persen';
  let baris = lama ? lama.termin.filter((t) => t.jenis === 'termin').map((t) => ({id: t.id, milestone: t.milestone || '', perkiraan_tagih: t.perkiraan_tagih || '', jasa: t.jasa, titipan: t.titipan, kunci: !!t.no_invoice, pct: ''}))
    : [{milestone: 'Uang muka', perkiraan_tagih: '', jasa: 0, titipan: 0, pct: ''}];
  const badanTermin = h('tbody'), kakiTermin = h('tfoot'), statusTermin = h('div', {class: 'kecil'});
  const modeEl = h('div', {class: 'baris-tombol'}, h('span', {class: 'kecil redup'}, 'Isi termin dengan:'),
    ...[['persen', 'Persen (%)'], ['rupiah', 'Rupiah']].map(([m, l]) => h('label', {class: 'centang'}, h('input', {type: 'radio', name: 'kt-mode', value: m, checked: mode === m, onchange: () => { mode = m; isiPersenDariNilai(); gambarTermin(); }}), ' ', l)));
  const cepat = teks('kt-cepat', '', {placeholder: 'mis. 30/40/30', 'aria-label': 'Pola persen termin', style: {maxWidth: '140px'}});
  const isiPersenDariNilai = () => {
    const tg = target(), total = tg.jasa + tg.titipan;
    for (const b of baris) b.pct = total ? idn((b.jasa + b.titipan) / total * 100, 2) : '';
  };
  // Persen -> rupiah. Bila total persen tepat 100%, baris terakhir yang belum ditagih menerima sisa pembulatan.
  const hitungDariPersen = () => {
    if (mode !== 'persen') return;
    const tg = target();
    const bebas = baris.filter((b) => !b.kunci);
    for (const b of bebas) { const bp = persenKeBp(b.pct) ?? 0; b.jasa = bagi(tg.jasa, bp, 10000); b.titipan = bagi(tg.titipan, bp, 10000); }
    const totalBp = baris.reduce((s, b) => s + (b.kunci ? Math.round((b.jasa + b.titipan) / Math.max(1, tg.jasa + tg.titipan) * 10000) : persenKeBp(b.pct) ?? 0), 0);
    if (totalBp === 10000 && bebas.length) {
      const akhir = bebas.at(-1);
      akhir.jasa += tg.jasa - baris.reduce((s, b) => s + b.jasa, 0);
      akhir.titipan += tg.titipan - baris.reduce((s, b) => s + b.titipan, 0);
    }
  };
  const kontrakSementara = () => ({ppn: ppn.value, tarif_ppn_bp: tarif(), retensi_bp: persenKeBp(retensi.value) ?? 0});
  const gambarTermin = () => {
    hitungDariPersen();
    const tg = target(), adaTitipan = tg.titipan > 0 || baris.some((b) => b.titipan > 0), ks = kontrakSementara();
    const sel = (b, k) => {
      const u = uang(null, b[k], {'aria-label': k === 'jasa' ? 'Porsi jasa' : 'Porsi titipan', disabled: b.kunci || !bisa, oninput: () => { b[k] = u.nilai() || 0; perbaruiKaki(); }});
      return u.el;
    };
    badanTermin.replaceChildren(...baris.map((b, i) => {
      const nilaiTagih = h('td', {class: 'kanan nw'});
      const isiTagih = () => { nilaiTagih.textContent = rp(hitungTermin({jenis: 'termin', jasa: b.jasa, titipan: b.titipan}, ks).tagihan); };
      isiTagih();
      b.isiTagih = isiTagih;
      return h('tr', null,
        h('td', {class: 'nw'}, String(i + 1), b.kunci && h('span', {title: 'Sudah ditagih'}, ' 🔒')),
        h('td', null, h('input', {type: 'text', value: b.milestone, 'aria-label': 'Milestone termin ' + (i + 1), placeholder: 'mis. Desain skematik disetujui', disabled: !bisa, oninput: (ev) => { b.milestone = ev.target.value; }})),
        h('td', null, h('input', {type: 'date', value: b.perkiraan_tagih || '', 'aria-label': 'Perkiraan tagih termin ' + (i + 1), disabled: b.kunci || !bisa, onchange: (ev) => { b.perkiraan_tagih = ev.target.value; }})),
        mode === 'persen'
          ? h('td', null, h('div', {class: 'berakhiran'}, h('input', {type: 'text', inputmode: 'decimal', value: b.pct, 'aria-label': 'Persen termin ' + (i + 1), disabled: b.kunci || !bisa, style: {width: '80px'},
            oninput: (ev) => { b.pct = ev.target.value; hitungDariPersen(); perbaruiNilai(); }}), h('span', null, '%')))
          : null,
        mode === 'persen' ? h('td', {class: 'kanan nw', 'data-k': 'jasa'}, rp(b.jasa)) : h('td', null, sel(b, 'jasa')),
        adaTitipan && (mode === 'persen' ? h('td', {class: 'kanan nw', 'data-k': 'titipan'}, rp(b.titipan)) : h('td', null, sel(b, 'titipan'))),
        nilaiTagih,
        h('td', null, !b.kunci && bisa && baris.length > 1 && h('button', {class: 'btn btn-kecil', type: 'button', 'aria-label': 'Hapus termin ' + (i + 1), onclick: () => { baris.splice(i, 1); gambarTermin(); }}, '✕')));
    }));
    kepalaTermin.replaceChildren(h('tr', null, ['Ke', 'Milestone / syarat tagih', 'Perkiraan tagih', mode === 'persen' && '%', 'Porsi jasa', adaTitipan && 'Titipan', 'Nilai tagihan', ''].filter((x) => x !== false && x != null)
      .map((x) => h('th', {class: ['Porsi jasa', 'Titipan', 'Nilai tagihan'].includes(x) ? 'kanan' : null}, x))));
    perbaruiKaki();
  };
  const perbaruiNilai = () => {
    badanTermin.querySelectorAll('tr').forEach((tr, i) => {
      const b = baris[i];
      tr.querySelector('[data-k=jasa]') && (tr.querySelector('[data-k=jasa]').textContent = rp(b.jasa));
      tr.querySelector('[data-k=titipan]') && (tr.querySelector('[data-k=titipan]').textContent = rp(b.titipan));
    });
    perbaruiKaki();
  };
  const kepalaTermin = h('thead');
  const perbaruiKaki = () => {
    const tg = target(), sj = baris.reduce((s, b) => s + b.jasa, 0), st = baris.reduce((s, b) => s + b.titipan, 0);
    const total = tg.jasa + tg.titipan, persen = total ? (sj + st) / total * 100 : 0;
    for (const b of baris) b.isiTagih?.();
    const pas = sj === tg.jasa && st === tg.titipan && total > 0;
    statusTermin.replaceChildren(pas ? h('span', {class: 'baik'}, '✓ Total termin 100% dari nilai kontrak (' + rp(total) + ').')
      : h('span', {class: 'form-galat'}, '✗ Total termin ' + idn(persen, 2) + '% — harus tepat 100%. ' + (sj !== tg.jasa ? 'Porsi jasa ' + rp(sj) + ' dari ' + rp(tg.jasa) + '. ' : '') + (st !== tg.titipan ? 'Porsi titipan ' + rp(st) + ' dari ' + rp(tg.titipan) + '.' : '')));
  };
  const tambahBaris = () => { baris.push({milestone: '', perkiraan_tagih: '', jasa: 0, titipan: 0, pct: ''}); gambarTermin(); };
  const terapkanCepat = () => {
    const bagian = cepat.value.split(/[/;+\s]+/).map((x) => x.trim()).filter(Boolean);
    if (!bagian.length || bagian.some((x) => persenKeBp(x) == null)) { galat.textContent = 'Pola cepat ditulis seperti 30/40/30.'; return; }
    galat.textContent = '';
    const kunci = baris.filter((b) => b.kunci);
    baris = [...kunci, ...bagian.map((p, i) => ({milestone: baris.filter((b) => !b.kunci)[i]?.milestone || '', perkiraan_tagih: '', jasa: 0, titipan: 0, pct: p}))];
    mode = 'persen';
    modeEl.querySelector('input[value=persen]').checked = true;
    gambarTermin();
  };

  // --- simpan ---
  const simpan = h('button', {class: 'btn btn-utama', type: 'submit'}, 'Simpan');
  let dlg;
  const form = h('form', {class: 'form', onsubmit: async (ev) => {
    ev.preventDefault();
    galat.textContent = '';
    const ret = persenKeBp(retensi.value);
    if (ret == null) { galat.textContent = 'Retensi ditulis dalam persen, maksimal 2 angka desimal (mis. 5).'; retensi.focus(); return; }
    const d = {
      proyek_kode: proyekNilai.value, no_kontrak: no.value.trim(), tanggal: tglEl.value, jenis_perjanjian: jenis.value || null, bentuk_dokumen: bentuk.value || null,
      nilai_jasa: jasa.nilai(), nilai_titipan: titipan.nilai() || 0, ppn: ppn.value, akun_pendapatan: akun.value, mulai: mulai.value || null, selesai: selesai.value || null,
      denda_alinea_persen: angka(dA.value), denda_alinea_maks: angka(dAMaks.value), denda_alinea_maks_jenis: dAMaks.value.trim() ? dAJenis.value : null,
      denda_klien_persen: angka(dK.value), denda_klien_satuan: dK.value.trim() ? dKSat.value : null, denda_klien_maks: angka(dKMaks.value), denda_klien_maks_jenis: dKMaks.value.trim() ? dKJenis.value : null,
      retensi_bp: ret, masa_pemeliharaan_hari: angka(masa.value), tgl_serah_terima: serah.value || null,
      garansi_bulan: angka(garansi.value), garansi_mulai: garansiMulai.value || null, klausul: klausul.value.trim() || null,
    };
    for (const [k, v] of Object.entries(d)) if (typeof v === 'number' && !Number.isFinite(v)) { galat.textContent = 'Isian angka tidak sah (' + k.replace(/_/g, ' ') + ').'; return; }
    if ([d.masa_pemeliharaan_hari, d.garansi_bulan].some((x) => x != null && !Number.isInteger(x))) { galat.textContent = 'Masa pemeliharaan dan garansi diisi angka bulat.'; return; }
    hitungDariPersen();
    const termin = baris.map((b) => ({id: b.id || null, milestone: b.milestone.trim() || null, perkiraan_tagih: b.perkiraan_tagih || null, jasa: b.jasa, titipan: b.titipan, jenis: 'termin'}));
    const salah = periksaKontrak({...d, id: lama?.id, tarif_ppn_bp: tarif()}, termin, {kontrak: K().kontrak_klien, proyek: S.d.proyek.map((p) => p.kode), profil: S.profil, addendum});
    if (salah.length) { galat.replaceChildren(...salah.map((x) => h('div', null, x))); return; }
    try {
      await sambilMenyimpan(simpan, async () => {
        d.file = await file.ambil('kontrak/' + (lama?.id || 'baru'));
        const hasil = await store.keu.simpanKontrak(lama?.id, d, termin);
        dlg.close();
        await segarkanKeuangan();
        const id = lama?.id || hasil?.id || hasil;
        if (id && typeof id === 'string') location.hash = '#kontrak-' + id;
      });
      pesan(lama ? 'Kontrak tersimpan.' : 'Kontrak tersimpan. Jadwal termin sudah dibuat.');
    } catch (e) { galat.textContent = e.message; }
  }},
    h('div', {class: 'form-bagian'}, h('h3', null, 'Identitas kontrak'),
      h('div', {class: 'form-grid'},
        medan('Proyek', proyek, {wajib: true, id: 'kt-proyek-cari', bantuan: sudahTagih ? 'Sudah ada invoice: proyek tidak bisa diganti.' : null}),
        medan('Klien', klienEl, {bantuan: 'Otomatis dari proyek. Ubah klien di data Proyek.'}),
        medan('No. kontrak / SPK', no, {wajib: true}), medan('Tanggal kontrak', tglEl, {wajib: true}),
        medan('Jenis perjanjian', jenis), medan('Bentuk dokumen', bentuk), file.el)),
    h('div', {class: 'form-bagian'}, h('h3', null, 'Nilai dan pajak'),
      h('div', {class: 'form-grid'},
        medan('Nilai jasa', jasa.el, {wajib: true, id: 'kt-jasa', bantuan: 'Fee desain / jasa pelaksanaan. Bila "sudah termasuk PPN", isi nilai bruto.'}),
        medan('Material & tukang turn-key (titipan)', titipan.el, {id: 'kt-titipan', bantuan: 'Dana klien untuk material/upah. Masuk Hutang Dana Titipan Klien, bukan pendapatan. Kosongkan bila tidak ada.'}),
        medan('PPN', h('div', null, ppn, ketPpn), {id: 'kt-ppn'}),
        medan('Akun pendapatan', akun, {bantuan: 'Bawaan dari jenis layanan proyek; boleh diubah.'}),
        addendum.length > 0 && h('div', {class: 'medan medan-lebar kotak-info kecil'}, 'Kontrak ini punya ' + addendum.length + ' addendum. Jadwal termin harus 100% dari nilai setelah addendum.'))),
    h('div', {class: 'form-bagian'}, h('div', {class: 'judul-baris'}, h('h3', null, 'Jadwal termin'), h('span', {class: 'pegas'}), modeEl),
      h('div', {class: 'gulir'}, h('table', {class: 'tabel tabel-isian'}, kepalaTermin, badanTermin, kakiTermin)),
      statusTermin,
      bisa && h('div', {class: 'baris-tombol'}, h('button', {class: 'btn btn-kecil', type: 'button', onclick: tambahBaris}, '+ Termin'),
        h('span', {class: 'kecil redup'}, 'Isi cepat:'), cepat, h('button', {class: 'btn btn-kecil', type: 'button', onclick: terapkanCepat}, 'Terapkan')),
      h('p', {class: 'kecil redup'}, 'Untuk kontrak turn-key, mode persen membagi setiap termin ke porsi jasa dan titipan sebanding nilainya. Nilai tagihan sudah memperhitungkan PPN dan potongan retensi.')),
    h('div', {class: 'form-bagian'}, h('h3', null, 'Waktu, denda, retensi, garansi'),
      h('div', {class: 'form-grid'},
        medan('Mulai pekerjaan', mulai), medan('Selesai pekerjaan (tenggat)', selesai),
        medan('Denda keterlambatan Alinea (% per hari)', dA), medan('Batas denda Alinea', h('div', {class: 'baris-tombol'}, dAMaks, dAJenis), {id: 'kt-da-maks'}),
        medan('Denda keterlambatan bayar klien (%)', h('div', {class: 'baris-tombol'}, dK, dKSat), {id: 'kt-dk', bantuan: 'Informasi saja; tidak ditagih otomatis.'}),
        medan('Batas denda klien', h('div', {class: 'baris-tombol'}, dKMaks, dKJenis), {id: 'kt-dk-maks'}),
        medan('Retensi (%)', retensi, {bantuan: 'Dipotong dari setiap termin (dari nilai sebelum PPN).'}),
        medan('Masa pemeliharaan (hari)', masa, {bantuan: 'Wajib bila ada retensi.'}),
        medan('Tanggal serah terima', serah, {bantuan: 'Retensi bisa ditagih setelah serah terima + masa pemeliharaan.'}),
        medan('Garansi (bulan)', garansi), medan('Garansi mulai', garansiMulai),
        medan('Klausul penting', klausul, {lebar: true}))),
    galat,
    kaki(lama && bisa && !sudahTagih && tombolHapus(async () => { await store.keu.hapusKontrak(lama.id); dlg.close(); location.hash = '#kontrak'; await segarkanKeuangan(); pesan('Kontrak dihapus.'); }),
      lama && sudahTagih && h('span', {class: 'kecil redup'}, 'Kontrak yang sudah punya invoice tidak bisa dihapus.'),
      h('span', {class: 'pegas'}), h('button', {class: 'btn', type: 'button', onclick: () => dlg.close()}, bisa ? 'Batal' : 'Tutup'), bisa && simpan));
  if (!bisa) form.querySelectorAll('input,select,textarea').forEach((x) => { x.disabled = true; });
  proyekNilai.addEventListener('change', isiKlien);
  tglEl.addEventListener('change', kunciPpn);
  ppn.addEventListener('change', () => { kunciPpn(); gambarTermin(); });
  retensi.addEventListener('input', () => gambarTermin());
  for (const u of [jasa, titipan]) u.inp.addEventListener('input', () => gambarTermin());
  dlg = dialogLebar(lama ? 'Ubah kontrak ' + lama.no_kontrak : 'Tambah kontrak klien', form);
  isiKlien(); kunciPpn();
  if (lama) isiPersenDariNilai();
  gambarTermin();
}
const opsiTeks = (k) => (OPSI[k] || []).map((x) => [x, x]);

// =====================================================================
// Addendum
// =====================================================================
function bukaFormAddendum(k, a, terakhir = false) {
  const bisa = bisaKontrak();
  const galat = h('p', {class: 'form-galat', role: 'alert'});
  const no = teks('ad-no', a?.no, {required: true, placeholder: 'mis. ADD-01'});
  const tglEl = tanggal('ad-tgl', a?.tanggal || hariIni(), {required: true});
  const selesaiBaru = tanggal('ad-selesai', a?.selesai_baru);
  const uraian = h('textarea', {id: 'ad-uraian', rows: '2', placeholder: 'Perubahan lingkup / nilai / waktu'}, a?.uraian ?? '');
  const file = pilihBukti('ad-file', a?.file, {label: 'File addendum (PDF)', hanyaPdf: true});
  const arah = pilihan('ad-arah', [['tambah', 'Nilai bertambah'], ['kurang', 'Nilai berkurang']], 'tambah');
  const dJasa = uang('ad-jasa', ''), dTitipan = uang('ad-titipan', '');
  let cara = 'tambah';
  const caraEl = h('div', {class: 'daftar-centang'}, ...[['tambah', 'Buat termin tambahan untuk selisihnya'], ['sesuaikan', 'Sesuaikan termin yang belum ditagih (sebanding nilainya)']].map(([v, l]) =>
    h('label', {class: 'centang'}, h('input', {type: 'radio', name: 'ad-cara', value: v, checked: cara === v, onchange: () => { cara = v; gambar(); }}), ' ', l)));
  const wadahTermin = h('div');
  let tambahan = [{milestone: '', jasa: 0, titipan: 0, perkiraan_tagih: ''}];
  const selisih = () => { const s = arah.value === 'kurang' ? -1 : 1; return {jasa: s * (dJasa.nilai() || 0), titipan: s * (dTitipan.nilai() || 0)}; };
  let usulan = null;
  const gambar = () => {
    const d = selisih();
    usulan = null;
    if (arah.value === 'kurang' && cara === 'tambah') { cara = 'sesuaikan'; caraEl.querySelector('input[value=sesuaikan]').checked = true; }
    caraEl.querySelector('input[value=tambah]').disabled = arah.value === 'kurang';
    if (cara === 'tambah') {
      if (tambahan.length === 1 && !tambahan[0].diubah) { tambahan[0].jasa = Math.max(0, d.jasa); tambahan[0].titipan = Math.max(0, d.titipan); }
      wadahTermin.replaceChildren(h('div', {class: 'gulir'}, h('table', {class: 'tabel tabel-isian'},
        h('thead', null, h('tr', null, ['Milestone', 'Perkiraan tagih', 'Porsi jasa', 'Porsi titipan', ''].map((x) => h('th', null, x)))),
        h('tbody', null, tambahan.map((t, i) => {
          const uj = uang(null, t.jasa, {'aria-label': 'Porsi jasa', oninput: () => { t.jasa = uj.nilai() || 0; t.diubah = true; cekTotal(); }});
          const ut = uang(null, t.titipan, {'aria-label': 'Porsi titipan', oninput: () => { t.titipan = ut.nilai() || 0; t.diubah = true; cekTotal(); }});
          return h('tr', null, h('td', null, h('input', {type: 'text', value: t.milestone, 'aria-label': 'Milestone', placeholder: 'mis. Pekerjaan tambah kanopi', oninput: (ev) => { t.milestone = ev.target.value; }})),
            h('td', null, h('input', {type: 'date', value: t.perkiraan_tagih, 'aria-label': 'Perkiraan tagih', onchange: (ev) => { t.perkiraan_tagih = ev.target.value; }})),
            h('td', null, uj.el), h('td', null, ut.el),
            h('td', null, tambahan.length > 1 && h('button', {class: 'btn btn-kecil', type: 'button', onclick: () => { tambahan.splice(i, 1); gambar(); }}, '✕')));
        })))),
      h('div', {class: 'baris-tombol'}, h('button', {class: 'btn btn-kecil', type: 'button', onclick: () => { tambahan.push({milestone: '', jasa: 0, titipan: 0, perkiraan_tagih: '', diubah: true}); gambar(); }}, '+ Termin tambahan'), totalEl));
      cekTotal = () => {
        const sj2 = tambahan.reduce((s, t) => s + t.jasa, 0), st2 = tambahan.reduce((s, t) => s + t.titipan, 0);
        totalEl.replaceChildren(sj2 === d.jasa && st2 === d.titipan ? h('span', {class: 'kecil'}, '✓ Termin tambahan sama dengan perubahan nilai.')
          : h('span', {class: 'form-galat kecil'}, '✗ Termin tambahan jasa ' + rp(sj2) + ' / titipan ' + rp(st2) + ', harus jasa ' + rp(d.jasa) + ' / titipan ' + rp(d.titipan) + '.'));
      };
      cekTotal();
    } else {
      try {
        usulan = sesuaikanTermin(k.termin, d.jasa, d.titipan);
        wadahTermin.replaceChildren(h('div', {class: 'gulir'}, h('table', {class: 'tabel'},
          h('thead', null, h('tr', null, ['Termin', 'Jasa sekarang', 'Jasa baru', 'Titipan sekarang', 'Titipan baru'].map((x, i) => h('th', {class: i ? 'kanan' : null}, x)))),
          h('tbody', null, usulan.map((u) => { const t = k.termin.find((x) => x.id === u.id); return h('tr', null, h('td', null, labelTermin(t) + (t.milestone ? ' · ' + t.milestone : '')),
            h('td', {class: 'kanan'}, rp(t.jasa)), h('td', {class: 'kanan'}, h('b', null, rp(u.jasa))), h('td', {class: 'kanan'}, rp(t.titipan)), h('td', {class: 'kanan'}, h('b', null, rp(u.titipan)))); })))),
          h('p', {class: 'kecil redup'}, 'Termin yang sudah ditagih tidak diubah. Sisa pembulatan masuk ke termin terakhir yang belum ditagih.'));
      } catch (e) { wadahTermin.replaceChildren(h('p', {class: 'form-galat'}, e.message)); }
    }
  };
  const totalEl = h('span');
  let cekTotal = () => {};
  const simpan = h('button', {class: 'btn btn-utama', type: 'submit'}, 'Simpan');
  let dlg;
  const form = h('form', {class: 'form', onsubmit: async (ev) => {
    ev.preventDefault();
    galat.textContent = '';
    if (!no.value.trim()) { galat.textContent = 'No. addendum wajib diisi.'; no.focus(); return; }
    if (!tglEl.value) { galat.textContent = 'Tanggal addendum wajib diisi.'; return; }
    const d = {no: no.value.trim(), tanggal: tglEl.value, selesai_baru: selesaiBaru.value || null, uraian: uraian.value.trim() || null};
    let termin = [];
    if (!a) {
      const s = selisih();
      Object.assign(d, {tambah_jasa: s.jasa, tambah_titipan: s.titipan, cara_termin: cara});
      if (!s.jasa && !s.titipan && !d.selesai_baru) { galat.textContent = 'Isi perubahan nilai dan/atau tanggal selesai baru.'; return; }
      if (cara === 'tambah') termin = (s.jasa || s.titipan) ? tambahan.map((t) => ({milestone: t.milestone.trim() || null, jasa: t.jasa, titipan: t.titipan, perkiraan_tagih: t.perkiraan_tagih || null})) : [];
      else { if (!usulan) { galat.textContent = 'Penyesuaian termin belum bisa dihitung.'; return; } termin = usulan.map((u) => ({id: u.id, jasa: u.jasa, titipan: u.titipan})); }
    }
    try {
      await sambilMenyimpan(simpan, async () => {
        d.file = await file.ambil('kontrak/' + k.id);
        await store.keu.simpanAddendum(k.id, a?.id, d, termin);
      });
      dlg.close(); await segarkanKeuangan(); pesan(a ? 'Addendum tersimpan.' : 'Addendum tersimpan. Nilai kontrak dan termin sudah disesuaikan.');
    } catch (e) { galat.textContent = e.message; }
  }},
    h('div', {class: 'form-grid'},
      medan('No. addendum', no, {wajib: true}), medan('Tanggal', tglEl, {wajib: true}),
      medan('Tanggal selesai baru', selesaiBaru, {bantuan: 'Kosongkan bila waktu pekerjaan tidak berubah.'}), file.el,
      medan('Uraian', uraian, {lebar: true})),
    a ? h('div', {class: 'form-bagian'}, h('h3', null, 'Perubahan nilai'),
      rincian([['Perubahan jasa', rpTanda(a.tambah_jasa)], ['Perubahan titipan', rpTanda(a.tambah_titipan)], ['Termin', a.cara_termin === 'tambah' ? 'Termin tambahan' : 'Termin yang belum ditagih disesuaikan']]),
      h('p', {class: 'kecil redup'}, 'Nilai addendum tidak bisa diubah. Untuk mengoreksi, hapus addendum ini (hanya addendum terakhir) lalu buat ulang.'))
      : h('div', {class: 'form-bagian'}, h('h3', null, 'Perubahan nilai'),
        h('div', {class: 'form-grid'}, medan('Arah perubahan', arah), h('span'),
          medan('Perubahan nilai jasa', dJasa.el, {id: 'ad-jasa'}), medan('Perubahan titipan', dTitipan.el, {id: 'ad-titipan', bantuan: 'Material/tukang turn-key.'})),
        h('b', {class: 'kecil'}, 'Penyesuaian termin'), caraEl, wadahTermin),
    galat,
    kaki(a && bisa && terakhir && tombolHapus(async () => { await store.keu.hapusAddendum(a.id); dlg.close(); await segarkanKeuangan(); pesan('Addendum dihapus; termin dikembalikan seperti sebelum addendum.'); }),
      a && !terakhir && h('span', {class: 'kecil redup'}, 'Hanya addendum terakhir yang bisa dihapus.'),
      h('span', {class: 'pegas'}), h('button', {class: 'btn', type: 'button', onclick: () => dlg.close()}, bisa ? 'Batal' : 'Tutup'), bisa && simpan));
  if (!bisa) form.querySelectorAll('input,select,textarea').forEach((x) => { x.disabled = true; });
  if (!a) {
    arah.addEventListener('change', gambar);
    for (const u of [dJasa, dTitipan]) u.inp.addEventListener('input', gambar);
  }
  dlg = dialogLebar(a ? 'Addendum ' + a.no : 'Tambah addendum · ' + k.no_kontrak, form);
  if (!a) gambar();
}

// =====================================================================
// Termin & Piutang
// =====================================================================
S.saringPiutang = S.saringPiutang || {proyek: '', status: '', kelompok: '', q: ''};
S.urutPiutang = S.urutPiutang || {k: 'kode', arah: 1};

export function renderPiutang(el, bukaId) {
  el.append(h('div', {class: 'kepala'}, h('h1', null, 'Termin & Piutang'),
    h('p', {class: 'redup'}, 'Semua tagihan dari jadwal termin kontrak klien. Terbitkan invoice, catat penerimaan, dan pantau umur piutang.')));
  if (belumSiap(el)) return;
  const sr = S.saringPiutang, semua = S.d.termin;
  const umur = ringkasUmur(semua);
  const belum = semua.filter((t) => !t.no_invoice);
  el.append(h('section', {class: 'ubin-grid', 'aria-label': 'Umur piutang'},
    ubin('Belum ditagih', rp(belum.reduce((s, t) => s + t.tagihan, 0)), belum.length + ' tagihan', {aktif: sr.status === 'Belum ditagih', onclick: () => { sr.kelompok = ''; sr.status = sr.status === 'Belum ditagih' ? '' : 'Belum ditagih'; S.render(); }}),
    umur.map((u) => ubin(u.kelompok === 'Belum jatuh tempo' ? 'Belum jatuh tempo' : u.kelompok + ' hari lewat', rp(u.sisa), u.jumlah + ' invoice',
      {aktif: sr.kelompok === u.kelompok, onclick: () => { sr.status = ''; sr.kelompok = sr.kelompok === u.kelompok ? '' : u.kelompok; S.render(); }}))));

  const badan = h('tbody'), hitungan = h('span', {class: 'redup kecil'});
  const tabel = h('table', {class: 'tabel'}, h('thead'), badan);
  const KOLOM = [['kode', 'Proyek'], ['no_kontrak', 'No. kontrak'], ['ke', 'Tagihan'], ['milestone', 'Milestone'], ['tagihan', 'Nilai tagihan', true], ['no_invoice', 'No. invoice'],
    ['jatuh_tempo', 'Jatuh tempo'], ['diterima', 'Diterima', true], ['sisa', 'Sisa', true], ['status', 'Status'], ['umur', 'Umur (hari)', true]];
  const gambar = () => {
    const q = sr.q.trim().toLowerCase();
    let rows = semua.filter((t) => (!sr.proyek || t.kode === sr.proyek) && (!sr.status || t.status === sr.status) && (!sr.kelompok || t.kelompok === sr.kelompok));
    if (q) rows = rows.filter((t) => [t.no_invoice, t.no_kontrak, t.kode, t.nama_proyek, t.milestone].some((x) => String(x ?? '').toLowerCase().includes(q)));
    const u = S.urutPiutang;
    rows.sort((a, b) => bandingkan(a[u.k], b[u.k]) * u.arah || bandingkan(a.no_kontrak, b.no_kontrak) || (a.jenis === 'retensi') - (b.jenis === 'retensi') || a.ke - b.ke);
    hitungan.textContent = rows.length + ' tagihan · nilai ' + rp(rows.reduce((s, t) => s + t.tagihan, 0)) + ' · piutang ' + rp(rows.reduce((s, t) => s + t.sisa, 0));
    tabel.querySelector('thead').replaceWith(kepalaUrut(KOLOM, S.urutPiutang, gambar));
    badan.replaceChildren(...(rows.length ? rows.map((t) => h('tr', {class: 'bisa-klik', tabindex: '0', onclick: () => bukaTermin(t.id), onkeydown: (ev) => { if (ev.key === 'Enter') bukaTermin(t.id); }},
      h('td', {class: 'nw', title: t.nama_proyek}, t.kode), h('td', {class: 'nw'}, t.no_kontrak), h('td', {class: 'nw'}, labelTermin(t)), h('td', {class: 'lebar'}, isi(t.milestone)),
      h('td', {class: 'kanan'}, rp(t.tagihan)), h('td', {class: 'nw'}, isi(t.no_invoice)), h('td', {class: 'nw'}, t.jatuh_tempo ? tgl(t.jatuh_tempo) : t.jenis === 'retensi' && t.tgl_pencairan ? 'cair ' + tgl(t.tgl_pencairan) : '—'),
      h('td', {class: 'kanan'}, t.diterima ? rp(t.diterima) : '—'), h('td', {class: 'kanan'}, t.no_invoice ? rp(t.sisa) : '—'), h('td', null, pill(t.status)),
      h('td', {class: 'kanan'}, t.umur == null ? '—' : t.umur > 0 ? String(t.umur) : t.umur === 0 ? 'hari ini' : (-t.umur) + ' lagi')))
      : [h('tr', null, h('td', {colspan: String(KOLOM.length), class: 'redup'}, semua.length ? 'Tidak ada tagihan yang cocok dengan saringan.' : 'Belum ada tagihan. Termin dibuat otomatis dari jadwal termin di menu Kontrak.'))]));
  };
  const proyekAda = [...new Set(semua.map((t) => t.kode))].sort(bandingkan);
  el.append(h('div', {class: 'kartu'},
    h('div', {class: 'alat'},
      h('input', {type: 'search', placeholder: 'Cari invoice / kontrak / proyek…', 'aria-label': 'Cari tagihan', value: sr.q, oninput: (ev) => { sr.q = ev.target.value; gambar(); }}),
      pilihan('sp-proyek', [['', 'Semua proyek'], ...proyekAda.map((x) => [x, x + ' — ' + isi(proyekDari(x)?.nama)])], sr.proyek, {'aria-label': 'Saring proyek', onchange: (ev) => { sr.proyek = ev.target.value; gambar(); }}),
      pilihan('sp-status', [['', 'Semua status'], ...STATUS_TERMIN.map((x) => [x, x])], sr.status, {'aria-label': 'Saring status', onchange: (ev) => { sr.status = ev.target.value; gambar(); }}),
      pilihan('sp-umur', [['', 'Semua umur'], ...KELOMPOK_UMUR.map((x) => [x, x === 'Belum jatuh tempo' ? x : x + ' hari'])], sr.kelompok, {'aria-label': 'Saring umur', onchange: (ev) => { sr.kelompok = ev.target.value; gambar(); }}),
      hitungan, h('span', {class: 'pegas'}),
      bisaKontrak() && h('a', {class: 'btn', href: '#kontrak'}, 'Kontrak')),
    h('div', {class: 'gulir'}, tabel),
    h('p', {class: 'kecil redup'}, 'Umur dihitung dari jatuh tempo. Denda keterlambatan klien hanya ditampilkan sebagai informasi. Retensi ditagih terpisah setelah tanggal pencairan.')));
  gambar();
  if (bukaId && !document.querySelector('dialog[open]')) bukaTermin(bukaId);
}

// --- dialog satu tagihan: invoice + penerimaan ---
export function bukaTermin(id) {
  const t = terminDari(id);
  if (!t) return pesan('Tagihan tidak ditemukan.', 'galat');
  const k = kontrakDari(t.kontrak_id);
  let dlg;
  const segarUlang = async (teksPesan) => { dlg.close(); await segarkanKeuangan(); if (teksPesan) pesan(teksPesan); bukaTermin(id); };

  const rincianTagihan = h('table', {class: 'tabel'}, h('tbody', null,
    ...(t.jenis === 'retensi' ? [
      ['Retensi jasa yang ditahan', t.jasa], t.titipan > 0 && ['Retensi titipan yang ditahan', t.titipan],
    ] : [
      [k.ppn === 'termasuk' ? 'Porsi jasa (termasuk PPN)' : 'Porsi jasa', t.jasa],
      k.ppn === 'termasuk' && ['  Dasar pengenaan pajak (DPP)', t.dpp],
      t.ppn > 0 && ['PPN ' + persenBp(k.tarif_ppn_bp) + (k.ppn === 'termasuk' ? ' (sudah di dalam porsi jasa)' : ''), t.ppn],
      t.titipan > 0 && ['Material & tukang (titipan)', t.titipan],
      t.ret_jasa + t.ret_titipan > 0 && ['Dikurangi retensi ' + persenBp(k.retensi_bp), -(t.ret_jasa + t.ret_titipan)],
    ]).filter(Boolean).map(([l, v]) => h('tr', null, h('td', null, l), h('td', {class: 'kanan'}, v < 0 ? '−' + rp(-v) : rp(v)))),
    h('tr', null, h('th', null, 'Nilai tagihan'), h('th', {class: 'kanan'}, rp(t.tagihan)))));

  const bagianInvoice = h('div', {class: 'form-bagian'}, h('h3', null, 'Invoice'));
  if (t.no_invoice) {
    const r = K().rekening.find((x) => x.id === t.rekening_id);
    bagianInvoice.append(rincian([['No. invoice', h('b', null, t.no_invoice)], ['Tanggal invoice', tgl(t.tgl_invoice)], ['Jatuh tempo', tgl(t.jatuh_tempo)],
      ['Rekening tujuan', r ? [r.nama, r.bank, r.no_rekening, r.atas_nama && 'a.n. ' + r.atas_nama].filter(Boolean).join(' · ') : '—']]),
    h('div', {class: 'baris-tombol'},
      h('button', {class: 'btn btn-utama', type: 'button', onclick: () => cetakInvoice(t, k)}, '🖨 Cetak / PDF invoice'),
      bisaTagih() && !t.penerimaan.length && h('button', {class: 'btn', type: 'button', onclick: () => { dlg.close(); bukaFormInvoice(t, k); }}, 'Ubah invoice'),
      bisaTagih() && !t.penerimaan.length && tombolKonfirmasi('Batalkan invoice', 'Klik lagi untuk membatalkan', async () => { await store.keu.batalInvoice(t.id); await segarUlang('Invoice dibatalkan.'); })));
    if (terkunci(K(), t.tgl_invoice)) bagianInvoice.append(catatanKunci(t.tgl_invoice));
  } else if (!t.bisa_ditagih) {
    bagianInvoice.append(h('div', {class: 'kotak-info'}, t.tgl_pencairan ? 'Retensi baru bisa ditagih mulai ' + tgl(t.tgl_pencairan) + ' (serah terima + masa pemeliharaan).' : 'Retensi bisa ditagih setelah tanggal serah terima diisi di kontrak dan masa pemeliharaan selesai.'));
  } else if (t.tagihan <= 0) {
    bagianInvoice.append(h('p', {class: 'redup'}, 'Nilai tagihan 0; tidak ada yang perlu ditagih.'));
  } else {
    bagianInvoice.append(h('p', {class: 'redup'}, 'Belum ditagih.'), bisaTagih() && h('div', {class: 'baris-tombol'}, h('button', {class: 'btn btn-utama', type: 'button', onclick: () => { dlg.close(); bukaFormInvoice(t, k); }}, 'Terbitkan invoice')));
  }

  const terakhir = t.penerimaan.at(-1);
  const bagianTerima = h('div', {class: 'form-bagian'}, h('div', {class: 'judul-baris'}, h('h3', null, 'Penerimaan'), h('span', {class: 'pegas'}),
    bisaTagih() && t.no_invoice && t.sisa > 0 && h('button', {class: 'btn btn-utama btn-kecil', type: 'button', onclick: () => { dlg.close(); bukaFormPenerimaan(t, k, null); }}, '+ Catat penerimaan')),
  h('div', {class: 'gulir'}, h('table', {class: 'tabel'},
    h('thead', null, h('tr', null, ['Tanggal', 'Diterima', 'Potongan pajak', 'Rekening', 'Bukti potong', 'Bukti transfer', 'Catatan', ''].map((x, i) => h('th', {class: i === 1 || i === 2 ? 'kanan' : null}, x)))),
    h('tbody', null, t.penerimaan.length ? t.penerimaan.map((p) => h('tr', null,
      h('td', {class: 'nw'}, tgl(p.tanggal), terkunci(K(), p.tanggal) && ' 🔒'), h('td', {class: 'kanan'}, rp(p.jumlah)), h('td', {class: 'kanan'}, p.potongan_pajak ? rp(p.potongan_pajak) : '—'),
      h('td', null, p.rekening_id ? namaRekening(p.rekening_id) : '—'), h('td', null, tombolBukti(p.bukti_potong)), h('td', null, tombolBukti(p.bukti_transfer)), h('td', {class: 'lebar'}, isi(p.catatan)),
      h('td', null, h('button', {class: 'btn btn-kecil', type: 'button', onclick: () => { dlg.close(); bukaFormPenerimaan(t, k, p, p.id === terakhir?.id); }}, p.id === terakhir?.id && bisaTagih() ? 'Ubah' : 'Lihat'))))
      : h('tr', null, h('td', {colspan: '8', class: 'redup'}, t.no_invoice ? 'Belum ada penerimaan.' : 'Terbitkan invoice dulu sebelum mencatat penerimaan.'))),
    t.penerimaan.length > 0 && h('tfoot', null, h('tr', null, h('th', null, 'Total'), h('th', {class: 'kanan'}, rp(t.uang)), h('th', {class: 'kanan'}, rp(t.potongan)),
      h('th', {colspan: '5'}, 'Sisa tagihan ' + rp(t.sisa)))))));

  dlg = dialogLebar(labelTermin(t) + ' · ' + k.no_kontrak, h('div', {class: 'form'},
    h('div', {class: 'judul-baris'}, pill(t.status), h('span', {class: 'redup'}, k.kode + ' — ' + isi(k.nama_proyek) + (k.klien ? ' · ' + k.klien : '')), h('span', {class: 'pegas'}),
      h('a', {href: '#kontrak-' + k.id, class: 'kecil', onclick: () => dlg.close()}, 'Buka kontrak →')),
    t.milestone && h('p', null, h('b', null, 'Milestone: '), t.milestone),
    t.denda && h('div', {class: 'kotak-galat'}, 'Lewat jatuh tempo ' + t.denda.hari + ' hari. Denda menurut kontrak: ' + rp(t.denda.denda) + (t.denda.dibatasi ? ' (batas maksimal)' : '') + '. Informasi saja — tidak ditagih otomatis dan tidak dijurnal.'),
    !t.denda && t.status === 'Lewat jatuh tempo' && h('div', {class: 'kotak-galat'}, 'Lewat jatuh tempo ' + t.umur + ' hari.'),
    rincianTagihan, bagianInvoice, bagianTerima,
    kaki(h('span', {class: 'pegas'}), h('button', {class: 'btn', type: 'button', onclick: () => dlg.close()}, 'Tutup'))));
}

function tombolKonfirmasi(teksAwal, teksYakin, fn) {
  let yakin = false;
  const b = h('button', {class: 'btn btn-bahaya', type: 'button', onclick: aman(async () => {
    if (!yakin) { yakin = true; b.textContent = teksYakin; return; }
    await fn();
  })}, teksAwal);
  return b;
}

// --- terbitkan / ubah invoice ---
function bukaFormInvoice(t, k) {
  const galat = h('p', {class: 'form-galat', role: 'alert'});
  const hari = K().akuntansi.jatuh_tempo_hari ?? 14;
  const tglEl = tanggal('iv-tgl', t.tgl_invoice || hariIni(), {required: true});
  const jt = tanggal('iv-jt', t.jatuh_tempo || tambahHari(tglEl.value, hari), {required: true});
  let jtDiubah = !!t.jatuh_tempo;
  jt.addEventListener('change', () => { jtDiubah = true; });
  const rekOpsi = rekeningInvoice();
  const bawaan = t.rekening_id || rekOpsi.find((r) => r.utama_invoice)?.id || (rekOpsi.length === 1 ? rekOpsi[0].id : '');
  const rek = pilihan('iv-rek', [['', 'Pilih rekening…'], ...rekOpsi.map((r) => [r.id, [r.nama, r.bank, r.no_rekening].filter(Boolean).join(' · ') + (r.utama_invoice ? ' (utama)' : '')])], bawaan, {required: true});
  const nomor = h('b');
  const segar = () => {
    if (!jtDiubah) jt.value = tambahHari(tglEl.value, hari);
    nomor.textContent = t.no_invoice || (tglEl.value ? nomorInvoiceBerikut(K(), tglEl.value) : '…');
    kunciEl.replaceChildren(...[terkunci(K(), tglEl.value) && h('div', {class: 'form-galat'}, 'Bulan ' + tglEl.value.slice(0, 7) + ' sudah ditutup; pilih tanggal di bulan yang masih terbuka.')].filter(Boolean));
  };
  const kunciEl = h('div');
  tglEl.addEventListener('change', segar);
  const simpan = h('button', {class: 'btn btn-utama', type: 'submit'}, t.no_invoice ? 'Simpan' : 'Terbitkan');
  let dlg;
  const form = h('form', {class: 'form', onsubmit: async (ev) => {
    ev.preventDefault();
    galat.textContent = '';
    if (!tglEl.value) { galat.textContent = 'Tanggal invoice wajib diisi.'; return; }
    if (!jt.value || jt.value < tglEl.value) { galat.textContent = 'Jatuh tempo wajib diisi dan tidak boleh sebelum tanggal invoice.'; return; }
    if (!rek.value) { galat.textContent = 'Rekening tujuan wajib dipilih.'; rek.focus(); return; }
    try {
      let no;
      await sambilMenyimpan(simpan, async () => { no = await store.keu.terbitkanInvoice(t.id, {tanggal: tglEl.value, jatuh_tempo: jt.value, rekening_id: rek.value}); });
      dlg.close(); await segarkanKeuangan(); pesan(t.no_invoice ? 'Invoice diperbarui.' : 'Invoice ' + (no || '') + ' terbit.'); bukaTermin(t.id);
    } catch (e) { galat.textContent = e.message; }
  }},
    h('p', null, labelTermin(t) + ' · ' + k.no_kontrak + ' · nilai tagihan ', h('b', null, rp(t.tagihan))),
    h('div', {class: 'form-grid'},
      medan('Tanggal invoice', tglEl, {wajib: true}), medan('Jatuh tempo', jt, {wajib: true, bantuan: 'Bawaan ' + hari + ' hari (Pengaturan → Akuntansi).'}),
      medan('Rekening tujuan', rek, {wajib: true, bantuan: rekOpsi.length ? 'Rekening yang ditandai "tampil di invoice" di Kas & Bank.' : 'Belum ada rekening yang ditampilkan di invoice. Atur di Kas & Bank → rekening.'}),
      h('div', {class: 'medan'}, h('label', null, 'Nomor invoice'), nomor, h('span', {class: 'kecil redup'}, t.no_invoice ? 'Nomor tidak berubah.' : 'Dibuat otomatis saat disimpan (format di Pengaturan → Akuntansi).'))),
    kunciEl,
    K().akuntansi.basis === 'akrual' && h('div', {class: 'kotak-info kecil'}, 'Basis akrual: invoice dijurnal D 1-2 Piutang Usaha / K ' + k.akun_pendapatan + ' pendapatan, K 2-4 titipan, K 2-5 PPN.'),
    galat,
    kaki(h('span', {class: 'pegas'}), h('button', {class: 'btn', type: 'button', onclick: () => { dlg.close(); bukaTermin(t.id); }}, 'Batal'), simpan));
  dlg = dialog(t.no_invoice ? 'Ubah invoice ' + t.no_invoice : 'Terbitkan invoice', form);
  segar();
}

// --- catat / ubah penerimaan ---
function bukaFormPenerimaan(t, k, p, bolehUbah = true) {
  const kunci = p && terkunci(K(), p.tanggal);
  const bisa = bisaTagih() && bolehUbah && !kunci;
  const galat = h('p', {class: 'form-galat', role: 'alert'});
  const sebelum = t.penerimaan.filter((x) => x.id !== p?.id).reduce((s, x) => s + x.jumlah + x.potongan_pajak, 0);
  const sisa = t.tagihan - sebelum;
  const tglEl = tanggal('pn-tgl', p?.tanggal || hariIni(), {required: true});
  const jumlah = uang('pn-jumlah', p ? p.jumlah : sisa);
  const potongan = uang('pn-pot', p?.potongan_pajak || '');
  let jumlahDiubah = !!p;
  jumlah.inp.addEventListener('input', () => { jumlahDiubah = true; });
  const rekOpsi = rekeningAktif();
  const rek = pilihan('pn-rek', [['', 'Pilih rekening…'], ...K().rekening.filter((r) => r.aktif || r.id === p?.rekening_id).map((r) => [r.id, r.nama])], p?.rekening_id || t.rekening_id || (rekOpsi.length === 1 ? rekOpsi[0].id : ''));
  const buktiPotong = pilihBukti('pn-bp', p?.bukti_potong, {label: 'Bukti potong pajak'});
  const buktiTransfer = pilihBukti('pn-bt', p?.bukti_transfer, {label: 'Bukti transfer'});
  const catatan = h('textarea', {id: 'pn-catatan', rows: '2'}, p?.catatan ?? '');
  const pratinjau = h('div', {class: 'kotak-info kecil'});
  const segar = () => {
    const pot = potongan.nilai() || 0;
    if (!jumlahDiubah) jumlah.inp.value = formatUang(String(Math.max(0, sisa - pot)));
    const jml = jumlah.nilai() || 0, total = jml + pot;
    const al = total > 0 && total <= sisa ? alokasiPenerimaan(t, sebelum, total) : null;
    const nm = (kode) => kode + ' ' + (akunKode(K(), kode)?.nama || '');
    const baris = [];
    if (jml) baris.push('D ' + (rek.value ? namaRekening(rek.value) : 'rekening') + ' ' + rp(jml));
    if (pot) baris.push('D ' + nm('1-3') + ' ' + rp(pot));
    if (K().akuntansi.basis === 'akrual') { if (total) baris.push('K ' + nm('1-2') + ' ' + rp(total)); }
    else if (al) {
      if (al.alok_pendapatan) baris.push('K ' + nm(k.akun_pendapatan) + ' ' + rp(al.alok_pendapatan));
      if (al.alok_titipan) baris.push('K ' + nm('2-4') + ' ' + rp(al.alok_titipan));
      if (al.alok_ppn) baris.push('K ' + nm('2-5') + ' ' + rp(al.alok_ppn));
    }
    pratinjau.replaceChildren(...[h('b', null, 'Jurnal otomatis (basis ' + (K().akuntansi.basis === 'akrual' ? 'akrual' : 'kas') + '):'), ...baris.map((x) => h('div', null, x)),
      total > sisa ? h('div', {class: 'form-galat'}, 'Diterima + potongan pajak melebihi sisa tagihan ' + rp(sisa) + '.') : h('div', {class: 'redup'}, 'Sisa setelah ini: ' + rp(sisa - total)),
      terkunci(K(), tglEl.value) && h('div', {class: 'form-galat'}, 'Bulan ' + tglEl.value.slice(0, 7) + ' sudah ditutup.')].filter(Boolean));
  };
  [tglEl, rek].forEach((x) => x.addEventListener('change', segar));
  jumlah.inp.addEventListener('input', segar); potongan.inp.addEventListener('input', segar);
  const simpan = h('button', {class: 'btn btn-utama', type: 'submit'}, 'Simpan');
  let dlg;
  const kembali = () => { dlg.close(); bukaTermin(t.id); };
  const form = h('form', {class: 'form', onsubmit: async (ev) => {
    ev.preventDefault();
    galat.textContent = '';
    const d = {termin_id: t.id, tanggal: tglEl.value, jumlah: jumlah.nilai() || 0, potongan_pajak: potongan.nilai() || 0, rekening_id: rek.value || null, catatan: catatan.value.trim() || null};
    if (!d.tanggal) { galat.textContent = 'Tanggal penerimaan wajib diisi.'; return; }
    if (d.jumlah + d.potongan_pajak <= 0) { galat.textContent = 'Isi jumlah diterima dan/atau potongan pajak.'; return; }
    if (d.jumlah > 0 && !d.rekening_id) { galat.textContent = 'Rekening penerima wajib dipilih.'; rek.focus(); return; }
    if (d.jumlah + d.potongan_pajak > sisa) { galat.textContent = 'Diterima + potongan pajak melebihi sisa tagihan ' + rp(sisa) + '.'; return; }
    try {
      await sambilMenyimpan(simpan, async () => {
        d.bukti_potong = await buktiPotong.ambil('termin/' + t.id);
        d.bukti_transfer = await buktiTransfer.ambil('termin/' + t.id);
        await store.keu.simpanPenerimaan(p?.id, d);
      });
      dlg.close(); await segarkanKeuangan(); pesan('Penerimaan tersimpan dan dijurnal.'); bukaTermin(t.id);
      // Tahap 4D: termin proyek peminjam diterima -> tawarkan pengembalian pinjaman antar proyek.
      if (!p && d.jumlah > 0) tawarkanPengembalian(k.proyek_kode || k.kode);
    } catch (e) { galat.textContent = e.message; }
  }},
    kunci && catatanKunci(p.tanggal),
    p && !bolehUbah && h('div', {class: 'kotak-info'}, 'Hanya penerimaan terakhir yang bisa diubah atau dihapus, agar pembagian ke pendapatan, titipan, dan PPN tetap urut.'),
    h('p', null, labelTermin(t) + ' · invoice ' + t.no_invoice + ' · sisa sebelum penerimaan ini ', h('b', null, rp(sisa))),
    h('div', {class: 'form-grid'},
      medan('Tanggal diterima', tglEl, {wajib: true}), medan('Rekening penerima', rek, {wajib: true}),
      medan('Jumlah diterima (masuk rekening)', jumlah.el, {wajib: true, id: 'pn-jumlah'}),
      medan('Potongan pajak oleh klien', potongan.el, {id: 'pn-pot', bantuan: 'Mis. PPh 23 / PPh final yang dipotong klien. Dicatat sebagai Pajak Dibayar di Muka.'}),
      buktiPotong.el, buktiTransfer.el, medan('Catatan', catatan, {lebar: true})),
    pratinjau, galat,
    kaki(p && bisa && tombolHapus(async () => { await store.keu.hapusPenerimaan(p.id); dlg.close(); await segarkanKeuangan(); pesan('Penerimaan dihapus beserta jurnalnya.'); bukaTermin(t.id); }),
      h('span', {class: 'pegas'}), h('button', {class: 'btn', type: 'button', onclick: kembali}, bisa ? 'Batal' : 'Kembali'), bisa && simpan));
  if (!bisa) form.querySelectorAll('input,select,textarea').forEach((x) => { x.disabled = true; });
  dlg = dialog(p ? 'Penerimaan ' + tgl(p.tanggal) : 'Catat penerimaan', form);
  segar();
}

// =====================================================================
// Cetak invoice (jendela baru → Cetak / Simpan sebagai PDF)
// =====================================================================
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const SATU = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh', 'sebelas'];
function terbilang(x) {
  x = Math.floor(Math.abs(x));
  if (x < 12) return SATU[x];
  if (x < 20) return terbilang(x - 10) + ' belas';
  if (x < 100) return terbilang(Math.floor(x / 10)) + ' puluh' + (x % 10 ? ' ' + terbilang(x % 10) : '');
  if (x < 200) return 'seratus' + (x - 100 ? ' ' + terbilang(x - 100) : '');
  if (x < 1000) return terbilang(Math.floor(x / 100)) + ' ratus' + (x % 100 ? ' ' + terbilang(x % 100) : '');
  if (x < 2000) return 'seribu' + (x - 1000 ? ' ' + terbilang(x - 1000) : '');
  for (const [n, nama] of [[1e12, 'triliun'], [1e9, 'miliar'], [1e6, 'juta'], [1e3, 'ribu']]) {
    if (x >= n) return terbilang(Math.floor(x / n)) + ' ' + nama + (x % n ? ' ' + terbilang(x % n) : '');
  }
  return '';
}
export const terbilangRupiah = (x) => { const t = terbilang(x) || 'nol'; return t.charAt(0).toUpperCase() + t.slice(1) + ' rupiah'; };

export function cetakInvoice(t, k) {
  const p = S.profil || {}, r = K().rekening.find((x) => x.id === t.rekening_id);
  const klien = S.d.klien.find((x) => x.id === k.klien_ref);
  const logo = new URL(p.logo || 'assets/logo.svg', location.href).href;
  const baris = t.jenis === 'retensi'
    ? [['Pencairan retensi ' + persenBp(k.retensi_bp) + ' — pekerjaan ' + (k.nama_proyek || k.kode), t.jasa + t.titipan]]
    : [
      [(k.ppn === 'termasuk' ? 'Jasa (DPP)' : 'Jasa') + ' — ' + labelTermin(t) + (t.milestone ? ': ' + t.milestone : ''), t.dpp],
      t.titipan > 0 && ['Material & upah tukang (dana titipan)', t.titipan],
      t.ret_jasa + t.ret_titipan > 0 && ['Dikurangi retensi ' + persenBp(k.retensi_bp), -(t.ret_jasa + t.ret_titipan)],
      t.ppn > 0 && ['PPN ' + persenBp(k.tarif_ppn_bp) + ' × DPP jasa', t.ppn],
    ].filter(Boolean);
  const uangTeks = (v) => (v < 0 ? '(' + rp(-v) + ')' : rp(v));
  const html = `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>${esc(t.no_invoice)}</title>
<style>
  @page { size: A4; margin: 18mm; }
  body { font: 13px/1.45 system-ui, -apple-system, 'Segoe UI', sans-serif; color: #1c1c1c; background: #fff; margin: 0 auto; max-width: 780px; padding: 24px; }
  .kop { display: flex; gap: 16px; align-items: center; border-bottom: 2px solid #1c1c1c; padding-bottom: 12px; }
  .kop img { width: 64px; height: 64px; object-fit: contain; }
  .kop h1 { font-size: 18px; margin: 0; } .kop p { margin: 2px 0; color: #444; font-size: 12px; }
  h2 { font-size: 22px; letter-spacing: .08em; margin: 20px 0 8px; }
  .dua { display: flex; justify-content: space-between; gap: 24px; margin-bottom: 16px; }
  .dua div { flex: 1; } .label { color: #666; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0; } th, td { padding: 7px 8px; border-bottom: 1px solid #ddd; text-align: left; vertical-align: top; }
  th { background: #f3f3f3; font-size: 12px; } .kanan { text-align: right; white-space: nowrap; } tfoot td { font-weight: 700; border-top: 2px solid #1c1c1c; border-bottom: 0; }
  .terbilang { font-style: italic; margin: 4px 0 16px; } .kotak { border: 1px solid #ccc; padding: 10px 12px; border-radius: 6px; }
  .ttd { margin-top: 36px; display: flex; justify-content: flex-end; } .ttd div { text-align: center; min-width: 220px; } .ttd .ruang { height: 70px; }
  .alat { margin-bottom: 16px; } .alat button { font: inherit; padding: 8px 14px; cursor: pointer; }
  @media print { .alat { display: none; } body { padding: 0; } }
</style></head><body>
<div class="alat"><button onclick="window.print()">Cetak / Simpan sebagai PDF</button></div>
<div class="kop"><img src="${esc(logo)}" alt=""><div>
  <h1>${esc(p.badan_hukum || p.nama_aplikasi || '')}</h1>
  ${p.alamat ? `<p>${esc(p.alamat)}</p>` : ''}
  <p>${[p.telepon && 'Telp. ' + p.telepon, p.email].filter(Boolean).map(esc).join(' · ')}</p>
  ${p.npwp ? `<p>NPWP ${esc(p.npwp)}</p>` : ''}
</div></div>
<h2>INVOICE</h2>
<div class="dua">
  <div><div class="label">Ditagihkan kepada</div><b>${esc(klien?.nama || k.klien || '—')}</b>${klien?.alamat ? `<div>${esc(klien.alamat)}</div>` : ''}${klien?.npwp ? `<div>NPWP ${esc(klien.npwp)}</div>` : ''}</div>
  <div><table>
    <tr><td class="label">No. invoice</td><td><b>${esc(t.no_invoice)}</b></td></tr>
    <tr><td class="label">Tanggal</td><td>${esc(tgl(t.tgl_invoice))}</td></tr>
    <tr><td class="label">Jatuh tempo</td><td>${esc(tgl(t.jatuh_tempo))}</td></tr>
    <tr><td class="label">No. kontrak</td><td>${esc(k.no_kontrak)}</td></tr>
    <tr><td class="label">Proyek</td><td>${esc(k.kode + ' — ' + (k.nama_proyek || ''))}</td></tr>
  </table></div>
</div>
<table><thead><tr><th>Uraian</th><th class="kanan">Jumlah</th></tr></thead>
<tbody>${baris.map(([l, v]) => `<tr><td>${esc(l)}</td><td class="kanan">${esc(uangTeks(v))}</td></tr>`).join('')}</tbody>
<tfoot><tr><td>Total tagihan</td><td class="kanan">${esc(rp(t.tagihan))}</td></tr></tfoot></table>
<div class="terbilang">Terbilang: ${esc(terbilangRupiah(t.tagihan))}</div>
<div class="kotak"><div class="label">Pembayaran ditransfer ke</div>
  ${r ? `<b>${esc(r.bank || r.nama)}</b>${r.cabang ? ' · ' + esc(r.cabang) : ''}<br>No. rekening <b>${esc(r.no_rekening || '—')}</b><br>a.n. ${esc(r.atas_nama || p.badan_hukum || '')}` : '—'}
  <div style="margin-top:6px;color:#555">Mohon cantumkan nomor invoice pada berita transfer.</div></div>
<div class="ttd"><div>Hormat kami,<br>${esc(p.badan_hukum || '')}<div class="ruang"></div><b>${esc(p.penandatangan_nama || '')}</b><br>${esc(p.penandatangan_jabatan || '')}</div></div>
</body></html>`;
  const w = window.open('', '_blank');
  if (!w) return pesan('Jendela invoice diblokir browser. Izinkan pop-up untuk aplikasi ini, lalu coba lagi.', 'galat');
  w.document.open(); w.document.write(html); w.document.close();
}

// Ringkasan kontrak di formulir Proyek: masuk kontrak dari sisi proyek.
export function kontrakProyek(kode) {
  if (!K().siap || K().kontrak_siap === false || !kode) return null;
  const daftar = S.d.kontrak.filter((k) => k.kode === kode);
  return h('div', {class: 'form-bagian'}, h('div', {class: 'judul-baris'}, h('h3', null, 'Kontrak klien'), h('span', {class: 'pegas'}),
    bisaKontrak() && h('button', {class: 'btn btn-kecil', type: 'button', onclick: (ev) => { ev.target.closest('dialog')?.close(); bukaFormKontrak(null, {proyek_kode: kode}); }}, '+ Kontrak untuk proyek ini')),
  daftar.length ? h('table', {class: 'tabel'}, h('tbody', null, daftar.map((k) => h('tr', {class: 'bisa-klik', onclick: (ev) => { ev.target.closest('dialog')?.close(); location.hash = '#kontrak-' + k.id; }},
    h('td', null, k.no_kontrak), h('td', {class: 'kanan'}, rp(k.total)), h('td', {class: 'kanan'}, pct(k.pct_terbayar) + ' terbayar'), h('td', null, pill(k.status))))))
    : h('p', {class: 'kecil redup'}, 'Belum ada kontrak untuk proyek ini.'));
}
