// Tahap 6 — Hutang Lain: daftar hutang dengan sisa pokok, angsuran berikutnya, status, dan pemisahan jangka pendek / panjang;
// detail (informasi, jadwal angsuran, riwayat pembayaran, jurnal); formulir kreditur, hutang, pembayaran; jadwal otomatis
// (flat / anuitas / efektif / tanpa bunga) atau impor Excel dengan pratinjau.
// Rumus ada di hutang-util.js; aturan dan jurnal dijaga database (supabase/migrasi/6-hutang.sql) dan mesin demo.
import {S, segarkanKeuangan} from './state.js';
import {store} from './store.js';
import {hariIni} from './calc.js';
import {bisaUbah} from './akses.js';
import {h, idn, rp, rpRingkas, tgl, isi, pill, pesan, aman, sambilMenyimpan, kepalaUrut, bandingkan, unduh} from './ui.js';
import {medan, teks, tanggal, pilihan, uang, centang, kaki, tombolHapus, catatanKunci, namaRekening, tombolBukti, pilihBukti, bukaFormJurnal, kartuBelumSiap} from './keuangan.js';
import {terkunci, daftarJurnal} from './keuangan-data.js';
import {JENIS_HUTANG, METODE_BUNGA, CARA_HUTANG, akunHutang, tanggalBulan, buatJadwal, targetJadwal, periksaJadwal} from './hutang-util.js';
import {totalBayar} from './aset-util.js';
import {bpKePersen, persenKeBp} from './kontrak-util.js';
import {K, ubin, dialogLebar, rincian} from './proyek-bersama.js';
import {eksporExcel, muatExcelJS} from './excel.js';
import {bacaTanggal, bacaRupiah} from './keuangan-excel.js';

const bisa = () => bisaUbah('hutang_lain');
const hutangDari = (id) => (S.d.hutang_lain || []).find((x) => x.id === id);
const krediturDari = (id) => (K().kreditur || []).find((k) => k.id === id);
const asetDari = (id) => (K().aset || []).find((a) => a.id === id);
const nmAkun = (kode) => { const a = K().akun.find((x) => x.kode === kode); return a ? a.kode + ' ' + a.nama : kode; };
const rekAktif = (kecuali) => K().rekening.filter((r) => r.aktif || r.id === kecuali).map((r) => [r.id, r.nama]);
const persenTeks = (bp) => idn(bpKePersen(bp), 2) + '% per tahun';
const sisaHutangAset = (a) => totalBayar(a) - (a.uang_muka || 0);
const baris0 = (n, teksKosong) => h('tr', null, h('td', {colspan: String(n), class: 'redup'}, teksKosong));
const tabel = (kepala, rows, kanan = []) => h('div', {class: 'gulir'}, h('table', {class: 'tabel'},
  h('thead', null, h('tr', null, kepala.map((x, i) => h('th', {class: kanan.includes(i) ? 'kanan' : null}, x)))), h('tbody', null, rows)));
const td = (v, kanan) => h('td', {class: kanan ? 'kanan nw' : null}, v);
const teksBerikut = (x) => (x.berikut ? tgl(x.berikut.tanggal) + ' · ' + rp(x.berikut.kurang) : x.status === 'Lunas' ? 'Lunas' : '—');
const pilPeringatan = (p) => h('span', {class: 'pill blok ' + (p.jenis === 'terlambat' ? 'pill-buruk' : p.jenis === 'segera' ? 'pill-waspada' : 'pill-netral')}, p.teks);
const idDari = (hasil, cadangan) => (typeof hasil === 'string' ? hasil : hasil?.id || cadangan);
const uraianHutang = (x) => x.uraian || JENIS_HUTANG[x.jenis];

// Database Tahap 6 belum dipasang di Supabase.
function belumSiapHutang(el) {
  if (!K().siap) { kartuBelumSiap(el); return true; }
  if (K().hutang_siap === false) {
    el.append(h('div', {class: 'kartu'}, h('h2', null, 'Database hutang belum dipasang'),
      h('p', null, 'Menu Hutang Lain memerlukan pembaruan database Tahap 6. Jalankan SQL file supabase/migrasi/6-hutang.sql di Supabase SQL Editor, lalu muat ulang halaman.')));
    return true;
  }
  return false;
}

// =====================================================================
// Daftar hutang
// =====================================================================
S.saringHutang = S.saringHutang || {jenis: '', status: 'Belum lunas', kreditur: '', peringatan: false, q: ''};
S.urutHutang = S.urutHutang || {k: 'tgl_berikut', arah: 1};
export function renderHutang(el) {
  el.append(h('div', {class: 'kepala'}, h('h1', null, 'Hutang Lain'),
    h('p', {class: 'redup'}, 'Kredit bank, leasing, pinjaman pemilik / pihak lain, sewa terutang: pokok, jadwal angsuran, pembayaran, dan sisa pokok. Hutang vendor dan supplier ada di menu masing-masing.')));
  if (belumSiapHutang(el)) return;
  const sr = S.saringHutang;
  const semua = (S.d.hutang_lain || []).map((x) => ({...x, tgl_berikut: x.berikut?.tanggal || '9999'}));
  const buka = semua.filter((x) => x.status !== 'Lunas');
  const jml = (rows, k) => rows.reduce((s, x) => s + (x[k] || 0), 0);
  el.append(h('div', {class: 'alat'}, h('span', {class: 'pegas'}),
    h('button', {class: 'btn', type: 'button', onclick: () => bukaDaftarKreditur()}, 'Daftar kreditur'),
    bisa() && h('button', {class: 'btn btn-utama', type: 'button', onclick: () => bukaFormHutang(null)}, '+ Hutang')));
  const terlambat = buka.filter((x) => x.status === 'Terlambat');
  el.append(h('section', {class: 'ubin-grid', 'aria-label': 'Ringkasan hutang'},
    ubin('Total sisa pokok', rpRingkas(jml(buka, 'sisa_pokok')), rp(jml(buka, 'sisa_pokok')) + ' · ' + buka.length + ' hutang belum lunas'),
    ubin('Jatuh tempo bulan ini', rpRingkas(jml(buka, 'jatuh_bulan_ini')), rp(jml(buka, 'jatuh_bulan_ini')) + ' · pokok + bunga yang belum dibayar'),
    ubin('Jangka pendek (≤ 12 bulan)', rpRingkas(jml(buka, 'jangka_pendek')), rp(jml(buka, 'jangka_pendek')) + ' · pokok jatuh tempo 12 bulan ke depan'),
    ubin('Jangka panjang (> 12 bulan)', rpRingkas(jml(buka, 'jangka_panjang')), rp(jml(buka, 'jangka_panjang'))),
    ubin('Terlambat', idn(terlambat.length) + ' hutang', terlambat.length ? rp(terlambat.reduce((s, x) => s + x.terlambat.reduce((t, r) => t + r.kurang, 0), 0)) + ' belum dibayar' : 'tidak ada', {buruk: terlambat.length > 0})));

  const wadah = h('div'), hitungan = h('span', {class: 'redup kecil'});
  const KOLOM = [['kreditur_nama', 'Kreditur'], ['jenis', 'Jenis'], ['uraian', 'Uraian'], ['pokok', 'Pokok', true], ['sisa_pokok', 'Sisa pokok', true],
    ['tgl_berikut', 'Angsuran berikutnya'], ['status', 'Status'], [null, 'Peringatan']];
  const saring = () => {
    const q = sr.q.trim().toLowerCase();
    return semua.filter((x) => (!sr.jenis || x.jenis === sr.jenis) && (!sr.kreditur || x.kreditur_id === sr.kreditur)
      && (sr.status === 'Semua' || (sr.status === 'Belum lunas' ? x.status !== 'Lunas' : x.status === sr.status))
      && (!sr.peringatan || x.peringatan.length)
      && (!q || [x.kreditur_nama, x.uraian, x.no_perjanjian, JENIS_HUTANG[x.jenis]].some((v) => String(v || '').toLowerCase().includes(q))));
  };
  const gambar = () => {
    const rows = saring().sort((a, b) => bandingkan(a[S.urutHutang.k], b[S.urutHutang.k]) * S.urutHutang.arah || bandingkan(a.kreditur_nama, b.kreditur_nama));
    hitungan.textContent = rows.length + ' hutang · sisa pokok ' + rp(jml(rows, 'sisa_pokok'));
    const badan = h('tbody', null, rows.length ? rows.map((x) => {
      const ke = () => { location.hash = '#hutang-' + x.id; };
      return h('tr', {class: 'bisa-klik', tabindex: '0', onclick: ke, onkeydown: (ev) => { if (ev.key === 'Enter') ke(); }},
        h('td', null, x.kreditur_nama, x.afiliasi && h('span', {class: 'kecil redup blok'}, 'Pihak afiliasi')), td(JENIS_HUTANG[x.jenis]),
        h('td', null, isi(x.uraian), x.aset_id && h('span', {class: 'kecil redup blok'}, 'Aset ' + (asetDari(x.aset_id)?.kode || ''))),
        td(rp(x.pokok), 1), td(rp(x.sisa_pokok), 1), h('td', {class: 'nw'}, teksBerikut(x)), td(pill(x.status)),
        h('td', null, x.peringatan.length ? x.peringatan.map(pilPeringatan) : '—'));
    }) : [baris0(KOLOM.length, semua.length ? 'Tidak ada hutang yang cocok dengan saringan.' : 'Belum ada hutang. Klik "+ Hutang".')]);
    wadah.replaceChildren(h('div', {class: 'gulir'}, h('table', {class: 'tabel'}, kepalaUrut(KOLOM, S.urutHutang, gambar), badan)));
  };
  const opsiKred = (K().kreditur || []).slice().sort((a, b) => bandingkan(a.nama, b.nama)).map((k) => [k.id, k.nama]);
  el.append(h('div', {class: 'kartu'},
    h('div', {class: 'alat'},
      h('input', {type: 'search', placeholder: 'Cari kreditur / uraian / no. perjanjian…', 'aria-label': 'Cari hutang', value: sr.q, oninput: (ev) => { sr.q = ev.target.value; gambar(); }}),
      pilihan('hu-sjenis', [['', 'Semua jenis'], ...Object.entries(JENIS_HUTANG)], sr.jenis, {'aria-label': 'Saring jenis', onchange: (ev) => { sr.jenis = ev.target.value; gambar(); }}),
      pilihan('hu-skred', [['', 'Semua kreditur'], ...opsiKred], sr.kreditur, {'aria-label': 'Saring kreditur', onchange: (ev) => { sr.kreditur = ev.target.value; gambar(); }}),
      pilihan('hu-sstatus', [['Belum lunas', 'Belum lunas'], ['Lancar', 'Lancar'], ['Terlambat', 'Terlambat'], ['Lunas', 'Lunas'], ['Semua', 'Semua']], sr.status,
        {'aria-label': 'Saring status', onchange: (ev) => { sr.status = ev.target.value; gambar(); }}),
      h('label', {class: 'centang kecil'}, h('input', {type: 'checkbox', checked: sr.peringatan, onchange: (ev) => { sr.peringatan = ev.target.checked; gambar(); }}), ' Hanya yang ada peringatan'),
      hitungan, h('span', {class: 'pegas'}),
      h('button', {class: 'btn', type: 'button', onclick: aman(() => eksporHutang(saring()))}, 'Ekspor Excel')),
    wadah));
  gambar();
}

async function eksporHutang(rows) {
  await eksporExcel('hutang-lain-' + hariIni() + '.xlsx', [{nama: 'Hutang per ' + hariIni(), kolom: [
    {judul: 'Kreditur', k: 'kreditur_nama', lebar: 26}, {judul: 'Afiliasi', k: 'afiliasi_teks'}, {judul: 'Jenis', k: 'jenis_teks', lebar: 18}, {judul: 'Uraian', k: 'uraian', lebar: 30},
    {judul: 'No. perjanjian', k: 'no_perjanjian', jenis: 'teks', lebar: 18}, {judul: 'Akun', k: 'akun_kode'}, {judul: 'Pokok', k: 'pokok', jenis: 'uang', lebar: 16},
    {judul: 'Sisa pokok', k: 'sisa_pokok', jenis: 'uang', lebar: 16}, {judul: 'Jangka pendek', k: 'jangka_pendek', jenis: 'uang', lebar: 16},
    {judul: 'Jangka panjang', k: 'jangka_panjang', jenis: 'uang', lebar: 16}, {judul: 'Angsuran berikutnya', k: 'tgl_berikut_x', lebar: 14},
    {judul: 'Jumlah angsuran berikutnya', k: 'jml_berikut', jenis: 'uang', lebar: 16}, {judul: 'Status', k: 'status'}, {judul: 'Peringatan', k: 'peringatan_teks', lebar: 40}],
  baris: rows.map((x) => ({...x, afiliasi_teks: x.afiliasi ? 'Ya' : 'Tidak', jenis_teks: JENIS_HUTANG[x.jenis], tgl_berikut_x: x.berikut?.tanggal || '', jml_berikut: x.berikut?.kurang ?? null,
    peringatan_teks: x.peringatan.map((p) => p.teks).join('; ')}))}]);
}

// =====================================================================
// Detail satu hutang
// =====================================================================
S.tabHutang = S.tabHutang || 'info';
export function renderDetailHutang(el, id) {
  if (belumSiapHutang(el)) return;
  const x = hutangDari(id);
  const kembali = h('a', {href: '#hutang', class: 'kecil'}, '← Daftar hutang');
  if (!x) { el.append(h('div', {class: 'kepala'}, kembali, h('h1', null, 'Hutang tidak ditemukan'), h('p', {class: 'redup'}, 'Data ini mungkin sudah dihapus.'))); return; }
  const lunas = x.status === 'Lunas';
  el.append(h('div', {class: 'kepala'}, kembali,
    h('div', {class: 'judul-baris'}, h('h1', null, x.kreditur_nama + ' · ' + uraianHutang(x)), pill(x.status), h('span', {class: 'pegas'}),
      h('button', {class: 'btn', type: 'button', onclick: () => bukaFormHutang(x)}, bisa() ? 'Ubah' : 'Lihat isian'),
      bisa() && !lunas && h('button', {class: 'btn', type: 'button', onclick: () => bukaFormBayar(x, null, {pelunasan: true})}, 'Pelunasan dipercepat'),
      bisa() && !lunas && h('button', {class: 'btn btn-utama', type: 'button', onclick: () => bukaFormBayar(x, null)}, '+ Bayar')),
    h('p', {class: 'redup'}, [JENIS_HUTANG[x.jenis], nmAkun(x.akun_kode), x.no_perjanjian && 'Perjanjian ' + x.no_perjanjian, CARA_HUTANG[x.cara]].filter(Boolean).join(' · '))));
  if (x.peringatan.length) el.append(h('div', {class: x.peringatan.some((p) => p.jenis === 'terlambat') ? 'kotak-galat' : 'kotak-info'}, 'Peringatan: ' + x.peringatan.map((p) => p.teks).join(' · ')));
  el.append(h('section', {class: 'ubin-grid', 'aria-label': 'Nilai hutang'},
    ubin('Pokok pinjaman', rp(x.pokok), x.cara === 'saldo_awal' ? 'sisa saat saldo awal ' + rp(x.sisa_pokok_awal) : persenTeks(x.bunga_bp) + ' · ' + METODE_BUNGA[x.metode_bunga]),
    ubin('Sisa pokok', rp(x.sisa_pokok), 'pokok dibayar ' + rp(x.pokok_dibayar) + ' · bunga ' + rp(x.bunga_dibayar) + (x.denda_dibayar ? ' · denda ' + rp(x.denda_dibayar) : '')),
    ubin('Angsuran berikutnya', x.berikut ? rp(x.berikut.kurang) : '—', x.berikut ? 'ke-' + x.berikut.ke + ' · ' + tgl(x.berikut.tanggal) : lunas ? 'hutang lunas' : 'belum ada jadwal',
      {buruk: x.status === 'Terlambat'}),
    ubin('Jangka pendek / panjang', rpRingkas(x.jangka_pendek) + ' / ' + rpRingkas(x.jangka_panjang), '≤ 12 bulan / > 12 bulan dari hari ini')));
  const TAB = [['info', 'Informasi'], ['jadwal', 'Jadwal angsuran'], ['bayar', 'Pembayaran'], ['jurnal', 'Jurnal']];
  if (!TAB.some(([k]) => k === S.tabHutang)) S.tabHutang = 'info';
  const panel = h('div', {class: 'kartu', role: 'tabpanel'});
  el.append(h('div', {class: 'tabs', role: 'tablist'}, TAB.map(([k, label]) => h('button', {class: 'tab', type: 'button', role: 'tab', 'aria-selected': String(S.tabHutang === k),
    onclick: () => { S.tabHutang = k; S.render(); }}, label + (k === 'jadwal' && x.jadwal.length ? ' (' + x.jadwal.length + ')' : k === 'bayar' && x.bayar.length ? ' (' + x.bayar.length + ')' : '')))), panel);
  panel.append(...[].concat({info: tabInfo, jadwal: tabJadwal, bayar: tabBayar, jurnal: tabJurnal}[S.tabHutang](x)).flat(3).filter(Boolean));
}

function tabInfo(x) {
  const a = x.aset_id && asetDari(x.aset_id), ja = x.jaminan_aset_id && asetDari(x.jaminan_aset_id);
  const linkAset = (as) => h('a', {href: '#aset-' + as.id}, as.kode + ' · ' + as.nama);
  const asal = x.cara === 'tunai' ? 'Dana diterima ke ' + namaRekening(x.rekening_id) + ' pada ' + tgl(x.tgl_mulai) + ' · jurnal D rekening / K ' + x.akun_kode
    : x.cara === 'aset' ? h('span', null, 'Kredit / leasing aset ', a ? linkAset(a) : '—', ' · jurnal hutang ikut jurnal perolehan aset (D aset / K rekening uang muka / K ' + x.akun_kode + ')')
      : 'Saldo awal per ' + tgl(x.tgl_saldo_awal) + ': sisa pokok ' + rp(x.sisa_pokok_awal) + ' · jurnal D 3-2-01 Ekuitas saldo awal / K ' + x.akun_kode + '. Angsuran sebelum tanggal itu dianggap sudah dibayar sebelum memakai aplikasi.';
  return [
    h('h3', null, 'Kreditur & perjanjian'),
    rincian([['Kreditur', x.kreditur_nama + (x.afiliasi ? ' (pihak afiliasi)' : '')], ['Kontak', krediturDari(x.kreditur_id)?.kontak], ['Jenis', JENIS_HUTANG[x.jenis]],
      ['Akun hutang', nmAkun(x.akun_kode)], ['Uraian', x.uraian], ['No. perjanjian', x.no_perjanjian], ['Tanggal perjanjian', x.tgl_perjanjian && tgl(x.tgl_perjanjian)],
      ['File perjanjian', x.file?.path ? tombolBukti(x.file) : null]]),
    h('h3', null, 'Pokok & bunga'),
    rincian([['Pokok', rp(x.pokok)], ['Suku bunga', x.metode_bunga === 'tanpa' ? 'Tanpa bunga' : persenTeks(x.bunga_bp) + ' · ' + METODE_BUNGA[x.metode_bunga]],
      ['Tenor', x.tenor_bulan ? x.tenor_bulan + ' bulan' : '—'], ['Tanggal mulai', tgl(x.tgl_mulai)], ['Tanggal angsuran', 'tanggal ' + x.hari_angsuran + ' tiap bulan'],
      ['Denda keterlambatan', x.denda_ket]]),
    h('h3', null, 'Asal hutang'),
    rincian([['Asal', asal]]),
    h('h3', null, 'Jaminan'),
    rincian([['Uraian jaminan', x.jaminan || '—'], ['Aset jaminan', ja ? linkAset(ja) : null]]),
    x.catatan && rincian([['Catatan', x.catatan]]),
  ];
}

function tabJadwal(x) {
  const tj = targetJadwal(x, x.jadwal, x.bayar);
  const berkas = h('input', {type: 'file', accept: '.xlsx', hidden: true, 'aria-label': 'File Excel jadwal angsuran', onchange: aman(async () => {
    const f = berkas.files[0];
    berkas.value = '';
    if (f) bukaPratinjauJadwal(x, await bacaImporJadwal(await f.arrayBuffer()));
  })});
  const tot = (k) => x.jadwal.reduce((s, r) => s + (r[k] || 0), 0);
  return [
    h('div', {class: 'alat'},
      h('span', {class: 'kecil redup'}, 'Sumber jadwal: ' + (x.jadwal_sumber === 'impor' ? 'impor Excel dari kreditur' : 'dibuat otomatis (' + METODE_BUNGA[x.metode_bunga] + ')') + '.'
        + (tj.K ? ' Angsuran sampai ke-' + tj.K + ' sudah ada pembayarannya dan tetap; jadwal baru mulai ke-' + (tj.K + 1) + ' dengan total pokok ' + rp(tj.target) + '.' : '')),
      h('span', {class: 'pegas'}),
      h('button', {class: 'btn btn-kecil', type: 'button', onclick: aman(() => eksporJadwal(x))}, 'Ekspor Excel'),
      h('button', {class: 'btn btn-kecil', type: 'button', onclick: aman(() => unduhTemplateJadwal(x))}, 'Unduh Template'),
      bisa() && x.status !== 'Lunas' && h('button', {class: 'btn btn-kecil', type: 'button', onclick: () => berkas.click()}, 'Impor Excel'), bisa() && berkas,
      bisa() && x.status !== 'Lunas' && h('button', {class: 'btn btn-kecil', type: 'button', onclick: () => bukaBuatUlangJadwal(x)}, 'Buat ulang jadwal')),
    tabel(['Ke', 'Tanggal', 'Pokok', 'Bunga', 'Total', 'Dibayar', 'Kurang', 'Status', ''], x.jadwal.length ? [
      ...x.jadwal.map((r) => h('tr', {class: x.berikut?.ke === r.ke ? 'baris-sorot' : null}, td(String(r.ke)), h('td', {class: 'nw'}, tgl(r.tanggal)), td(rp(r.pokok), 1), td(rp(r.bunga), 1),
        td(rp(r.total), 1), td(r.dibayar_pokok + r.dibayar_bunga ? rp(r.dibayar_pokok + r.dibayar_bunga) : '—', 1), td(r.kurang ? rp(r.kurang) : '—', 1), td(pill(r.status)),
        td(bisa() && r.terbuka && h('button', {class: 'btn btn-kecil', type: 'button', onclick: () => bukaFormBayar(x, null, {ke: r.ke})}, 'Bayar')))),
      h('tr', null, h('th', {colspan: '2'}, 'Total'), h('th', {class: 'kanan'}, rp(tot('pokok'))), h('th', {class: 'kanan'}, rp(tot('bunga'))), h('th', {class: 'kanan'}, rp(tot('total'))),
        h('th', {colspan: '4'})),
    ] : [baris0(9, x.tenor_bulan ? 'Belum ada jadwal. Klik "Buat ulang jadwal" atau impor dari Excel.' : 'Belum ada jadwal. Isi tenor di formulir hutang, atau impor jadwal dari kreditur (Excel).')], [2, 3, 4, 5, 6]),
    h('p', {class: 'kecil redup'}, 'Status angsuran: Terlambat bila lewat tanggal dan belum dibayar penuh (pokok + bunga). Pengingat H-X, hari H, dan terlambat muncul di lonceng 🔔 sesuai Pengaturan → Notifikasi.'),
  ];
}

function tabBayar(x) {
  const rows = x.bayar.slice().sort((a, b) => bandingkan(b.tanggal, a.tanggal));
  return [h('div', {class: 'alat'}, h('span', {class: 'kecil redup'}, 'Riwayat pembayaran. Porsi pokok mengurangi sisa pokok (D ' + x.akun_kode + '); bunga ke 7-1 Beban Bunga; denda ke 7-3 Denda.'),
    h('span', {class: 'pegas'}), bisa() && x.status !== 'Lunas' && h('button', {class: 'btn btn-kecil btn-utama', type: 'button', onclick: () => bukaFormBayar(x, null)}, '+ Bayar')),
  tabel(['Tanggal', 'Angsuran', 'Pokok', 'Bunga', 'Denda', 'Total', 'Dari rekening', 'Bukti', ''], rows.length ? rows.map((b) => h('tr', null,
    h('td', {class: 'nw'}, tgl(b.tanggal), terkunci(K(), b.tanggal) && ' 🔒'), td(b.angsuran_ke ? 'ke-' + b.angsuran_ke : 'Di luar jadwal'), td(rp(b.pokok), 1), td(rp(b.bunga), 1),
    td(b.denda ? rp(b.denda) : '—', 1), td(rp(b.pokok + b.bunga + b.denda), 1), td(namaRekening(b.rekening_id)), td(tombolBukti(b.bukti)),
    td(h('button', {class: 'btn btn-kecil', type: 'button', onclick: () => bukaFormBayar(x, b)}, bisa() ? 'Ubah' : 'Lihat')))) : [baris0(9, 'Belum ada pembayaran.')], [2, 3, 4, 5])];
}

function tabJurnal(x) {
  const idBayar = new Set(x.bayar.map((b) => b.id));
  const jurnal = daftarJurnal(K()).filter((j) => (j.sumber === 'hutang' && j.sumber_id === x.id) || (j.sumber === 'bayar_hutang' && idBayar.has(j.sumber_id))
    || (x.aset_id && j.sumber === 'aset' && j.sumber_id === x.aset_id));
  return [tabel(['No.', 'Tanggal', 'Uraian', 'Jumlah'], jurnal.length ? jurnal.map((j) => h('tr', {class: 'bisa-klik', tabindex: '0', onclick: () => bukaFormJurnal(j)},
    td(j.no), h('td', {class: 'nw'}, tgl(j.tanggal)), td(j.uraian), td(rp(j.baris.reduce((s, b) => s + (+b.debit || 0), 0)), 1))) : [baris0(4, 'Belum ada jurnal.')], [3]),
  x.cara === 'aset' && h('p', {class: 'kecil redup'}, 'Hutang kredit / leasing aset dicatat lewat jurnal perolehan aset (tidak ada jurnal "pinjaman diterima" terpisah).')];
}

// =====================================================================
// Kreditur
// =====================================================================
function bukaDaftarKreditur() {
  const wadah = h('div');
  const gambar = () => {
    const rows = (K().kreditur || []).slice().sort((a, b) => bandingkan(a.nama, b.nama));
    const per = (id) => (S.d.hutang_lain || []).filter((x) => x.kreditur_id === id);
    wadah.replaceChildren(tabel(['Nama', 'Afiliasi', 'Kontak', 'Hutang', 'Sisa pokok', 'Status', ''], rows.length ? rows.map((k) => h('tr', null,
      td(k.nama), td(k.afiliasi ? 'Ya' : '—'), td(isi(k.kontak)), td(idn(per(k.id).length), 1), td(rp(per(k.id).reduce((s, x) => s + x.sisa_pokok, 0)), 1), td(pill(k.aktif ? 'Aktif' : 'Nonaktif')),
      td(h('button', {class: 'btn btn-kecil', type: 'button', onclick: () => bukaFormKreditur(k, gambar)}, bisa() ? 'Ubah' : 'Lihat')))) : [baris0(7, 'Belum ada kreditur.')], [3, 4]));
  };
  gambar();
  const dlg = dialogLebar('Daftar kreditur', h('div', {class: 'form'},
    h('p', {class: 'kecil redup'}, 'Kreditur disimpan sekali dan dipakai ulang di setiap hutang. Tanda "Pihak afiliasi" membuat hutangnya masuk 2-9 Hutang kepada Pemilik / Pihak Afiliasi (kecuali kredit bank & leasing: 2-8).'),
    wadah,
    kaki(h('span', {class: 'pegas'}), h('button', {class: 'btn', type: 'button', onclick: () => dlg.close()}, 'Tutup'),
      bisa() && h('button', {class: 'btn btn-utama', type: 'button', onclick: () => bukaFormKreditur(null, gambar)}, '+ Kreditur'))));
}

function bukaFormKreditur(lama, setelah) {
  const x = lama || {aktif: true};
  const boleh = bisa();
  const galat = h('p', {class: 'form-galat', role: 'alert'});
  const nama = teks('kr-nama', x.nama, {required: true, placeholder: 'mis. Bank BPD Bali / PT Mandiri Tunas Finance / Bapak Made (pemilik)'});
  const afiliasi = centang('kr-afil', x.afiliasi, 'Pihak afiliasi (pemilik, keluarga pemilik, perusahaan sekelompok)');
  const kontak = teks('kr-kontak', x.kontak, {placeholder: 'Nama petugas / no. HP / email'});
  const aktif = centang('kr-aktif', x.aktif !== false, 'Aktif (muncul di pilihan hutang baru)');
  const catatan = h('textarea', {id: 'kr-catatan', rows: '2'}, x.catatan ?? '');
  const simpan = h('button', {class: 'btn btn-utama', type: 'button', onclick: aman(async () => {
    galat.textContent = '';
    const d = {nama: nama.value.trim(), afiliasi: afiliasi.querySelector('input').checked, kontak: kontak.value.trim() || null, catatan: catatan.value.trim() || null,
      aktif: aktif.querySelector('input').checked};
    if (!d.nama) { galat.textContent = 'Nama kreditur wajib diisi.'; nama.focus(); return; }
    let hasil;
    try { hasil = await sambilMenyimpan(simpan, () => store.keu.simpanKreditur(lama?.id, d)); } catch (e) { galat.textContent = e.message; return; }
    dlg.close(); await segarkanKeuangan(); pesan('Kreditur tersimpan.');
    setelah?.(idDari(hasil, lama?.id));
  })}, 'Simpan');
  const dlg = dialogLebar(lama ? 'Kreditur ' + lama.nama : 'Kreditur baru', h('div', {class: 'form'},
    h('div', {class: 'form-grid'}, medan('Nama kreditur', nama, {wajib: true}), medan('Kontak', kontak), h('div', {class: 'medan medan-lebar'}, afiliasi,
      h('span', {class: 'kecil redup'}, 'Mengubah tanda ini memindahkan akun hutang kreditur ini (yang belum punya pembayaran) antara 2-9 dan 2-10.')),
    h('div', {class: 'medan'}, aktif), medan('Catatan', catatan, {lebar: true})),
    galat,
    kaki(h('span', {class: 'pegas'}), h('button', {class: 'btn', type: 'button', onclick: () => dlg.close()}, boleh ? 'Batal' : 'Tutup'), boleh && simpan)));
  if (!boleh) dlg.querySelectorAll('input, select, textarea').forEach((e) => { e.disabled = true; });
}

// =====================================================================
// Formulir hutang
// =====================================================================
const KOLOM_JADWAL = ['pokok', 'bunga_bp', 'metode_bunga', 'tenor_bulan', 'tgl_mulai', 'hari_angsuran'];
export function bukaFormHutang(lama) {
  const x = lama || {};
  const boleh = bisa();
  const adaBayar = !!lama?.bayar?.length;
  const kunci = !!lama && terkunci(K(), lama.cara === 'saldo_awal' ? lama.tgl_saldo_awal : lama.tgl_mulai) && lama.cara !== 'aset';
  const galat = h('p', {class: 'form-galat', role: 'alert'});
  // 1. Kreditur & jenis
  const opsiKred = (pilih) => [['', 'Pilih kreditur…'], ...(K().kreditur || []).filter((k) => k.aktif || k.id === x.kreditur_id).sort((a, b) => bandingkan(a.nama, b.nama))
    .map((k) => [k.id, k.nama + (k.afiliasi ? ' (afiliasi)' : '')])].map(([v, l]) => h('option', {value: v, selected: v === pilih}, l));
  const kred = h('select', {id: 'hu-kred', required: true}, opsiKred(x.kreditur_id || ''));
  const kredBaru = boleh && h('button', {class: 'btn btn-kecil', type: 'button', onclick: () => bukaFormKreditur(null, (id) => { kred.replaceChildren(...opsiKred(id)); segar(); })}, '+ Kreditur baru');
  const jenis = pilihan('hu-jenis', [['', 'Pilih jenis…'], ...Object.entries(JENIS_HUTANG)], x.jenis || '', {required: true});
  const uraian = teks('hu-uraian', x.uraian, {placeholder: 'mis. Kredit modal kerja 2026 / Leasing Toyota Hilux'});
  // 2. Perjanjian
  const noPj = teks('hu-nopj', x.no_perjanjian, {placeholder: 'No. perjanjian kredit'});
  const tglPj = tanggal('hu-tglpj', x.tgl_perjanjian || '');
  const filePj = pilihBukti('hu-file', x.file, {label: 'File perjanjian (PDF)', hanyaPdf: true});
  // 3. Pokok & bunga
  const pokok = uang('hu-pokok', x.pokok ?? '');
  const bunga = h('input', {id: 'hu-bunga', type: 'text', inputmode: 'decimal', class: 'angka-pendek', autocomplete: 'off', value: x.bunga_bp ? String(bpKePersen(x.bunga_bp)).replace('.', ',') : ''});
  const metode = pilihan('hu-metode', Object.entries(METODE_BUNGA), x.metode_bunga || 'flat');
  const tenor = h('input', {id: 'hu-tenor', type: 'number', min: '1', max: '600', step: '1', class: 'angka-pendek', value: x.tenor_bulan ?? ''});
  const mulai = tanggal('hu-mulai', x.tgl_mulai || hariIni(), {required: true});
  const hari = h('input', {id: 'hu-hari', type: 'number', min: '1', max: '31', step: '1', class: 'angka-pendek', value: x.hari_angsuran ?? ''});
  const denda = teks('hu-denda', x.denda_ket, {placeholder: 'mis. 0,1% per hari dari angsuran tertunggak (opsional)'});
  const mBunga = medan('Suku bunga', h('div', {class: 'berakhiran'}, bunga, h('span', null, '% / tahun')), {id: 'hu-bunga', bantuan: 'Boleh desimal, mis. 9,5.'});
  // 4. Asal hutang
  const cara = pilihan('hu-cara', Object.entries(CARA_HUTANG), x.cara || 'tunai');
  const rekDaftar = rekAktif(x.rekening_id);
  const rek = pilihan('hu-rek', [['', 'Pilih rekening…'], ...rekDaftar], x.rekening_id || (rekDaftar.length === 1 ? rekDaftar[0][0] : ''));
  const mRek = medan('Dana diterima ke rekening', rek, {wajib: true});
  const asetPilih = (K().aset || []).filter((a) => ['kredit', 'leasing'].includes(a.cara) && (!a.hutang_id || a.hutang_id === x.id))
    .sort((a, b) => bandingkan(a.kode, b.kode));
  const aset = pilihan('hu-aset', [['', asetPilih.length ? 'Pilih aset…' : 'Tidak ada aset Kredit / Leasing yang belum tertaut'],
    ...asetPilih.map((a) => [a.id, a.kode + ' · ' + a.nama + ' · hutang ' + rp(sisaHutangAset(a))])], x.aset_id || '');
  const mAset = medan('Aset yang dibeli', aset, {wajib: true, bantuan: 'Aset dengan cara perolehan Kredit / Leasing di menu Aset. Pokok hutang = nilai dibayar − uang muka.'});
  const tglSaldo = tanggal('hu-tglsaldo', x.tgl_saldo_awal || K().rekening.map((r) => r.tgl_saldo_awal).filter(Boolean).sort()[0] || hariIni());
  const sisaAwal = uang('hu-sisaawal', x.sisa_pokok_awal ?? '');
  const mSaldo = h('div', {class: 'form-grid medan-lebar'}, medan('Tanggal saldo awal', tglSaldo, {wajib: true, bantuan: 'Tanggal hutang mulai dicatat di aplikasi, biasanya sama dengan saldo awal rekening.'}),
    medan('Sisa pokok per tanggal itu', sisaAwal.el, {wajib: true, id: 'hu-sisaawal', bantuan: 'Dari rekening koran / surat kreditur.'}));
  const caraInfo = h('p', {class: 'kecil redup medan-lebar'});
  // 5. Jaminan
  const jaminan = teks('hu-jaminan', x.jaminan, {placeholder: 'mis. SHM No. 123 a.n. PT / BPKB kendaraan'});
  const jamAset = pilihan('hu-jamaset', [['', '— tidak ditautkan —'], ...(K().aset || []).filter((a) => a.status === 'Aktif' || a.id === x.jaminan_aset_id)
    .sort((a, b) => bandingkan(a.kode, b.kode)).map((a) => [a.id, a.kode + ' · ' + a.nama])], x.jaminan_aset_id || '');
  const catatan = h('textarea', {id: 'hu-catatan', rows: '2'}, x.catatan ?? '');
  const info = h('div', {class: 'kotak-info kecil medan-lebar'});
  const jadwalInfo = h('div', {class: 'kotak-info kecil medan-lebar'});

  const bacaBunga = () => (metode.value === 'tanpa' ? 0 : persenKeBp(bunga.value));
  const baca = () => ({kreditur_id: kred.value || null, jenis: jenis.value || null, uraian: uraian.value.trim() || null, no_perjanjian: noPj.value.trim() || null,
    tgl_perjanjian: tglPj.value || null, pokok: pokok.nilai(), bunga_bp: bacaBunga(), metode_bunga: metode.value, tenor_bulan: tenor.value === '' ? null : +tenor.value,
    tgl_mulai: mulai.value || null, hari_angsuran: hari.value === '' ? null : +hari.value, denda_ket: denda.value.trim() || null, cara: cara.value,
    rekening_id: cara.value === 'tunai' ? rek.value || null : null, aset_id: cara.value === 'aset' ? aset.value || null : null,
    tgl_saldo_awal: cara.value === 'saldo_awal' ? tglSaldo.value || null : null, sisa_pokok_awal: cara.value === 'saldo_awal' ? sisaAwal.nilai() : null,
    jaminan: jaminan.value.trim() || null, jaminan_aset_id: jamAset.value || null, catatan: catatan.value.trim() || null});
  // Jadwal otomatis ikut disimpan bila hutang baru, atau jadwal otomatis lama belum punya pembayaran dan isian jadwalnya berubah.
  const perluJadwal = (d) => d.tenor_bulan && (!lama || (!adaBayar && lama.jadwal_sumber !== 'impor' && (!lama.jadwal.length || KOLOM_JADWAL.some((k) => String(lama[k] ?? '') !== String(d[k] ?? '')))));
  const jadwalDari = (d) => buatJadwal({...d, hari_angsuran: d.hari_angsuran || +String(d.tgl_mulai || '').slice(8, 10)});

  const segar = () => {
    const d = baca();
    mBunga.hidden = metode.value === 'tanpa';
    mRek.hidden = cara.value !== 'tunai';
    mAset.hidden = cara.value !== 'aset';
    mSaldo.hidden = cara.value !== 'saldo_awal';
    const a = cara.value === 'aset' && asetDari(aset.value);
    if (a && !lama?.bayar?.length) {
      if (pokok.nilai() !== sisaHutangAset(a)) pokok.inp.value = idn(sisaHutangAset(a));
      if (!lama && a.tgl_perolehan && mulai.value === hariIni()) mulai.value = a.tgl_perolehan;
    }
    const k = krediturDari(d.kreditur_id);
    const akun = d.jenis ? akunHutang(d.jenis, k?.afiliasi) : null;
    caraInfo.textContent = cara.value === 'tunai' ? 'Jurnal pada tanggal mulai: D rekening penerima / K ' + (akun || 'akun hutang') + ' sebesar pokok.'
      : cara.value === 'aset' ? 'Tidak ada jurnal terpisah: hutang ini adalah K 2-8 pada jurnal perolehan aset (D aset / K rekening uang muka / K 2-8 sisa). Hanya untuk jenis Kredit bank atau Leasing.'
        : 'Pinjaman yang sudah berjalan sebelum memakai aplikasi. Jurnal pada tanggal saldo awal: D 3-2-01 Ekuitas saldo awal / K ' + (akun || 'akun hutang')
          + ' sebesar sisa pokok, tanpa uang masuk. Angsuran sebelum tanggal itu ditandai "Sebelum aplikasi". Pastikan hutang ini belum dimasukkan lewat jurnal manual saldo awal.';
    info.replaceChildren(akun ? h('span', null, 'Akun hutang: ', h('b', null, nmAkun(akun)), akun === '2-9' ? ' (pinjaman pemilik / kreditur afiliasi)' : '') : 'Pilih jenis untuk melihat akun hutang.');
    if (lama?.jadwal_sumber === 'impor' && KOLOM_JADWAL.some((c) => String(lama[c] ?? '') !== String(d[c] ?? ''))) {
      jadwalInfo.textContent = 'Jadwal hutang ini hasil impor dan tidak diubah otomatis. Buat ulang / impor ulang di tab Jadwal angsuran bila perlu.';
    } else if (adaBayar) {
      jadwalInfo.textContent = 'Hutang ini sudah punya pembayaran: jadwal tidak diubah dari sini. Gunakan tab Jadwal angsuran (buat ulang dari sisa pokok atau impor jadwal baru dari kreditur).';
    } else if (d.tenor_bulan && d.pokok > 0 && d.tgl_mulai) {
      const j = jadwalDari(d), totB = j.reduce((s, r) => s + r.bunga, 0);
      jadwalInfo.replaceChildren(h('div', null, 'Jadwal otomatis ', h('b', null, j.length + ' angsuran'), ', pertama ' + tgl(j[0]?.tanggal) + ' sebesar ' + rp(j[0] ? j[0].pokok + j[0].bunga : 0)
        + (j.length > 1 ? ', terakhir ' + tgl(j.at(-1).tanggal) : '') + '. Total bunga ' + rp(totB) + '.'),
      h('div', {class: 'redup'}, 'Bila kreditur memberi jadwal sendiri, impor dari Excel di tab Jadwal angsuran setelah disimpan (mengganti jadwal otomatis).'));
    } else jadwalInfo.textContent = 'Isi pokok, tenor, dan tanggal mulai untuk membuat jadwal otomatis. Tanpa tenor: jadwal bisa diimpor dari Excel setelah disimpan.';
  };
  [kred, jenis, metode, mulai, cara, aset, tglSaldo].forEach((e) => e.addEventListener('change', segar));
  [pokok.inp, bunga, tenor, hari, sisaAwal.inp].forEach((e) => e.addEventListener('input', segar));
  segar();

  const simpan = h('button', {class: 'btn btn-utama', type: 'button', onclick: aman(async () => {
    galat.textContent = '';
    const d = baca();
    if (!d.kreditur_id) { galat.textContent = 'Kreditur wajib dipilih (tambahkan dengan "+ Kreditur baru" bila belum ada).'; kred.focus(); return; }
    if (!d.jenis) { galat.textContent = 'Jenis hutang wajib dipilih.'; jenis.focus(); return; }
    if (d.bunga_bp == null) { galat.textContent = 'Suku bunga ditulis dalam persen per tahun, mis. 10 atau 9,5.'; bunga.focus(); return; }
    if (d.pokok == null) { galat.textContent = 'Pokok pinjaman wajib diisi.'; pokok.inp.focus(); return; }
    const jadwal = perluJadwal(d) ? jadwalDari(d) : null;
    let hasil;
    try {
      hasil = await sambilMenyimpan(simpan, async () => {
        d.file = await filePj.ambil('hutang');
        return store.keu.simpanHutang(lama?.id, d, jadwal);
      });
    } catch (e) { galat.textContent = e.message; return; }
    const id = idDari(hasil, lama?.id);
    dlg.close();
    if (!lama && id) location.hash = '#hutang-' + id;
    await segarkanKeuangan();
    pesan(lama ? 'Hutang tersimpan.' : 'Hutang tersimpan' + (d.cara === 'aset' ? ' dan ditautkan ke aset.' : ' dan dijurnal otomatis.'));
  })}, 'Simpan');
  const hapus = lama && boleh && !adaBayar && tombolHapus(async () => {
    try { await store.keu.hapusHutang(lama.id); } catch (e) { galat.textContent = e.message; return; }
    dlg.close(); location.hash = '#hutang'; await segarkanKeuangan(); pesan('Hutang dihapus beserta jadwal dan jurnalnya.');
  });
  const dlg = dialogLebar(lama ? 'Hutang ' + lama.kreditur_nama : 'Hutang baru', h('div', {class: 'form'},
    h('p', {class: 'kecil redup'}, 'Isi dari atas. Jadwal angsuran dibuat otomatis dari pokok, bunga, dan tenor; bisa diganti dengan jadwal dari kreditur (impor Excel).'),
    kunci && catatanKunci(lama.cara === 'saldo_awal' ? lama.tgl_saldo_awal : lama.tgl_mulai),
    adaBayar && h('div', {class: 'kotak-info'}, 'Hutang ini sudah punya pembayaran: pokok, asal hutang, jenis / kreditur, aset, dan saldo awal tidak bisa diubah.'),
    h('h3', null, '1. Kreditur & jenis'),
    h('div', {class: 'form-grid'}, medan('Kreditur', h('div', {class: 'baris-tombol'}, kred, kredBaru), {wajib: true, id: 'hu-kred'}), medan('Jenis', jenis, {wajib: true}),
      medan('Uraian', uraian, {lebar: true}), info),
    h('h3', null, '2. Perjanjian'),
    h('div', {class: 'form-grid'}, medan('No. perjanjian', noPj), medan('Tanggal perjanjian', tglPj), filePj.el),
    h('h3', null, '3. Pokok, bunga, tenor'),
    h('div', {class: 'form-grid'}, medan('Pokok pinjaman', pokok.el, {wajib: true, id: 'hu-pokok'}), medan('Jenis bunga', metode), mBunga,
      medan('Tenor', h('div', {class: 'berakhiran'}, tenor, h('span', null, 'bulan')), {id: 'hu-tenor', bantuan: 'Kosongkan bila tidak ada jadwal tetap (mis. pinjaman pemilik).'}),
      medan('Tanggal mulai', mulai, {wajib: true, bantuan: 'Tanggal pencairan / akad. Angsuran pertama sebulan setelahnya.'}),
      medan('Tanggal angsuran tiap bulan', hari, {id: 'hu-hari', bantuan: 'Bawaan: tanggal yang sama dengan tanggal mulai.'}), medan('Denda keterlambatan', denda, {lebar: true}), jadwalInfo),
    h('h3', null, '4. Asal hutang'),
    h('div', {class: 'form-grid'}, medan('Asal', cara, {wajib: true}), mRek, mAset, mSaldo, caraInfo),
    h('h3', null, '5. Jaminan'),
    h('div', {class: 'form-grid'}, medan('Uraian jaminan', jaminan), medan('Aset jaminan', jamAset, {bantuan: 'Opsional: tautkan ke aset di menu Aset.'})),
    medan('Catatan', catatan, {lebar: true}),
    galat,
    kaki(hapus, h('span', {class: 'pegas'}), h('button', {class: 'btn', type: 'button', onclick: () => dlg.close()}, boleh ? 'Batal' : 'Tutup'), boleh && simpan)));
  if (!boleh) dlg.querySelectorAll('input, select, textarea, button.btn-kecil').forEach((e) => { e.disabled = true; });
  if (boleh && adaBayar) [kred, jenis, pokok.inp, cara, rek, aset, tglSaldo, sisaAwal.inp].forEach((e) => { e.disabled = true; });
  if (boleh && kunci) [mulai, pokok.inp, cara, rek, tglSaldo, sisaAwal.inp].forEach((e) => { e.disabled = true; });
  if (boleh && lama?.cara === 'aset') pokok.inp.readOnly = true;
}

// =====================================================================
// Formulir pembayaran (angsuran / pelunasan dipercepat)
// =====================================================================
export function bukaFormBayar(hu, lama, {pelunasan = false, ke = null} = {}) {
  const x = lama || {};
  const kunci = lama && terkunci(K(), lama.tanggal);
  const boleh = bisa() && !kunci;
  const galat = h('p', {class: 'form-galat', role: 'alert'});
  const terbuka = hu.jadwal.filter((r) => r.terbuka || r.ke === x.angsuran_ke);
  const awalKe = lama ? (x.angsuran_ke ?? '') : pelunasan ? '' : String(ke ?? hu.berikut?.ke ?? '');
  const angs = pilihan('hb-ke', [['', 'Di luar jadwal (pelunasan dipercepat / tambahan pokok)'],
    ...terbuka.map((r) => [String(r.ke), 'Angsuran ke-' + r.ke + ' · ' + tgl(r.tanggal) + ' · ' + (r.kurang ? 'kurang ' + rp(r.kurang) : rp(r.total)) + (r.status === 'Terlambat' ? ' · terlambat' : '')])], String(awalKe));
  const tglEl = tanggal('hb-tgl', x.tanggal || hariIni(), {required: true});
  const pokok = uang('hb-pokok', x.pokok ?? '');
  const bunga = uang('hb-bunga', x.bunga ?? '');
  const denda = uang('hb-denda', x.denda || '');
  const rekDaftar = rekAktif(x.rekening_id);
  const rek = pilihan('hb-rek', [['', 'Pilih rekening…'], ...rekDaftar], x.rekening_id || (rekDaftar.length === 1 ? rekDaftar[0][0] : ''));
  const bukti = pilihBukti('hb-bukti', x.bukti, {label: 'Bukti bayar'});
  const catatan = teks('hb-catatan', x.catatan ?? (pelunasan ? 'Pelunasan dipercepat' : ''), {placeholder: 'Opsional'});
  const info = h('div', {class: 'kotak-info kecil medan-lebar'});
  const sisaLain = hu.sisa_pokok + (lama ? lama.pokok : 0);
  const isiDari = () => {
    if (lama) return;
    const r = hu.jadwal.find((a) => String(a.ke) === angs.value);
    if (r) { pokok.inp.value = idn(Math.max(0, r.kurang_pokok)); bunga.inp.value = idn(Math.max(0, r.kurang - r.kurang_pokok)); }
    else if (pelunasan || angs.value === '') { pokok.inp.value = idn(sisaLain); bunga.inp.value = '0'; }
  };
  const segar = () => {
    const p = pokok.nilai() || 0, b = bunga.nilai() || 0, dn = denda.nilai() || 0, sisa = sisaLain - p;
    info.replaceChildren(...[h('div', null, 'Total dibayar ', h('b', null, rp(p + b + dn)), ' · sisa pokok setelah ini ', h('b', null, rp(Math.max(0, sisa)))),
      h('div', {class: 'redup'}, 'Jurnal: D ' + hu.akun_kode + ' ' + rp(p) + (b ? ' + D 7-1 Beban Bunga ' + rp(b) : '') + (dn ? ' + D 7-3 Denda ' + rp(dn) : '') + ' / K rekening ' + rp(p + b + dn) + '.'),
      angs.value === '' && p > 0 && h('div', null, sisa <= 0 ? 'Pokok lunas: status hutang menjadi Lunas, sisa angsuran ditutup.'
        : 'Pembayaran pokok di luar jadwal. Setelah disimpan, perbarui jadwal di tab Jadwal angsuran: buat ulang dari sisa pokok, atau impor jadwal baru dari kreditur.'),
      p > sisaLain && h('div', {class: 'form-galat'}, 'Porsi pokok melebihi sisa pokok ' + rp(sisaLain) + '.')].filter(Boolean));
  };
  angs.addEventListener('change', () => { isiDari(); segar(); });
  [pokok.inp, bunga.inp, denda.inp].forEach((e) => e.addEventListener('input', segar));
  isiDari(); segar();
  const simpan = h('button', {class: 'btn btn-utama', type: 'button', onclick: aman(async () => {
    galat.textContent = '';
    const d = {hutang_id: hu.id, angsuran_ke: angs.value === '' ? null : +angs.value, tanggal: tglEl.value || null, pokok: pokok.nilai() || 0, bunga: bunga.nilai() || 0,
      denda: denda.nilai() || 0, rekening_id: rek.value || null, catatan: catatan.value.trim() || null};
    try {
      await sambilMenyimpan(simpan, async () => { d.bukti = await bukti.ambil('hutang'); return store.keu.simpanBayarHutang(lama?.id, d); });
    } catch (e) { galat.textContent = e.message; return; }
    dlg.close(); S.tabHutang = 'bayar'; await segarkanKeuangan();
    const baru = hutangDari(hu.id);
    pesan(baru?.status === 'Lunas' ? 'Pembayaran tersimpan. Hutang lunas.' : 'Pembayaran tersimpan dan dijurnal.' + (baru?.peringatan.some((p) => p.jenis === 'jadwal') ? ' Jadwal perlu diperbarui (tab Jadwal angsuran).' : ''));
  })}, 'Simpan');
  const hapus = lama && boleh && tombolHapus(async () => {
    try { await store.keu.hapusBayarHutang(lama.id); } catch (e) { galat.textContent = e.message; return; }
    dlg.close(); await segarkanKeuangan(); pesan('Pembayaran dihapus beserta jurnalnya.');
  });
  const dlg = dialogLebar((pelunasan ? 'Pelunasan dipercepat' : lama ? 'Pembayaran' : 'Bayar angsuran') + ' · ' + hu.kreditur_nama, h('div', {class: 'form'},
    kunci && catatanKunci(lama.tanggal),
    h('p', {class: 'kecil redup'}, 'Sisa pokok saat ini ' + rp(hu.sisa_pokok) + '. Pilih angsuran: jumlah pokok dan bunga terisi dari jadwal dan bisa diubah sesuai bukti bayar.'),
    h('div', {class: 'form-grid'}, medan('Angsuran', angs, {lebar: true}), medan('Tanggal bayar', tglEl, {wajib: true}), medan('Dari rekening', rek, {wajib: true}),
      medan('Porsi pokok', pokok.el, {id: 'hb-pokok', bantuan: 'Mengurangi sisa pokok.'}), medan('Porsi bunga', bunga.el, {id: 'hb-bunga', bantuan: 'Ke 7-1 Beban Bunga.'}),
      medan('Denda', denda.el, {id: 'hb-denda', bantuan: 'Ke 7-3 Denda. Opsional.'}), bukti.el, medan('Catatan', catatan, {lebar: true}), info),
    galat,
    kaki(hapus, h('span', {class: 'pegas'}), h('button', {class: 'btn', type: 'button', onclick: () => dlg.close()}, boleh ? 'Batal' : 'Tutup'), boleh && simpan)));
  if (!boleh) dlg.querySelectorAll('input, select, textarea').forEach((e) => { e.disabled = true; });
}

// =====================================================================
// Jadwal: buat ulang, ekspor, template, impor
// =====================================================================
function bukaBuatUlangJadwal(hu) {
  const tj = targetJadwal(hu, hu.jadwal, hu.bayar);
  const galat = h('p', {class: 'form-galat', role: 'alert'});
  const akhirLama = tj.dipertahankan.at(-1);
  const tglAwal = akhirLama ? tanggalBulan(akhirLama.tanggal, 1, hu.hari_angsuran) : tanggalBulan(hu.tgl_mulai, 1, hu.hari_angsuran);
  const sisaRows = hu.jadwal.filter((r) => r.ke > tj.K).length;
  const tenor = h('input', {id: 'bj-tenor', type: 'number', min: '1', max: '600', step: '1', class: 'angka-pendek', value: String(sisaRows || Math.max(1, (hu.tenor_bulan || 12) - tj.K))});
  const pertama = tanggal('bj-pertama', tglAwal);
  const metode = pilihan('bj-metode', Object.entries(METODE_BUNGA), hu.metode_bunga);
  const bunga = h('input', {id: 'bj-bunga', type: 'text', inputmode: 'decimal', class: 'angka-pendek', value: String(bpKePersen(hu.bunga_bp)).replace('.', ',')});
  const pratinjau = h('div');
  let rows = [];
  const segar = () => {
    galat.textContent = '';
    const bp = metode.value === 'tanpa' ? 0 : persenKeBp(bunga.value);
    rows = bp == null || !(+tenor.value > 0) || !pertama.value ? [] : buatJadwal({pokok: tj.target, bunga_bp: bp, metode: metode.value, tenor_bulan: +tenor.value, hari_angsuran: hu.hari_angsuran},
      {tglPertama: pertama.value, mulaiKe: tj.K + 1});
    pratinjau.replaceChildren(rows.length ? tabelPratinjau(rows) : h('p', {class: 'redup'}, 'Isi tenor, tanggal pertama, dan bunga.'));
  };
  [tenor, bunga].forEach((e) => e.addEventListener('input', segar));
  [pertama, metode].forEach((e) => e.addEventListener('change', segar));
  segar();
  const simpan = h('button', {class: 'btn btn-utama', type: 'button', onclick: aman(async () => {
    const g = periksaJadwal(rows, tj);
    if (g.length) { galat.textContent = g.join(' '); return; }
    try { await sambilMenyimpan(simpan, () => store.keu.simpanJadwalHutang(hu.id, rows, 'otomatis')); } catch (e) { galat.textContent = e.message; return; }
    dlg.close(); S.tabHutang = 'jadwal'; await segarkanKeuangan(); pesan('Jadwal angsuran diperbarui: ' + rows.length + ' angsuran.');
  })}, 'Ganti jadwal');
  const dlg = dialogLebar('Buat ulang jadwal · ' + hu.kreditur_nama, h('div', {class: 'form'},
    h('p', null, tj.K ? 'Angsuran sampai ke-' + tj.K + ' sudah ada pembayarannya dan tetap. Jadwal baru mulai ke-' + (tj.K + 1) + ' untuk sisa pokok terjadwal ' : 'Jadwal baru untuk pokok ', h('b', null, rp(tj.target)),
      '. Bunga dihitung dari jumlah itu. Bila kreditur memberi jadwal baru (mis. setelah pelunasan sebagian), lebih tepat impor jadwal kreditur dari Excel.'),
    h('div', {class: 'form-grid'}, medan('Jumlah angsuran', h('div', {class: 'berakhiran'}, tenor, h('span', null, 'bulan')), {id: 'bj-tenor'}), medan('Tanggal angsuran pertama', pertama),
      medan('Jenis bunga', metode), medan('Suku bunga', h('div', {class: 'berakhiran'}, bunga, h('span', null, '% / tahun')), {id: 'bj-bunga'})),
    pratinjau, galat,
    kaki(h('span', {class: 'pegas'}), h('button', {class: 'btn', type: 'button', onclick: () => dlg.close()}, 'Batal'), simpan)));
}

const tabelPratinjau = (rows) => {
  const tp = rows.reduce((s, r) => s + (Number.isInteger(r.pokok) ? r.pokok : 0), 0), tb = rows.reduce((s, r) => s + (Number.isInteger(r.bunga) ? r.bunga : 0), 0);
  return h('div', {class: 'gulir gulir-pendek'}, h('table', {class: 'tabel'},
    h('thead', null, h('tr', null, ['Ke', 'Tanggal', 'Pokok', 'Bunga', 'Total'].map((t, i) => h('th', {class: i > 1 ? 'kanan' : null}, t)))),
    h('tbody', null, rows.map((r) => h('tr', null, td(String(r.ke)), h('td', {class: 'nw'}, tgl(r.tanggal)), td(rp(r.pokok), 1), td(rp(r.bunga), 1), td(rp(r.pokok + r.bunga), 1))),
      h('tr', null, h('th', {colspan: '2'}, 'Total'), h('th', {class: 'kanan'}, rp(tp)), h('th', {class: 'kanan'}, rp(tb)), h('th', {class: 'kanan'}, rp(tp + tb))))));
};

const KOLOM_IMPOR = [{k: 'ke', judul: 'Angsuran ke *', lebar: 14}, {k: 'tanggal', judul: 'Tanggal *', lebar: 14}, {k: 'pokok', judul: 'Pokok *', lebar: 16},
  {k: 'bunga', judul: 'Bunga', lebar: 16}, {k: 'total', judul: 'Total', lebar: 16}];
const namaFile = (hu) => String(hu.kreditur_nama + '-' + (hu.uraian || hu.jenis)).toLowerCase().replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
async function eksporJadwal(hu) {
  await eksporExcel('jadwal-' + namaFile(hu) + '.xlsx', [{nama: 'Jadwal angsuran', kolom: [{judul: 'Angsuran ke', k: 'ke'}, {judul: 'Tanggal', k: 'tanggal', lebar: 14},
    {judul: 'Pokok', k: 'pokok', jenis: 'uang', lebar: 16}, {judul: 'Bunga', k: 'bunga', jenis: 'uang', lebar: 16}, {judul: 'Total', k: 'total', jenis: 'uang', lebar: 16},
    {judul: 'Dibayar pokok', k: 'dibayar_pokok', jenis: 'uang', lebar: 16}, {judul: 'Dibayar bunga', k: 'dibayar_bunga', jenis: 'uang', lebar: 16},
    {judul: 'Kurang', k: 'kurang', jenis: 'uang', lebar: 16}, {judul: 'Status', k: 'status', lebar: 18}], baris: hu.jadwal}]);
}
async function unduhTemplateJadwal(hu) {
  const ExcelJS = await muatExcelJS(), wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Jadwal', {views: [{state: 'frozen', ySplit: 1}]});
  ws.columns = KOLOM_IMPOR.map((c) => ({header: c.judul, key: c.k, width: c.lebar}));
  ws.getRow(1).font = {bold: true};
  const tj = targetJadwal(hu, hu.jadwal, hu.bayar);
  for (const r of hu.jadwal.filter((a) => a.ke > tj.K)) ws.addRow({ke: r.ke, tanggal: r.tanggal, pokok: r.pokok, bunga: r.bunga, total: r.pokok + r.bunga});
  const p = wb.addWorksheet('Petunjuk');
  p.columns = [{header: 'Petunjuk', width: 120}];
  p.getRow(1).font = {bold: true};
  for (const t of ['Satu baris = satu angsuran. Kolom: Angsuran ke | Tanggal | Pokok | Bunga | Total. Total boleh kosong; bila diisi harus = Pokok + Bunga.',
    'Tanggal ditulis sebagai tanggal Excel atau teks 2026-03-15 / 15/03/2026. Rupiah utuh tanpa desimal.',
    tj.K ? 'Angsuran sampai ke-' + tj.K + ' sudah ada pembayarannya dan tetap. Isi angsuran mulai ke-' + (tj.K + 1) + '; total pokok harus Rp ' + idn(tj.target) + '.'
      : 'Total pokok semua baris harus sama dengan pokok pinjaman Rp ' + idn(tj.target) + '.',
    'Impor MENGGANTI jadwal yang ada (mulai angsuran setelah yang sudah dibayar). Aplikasi menampilkan pratinjau lebih dulu.',
    'Isi awal lembar Jadwal = jadwal saat ini; ganti dengan jadwal dari kreditur.']) p.addRow([t]);
  unduh('template-jadwal-' + namaFile(hu) + '.xlsx', new Blob([await wb.xlsx.writeBuffer()], {type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
}
async function bacaImporJadwal(buffer) {
  const ExcelJS = await muatExcelJS(), wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer); } catch { throw new Error('File tidak bisa dibaca. Pastikan formatnya .xlsx (Excel).'); }
  const ws = wb.getWorksheet('Jadwal') || wb.worksheets[0];
  const norm = (s) => String(s ?? '').replace(/\*/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const peta = {...Object.fromEntries(KOLOM_IMPOR.map((c) => [norm(c.judul), c.k])), 'ke': 'ke', 'no': 'ke', 'angsuran': 'ke', 'jatuh tempo': 'tanggal'}, kunci = {};
  const nilai = (cell) => { let v = cell.value; if (v && typeof v === 'object' && !(v instanceof Date)) v = v.result ?? v.text ?? (v.richText ? v.richText.map((x) => x.text).join('') : null); return v instanceof Date || typeof v === 'number' ? v : v == null ? '' : String(v).trim(); };
  ws.getRow(1).eachCell((cell, col) => { const k = peta[norm(nilai(cell))]; if (k) kunci[col] = k; });
  const hilang = KOLOM_IMPOR.filter((c) => c.judul.endsWith('*') && !Object.values(kunci).includes(c.k));
  if (hilang.length) throw new Error('Kolom ' + hilang.map((c) => '"' + c.judul.replace(' *', '') + '"').join(', ') + ' tidak ditemukan. Pakai file dari tombol Unduh Template.');
  const rows = [], galat = [];
  ws.eachRow((row, no) => {
    if (no === 1) return;
    const v = {};
    for (const [col, k] of Object.entries(kunci)) { const x = nilai(row.getCell(+col)); if (x !== '') v[k] = x; }
    if (!Object.keys(v).length) return;
    const ke = typeof v.ke === 'number' ? v.ke : /^\d+$/.test(String(v.ke ?? '').trim()) ? +String(v.ke).trim() : NaN;
    const r = {no, ke, tanggal: v.tanggal === undefined ? null : bacaTanggal(v.tanggal), pokok: v.pokok === undefined ? NaN : bacaRupiah(v.pokok), bunga: v.bunga === undefined ? 0 : bacaRupiah(v.bunga)};
    if (v.total !== undefined) {
      const t = bacaRupiah(v.total);
      if (Number.isInteger(t) && Number.isInteger(r.pokok) && Number.isInteger(r.bunga) && t !== r.pokok + r.bunga) galat.push('Baris ' + no + ': Total ' + rp(t) + ' ≠ Pokok + Bunga ' + rp(r.pokok + r.bunga) + '.');
    }
    rows.push(r);
  });
  return {rows: rows.sort((a, b) => (a.ke || 0) - (b.ke || 0)), galatTotal: galat};
}
function bukaPratinjauJadwal(hu, {rows, galatTotal}) {
  const tj = targetJadwal(hu, hu.jadwal, hu.bayar);
  const salah = [...galatTotal, ...periksaJadwal(rows, tj)];
  const galat = h('p', {class: 'form-galat', role: 'alert'});
  const simpan = h('button', {class: 'btn btn-utama', type: 'button', disabled: salah.length > 0, onclick: aman(async () => {
    try { await sambilMenyimpan(simpan, () => store.keu.simpanJadwalHutang(hu.id, rows.map(({ke, tanggal: t, pokok, bunga}) => ({ke, tanggal: t, pokok, bunga})), 'impor')); }
    catch (e) { galat.textContent = e.message; return; }
    dlg.close(); S.tabHutang = 'jadwal'; await segarkanKeuangan(); pesan('Jadwal impor tersimpan: ' + rows.length + ' angsuran menggantikan jadwal sebelumnya.');
  })}, 'Ganti jadwal dengan ' + rows.length + ' angsuran');
  const dlg = dialogLebar('Pratinjau impor jadwal · ' + hu.kreditur_nama, h('div', {class: 'form'},
    h('p', null, h('b', null, rows.length + ' angsuran dibaca.'), ' Belum ada yang disimpan. ', tj.K ? 'Angsuran sampai ke-' + tj.K + ' (sudah dibayar) tetap; ' : '',
      'Total pokok harus ' + rp(tj.target) + (tj.K ? ' (sisa pokok yang dijadwalkan ulang).' : ' (pokok pinjaman).')),
    salah.length > 0 && h('div', {class: 'kotak-galat'}, h('b', null, 'Jadwal ditolak, perbaiki file lalu impor lagi:'), salah.slice(0, 20).map((g) => h('div', null, g)),
      salah.length > 20 && h('div', null, '… dan ' + (salah.length - 20) + ' masalah lain.')),
    rows.length > 0 && tabelPratinjau(rows),
    galat,
    kaki(h('span', {class: 'pegas'}), h('button', {class: 'btn', type: 'button', onclick: () => dlg.close()}, 'Batal'), simpan)));
}
