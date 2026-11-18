// Halaman Keuangan Tahap 1: Kas & Bank (rekening, mutasi, transaksi kas umum, transfer) dan Jurnal (daftar, jurnal manual, tutup buku).
import {S, segarkanKeuangan} from './state.js';
import {store, BUCKET_BUKTI, idBaru} from './store.js';
import {hariIni} from './calc.js';
import {bisaUbah, khusus} from './akses.js';
import {h, idn, rp, tgl, isi, pill, pesan, aman, dialog, formatUang, bacaUang, ukuranFile, pilihCari, kepalaUrut, bandingkan, sambilMenyimpan, unduh} from './ui.js';
import {eksporExcel, muatExcelJS} from './excel.js';
import {buatWorkbook, bacaWorkbook, evaluasiRekening, evaluasiKas, rekeningKeBaris, kasKeBaris, JENIS_IMPOR} from './keuangan-excel.js';
import {
  JENIS_REKENING, SUMBER_JURNAL, GOLONGAN, akunRekening, akunTransaksi, terkunci, mutasiRekening, saldoRekening, daftarJurnal,
  bulanDari, namaBulan,
} from './keuangan-data.js';

const K = () => S.keu;
const akunDari = (id) => K().akun.find((a) => a.id === id);
const namaAkun = (id) => { const a = akunDari(id); return a ? a.kode + ' ' + a.nama : '—'; };
const rekeningDari = (id) => K().rekening.find((r) => r.id === id);
const namaRekening = (id) => rekeningDari(id)?.nama || '—';
const opsiAkun = (o) => akunTransaksi(K(), o).map((a) => ({v: a.id, label: a.kode + ' ' + a.nama, grup: GOLONGAN[a.golongan]}));
const opsiProyek = () => S.db.proyek.slice().sort((a, b) => bandingkan(a.kode, b.kode)).map((p) => ({v: p.kode, label: p.kode + ' — ' + isi(p.nama)}));
const batasUnggah = () => (+S.pengaturan?.data?.unggah_mb || 10) * 1048576;
const bulanIni = () => bulanDari(hariIni());
const bisaKas = () => bisaUbah('kas');

// ---------- bagian formulir ----------
const medan = (label, el, {wajib, bantuan, lebar, id} = {}) => h('div', {class: 'medan' + (lebar ? ' medan-lebar' : '')},
  h('label', {for: id || el.id || el.querySelector?.('input,select,textarea')?.id}, label, wajib && h('span', {class: 'wajib', title: 'Wajib diisi'}, ' *')), el,
  bantuan && h('span', {class: 'kecil redup'}, bantuan));
const teks = (id, v, o = {}) => h('input', {id, type: 'text', value: v ?? '', autocomplete: 'off', ...o});
const tanggal = (id, v, o = {}) => h('input', {id, type: 'date', value: v ?? '', ...o});
const pilihan = (id, daftar, v, o = {}) => h('select', {id, ...o}, daftar.map(([x, l]) => h('option', {value: x, selected: x === v}, l)));
function uang(id, v, o = {}) {
  const inp = h('input', {id, type: 'text', inputmode: 'numeric', value: v == null || v === '' ? '' : idn(v), autocomplete: 'off', ...o, oninput: () => { inp.value = formatUang(inp.value); o.oninput?.(); }});
  return {el: h('div', {class: 'berawalan'}, h('span', null, 'Rp'), inp), inp, nilai: () => bacaUang(inp.value)};
}
const centang = (id, v, label) => h('label', {class: 'centang', for: id}, h('input', {id, type: 'checkbox', checked: !!v}), ' ', label);
const kaki = (...isiKaki) => h('div', {class: 'form-kaki'}, ...isiKaki);
const tombolHapus = (fn) => {
  let yakin = false;
  const b = h('button', {class: 'btn btn-bahaya', type: 'button', onclick: aman(async () => {
    if (!yakin) { yakin = true; b.textContent = 'Klik lagi untuk menghapus'; return; }
    await fn();
  })}, 'Hapus');
  return b;
};
const catatanKunci = (t) => terkunci(K(), t) && h('div', {class: 'kotak-info'}, '🔒 Bulan ' + namaBulan(bulanDari(t)) + ' sudah ditutup. Data ini hanya bisa dilihat. Untuk mengoreksinya, super admin harus membuka kembali buku bulan itu di Jurnal → Tutup buku.');

// Bukti transaksi: PDF, JPG, atau PNG; batas ukuran dari Pengaturan.
const TIPE_BUKTI = ['application/pdf', 'image/jpeg', 'image/png'];
export function pilihBukti(id, lama, {label = 'Bukti', hanyaPdf = false} = {}) {
  const TIPE = hanyaPdf ? ['application/pdf'] : TIPE_BUKTI;
  const ket = h('span', {class: 'kecil redup'}, (hanyaPdf ? 'PDF' : 'PDF, JPG, atau PNG') + ', maksimal ' + ukuranFile(batasUnggah()) + '.');
  const inp = h('input', {id, type: 'file', accept: hanyaPdf ? '.pdf,application/pdf' : '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png'});
  let buang = false;
  inp.addEventListener('change', () => {
    const f = inp.files[0];
    ket.classList.remove('form-galat');
    if (!f) return;
    if (!TIPE.includes(f.type) || f.size > batasUnggah()) {
      ket.textContent = !TIPE.includes(f.type) ? (hanyaPdf ? 'Hanya file PDF.' : 'Hanya PDF, JPG, atau PNG.') : 'File terlalu besar (' + ukuranFile(f.size) + '). Maksimal ' + ukuranFile(batasUnggah()) + '.';
      ket.classList.add('form-galat'); inp.value = '';
    } else ket.textContent = f.name + ' · ' + ukuranFile(f.size);
  });
  const lamaEl = lama && h('div', {class: 'baris-tombol'}, tombolBukti(lama), h('button', {class: 'btn btn-kecil', type: 'button', onclick: () => { buang = true; lamaEl.remove(); }}, 'Lepas bukti'));
  return {
    el: h('div', {class: 'medan medan-lebar'}, h('label', {for: id}, label), lamaEl, inp, ket),
    async ambil(folder) {
      const f = inp.files[0];
      if (!f) return buang ? null : lama || null;
      const path = folder + '/' + idBaru() + '-' + f.name.replace(/[^\w.-]+/g, '_');
      await store.unggah(path, f, BUCKET_BUKTI);
      return {path, nama: f.name, ukuran: f.size, tipe: f.type};
    },
  };
}
export function tombolBukti(b) {
  if (!b?.path) return '—';
  return h('button', {class: 'btn btn-kecil', type: 'button', title: b.nama, onclick: aman(async (ev) => { ev.stopPropagation(); window.open(await store.urlBerkas(b.path, BUCKET_BUKTI), '_blank', 'noopener'); })}, '📎 ' + (b.tipe === 'application/pdf' ? 'PDF' : 'Foto'));
}

export function kartuBelumSiap(el) {
  el.append(h('div', {class: 'kartu'}, h('h2', null, 'Database keuangan belum dipasang'),
    h('p', null, 'Bagian ini memerlukan pembaruan database Tahap 1. Jalankan SQL file supabase/migrasi/1-fondasi.sql di Supabase SQL Editor, lalu muat ulang halaman.')));
}

// ---------- Kas & Bank ----------
S.tabKas = S.tabKas || 'rekening';
S.urutKas = S.urutKas || {k: 'tanggal', arah: -1};
S.saringKas = S.saringKas || {rekening: '', jenis: '', bulan: ''};

export function renderKas(el) {
  el.append(h('div', {class: 'kepala'}, h('h1', null, 'Kas & Bank'),
    h('p', {class: 'redup'}, 'Saldo setiap rekening dihitung dari saldo awal, uang masuk, dan uang keluar. Setiap transaksi otomatis membuat jurnal.')));
  if (!K().siap) return kartuBelumSiap(el);
  const rek = K().rekening.slice().sort((a, b) => (b.aktif - a.aktif) || bandingkan(akunRekening(K(), a.id)?.kode, akunRekening(K(), b.id)?.kode));
  const aktif = rek.filter((r) => r.aktif);
  el.append(h('div', {class: 'alat'}, h('span', {class: 'pegas'}),
    bisaKas() && aktif.length > 0 && h('button', {class: 'btn btn-utama', type: 'button', onclick: () => bukaFormKas(null)}, '+ Transaksi kas'),
    bisaKas() && aktif.length > 1 && h('button', {class: 'btn', type: 'button', onclick: () => bukaFormTransfer(null)}, '+ Transfer antar rekening'),
    bisaKas() && h('button', {class: 'btn', type: 'button', onclick: () => bukaFormRekening(null)}, '+ Rekening')));

  if (!rek.length) {
    el.append(h('div', {class: 'kartu kosong-ajakan'}, h('h2', null, 'Belum ada rekening'),
      h('p', null, 'Tambahkan rekening bank dan kas tunai perusahaan beserta saldo awalnya. Setiap rekening otomatis menjadi sub-akun Kas dan Setara Kas di Bagan Akun.'),
      bisaKas() && h('div', {class: 'baris-tombol tengah-isi'}, h('button', {class: 'btn btn-utama', type: 'button', onclick: () => bukaFormRekening(null)}, '+ Tambah rekening pertama'),
        ...tombolExcel('rekening', {ekspor: false}))));
    return;
  }
  const total = aktif.reduce((s, r) => s + saldoRekening(K(), r.id), 0);
  el.append(h('section', {class: 'ubin-grid', 'aria-label': 'Saldo rekening'},
    h('div', {class: 'ubin'}, h('span', {class: 'ubin-label'}, 'Total kas & bank'), h('span', {class: 'ubin-nilai'}, rp(total)), h('span', {class: 'ubin-kaki'}, aktif.length + ' rekening aktif')),
    aktif.map((r) => h('a', {class: 'ubin ubin-tautan', href: '#kas-' + r.id},
      h('span', {class: 'ubin-label'}, r.nama), h('span', {class: 'ubin-nilai'}, rp(saldoRekening(K(), r.id))),
      h('span', {class: 'ubin-kaki'}, [r.jenis, r.bank, r.no_rekening].filter(Boolean).join(' · '))))));

  const TAB = [['rekening', 'Rekening'], ['kas', 'Transaksi kas umum'], ['transfer', 'Transfer']];
  const panel = h('div', {class: 'kartu', role: 'tabpanel'});
  const tombolTab = TAB.map(([k, label]) => h('button', {class: 'tab', type: 'button', role: 'tab', 'aria-selected': String(S.tabKas === k), onclick: () => { S.tabKas = k; S.render(); }}, label));
  el.append(h('div', {class: 'tabs', role: 'tablist'}, tombolTab), panel);
  if (S.tabKas === 'rekening') panelRekening(panel, rek);
  else if (S.tabKas === 'kas') panelKasUmum(panel);
  else panelTransfer(panel);
}

export function tabelRekening(rek) {
  return h('div', {class: 'gulir'}, h('table', {class: 'tabel'},
    h('thead', null, h('tr', null, ['Akun', 'Nama', 'Jenis', 'Bank / cabang', 'No. rekening', 'Atas nama', 'Saldo', 'Invoice', 'Status'].map((x, i) => h('th', {class: i === 6 ? 'kanan' : null}, x)))),
    h('tbody', null, rek.map((r) => h('tr', {class: 'bisa-klik', tabindex: '0', onclick: () => bukaFormRekening(r), onkeydown: (ev) => { if (ev.key === 'Enter') bukaFormRekening(r); }},
      h('td', null, akunRekening(K(), r.id)?.kode || '—'), h('td', null, h('a', {href: '#kas-' + r.id, onclick: (ev) => ev.stopPropagation()}, r.nama)), h('td', null, r.jenis),
      h('td', null, [r.bank, r.cabang].filter(Boolean).join(' · ') || '—'), h('td', null, isi(r.no_rekening)), h('td', null, isi(r.atas_nama)),
      h('td', {class: 'kanan'}, rp(saldoRekening(K(), r.id))),
      h('td', null, r.utama_invoice ? pill('Utama') : r.di_invoice ? 'Tampil' : '—'), h('td', null, pill(r.aktif ? 'Aktif' : 'Nonaktif')))))));
}
function panelRekening(panel, rek) {
  panel.append(h('div', {class: 'alat'}, h('span', {class: 'kecil redup'}, 'Klik baris untuk mengubah. Rekening yang sudah dipakai transaksi tidak bisa dihapus, hanya dinonaktifkan.'),
    h('span', {class: 'pegas'}), ...tombolExcel('rekening')), tabelRekening(rek));
}

// ---------- Excel: ekspor, template, impor dengan pratinjau ----------
async function unduhWorkbook(wb, nama) {
  unduh(nama, new Blob([await wb.xlsx.writeBuffer()], {type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
}
function tombolExcel(jenis, {ekspor = true, baris} = {}) {
  const berkas = h('input', {type: 'file', accept: '.xlsx', hidden: true, 'aria-label': 'File Excel ' + JENIS_IMPOR[jenis].nama, onchange: aman(async () => {
    const f = berkas.files[0];
    berkas.value = '';
    if (!f) return;
    pesan('Membaca ' + f.name + '…');
    const isiFile = await bacaWorkbook(await muatExcelJS(), jenis, await f.arrayBuffer());
    await segarkanKeuangan();
    bukaPratinjauImpor(jenis, isiFile);
  })});
  return [
    ekspor && h('button', {class: 'btn', type: 'button', onclick: aman(async () => {
      const data = baris ? baris() : jenis === 'rekening' ? K().rekening.map(rekeningKeBaris) : K().kas_transaksi.map((k) => kasKeBaris(K(), k));
      await unduhWorkbook(buatWorkbook(await muatExcelJS(), jenis, data, {K: K()}), (jenis === 'rekening' ? 'rekening-' : 'kas-umum-') + hariIni() + '.xlsx');
    })}, 'Ekspor Excel'),
    h('button', {class: 'btn', type: 'button', onclick: aman(async () => {
      await unduhWorkbook(buatWorkbook(await muatExcelJS(), jenis, [], {contoh: true, K: K()}), 'template-' + (jenis === 'rekening' ? 'rekening' : 'kas-umum') + '.xlsx');
    })}, 'Unduh Template'),
    bisaKas() && h('button', {class: 'btn', type: 'button', onclick: () => berkas.click()}, 'Impor Excel'), bisaKas() && berkas,
  ].filter(Boolean);
}

function bukaPratinjauImpor(jenis, isiFile) {
  const rekening = jenis === 'rekening';
  const hasil = rekening ? evaluasiRekening(isiFile, K()) : evaluasiKas(isiFile, K(), S.db.proyek.map((p) => p.kode).filter(Boolean));
  const error = hasil.filter((r) => r.status === 'error'), dup = hasil.filter((r) => r.status === 'duplikat'), siap = hasil.filter((r) => r.status === 'siap');
  const akanSimpan = () => siap.concat(dup.filter((r) => r.aksi === 'simpan'));
  const satuan = rekening ? ' rekening' : ' transaksi';
  const galat = h('p', {class: 'form-galat', role: 'alert'});
  const tombol = h('button', {class: 'btn btn-utama', type: 'button'});
  let dlg, yakin = false;
  const segarTombol = () => { yakin = false; tombol.textContent = 'Simpan ' + akanSimpan().length + satuan; tombol.disabled = !akanSimpan().length; };
  tombol.addEventListener('click', aman(async () => {
    if (!yakin) { yakin = true; tombol.textContent = 'Klik lagi untuk menyimpan ' + akanSimpan().length + satuan; return; }
    galat.textContent = '';
    const daftar = akanSimpan().sort((a, b) => a.no - b.no).map((r) => ({...r.data, __no: r.no}));
    try {
      await sambilMenyimpan(tombol, () => (rekening ? store.keu.imporRekening(daftar) : store.keu.imporKas(daftar)));
    } catch (e) {
      galat.textContent = 'Tidak ada yang tersimpan. ' + e.message; segarTombol(); await segarkanKeuangan(); return;
    }
    dlg.close(); await segarkanKeuangan();
    pesan('Impor selesai: ' + daftar.length + satuan + ' tersimpan dan dijurnal otomatis.');
  }));
  const tabel = (judul, kepala, rows) => rows.length ? [h('h3', null, judul), h('div', {class: 'gulir gulir-pendek'}, h('table', {class: 'tabel'}, h('thead', null, h('tr', null, kepala.map((x) => h('th', null, x)))), h('tbody', null, rows)))] : null;
  const ringkas = (r) => rekening
    ? [h('td', null, r.data.nama || isi(r.nilai.nama)), h('td', null, isi(r.data.jenis)), h('td', {class: 'kanan'}, Number.isInteger(r.data.saldo_awal) ? rp(r.data.saldo_awal) : '—'), h('td', null, r.data.tgl_saldo_awal ? tgl(r.data.tgl_saldo_awal) : '—')]
    : [h('td', null, r.data.tanggal ? tgl(r.data.tanggal) : '—'), h('td', null, r.data.jenis === 'masuk' ? 'Pemasukan' : r.data.jenis === 'keluar' ? 'Pengeluaran' : '—'), h('td', null, isi(r.rekening)), h('td', null, isi(r.akun)),
      h('td', {class: 'lebar'}, isi(r.data.uraian)), h('td', {class: 'kanan'}, Number.isInteger(r.data.jumlah) ? rp(r.data.jumlah) : '—')];
  const kepala = rekening ? ['Nama', 'Jenis', 'Saldo awal', 'Tgl saldo awal'] : ['Tanggal', 'Jenis', 'Rekening', 'Akun', 'Uraian', 'Jumlah'];
  const pilihAksi = (r) => (r.bolehSimpanJuga
    ? h('select', {'aria-label': 'Tindakan untuk baris ' + r.no, onchange: (ev) => { r.aksi = ev.target.value; segarTombol(); }}, [['lewati', 'Lewati'], ['simpan', 'Tetap simpan']].map(([v, l]) => h('option', {value: v}, l)))
    : 'Dilewati');
  const total = (rows) => rows.reduce((s, r) => s + (rekening ? r.data.saldo_awal : r.data.jumlah), 0);
  segarTombol();
  dlg = dialog('Pratinjau impor ' + JENIS_IMPOR[jenis].nama, h('div', {class: 'form'},
    h('p', null, h('b', null, siap.length + ' baris siap, ' + error.length + ' baris error, ' + dup.length + ' baris duplikat.'), ' Belum ada yang disimpan.'),
    !hasil.length && h('p', {class: 'redup'}, 'File tidak berisi baris data (baris contoh diabaikan).'),
    tabel('Baris error (tidak ikut disimpan)', ['Baris', 'Masalah'], error.map((r) => h('tr', null, h('td', null, String(r.no)), h('td', null, r.galat.map((g) => h('div', null, g.kolom + ': ' + g.pesan)))))),
    error.length > 0 && h('div', null, h('button', {class: 'btn btn-kecil', type: 'button', onclick: aman(async () => {
      await unduhWorkbook(buatWorkbook(await muatExcelJS(), jenis, error.map((r) => r.nilai), {galat: error.map((r) => r.galat.map((g) => g.kolom + ': ' + g.pesan).join('; ')), K: K()}), (rekening ? 'rekening' : 'kas-umum') + '-baris-error.xlsx');
    })}, 'Unduh baris yang error'), h('span', {class: 'kecil redup'}, ' Perbaiki di file itu, lalu impor lagi.')),
    tabel('Baris duplikat', ['Baris', ...kepala, 'Duplikat karena', 'Tindakan'], dup.map((r) => h('tr', null, h('td', null, String(r.no)), ...ringkas(r), h('td', null, r.alasan), h('td', null, pilihAksi(r))))),
    tabel('Baris siap disimpan · total ' + rp(total(siap)), ['Baris', ...kepala], siap.map((r) => h('tr', null, h('td', null, String(r.no)), ...ringkas(r)))),
    siap.length > 0 && h('p', {class: 'kecil redup'}, rekening ? 'Setiap rekening otomatis menjadi sub-akun 1-1-xx dan saldo awalnya dijurnal ke 3-2-01 Ekuitas saldo awal.' : 'Setiap transaksi otomatis dijurnal: pengeluaran D akun / K rekening, pemasukan D rekening / K akun.'),
    galat,
    h('div', {class: 'form-kaki'}, h('span', {class: 'pegas'}), h('button', {class: 'btn', type: 'button', onclick: () => dlg.close()}, 'Batal'), tombol)));
}

function panelKasUmum(panel) {
  const sr = S.saringKas;
  const badan = h('tbody'), hitungan = h('span', {class: 'redup kecil'});
  const tabel = h('table', {class: 'tabel'}, h('thead'), badan);
  const KOLOM = [['tanggal', 'Tanggal'], ['jenis', 'Jenis'], ['rekening', 'Rekening'], ['akun', 'Akun'], ['proyek_kode', 'Proyek'], ['pihak', 'Pihak'], ['uraian', 'Uraian'], ['jumlah', 'Jumlah', true], [null, 'Bukti']];
  const baris = () => K().kas_transaksi.map((k) => ({...k, rekening: namaRekening(k.rekening_id), akun: namaAkun(k.akun_id)}));
  const gambar = () => {
    let rows = baris().filter((k) => (!sr.rekening || k.rekening_id === sr.rekening) && (!sr.jenis || k.jenis === sr.jenis) && (!sr.bulan || bulanDari(k.tanggal) === sr.bulan));
    const q = S.cari.trim().toLowerCase();
    if (q) rows = rows.filter((k) => [k.uraian, k.pihak, k.proyek_kode, k.akun, k.rekening].some((x) => String(x ?? '').toLowerCase().includes(q)));
    rows.sort((a, b) => bandingkan(a[S.urutKas.k], b[S.urutKas.k]) * S.urutKas.arah || bandingkan(b.dibuat, a.dibuat));
    hitungan.textContent = rows.length + ' transaksi · masuk ' + rp(rows.filter((k) => k.jenis === 'masuk').reduce((s, k) => s + k.jumlah, 0)) + ' · keluar ' + rp(rows.filter((k) => k.jenis === 'keluar').reduce((s, k) => s + k.jumlah, 0));
    tabel.querySelector('thead').replaceWith(kepalaUrut(KOLOM, S.urutKas, gambar));
    badan.replaceChildren(...(rows.length ? rows.map((k) => h('tr', {class: 'bisa-klik', tabindex: '0', onclick: () => bukaFormKas(k), onkeydown: (ev) => { if (ev.key === 'Enter') bukaFormKas(k); }},
      h('td', null, tgl(k.tanggal), terkunci(K(), k.tanggal) && ' 🔒'), h('td', null, pill(k.jenis === 'masuk' ? 'Pemasukan' : 'Pengeluaran')), h('td', null, k.rekening), h('td', null, k.akun),
      h('td', null, isi(k.proyek_kode)), h('td', null, isi(k.pihak)), h('td', {class: 'lebar'}, k.uraian), h('td', {class: 'kanan'}, rp(k.jumlah)), h('td', null, tombolBukti(k.bukti))))
      : [h('tr', null, h('td', {colspan: '9', class: 'redup'}, K().kas_transaksi.length ? 'Tidak ada transaksi yang cocok dengan saringan.' : 'Belum ada transaksi kas umum. Klik "+ Transaksi kas" untuk mencatat pemasukan atau pengeluaran.'))]));
  };
  const bulanAda = [...new Set(K().kas_transaksi.map((k) => bulanDari(k.tanggal)))].sort().reverse();
  panel.append(
    h('div', {class: 'alat'},
      h('input', {type: 'search', placeholder: 'Cari…', 'aria-label': 'Cari transaksi', value: S.cari, oninput: (ev) => { S.cari = ev.target.value; gambar(); }}),
      pilihan('saring-rek', [['', 'Semua rekening'], ...K().rekening.map((r) => [r.id, r.nama])], sr.rekening, {'aria-label': 'Saring rekening', onchange: (ev) => { sr.rekening = ev.target.value; gambar(); }}),
      pilihan('saring-jenis', [['', 'Semua jenis'], ['masuk', 'Pemasukan'], ['keluar', 'Pengeluaran']], sr.jenis, {'aria-label': 'Saring jenis', onchange: (ev) => { sr.jenis = ev.target.value; gambar(); }}),
      pilihan('saring-bulan', [['', 'Semua bulan'], ...bulanAda.map((b) => [b, namaBulan(b)])], sr.bulan, {'aria-label': 'Saring bulan', onchange: (ev) => { sr.bulan = ev.target.value; gambar(); }}),
      hitungan, h('span', {class: 'pegas'}),
      ...tombolExcel('kas', {baris: () => K().kas_transaksi.slice().sort((a, b) => bandingkan(a.tanggal, b.tanggal)).map((k) => kasKeBaris(K(), k))})),
    h('div', {class: 'gulir'}, tabel));
  gambar();
}

function panelTransfer(panel) {
  const rows = K().transfer.slice().sort((a, b) => bandingkan(b.tanggal, a.tanggal) || bandingkan(b.dibuat, a.dibuat));
  panel.append(h('div', {class: 'gulir'}, h('table', {class: 'tabel'},
    h('thead', null, h('tr', null, ['Tanggal', 'Dari', 'Ke', 'Jumlah', 'Biaya admin', 'Uraian', 'Bukti'].map((x, i) => h('th', {class: i === 3 || i === 4 ? 'kanan' : null}, x)))),
    h('tbody', null, rows.length ? rows.map((t) => h('tr', {class: 'bisa-klik', tabindex: '0', onclick: () => bukaFormTransfer(t), onkeydown: (ev) => { if (ev.key === 'Enter') bukaFormTransfer(t); }},
      h('td', null, tgl(t.tanggal), terkunci(K(), t.tanggal) && ' 🔒'), h('td', null, namaRekening(t.dari_rekening)), h('td', null, namaRekening(t.ke_rekening)),
      h('td', {class: 'kanan'}, rp(t.jumlah)), h('td', {class: 'kanan'}, t.biaya_admin ? rp(t.biaya_admin) : '—'), h('td', {class: 'lebar'}, isi(t.uraian)), h('td', null, tombolBukti(t.bukti))))
      : h('tr', null, h('td', {colspan: '7', class: 'redup'}, 'Belum ada transfer antar rekening.'))))));
}

// Mutasi satu rekening.
export function renderMutasi(el, rid) {
  const r = rekeningDari(rid);
  if (!K().siap) return kartuBelumSiap(el);
  if (!r) { el.append(h('div', {class: 'kartu'}, h('p', null, 'Rekening tidak ditemukan. '), h('a', {href: '#kas'}, '← Kembali ke Kas & Bank'))); return; }
  const semua = mutasiRekening(K(), rid);
  const dari = h('input', {type: 'date', id: 'mut-dari', 'aria-label': 'Dari tanggal'}), sampai = h('input', {type: 'date', id: 'mut-sampai', 'aria-label': 'Sampai tanggal'});
  const badan = h('tbody'), ringkas = h('p', {class: 'redup kecil'});
  const SUMBER = SUMBER_JURNAL;
  const pilihBaris = () => semua.filter((m) => (!dari.value || m.tanggal >= dari.value) && (!sampai.value || m.tanggal <= sampai.value));
  const gambar = () => {
    const rows = pilihBaris();
    const awal = dari.value ? (semua.filter((m) => m.tanggal < dari.value).at(-1)?.saldo ?? 0) : 0;
    ringkas.textContent = (dari.value ? 'Saldo sebelum ' + tgl(dari.value) + ': ' + rp(awal) + ' · ' : '') + 'Masuk ' + rp(rows.reduce((s, m) => s + m.masuk, 0)) + ' · Keluar ' + rp(rows.reduce((s, m) => s + m.keluar, 0));
    badan.replaceChildren(...(rows.length ? rows.slice().reverse().map((m) => h('tr', {class: 'bisa-klik', tabindex: '0', onclick: () => bukaSumber(m.sumber, m.sumber_id, m.jurnal_id)},
      h('td', null, tgl(m.tanggal)), h('td', {class: 'lebar'}, m.uraian), h('td', null, SUMBER[m.sumber] || m.sumber),
      h('td', {class: 'kanan'}, m.masuk ? rp(m.masuk) : ''), h('td', {class: 'kanan'}, m.keluar ? rp(m.keluar) : ''), h('td', {class: 'kanan'}, rp(m.saldo))))
      : [h('tr', null, h('td', {colspan: '6', class: 'redup'}, 'Tidak ada mutasi pada periode ini.'))]));
  };
  dari.addEventListener('change', gambar); sampai.addEventListener('change', gambar);
  el.append(
    h('div', {class: 'kepala'}, h('a', {href: '#kas', class: 'kecil'}, '← Kas & Bank'), h('h1', null, r.nama),
      h('p', {class: 'redup'}, [akunRekening(K(), rid)?.kode, r.jenis, r.bank, r.cabang, r.no_rekening, r.atas_nama && 'a.n. ' + r.atas_nama].filter(Boolean).join(' · '))),
    h('section', {class: 'ubin-grid'},
      h('div', {class: 'ubin'}, h('span', {class: 'ubin-label'}, 'Saldo sekarang'), h('span', {class: 'ubin-nilai'}, rp(saldoRekening(K(), rid))), h('span', {class: 'ubin-kaki'}, 'per ' + tgl(hariIni()))),
      h('div', {class: 'ubin'}, h('span', {class: 'ubin-label'}, 'Saldo awal'), h('span', {class: 'ubin-nilai'}, rp(r.saldo_awal)), h('span', {class: 'ubin-kaki'}, 'per ' + tgl(r.tgl_saldo_awal)))),
    h('div', {class: 'kartu'},
      h('div', {class: 'alat'}, h('label', {for: 'mut-dari', class: 'kecil redup'}, 'Dari'), dari, h('label', {for: 'mut-sampai', class: 'kecil redup'}, 'sampai'), sampai, h('span', {class: 'pegas'}),
        bisaKas() && r.aktif && h('button', {class: 'btn btn-utama', type: 'button', onclick: () => bukaFormKas(null, {rekening_id: rid})}, '+ Transaksi kas'),
        h('button', {class: 'btn', type: 'button', onclick: () => bukaFormRekening(r)}, 'Data rekening'),
        h('button', {class: 'btn', type: 'button', onclick: aman(() => eksporExcel('mutasi-' + r.nama.replace(/\W+/g, '-') + '-' + hariIni() + '.xlsx', [{nama: 'Mutasi', kolom: [
          {judul: 'Tanggal', k: 'tanggal'}, {judul: 'Uraian', k: 'uraian', lebar: 40}, {judul: 'Sumber', k: 'sumber_teks', lebar: 16},
          {judul: 'Masuk', k: 'masuk', jenis: 'uang', lebar: 16}, {judul: 'Keluar', k: 'keluar', jenis: 'uang', lebar: 16}, {judul: 'Saldo', k: 'saldo', jenis: 'uang', lebar: 16}],
        baris: pilihBaris().map((m) => ({...m, sumber_teks: SUMBER[m.sumber] || m.sumber}))}]))}, 'Ekspor Excel')),
      ringkas,
      h('div', {class: 'gulir'}, h('table', {class: 'tabel'},
        h('thead', null, h('tr', null, ['Tanggal', 'Uraian', 'Sumber', 'Masuk', 'Keluar', 'Saldo'].map((x, i) => h('th', {class: i >= 3 ? 'kanan' : null}, x)))), badan))));
  gambar();
}

// Membuka formulir sumber sebuah jurnal.
export function bukaSumber(sumber, sumberId, jurnalId) {
  if (sumber === 'kas') { const k = K().kas_transaksi.find((x) => x.id === sumberId); if (k) return bukaFormKas(k); }
  if (sumber === 'transfer') { const t = K().transfer.find((x) => x.id === sumberId); if (t) return bukaFormTransfer(t); }
  if (sumber === 'saldo_awal') { const r = rekeningDari(sumberId); if (r) return bukaFormRekening(r); }
  if (sumber === 'penerimaan') { const p = K().penerimaan?.find((x) => x.id === sumberId); if (p) { location.hash = '#piutang-' + p.termin_id; return; } }
  if (sumber === 'invoice' && K().termin?.some((x) => x.id === sumberId)) { location.hash = '#piutang-' + sumberId; return; }
  if ((sumber === 'aset' || sumber === 'pelepasan_aset') && K().aset?.some((x) => x.id === sumberId)) { location.hash = '#aset-' + sumberId; return; }
  if (sumber === 'servis_aset') { const s = K().aset_servis?.find((x) => x.id === sumberId); if (s) { S.tabAset = 'servis'; location.hash = '#aset-' + s.aset_id; return; } }
  const j = daftarJurnal(K()).find((x) => x.id === jurnalId);
  if (j) bukaFormJurnal(j);
}

// ---------- formulir rekening ----------
const normNama = (s) => String(s || '').toLowerCase().replace(/\b(pt|cv|tbk|persero|perorangan)\b/g, '').replace(/[^a-z0-9]/g, '');
export function bukaFormRekening(r) {
  const bisa = bisaUbah('kas') || bisaUbah('pengaturan');
  const kunci = r && terkunci(K(), r.tgl_saldo_awal);
  const galat = h('p', {class: 'form-galat', role: 'alert'});
  const nama = teks('r-nama', r?.nama, {required: true, placeholder: 'mis. BCA Giro Operasional'});
  const jenis = pilihan('r-jenis', JENIS_REKENING.map((j) => [j, j]), r?.jenis || 'Giro');
  const bank = teks('r-bank', r?.bank), cabang = teks('r-cabang', r?.cabang);
  const norek = teks('r-norek', r?.no_rekening, {inputmode: 'numeric'});
  const atas = teks('r-atas', r?.atas_nama ?? (r ? '' : S.profil.badan_hukum || ''));
  const mataUang = pilihan('r-uang', [['IDR', 'IDR (Rupiah)']], 'IDR', {disabled: true});
  const saldo = uang('r-saldo', r ? r.saldo_awal : '', {disabled: kunci});
  const tglSaldo = tanggal('r-tgl', r?.tgl_saldo_awal || hariIni(), {required: true, disabled: kunci});
  const diInvoice = centang('r-invoice', r?.di_invoice, 'Tampilkan di invoice');
  const utama = centang('r-utama', r?.utama_invoice, 'Rekening utama invoice');
  const aktif = centang('r-aktif', r ? r.aktif : true, 'Aktif');
  const catatan = h('textarea', {id: 'r-catatan', rows: '2'}, r?.catatan ?? '');
  const peringatan = h('div', {class: 'kotak-info', hidden: true});
  const cek = () => {
    const bh = S.profil.badan_hukum, an = atas.value.trim();
    const pesanList = [];
    if (an && bh && normNama(an) !== normNama(bh)) pesanList.push('⚠ Rekening bukan atas nama perusahaan (' + bh + ').');
    const utamaLain = K().rekening.find((x) => x.utama_invoice && x.id !== r?.id);
    if (utama.querySelector('input').checked && utamaLain) pesanList.push('Rekening utama invoice sekarang "' + utamaLain.nama + '"; akan dipindahkan ke rekening ini.');
    const mirip = nama.value.trim() && K().rekening.find((x) => x.id !== r?.id && normNama(x.nama) === normNama(nama.value) && x.nama.toLowerCase() !== nama.value.trim().toLowerCase());
    if (mirip) pesanList.push('Nama mirip dengan rekening "' + mirip.nama + '". Pastikan bukan rekening yang sama.');
    peringatan.replaceChildren(...pesanList.map((x) => h('div', null, x)));
    peringatan.hidden = !pesanList.length;
    const tunai = jenis.value === 'Kas tunai';
    for (const x of [bank, cabang, norek]) x.closest('.medan').hidden = tunai;
  };
  [atas, nama, jenis].forEach((x) => x.addEventListener('input', cek));
  jenis.addEventListener('change', cek);
  utama.querySelector('input').addEventListener('change', () => { if (utama.querySelector('input').checked) diInvoice.querySelector('input').checked = true; cek(); });
  const simpan = h('button', {class: 'btn btn-utama', type: 'submit'}, 'Simpan');
  const dipakai = r && (K().kas_transaksi.some((k) => k.rekening_id === r.id) || K().transfer.some((t) => t.dari_rekening === r.id || t.ke_rekening === r.id));
  let dlg;
  const form = h('form', {class: 'form', onsubmit: async (ev) => {
    ev.preventDefault();
    galat.textContent = '';
    if (!nama.value.trim()) { galat.textContent = 'Nama akun rekening wajib diisi.'; nama.focus(); return; }
    const tunai = jenis.value === 'Kas tunai';
    const no = tunai ? '' : norek.value.trim();
    if (no && K().rekening.some((x) => x.id !== r?.id && String(x.no_rekening || '').replace(/\D/g, '') === no.replace(/\D/g, '') && normNama(x.bank) === normNama(bank.value))) {
      galat.textContent = 'No. rekening ' + no + ' di bank ini sudah terdaftar.'; norek.focus(); return;
    }
    const data = {
      nama: nama.value.trim(), jenis: jenis.value, bank: tunai ? null : bank.value.trim() || null, cabang: tunai ? null : cabang.value.trim() || null,
      no_rekening: no || null, atas_nama: atas.value.trim() || null, mata_uang: 'IDR',
      di_invoice: diInvoice.querySelector('input').checked, utama_invoice: utama.querySelector('input').checked, aktif: aktif.querySelector('input').checked,
      catatan: catatan.value.trim() || null,
    };
    if (!kunci) { data.saldo_awal = saldo.nilai() ?? 0; data.tgl_saldo_awal = tglSaldo.value; }
    if (data.utama_invoice && !(data.di_invoice && data.aktif)) { galat.textContent = 'Rekening utama invoice harus aktif dan ditampilkan di invoice.'; return; }
    try {
      await sambilMenyimpan(simpan, async () => {
        const utamaLain = K().rekening.find((x) => x.utama_invoice && x.id !== r?.id);
        if (data.utama_invoice && utamaLain) await store.keu.simpanRekening(utamaLain.id, {utama_invoice: false});
        await store.keu.simpanRekening(r?.id, data);
      });
      dlg.close(); await segarkanKeuangan(); pesan('Rekening tersimpan.');
    } catch (e) { galat.textContent = e.message; await segarkanKeuangan(); }
  }},
    kunci && catatanKunci(r.tgl_saldo_awal),
    h('div', {class: 'form-grid'},
      medan('Nama akun', nama, {wajib: true}), medan('Jenis', jenis, {wajib: true}),
      medan('Bank', bank), medan('Cabang', cabang), medan('No. rekening', norek), medan('Atas nama', atas),
      medan('Mata uang', mataUang, {bantuan: 'Saat ini hanya Rupiah.'}),
      medan('Saldo awal', saldo.el, {id: 'r-saldo', bantuan: 'Rupiah utuh. Dijurnal ke 3-2-01 Ekuitas saldo awal.'}),
      medan('Tanggal saldo awal', tglSaldo, {wajib: true}),
      h('div', {class: 'medan medan-lebar'}, diInvoice, utama, aktif),
      medan('Catatan', catatan, {lebar: true})),
    peringatan, galat,
    kaki(r && bisa && (dipakai ? h('span', {class: 'kecil redup'}, 'Sudah dipakai transaksi; nonaktifkan saja.') : tombolHapus(async () => { await store.keu.hapusRekening(r.id); dlg.close(); await segarkanKeuangan(); pesan('Rekening dihapus.'); })),
      h('span', {class: 'pegas'}), h('button', {class: 'btn', type: 'button', onclick: () => dlg.close()}, bisa ? 'Batal' : 'Tutup'), bisa && simpan));
  if (!bisa) form.querySelectorAll('input,select,textarea').forEach((x) => { x.disabled = true; });
  dlg = dialog(r ? 'Rekening: ' + r.nama : 'Tambah rekening', form);
  cek();
}

// ---------- formulir transaksi kas umum ----------
export function bukaFormKas(k, awal = {}) {
  const kunci = k && terkunci(K(), k.tanggal);
  const bisa = bisaKas() && !kunci;
  const galat = h('p', {class: 'form-galat', role: 'alert'});
  const tglEl = tanggal('k-tgl', k?.tanggal || hariIni(), {required: true});
  const jenis = pilihan('k-jenis', [['keluar', 'Pengeluaran'], ['masuk', 'Pemasukan']], k?.jenis || awal.jenis || 'keluar');
  const rekAktif = K().rekening.filter((r) => r.aktif || r.id === k?.rekening_id);
  const rek = pilihan('k-rek', [['', 'Pilih rekening…'], ...rekAktif.map((r) => [r.id, r.nama + ' · saldo ' + rp(saldoRekening(K(), r.id))])], k?.rekening_id || awal.rekening_id || (rekAktif.length === 1 ? rekAktif[0].id : ''), {required: true});
  const akun = pilihCari('k-akun', opsiAkun(), k?.akun_id || '', {wajib: true, label: 'Cari akun', placeholder: 'Ketik kode atau nama akun, mis. 6-3 atau listrik'});
  const proyek = pilihCari('k-proyek', opsiProyek(), k?.proyek_kode || '', {label: 'Cari proyek', placeholder: 'Opsional'});
  const saranPihak = [...new Set([...S.db.klien.map((x) => x.nama), ...S.db.vendor.map((x) => x.vendor), ...K().kas_transaksi.map((x) => x.pihak)].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'id'));
  const pihak = [teks('k-pihak', k?.pihak, {list: 'k-pihak-saran', placeholder: 'Opsional: dibayar ke / diterima dari'}), h('datalist', {id: 'k-pihak-saran'}, saranPihak.map((x) => h('option', {value: x})))];
  const jumlah = uang('k-jumlah', k?.jumlah ?? '', {required: true});
  const uraian = h('textarea', {id: 'k-uraian', rows: '2', required: true}, k?.uraian ?? '');
  const bukti = pilihBukti('k-bukti', k?.bukti);
  // Tahap 5: barang modal di bawah batas kapitalisasi (Laporan Pajak aset).
  const asetSiap = K().aset_siap !== false && K().aset_kategori;
  const modal = centang('k-modal', k?.barang_modal, 'Barang modal di bawah batas kapitalisasi');
  const mModal = asetSiap && h('div', {class: 'medan medan-lebar'}, modal, h('span', {class: 'kecil redup'}, 'Centang untuk pengeluaran membeli barang modal (alat, perabot, elektronik) yang nilainya di bawah batas kapitalisasi sehingga dibebankan. Masuk Laporan Pajak aset → (c).'));
  const pratinjau = h('div', {class: 'kotak-info kecil'});
  const segar = () => {
    const jml = jumlah.nilai() || 0, a = akun.querySelector('input[type=hidden]').value, r = rek.value;
    if (mModal) mModal.hidden = jenis.value !== 'keluar';
    const kasAkun = r ? akunRekening(K(), r) : null;
    const [d, kr] = jenis.value === 'masuk' ? [kasAkun?.id, a] : [a, kasAkun?.id];
    pratinjau.replaceChildren(...[h('b', null, 'Jurnal otomatis: '), 'D ' + (d ? namaAkun(d) : '…') + ' ' + rp(jml) + ' / K ' + (kr ? namaAkun(kr) : '…') + ' ' + rp(jml),
      terkunci(K(), tglEl.value) && h('div', {class: 'form-galat'}, 'Bulan ' + namaBulan(bulanDari(tglEl.value)) + ' sudah ditutup; pilih tanggal di bulan yang masih terbuka.')].filter(Boolean));
  };
  [tglEl, jenis, rek].forEach((x) => x.addEventListener('change', segar));
  akun.querySelector('input[type=hidden]').addEventListener('change', segar);
  jumlah.inp.addEventListener('input', segar);
  const simpan = h('button', {class: 'btn btn-utama', type: 'submit'}, 'Simpan');
  let dlg;
  const form = h('form', {class: 'form', onsubmit: async (ev) => {
    ev.preventDefault();
    galat.textContent = '';
    const data = {
      tanggal: tglEl.value, jenis: jenis.value, rekening_id: rek.value, akun_id: akun.querySelector('input[type=hidden]').value,
      proyek_kode: proyek.querySelector('input[type=hidden]').value || null, pihak: form.querySelector('#k-pihak').value.trim() || null,
      jumlah: jumlah.nilai(), uraian: uraian.value.trim(),
      ...(asetSiap ? {barang_modal: jenis.value === 'keluar' && modal.querySelector('input').checked} : {}),
    };
    if (!data.tanggal) { galat.textContent = 'Tanggal wajib diisi.'; return; }
    if (!data.rekening_id) { galat.textContent = 'Rekening wajib dipilih.'; rek.focus(); return; }
    if (!data.akun_id) { galat.textContent = 'Akun wajib dipilih dari daftar.'; form.querySelector('#k-akun-cari').focus(); return; }
    if (!(data.jumlah > 0)) { galat.textContent = 'Jumlah harus lebih dari 0.'; jumlah.inp.focus(); return; }
    if (!data.uraian) { galat.textContent = 'Uraian wajib diisi.'; uraian.focus(); return; }
    try {
      await sambilMenyimpan(simpan, async () => {
        const id = k?.id || idBaru();
        data.bukti = await bukti.ambil('kas/' + id);
        if (!k) data.id = id;
        await store.keu.simpanKas(k?.id, data);
      });
      dlg.close(); await segarkanKeuangan(); pesan('Transaksi kas tersimpan dan dijurnal.');
    } catch (e) { galat.textContent = e.message; }
  }},
    kunci && catatanKunci(k.tanggal),
    h('div', {class: 'form-grid'},
      medan('Tanggal', tglEl, {wajib: true}), medan('Jenis', jenis, {wajib: true}),
      medan('Rekening', rek, {wajib: true}), medan('Akun', akun, {wajib: true, id: 'k-akun-cari', bantuan: 'Lawan dari rekening, mis. 6-3 Listrik untuk bayar listrik.'}),
      medan('Proyek', proyek, {id: 'k-proyek-cari'}), medan('Pihak', h('div', null, pihak), {id: 'k-pihak'}),
      medan('Jumlah', jumlah.el, {wajib: true, id: 'k-jumlah'}), medan('Uraian', uraian, {wajib: true, lebar: true}),
      mModal, bukti.el),
    pratinjau, galat,
    kaki(k && bisa && tombolHapus(async () => { await store.keu.hapusKas(k.id); dlg.close(); await segarkanKeuangan(); pesan('Transaksi dihapus beserta jurnalnya.'); }),
      h('span', {class: 'pegas'}), h('button', {class: 'btn', type: 'button', onclick: () => dlg.close()}, bisa ? 'Batal' : 'Tutup'), bisa && simpan));
  if (!bisa) form.querySelectorAll('input,select,textarea').forEach((x) => { x.disabled = true; });
  dlg = dialog(k ? 'Transaksi kas umum' : 'Tambah transaksi kas umum', form);
  segar();
}

// ---------- formulir transfer ----------
export function bukaFormTransfer(t) {
  const kunci = t && terkunci(K(), t.tanggal);
  const bisa = bisaKas() && !kunci;
  const galat = h('p', {class: 'form-galat', role: 'alert'});
  const rekAktif = K().rekening.filter((r) => r.aktif || r.id === t?.dari_rekening || r.id === t?.ke_rekening);
  const opsi = [['', 'Pilih rekening…'], ...rekAktif.map((r) => [r.id, r.nama + ' · saldo ' + rp(saldoRekening(K(), r.id))])];
  const tglEl = tanggal('t-tgl', t?.tanggal || hariIni(), {required: true});
  const dari = pilihan('t-dari', opsi, t?.dari_rekening || '', {required: true});
  const ke = pilihan('t-ke', opsi, t?.ke_rekening || '', {required: true});
  const jumlah = uang('t-jumlah', t?.jumlah ?? '');
  const biaya = uang('t-biaya', t?.biaya_admin || '');
  const uraian = teks('t-uraian', t?.uraian, {placeholder: 'Opsional, mis. Pindah dana ke tabungan'});
  const bukti = pilihBukti('t-bukti', t?.bukti);
  const pratinjau = h('div', {class: 'kotak-info kecil'});
  const segar = () => {
    const a = dari.value && akunRekening(K(), dari.value), b = ke.value && akunRekening(K(), ke.value), j = jumlah.nilai() || 0, by = biaya.nilai() || 0;
    pratinjau.replaceChildren(...[h('b', null, 'Jurnal otomatis: '), 'D ' + (b ? namaAkun(b.id) : '…') + ' ' + rp(j) + ' / K ' + (a ? namaAkun(a.id) : '…') + ' ' + rp(j),
      by > 0 && h('div', null, 'D 7-4 Biaya Administrasi Bank ' + rp(by) + ' / K ' + (a ? namaAkun(a.id) : '…') + ' ' + rp(by)),
      h('div', {class: 'redup'}, 'Saldo asal berkurang ' + rp(j + by) + ', saldo tujuan bertambah ' + rp(j) + '. Tidak ada pendapatan atau beban selain biaya admin.')].filter(Boolean));
  };
  [dari, ke].forEach((x) => x.addEventListener('change', segar));
  [jumlah.inp, biaya.inp].forEach((x) => x.addEventListener('input', segar));
  const simpan = h('button', {class: 'btn btn-utama', type: 'submit'}, 'Simpan');
  let dlg;
  const form = h('form', {class: 'form', onsubmit: async (ev) => {
    ev.preventDefault();
    galat.textContent = '';
    const data = {tanggal: tglEl.value, dari_rekening: dari.value, ke_rekening: ke.value, jumlah: jumlah.nilai(), biaya_admin: biaya.nilai() || 0, uraian: uraian.value.trim() || null};
    if (!data.dari_rekening || !data.ke_rekening) { galat.textContent = 'Rekening asal dan tujuan wajib dipilih.'; return; }
    if (data.dari_rekening === data.ke_rekening) { galat.textContent = 'Rekening asal dan tujuan tidak boleh sama.'; return; }
    if (!(data.jumlah > 0)) { galat.textContent = 'Jumlah transfer harus lebih dari 0.'; jumlah.inp.focus(); return; }
    if (data.biaya_admin < 0) { galat.textContent = 'Biaya admin tidak boleh minus.'; return; }
    try {
      await sambilMenyimpan(simpan, async () => {
        const id = t?.id || idBaru();
        data.bukti = await bukti.ambil('transfer/' + id);
        if (!t) data.id = id;
        await store.keu.simpanTransfer(t?.id, data);
      });
      dlg.close(); await segarkanKeuangan(); pesan('Transfer tersimpan dan dijurnal.');
    } catch (e) { galat.textContent = e.message; }
  }},
    kunci && catatanKunci(t.tanggal),
    h('div', {class: 'form-grid'},
      medan('Tanggal', tglEl, {wajib: true}), h('div', {class: 'medan'}),
      medan('Dari rekening', dari, {wajib: true}), medan('Ke rekening', ke, {wajib: true}),
      medan('Jumlah', jumlah.el, {wajib: true, id: 't-jumlah'}), medan('Biaya admin', biaya.el, {id: 't-biaya', bantuan: 'Opsional. Dibebankan ke 7-4 Biaya Administrasi Bank dan dipotong dari rekening asal.'}),
      medan('Uraian', uraian, {lebar: true}), bukti.el),
    pratinjau, galat,
    kaki(t && bisa && tombolHapus(async () => { await store.keu.hapusTransfer(t.id); dlg.close(); await segarkanKeuangan(); pesan('Transfer dihapus beserta jurnalnya.'); }),
      h('span', {class: 'pegas'}), h('button', {class: 'btn', type: 'button', onclick: () => dlg.close()}, bisa ? 'Batal' : 'Tutup'), bisa && simpan));
  if (!bisa) form.querySelectorAll('input,select,textarea').forEach((x) => { x.disabled = true; });
  dlg = dialog(t ? 'Transfer antar rekening' : 'Tambah transfer antar rekening', form);
  segar();
}

// ---------- Jurnal ----------
S.tabJurnal = S.tabJurnal || 'jurnal';
S.saringJurnal = S.saringJurnal || {bulan: '', sumber: ''};
const bolehJurnalManual = () => bisaUbah('jurnal') && khusus('jurnal_manual');

export function renderJurnal(el) {
  el.append(h('div', {class: 'kepala'}, h('h1', null, 'Jurnal'),
    h('p', {class: 'redup'}, 'Jurnal otomatis dibuat dari transaksi dan tidak bisa diubah langsung: ubah transaksi sumbernya. Jurnal manual dipakai untuk penyesuaian dan wajib seimbang.')));
  if (!K().siap) return kartuBelumSiap(el);
  const TAB = [['jurnal', 'Daftar jurnal'], ['tutup', 'Tutup buku']];
  const panel = h('div', {class: 'kartu', role: 'tabpanel'});
  el.append(h('div', {class: 'tabs', role: 'tablist'}, TAB.map(([k, label]) => h('button', {class: 'tab', type: 'button', role: 'tab', 'aria-selected': String(S.tabJurnal === k), onclick: () => { S.tabJurnal = k; S.render(); }}, label))), panel);
  if (S.tabJurnal === 'tutup') panelTutupBuku(panel); else panelJurnal(panel);
}

function panelJurnal(panel) {
  const sj = S.saringJurnal;
  const semua = daftarJurnal(K());
  const bulanAda = [...new Set(semua.map((j) => bulanDari(j.tanggal)))].sort().reverse();
  const badan = h('tbody'), ringkas = h('span', {class: 'redup kecil'});
  const pilihBaris = () => {
    const q = S.cari.trim().toLowerCase();
    return semua.filter((j) => (!sj.bulan || bulanDari(j.tanggal) === sj.bulan) && (!sj.sumber || j.sumber === sj.sumber)
      && (!q || j.uraian.toLowerCase().includes(q) || j.baris.some((b) => namaAkun(b.akun_id).toLowerCase().includes(q) || String(b.proyek_kode || '').toLowerCase().includes(q))));
  };
  const gambar = () => {
    const rows = pilihBaris();
    const d = rows.reduce((s, j) => s + j.baris.reduce((x, b) => x + b.debit, 0), 0), k = rows.reduce((s, j) => s + j.baris.reduce((x, b) => x + b.kredit, 0), 0);
    ringkas.textContent = rows.length + ' jurnal · debit ' + rp(d) + ' · kredit ' + rp(k) + (d === k ? ' · seimbang' : ' · TIDAK SEIMBANG');
    badan.replaceChildren(...(rows.length ? rows.flatMap((j) => {
      const buka = () => bukaSumber(j.sumber, j.sumber_id, j.id);
      return [
        h('tr', {class: 'bisa-klik jurnal-kepala', tabindex: '0', onclick: buka, onkeydown: (ev) => { if (ev.key === 'Enter') buka(); }},
          h('td', null, tgl(j.tanggal), terkunci(K(), j.tanggal) && ' 🔒'), h('td', null, 'J-' + String(j.no).padStart(5, '0')),
          h('td', {class: 'lebar', colspan: '2'}, h('b', null, j.uraian), ' ', h('span', {class: 'pill pill-netral'}, SUMBER_JURNAL[j.sumber] || j.sumber), j.bukti && [' ', tombolBukti(j.bukti)]),
          h('td', null, ''), h('td', null, '')),
        ...j.baris.map((b) => h('tr', {class: 'jurnal-baris'}, h('td', null, ''), h('td', null, ''),
          h('td', {class: b.kredit ? 'menjorok' : null}, namaAkun(b.akun_id)), h('td', {class: 'kecil redup'}, [b.proyek_kode, b.keterangan].filter(Boolean).join(' · ')),
          h('td', {class: 'kanan'}, b.debit ? rp(b.debit) : ''), h('td', {class: 'kanan'}, b.kredit ? rp(b.kredit) : ''))),
      ];
    }) : [h('tr', null, h('td', {colspan: '6', class: 'redup'}, semua.length ? 'Tidak ada jurnal yang cocok dengan saringan.' : 'Belum ada jurnal. Jurnal muncul otomatis saat Anda menambah rekening bersaldo awal, transaksi kas, atau transfer.'))]));
  };
  panel.append(
    h('div', {class: 'alat'},
      h('input', {type: 'search', placeholder: 'Cari uraian, akun, proyek…', 'aria-label': 'Cari jurnal', value: S.cari, oninput: (ev) => { S.cari = ev.target.value; gambar(); }}),
      pilihan('j-bulan', [['', 'Semua bulan'], ...bulanAda.map((b) => [b, namaBulan(b)])], sj.bulan, {'aria-label': 'Saring bulan', onchange: (ev) => { sj.bulan = ev.target.value; gambar(); }}),
      pilihan('j-sumber', [['', 'Semua sumber'], ...Object.entries(SUMBER_JURNAL)], sj.sumber, {'aria-label': 'Saring sumber', onchange: (ev) => { sj.sumber = ev.target.value; gambar(); }}),
      ringkas, h('span', {class: 'pegas'}),
      h('button', {class: 'btn', type: 'button', onclick: aman(() => eksporExcel('jurnal-' + hariIni() + '.xlsx', [{nama: 'Jurnal', kolom: [
        {judul: 'Tanggal', k: 'tanggal'}, {judul: 'No.', k: 'no'}, {judul: 'Uraian', k: 'uraian', lebar: 40}, {judul: 'Sumber', k: 'sumber', lebar: 14},
        {judul: 'Kode akun', k: 'kode', jenis: 'teks'}, {judul: 'Nama akun', k: 'akun', lebar: 34}, {judul: 'Proyek', k: 'proyek'},
        {judul: 'Debit', k: 'debit', jenis: 'uang', lebar: 16}, {judul: 'Kredit', k: 'kredit', jenis: 'uang', lebar: 16}],
      baris: pilihBaris().slice().reverse().flatMap((j) => j.baris.map((b) => ({tanggal: j.tanggal, no: 'J-' + String(j.no).padStart(5, '0'), uraian: j.uraian, sumber: SUMBER_JURNAL[j.sumber],
        kode: akunDari(b.akun_id)?.kode, akun: akunDari(b.akun_id)?.nama, proyek: b.proyek_kode, debit: b.debit || null, kredit: b.kredit || null})))}]))}, 'Ekspor Excel'),
      bolehJurnalManual() && h('button', {class: 'btn btn-utama', type: 'button', onclick: () => bukaFormJurnal(null)}, '+ Jurnal manual')),
    h('div', {class: 'gulir'}, h('table', {class: 'tabel tabel-jurnal'},
      h('thead', null, h('tr', null, ['Tanggal', 'No.', 'Akun', 'Proyek / keterangan', 'Debit', 'Kredit'].map((x, i) => h('th', {class: i >= 4 ? 'kanan' : null}, x)))), badan)));
  gambar();
}

// Formulir jurnal: jurnal manual bisa diubah; jurnal otomatis hanya ditampilkan.
export function bukaFormJurnal(j) {
  const otomatis = j && j.sumber !== 'manual';
  const kunci = j && terkunci(K(), j.tanggal);
  const bisa = !otomatis && !kunci && bolehJurnalManual();
  const galat = h('p', {class: 'form-galat', role: 'alert'});
  const tglEl = tanggal('jm-tgl', j?.tanggal || hariIni(), {required: true});
  const uraian = teks('jm-uraian', j?.uraian, {required: true, placeholder: 'mis. Koreksi salah catat akun'});
  const bukti = pilihBukti('jm-bukti', j?.bukti);
  const badan = h('tbody');
  const total = h('tfoot');
  const baris = [];
  let nomor = 0;
  const opsi = opsiAkun({tanpaKas: false});
  const hitungTotal = () => {
    const d = baris.reduce((s, b) => s + (b.debit.nilai() || 0), 0), k = baris.reduce((s, b) => s + (b.kredit.nilai() || 0), 0);
    total.replaceChildren(h('tr', null, h('td', {colspan: '2', class: 'kanan'}, h('b', null, 'Total')), h('td', {class: 'kanan'}, h('b', null, rp(d))), h('td', {class: 'kanan'}, h('b', null, rp(k))),
      h('td', {colspan: '2'}, d === k && d > 0 ? pill('Seimbang') : h('span', {class: 'pill pill-buruk'}, 'Selisih ' + rp(Math.abs(d - k))))));
    return {d, k};
  };
  const tambah = (b = {}) => {
    const i = ++nomor;
    const akun = pilihCari('jm-akun-' + i, opsi, b.akun_id || '', {wajib: true, label: 'Akun baris ' + i, placeholder: 'Kode / nama akun'});
    const debit = uang('jm-d-' + i, b.debit || '', {'aria-label': 'Debit baris ' + i, oninput: hitungTotal});
    const kredit = uang('jm-k-' + i, b.kredit || '', {'aria-label': 'Kredit baris ' + i, oninput: hitungTotal});
    const proyek = pilihCari('jm-p-' + i, opsiProyek(), b.proyek_kode || '', {label: 'Proyek baris ' + i, placeholder: 'Opsional'});
    const ket = teks('jm-ket-' + i, b.keterangan, {'aria-label': 'Keterangan baris ' + i, placeholder: 'Opsional'});
    const item = {akun, debit, kredit, proyek, ket};
    const tr = h('tr', null, h('td', null, akun), h('td', null, proyek), h('td', null, debit.el), h('td', null, kredit.el), h('td', null, ket),
      h('td', null, bisa && h('button', {class: 'btn btn-kecil', type: 'button', 'aria-label': 'Hapus baris ' + i, onclick: () => { baris.splice(baris.indexOf(item), 1); tr.remove(); hitungTotal(); }}, '✕')));
    baris.push(item); badan.append(tr);
  };
  (j?.baris?.length ? j.baris : [{}, {}]).forEach(tambah);
  const simpan = h('button', {class: 'btn btn-utama', type: 'submit'}, 'Simpan');
  let dlg;
  const form = h('form', {class: 'form', onsubmit: async (ev) => {
    ev.preventDefault();
    galat.textContent = '';
    if (!uraian.value.trim()) { galat.textContent = 'Uraian jurnal wajib diisi.'; uraian.focus(); return; }
    const isiBaris = baris.map((b) => ({akun_id: b.akun.querySelector('input[type=hidden]').value, debit: b.debit.nilai() || 0, kredit: b.kredit.nilai() || 0,
      proyek_kode: b.proyek.querySelector('input[type=hidden]').value || null, keterangan: b.ket.value.trim() || null})).filter((b) => b.akun_id || b.debit || b.kredit);
    if (isiBaris.some((b) => !b.akun_id)) { galat.textContent = 'Setiap baris yang diisi wajib memilih akun.'; return; }
    if (isiBaris.some((b) => (b.debit > 0) === (b.kredit > 0))) { galat.textContent = 'Setiap baris diisi debit ATAU kredit (salah satu).'; return; }
    const {d, k} = hitungTotal();
    if (isiBaris.length < 2 || d !== k || d === 0) { galat.textContent = 'Jurnal tidak seimbang: debit ' + rp(d) + ', kredit ' + rp(k) + '. Debit harus sama dengan kredit.'; return; }
    try {
      await sambilMenyimpan(simpan, async () => {
        const b = await bukti.ambil('jurnal/' + (j?.id || idBaru()));
        await store.keu.simpanJurnalManual(j?.id, {tanggal: tglEl.value, uraian: uraian.value.trim(), baris: isiBaris, bukti: b});
      });
      dlg.close(); await segarkanKeuangan(); pesan('Jurnal manual tersimpan.');
    } catch (e) { galat.textContent = e.message; }
  }},
    kunci && catatanKunci(j.tanggal),
    otomatis && h('div', {class: 'kotak-info'}, 'Jurnal otomatis dari ' + (SUMBER_JURNAL[j.sumber] || j.sumber) + '. Untuk mengubahnya, ubah transaksi sumbernya.'),
    h('div', {class: 'form-grid'}, medan('Tanggal', tglEl, {wajib: true}), medan('Uraian', uraian, {wajib: true})),
    h('div', {class: 'gulir'}, h('table', {class: 'tabel tabel-isian'},
      h('thead', null, h('tr', null, ['Akun', 'Proyek', 'Debit', 'Kredit', 'Keterangan', ''].map((x) => h('th', null, x)))), badan, total)),
    bisa && h('div', null, h('button', {class: 'btn btn-kecil', type: 'button', onclick: () => tambah()}, '+ Baris')),
    !otomatis && bukti.el, galat,
    kaki(j && bisa && tombolHapus(async () => { await store.keu.hapusJurnalManual(j.id); dlg.close(); await segarkanKeuangan(); pesan('Jurnal manual dihapus.'); }),
      h('span', {class: 'pegas'}), otomatis && h('button', {class: 'btn', type: 'button', onclick: () => { dlg.close(); bukaSumber(j.sumber, j.sumber_id); }}, 'Buka transaksi sumber'),
      h('button', {class: 'btn', type: 'button', onclick: () => dlg.close()}, bisa ? 'Batal' : 'Tutup'), bisa && simpan));
  if (!bisa) form.querySelectorAll('input,select,textarea').forEach((x) => { x.disabled = true; });
  dlg = dialog(j ? 'Jurnal J-' + String(j.no).padStart(5, '0') : 'Jurnal manual', form);
  dlg.classList.add('dialog-lebar');
  hitungTotal();
}

// ---------- Tutup buku ----------
function panelTutupBuku(panel) {
  const tutup = new Map(K().tutup_buku.map((t) => [t.bulan, t]));
  const ini = bulanIni();
  const pertama = [...K().jurnal.map((j) => bulanDari(j.tanggal)), ...K().tutup_buku.map((t) => t.bulan)].sort()[0];
  const bulan = [];
  if (pertama) {
    for (let b = pertama; b <= ini; ) {
      bulan.push(b);
      const [y, m] = b.split('-').map(Number);
      b = (m === 12 ? y + 1 : y) + '-' + String(m === 12 ? 1 : m + 1).padStart(2, '0') + '-01';
    }
  }
  const jumlahJurnal = (b) => K().jurnal.filter((j) => bulanDari(j.tanggal) === b).length;
  panel.append(
    h('p', null, 'Bulan yang sudah ditutup tidak bisa ditambah, diubah, atau dihapus transaksinya. Hanya super admin yang bisa membuka kembali, dengan alasan yang tercatat.'),
    !khusus('tutup_buku') && h('p', {class: 'kecil redup'}, 'Anda tidak punya hak menutup buku. Hak ini diatur super admin di Pengaturan → Pengguna & Peran.'),
    h('div', {class: 'gulir'}, h('table', {class: 'tabel'},
      h('thead', null, h('tr', null, ['Bulan', 'Jurnal', 'Status', 'Ditutup', ''].map((x, i) => h('th', {class: i === 1 ? 'kanan' : null}, x)))),
      h('tbody', null, bulan.length ? bulan.slice().reverse().map((b) => {
        const t = tutup.get(b);
        return h('tr', null, h('td', null, namaBulan(b)), h('td', {class: 'kanan'}, idn(jumlahJurnal(b))),
          h('td', null, t ? pill('Ditutup') : b === ini ? pill('Berjalan') : pill('Terbuka')),
          h('td', {class: 'kecil redup'}, t ? [t.ditutup_oleh_email || t.ditutup_oleh || '', ' ', t.ditutup_pada ? tgl(t.ditutup_pada.slice(0, 10)) : ''] : '—'),
          h('td', null, t ? (S.user.super_admin && h('button', {class: 'btn btn-kecil', type: 'button', onclick: () => bukaKembali(b)}, 'Buka kembali…'))
            : b < ini && khusus('tutup_buku') && h('button', {class: 'btn btn-kecil', type: 'button', onclick: aman(async (ev) => {
              const tb = ev.currentTarget;
              if (tb.dataset.yakin !== '1') { tb.dataset.yakin = '1'; tb.textContent = 'Klik lagi untuk menutup ' + namaBulan(b); return; }
              // Penyusutan aset bulan itu dibukukan dulu agar ikut terkunci.
              let susut = 0;
              if (K().aset_siap !== false && K().aset?.length && bisaUbah('aset')) susut = await store.keu.bukukanPenyusutan(b.slice(0, 8) + String(new Date(Date.UTC(+b.slice(0, 4), +b.slice(5, 7), 0)).getUTCDate()).padStart(2, '0'));
              await store.keu.tutupBulan(b); await segarkanKeuangan(); pesan('Buku ' + namaBulan(b) + ' ditutup.' + (susut ? ' Penyusutan aset dibukukan lebih dulu.' : ''));
            })}, 'Tutup buku')));
      }) : h('tr', null, h('td', {colspan: '5', class: 'redup'}, 'Belum ada jurnal.'))))),
    K().tutup_buku_riwayat.length > 0 && [h('h3', null, 'Riwayat tutup / buka buku'), h('div', {class: 'gulir'}, h('table', {class: 'tabel'},
      h('thead', null, h('tr', null, ['Waktu', 'Bulan', 'Aksi', 'Oleh', 'Alasan'].map((x) => h('th', null, x)))),
      h('tbody', null, K().tutup_buku_riwayat.slice().sort((a, b) => bandingkan(b.pada, a.pada)).map((r) => h('tr', null,
        h('td', null, new Date(r.pada).toLocaleString('id-ID')), h('td', null, namaBulan(r.bulan)), h('td', null, r.aksi === 'tutup' ? 'Ditutup' : 'Dibuka kembali'),
        h('td', null, isi(r.email)), h('td', {class: 'lebar'}, isi(r.alasan)))))))]);
}

function bukaKembali(b) {
  const galat = h('p', {class: 'form-galat', role: 'alert'});
  const alasan = h('textarea', {id: 'buka-alasan', rows: '3', required: true});
  const simpan = h('button', {class: 'btn btn-bahaya', type: 'submit'}, 'Buka kembali');
  let dlg;
  dlg = dialog('Buka kembali buku ' + namaBulan(b), h('form', {class: 'form', onsubmit: async (ev) => {
    ev.preventDefault();
    if (!alasan.value.trim()) { galat.textContent = 'Alasan wajib diisi.'; alasan.focus(); return; }
    try {
      await sambilMenyimpan(simpan, () => store.keu.bukaBulan(b, alasan.value.trim()));
      dlg.close(); await segarkanKeuangan(); pesan('Buku ' + namaBulan(b) + ' dibuka kembali. Jangan lupa menutupnya lagi setelah koreksi.');
    } catch (e) { galat.textContent = e.message; }
  }},
    h('p', null, 'Setelah dibuka, transaksi di bulan ini bisa diubah lagi. Alasan dan nama Anda dicatat di riwayat.'),
    medan('Alasan membuka kembali', alasan, {wajib: true, lebar: true}), galat,
    kaki(h('span', {class: 'pegas'}), h('button', {class: 'btn', type: 'button', onclick: () => dlg.close()}, 'Batal'), simpan)));
}


// Dipakai halaman Kontrak dan Termin & Piutang.
export {medan, teks, tanggal, pilihan, uang, centang, kaki, tombolHapus, catatanKunci, batasUnggah, opsiProyek, namaRekening};
