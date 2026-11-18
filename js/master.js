// Tahap 2 — halaman master Vendor & Tukang dan Supplier, serta bagian bersama (unggah file,
// multi-pilih, impor Excel dengan pratinjau) yang juga dipakai Barang & Harga (js/barang.js).
import {OPSI} from './schema.js';
import {S, segarkan} from './state.js';
import {store, BUCKET_MASTER, idBaru} from './store.js';
import {hariIni} from './calc.js';
import {bisaUbah} from './akses.js';
import {h, idn, isi, pill, pesan, aman, dialog, ukuranFile, kepalaUrut, bandingkan, unduh} from './ui.js';
import {kotakCek, cekSemua} from './cek.js';
import {muatExcelJS} from './excel.js';
import {JENIS_VENDOR, JENIS_VENDOR_TIM, BENTUK_PIHAK, TERMIN_SUPPLIER, validasiVendor, duplikatVendor, validasiSupplier, duplikatSupplier, teksTermin, mirip} from './master-util.js';
import {DEF, buatWorkbook, bacaWorkbook} from './master-excel.js';
import {evaluasiMaster, gabungAksi} from './master-impor.js';

// ---------- bagian bersama ----------
export const medan = (label, el, {wajib, bantuan, lebar, id} = {}) => h('div', {class: 'medan' + (lebar ? ' medan-lebar' : '')},
  h('label', {for: id || el.id || el.querySelector?.('input,select,textarea')?.id}, label, wajib && h('span', {class: 'wajib', title: 'Wajib diisi'}, ' *')), el,
  bantuan && h('span', {class: 'kecil redup'}, bantuan));
export const teks = (id, v, o = {}) => h('input', {id, type: 'text', value: v ?? '', autocomplete: 'off', ...o});
export const pilihan = (id, daftar, v, o = {}) => h('select', {id, ...o}, daftar.map((x) => (Array.isArray(x) ? x : [x, x])).map(([x, l]) => h('option', {value: x, selected: x === v}, l)));
export const centang = (id, v, label) => h('label', {class: 'centang', for: id}, h('input', {id, type: 'checkbox', checked: !!v}), ' ', label);
export const nilaiCentang = (el) => el.querySelector('input').checked;
export async function unduhWorkbook(wb, nama) {
  unduh(nama, new Blob([await wb.xlsx.writeBuffer()], {type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
}
export const batasUnggah = () => (+S.pengaturan?.data?.unggah_mb || 10) * 1048576;
export const namaPihak = (tabel, id) => S.db[tabel]?.find((x) => x.id === id)?.nama;

// Multi-pilih dengan kotak centang. Pilihan lama yang sudah tidak ada di daftar tetap ditampilkan.
export function multiPilih(id, daftar, nilai = [], label) {
  const semua = daftar.concat((nilai || []).filter((x) => !daftar.includes(x)));
  const wadah = h('div', {class: 'multi-pilih', id, role: 'group', 'aria-label': label},
    semua.map((x, i) => h('label', {class: 'centang'}, h('input', {type: 'checkbox', value: x, id: id + '-' + i, checked: (nilai || []).includes(x)}), ' ', daftar.includes(x) ? x : x + ' (lama)')));
  wadah.nilai = () => [...wadah.querySelectorAll('input:checked')].map((x) => x.value);
  return wadah;
}

// Berkas: PDF/JPG/PNG (atau JPG/PNG saja untuk foto). folder: 'vendor/<id>' atau 'barang/<id>'.
const TIPE = {dokumen: ['application/pdf', 'image/jpeg', 'image/png'], foto: ['image/jpeg', 'image/png']};
export async function bukaBerkas(b) { window.open(await store.urlBerkas(b.path, BUCKET_MASTER), '_blank', 'noopener'); }
export function daftarBerkas(id, lama = [], {jenis = 'dokumen', label = 'Dokumen', pilihJenis = null, satu = false} = {}) {
  const tipe = TIPE[jenis];
  const ada = (lama || []).map((b) => ({...b}));
  const baru = [];
  const daftar = h('ul', {class: 'daftar-berkas'});
  const ket = h('span', {class: 'kecil redup'}, (jenis === 'foto' ? 'JPG atau PNG' : 'PDF, JPG, atau PNG') + ', maksimal ' + ukuranFile(batasUnggah()) + ' per file.');
  const jenisEl = pilihJenis && pilihan(id + '-jenis', pilihJenis, pilihJenis[0], {'aria-label': 'Jenis dokumen'});
  const inp = h('input', {id, type: 'file', accept: tipe.map((t) => (t === 'application/pdf' ? '.pdf,' : '') + t).join(',')});
  const gambar = () => {
    daftar.replaceChildren(...[...ada.map((b) => [b, false]), ...baru.map((b) => [b, true])].map(([b, belum]) => h('li', null,
      b.jenis && h('span', {class: 'pill pill-netral'}, b.jenis), ' ',
      belum ? h('span', null, b.file.name + ' · ' + ukuranFile(b.file.size) + ' (belum diunggah)') : h('button', {class: 'tautan', type: 'button', onclick: aman(() => bukaBerkas(b))}, b.nama),
      ' ', h('button', {class: 'btn btn-kecil', type: 'button', 'aria-label': 'Lepas ' + (b.nama || b.file?.name), onclick: () => {
        if (belum) baru.splice(baru.indexOf(b), 1); else ada.splice(ada.indexOf(b), 1);
        gambar();
      }}, 'Lepas'))));
    inp.hidden = satu && ada.length + baru.length >= 1;
    if (jenisEl) jenisEl.hidden = inp.hidden;
  };
  inp.addEventListener('change', () => {
    const f = inp.files[0];
    ket.classList.remove('form-galat');
    if (!f) return;
    if (!tipe.includes(f.type)) { ket.textContent = 'Hanya ' + (jenis === 'foto' ? 'JPG atau PNG.' : 'PDF, JPG, atau PNG.'); ket.classList.add('form-galat'); inp.value = ''; return; }
    if (f.size > batasUnggah()) { ket.textContent = 'File terlalu besar (' + ukuranFile(f.size) + '). Maksimal ' + ukuranFile(batasUnggah()) + '.'; ket.classList.add('form-galat'); inp.value = ''; return; }
    baru.push({file: f, jenis: jenisEl?.value || null});
    inp.value = '';
    gambar();
  });
  gambar();
  const awal = new Set((lama || []).map((b) => b.path));
  return {
    el: h('div', {class: 'medan medan-lebar'}, h('label', {for: id}, label), daftar, h('div', {class: 'baris-tombol'}, jenisEl, inp), ket),
    // Mengunggah file baru; mengembalikan daftar akhir dan path yang dilepas (dihapus setelah simpan berhasil).
    async ambil(folder) {
      const hasil = ada.slice();
      for (const b of baru) {
        const path = folder + '/' + idBaru() + '-' + b.file.name.replace(/[^\w.-]+/g, '_');
        await store.unggah(path, b.file, BUCKET_MASTER);
        hasil.push({path, nama: b.file.name, ukuran: b.file.size, tipe: b.file.type, jenis: b.jenis || undefined, diunggah: hariIni()});
      }
      const tersisa = new Set(hasil.map((b) => b.path));
      return {daftar: hasil, dilepas: [...awal].filter((p) => !tersisa.has(p))};
    },
  };
}

// Tombol Hapus dua langkah.
export function tombolHapus(fn, teksTombol = 'Hapus') {
  let yakin = false;
  const b = h('button', {class: 'btn btn-bahaya', type: 'button', onclick: aman(async () => {
    if (!yakin) { yakin = true; b.textContent = 'Klik lagi untuk menghapus'; return; }
    await fn();
  })}, teksTombol);
  return b;
}

// Peringatan duplikat dengan tombol "Tetap simpan". temuan: [[label, daftar]].
export function kotakPeringatan(wadah, judul, temuan, lanjut, tampilkan = (x) => x.nama) {
  wadah.replaceChildren(h('b', null, judul), ...temuan.flatMap(([label, daftar]) => [h('p', {class: 'kecil'}, label + ':'), h('ul', {class: 'cocok'}, daftar.map((x) => h('li', null, tampilkan(x))))]),
    h('div', {class: 'baris-tombol'}, h('button', {class: 'btn btn-utama', type: 'button', onclick: lanjut}, 'Tetap simpan'), h('button', {class: 'btn', type: 'button', onclick: () => { wadah.hidden = true; }}, 'Batal')));
  wadah.hidden = false;
}

// Tombol Ekspor / Unduh Template / Impor Excel.
// cfg: {def: () => DEF, nama, baris: () => [...], daftar?: () => sheet bantu, bolehImpor, saatImpor(isiFile)}
export function tombolExcel(cfg) {
  const berkas = h('input', {type: 'file', accept: '.xlsx', hidden: true, 'aria-label': 'File Excel ' + cfg.nama, onchange: aman(async () => {
    const f = berkas.files[0];
    berkas.value = '';
    if (!f) return;
    pesan('Membaca ' + f.name + '…');
    cfg.saatImpor(await bacaWorkbook(await muatExcelJS(), cfg.def(), await f.arrayBuffer()));
  })});
  return [
    h('button', {class: 'btn', type: 'button', onclick: aman(async () => { await unduhWorkbook(buatWorkbook(await muatExcelJS(), cfg.def(), cfg.baris(), {daftar: cfg.daftar?.()}), cfg.nama.replace(/\s+/g, '-') + '-' + hariIni() + '.xlsx'); })}, 'Ekspor Excel'),
    h('button', {class: 'btn', type: 'button', onclick: aman(async () => { await unduhWorkbook(buatWorkbook(await muatExcelJS(), cfg.def(), [], {contoh: true, daftar: cfg.daftar?.()}), 'template-' + cfg.nama.replace(/\s+/g, '-') + '.xlsx'); })}, 'Unduh Template'),
    cfg.bolehImpor && h('button', {class: 'btn', type: 'button', onclick: () => berkas.click()}, 'Impor Excel'), cfg.bolehImpor && berkas,
  ].filter(Boolean);
}

// Pratinjau impor umum. cfg: {judul, satuan, hasil, kepala: [..], sel: (r) => [td..], def, simpan: async (dipilih) => jumlah}
export function bukaPratinjau(cfg) {
  const {hasil} = cfg;
  const error = hasil.filter((r) => r.status === 'error'), dup = hasil.filter((r) => r.status === 'duplikat'), siap = hasil.filter((r) => r.status === 'siap');
  const dipilih = () => siap.concat(dup.filter((r) => r.aksi !== 'lewati'));
  const galat = h('p', {class: 'form-galat', role: 'alert'});
  const tombol = h('button', {class: 'btn btn-utama', type: 'button'});
  let dlg, yakin = false;
  const segarTombol = () => { yakin = false; tombol.textContent = 'Simpan ' + dipilih().length + ' ' + cfg.satuan; tombol.disabled = !dipilih().length; };
  tombol.addEventListener('click', aman(async () => {
    if (!yakin) { yakin = true; tombol.textContent = 'Klik lagi untuk menyimpan ' + dipilih().length + ' ' + cfg.satuan; return; }
    galat.textContent = '';
    tombol.disabled = true; tombol.textContent = 'Menyimpan…';
    try {
      const n = await cfg.simpan(dipilih().sort((a, b) => a.no - b.no));
      dlg.close(); await segarkan(); pesan('Impor selesai: ' + n + ' ' + cfg.satuan + ' disimpan.');
    } catch (e) {
      galat.textContent = 'Penyimpanan berhenti: ' + e.message + ' Baris sebelum baris ini mungkin sudah tersimpan; muat ulang lalu impor lagi (yang sudah tersimpan akan terdeteksi sebagai duplikat).';
      segarTombol(); await segarkan();
    }
  }));
  const tabel = (judul, kepala, rows) => rows.length ? [h('h3', null, judul), h('div', {class: 'gulir gulir-pendek'}, h('table', {class: 'tabel'}, h('thead', null, h('tr', null, kepala.map((x) => h('th', null, x)))), h('tbody', null, rows)))] : null;
  const pilihAksi = (r) => (r.pilihan.length > 1
    ? h('select', {'aria-label': 'Tindakan untuk baris ' + r.no, onchange: (ev) => { r.aksi = ev.target.value; segarTombol(); }}, r.pilihan.map(([v, l]) => h('option', {value: v, selected: v === r.aksi}, l)))
    : 'Dilewati');
  segarTombol();
  dlg = dialog(cfg.judul, h('div', {class: 'form'},
    h('p', null, h('b', null, siap.length + ' baris siap, ' + error.length + ' baris error, ' + dup.length + ' baris duplikat.'), ' Belum ada yang disimpan.'),
    !hasil.length && h('p', {class: 'redup'}, 'File tidak berisi baris data (baris contoh diabaikan).'),
    tabel('Baris error (tidak ikut disimpan)', ['Baris', 'Masalah'], error.map((r) => h('tr', null, h('td', null, String(r.no)), h('td', null, r.galat.map((g) => h('div', null, g.kolom + ': ' + g.pesan)))))),
    error.length > 0 && h('div', null, h('button', {class: 'btn btn-kecil', type: 'button', onclick: aman(async () => {
      await unduhWorkbook(buatWorkbook(await muatExcelJS(), cfg.def(), error.map((r) => r.nilai), {galat: error.map((r) => r.galat.map((g) => g.kolom + ': ' + g.pesan).join('; '))}), cfg.satuan.replace(/\s+/g, '-') + '-baris-error.xlsx');
    })}, 'Unduh baris yang error'), h('span', {class: 'kecil redup'}, ' Perbaiki di file itu, lalu impor lagi.')),
    tabel('Baris duplikat', ['Baris', ...cfg.kepala, 'Duplikat karena', 'Tindakan'], dup.map((r) => h('tr', null, h('td', null, String(r.no)), ...cfg.sel(r), h('td', null, r.alasan), h('td', null, pilihAksi(r))))),
    tabel('Baris siap disimpan', ['Baris', ...cfg.kepala, 'Catatan'], siap.map((r) => h('tr', null, h('td', null, String(r.no)), ...cfg.sel(r), h('td', {class: 'kecil'}, r.peringatan ? '⚠ ' + r.peringatan : '')))),
    galat,
    h('div', {class: 'form-kaki'}, h('span', {class: 'pegas'}), h('button', {class: 'btn', type: 'button', onclick: () => dlg.close()}, 'Batal'), tombol)));
}

// Menyimpan hasil impor: data baru sekaligus, yang ditimpa / dilengkapi satu per satu.
export async function simpanImpor(tabel, dipilih, siapkan = (d) => d) {
  const baru = dipilih.filter((r) => r.aksi === 'baru').map((r) => ({tabel, data: siapkan(r.data, r)}));
  if (baru.length) await store.tambahBanyak(baru);
  for (const r of dipilih.filter((x) => x.aksi === 'timpa' || x.aksi === 'isi')) {
    const {id, ...lama} = r.cocok;
    await store.simpan(tabel, id, bersihkan(gabungAksi({...r, cocok: lama})));
  }
  return dipilih.length;
}
// Kolom hasil hitungan tidak ikut disimpan.
const bersihkan = (d) => Object.fromEntries(Object.entries(d).filter(([k, v]) => !k.startsWith('_') && v != null && v !== ''));

// Tabel daftar dengan urutan, pencarian, dan saringan. cfg: {kolom: [[k, judul, kanan?]], baris, sel(r) -> [td], klik(r), kosong}
function tabelDaftar(urut, kolom, rows, sel, klik, kosongTeks) {
  return h('table', {class: 'tabel'}, kepalaUrut(kolom, urut, () => S.render()),
    h('tbody', null, rows.length ? rows.map((r) => h('tr', {class: 'bisa-klik', tabindex: '0', onclick: () => klik(r), onkeydown: (ev) => { if (ev.key === 'Enter') klik(r); }}, sel(r)))
      : h('tr', null, h('td', {colspan: String(kolom.length), class: 'redup'}, kosongTeks))));
}
const urutkan = (rows, urut) => rows.sort((a, b) => bandingkan(a[urut.k], b[urut.k]) * urut.arah || bandingkan(a.nama, b.nama));
const saringTeks = (rows, q, ambil) => (q ? rows.filter((r) => ambil(r).some((v) => String(v ?? '').toLowerCase().includes(q))) : rows);

// ---------- Vendor & Tukang ----------
S.urutVendor = S.urutVendor || {k: 'nama', arah: 1};
S.saringVendor = S.saringVendor || {jenis: '', keahlian: '', status: 'Aktif'};
const refVendor = (id) => 'vendor:' + id;
export const proyekVendor = (id) => S.db.proyek.filter((p) => Array.isArray(p.tim) && p.tim.some((a) => a.ref === refVendor(id)));
const vendorDipakai = (id) => proyekVendor(id).length > 0 || S.db.harga.some((x) => x.pihak_id === id);

export function renderVendor(el) {
  const sv = S.saringVendor, bisa = bisaUbah('vendor');
  const semua = S.db.vendor_tukang.map((v) => ({...v, keahlian_teks: (v.keahlian || []).join(', '), status: v.aktif === false ? 'Nonaktif' : 'Aktif', jml_proyek: proyekVendor(v.id).length}));
  const saring = () => urutkan(saringTeks(semua.filter((v) => (!sv.jenis || v.jenis === sv.jenis) && (!sv.keahlian || (v.keahlian || []).includes(sv.keahlian)) && (!sv.status || v.status === sv.status)),
    S.cari.trim().toLowerCase(), (v) => [v.nama, v.pic, v.hp, v.nik, v.npwp, v.keahlian_teks, v.alamat]), S.urutVendor);
  const hitungan = h('span', {class: 'redup kecil'});
  const KOLOM = [['nama', 'Nama'], ['jenis', 'Jenis'], ['keahlian_teks', 'Keahlian'], ['hp', 'HP / WA'], ['status', 'Status'], ['jml_proyek', 'Proyek', true], [null, 'Total kontrak'], [null, 'Hutang berjalan']];
  const excel = tombolExcel({def: DEF.vendor, nama: 'vendor', bolehImpor: bisa, baris: () => saring().map(vendorKeBaris),
    saatImpor: (isiFile) => bukaPratinjau({judul: 'Pratinjau impor vendor', satuan: 'vendor', def: DEF.vendor,
      hasil: evaluasiMaster('vendor', isiFile, {ada: S.db.vendor_tukang, sdm: S.db.sdm}),
      kepala: ['Nama', 'Jenis', 'NIK', 'HP / WA'], sel: (r) => [h('td', null, r.data.nama), h('td', null, r.data.jenis), h('td', null, isi(r.data.nik)), h('td', null, isi(r.data.hp))],
      simpan: (dipilih) => simpanImpor('vendor_tukang', dipilih)})});
  el.append(
    h('div', {class: 'kepala'}, h('h1', null, 'Vendor & Tukang'),
      h('p', {class: 'redup'}, 'Pihak dengan perjanjian per proyek atau borongan (bukan pegawai SDM). Mandor, Tukang, dan Freelance yang aktif muncul di pilihan Tim Proyek.')),
    h('div', {class: 'alat'},
      h('input', {type: 'search', placeholder: 'Cari nama, HP, NIK…', 'aria-label': 'Cari vendor', value: S.cari, oninput: (ev) => { S.cari = ev.target.value; segarDaftar(); }}),
      pilihan('sv-jenis', [['', 'Semua jenis'], ...JENIS_VENDOR.map((x) => [x, x])], sv.jenis, {'aria-label': 'Saring jenis', onchange: (ev) => { sv.jenis = ev.target.value; S.render(); }}),
      pilihan('sv-keahlian', [['', 'Semua keahlian'], ...OPSI.keahlianVendor.map((x) => [x, x])], sv.keahlian, {'aria-label': 'Saring keahlian', onchange: (ev) => { sv.keahlian = ev.target.value; S.render(); }}),
      pilihan('sv-status', [['Aktif', 'Aktif'], ['Nonaktif', 'Nonaktif'], ['', 'Semua status']], sv.status, {'aria-label': 'Saring status', onchange: (ev) => { sv.status = ev.target.value; S.render(); }}),
      hitungan, h('span', {class: 'pegas'}),
      ...excel, bisa && h('button', {class: 'btn btn-utama', type: 'button', onclick: () => bukaFormVendor(null)}, '+ Tambah vendor')));
  if (!semua.length) {
    el.append(h('div', {class: 'kartu kosong-ajakan'}, h('h2', null, 'Belum ada vendor atau tukang'),
      h('p', null, 'Catat mandor, tukang, subkontraktor, dan freelance yang bekerja per proyek. Data ini dipakai di Tim Proyek dan nanti di kontrak vendor (Tahap 4).'),
      bisa && h('div', {class: 'baris-tombol tengah-isi'}, h('button', {class: 'btn btn-utama', type: 'button', onclick: () => bukaFormVendor(null)}, '+ Tambah vendor pertama'), h('span', {class: 'redup kecil'}, 'atau pakai Unduh Template lalu Impor Excel.'))));
    return;
  }
  const wadah = h('div', {class: 'gulir'});
  const segarDaftar = () => {
    const r = saring();
    hitungan.textContent = r.length + ' dari ' + semua.length + ' vendor';
    wadah.replaceChildren(tabelDaftar(S.urutVendor, KOLOM, r, (v) => [
      h('td', null, v.nama, v.afiliasi && [' ', h('span', {class: 'pill pill-waspada', title: 'Pihak afiliasi'}, 'Afiliasi')], v.bentuk === 'Badan usaha' && h('span', {class: 'kecil redup blok'}, 'Badan usaha')),
      h('td', null, v.jenis, JENIS_VENDOR_TIM.includes(v.jenis) && v.status === 'Aktif' && h('span', {class: 'kecil redup blok'}, 'Tim Proyek')),
      h('td', {class: 'kecil'}, isi(v.keahlian_teks)), h('td', {class: 'nw'}, v.hp ? h('a', {href: 'https://wa.me/' + v.hp, target: '_blank', rel: 'noopener', onclick: (ev) => ev.stopPropagation()}, v.hp) : '—'),
      h('td', null, pill(v.status)), h('td', {class: 'kanan'}, idn(v.jml_proyek)),
      h('td', {class: 'redup kecil', title: 'Terisi setelah kontrak vendor dibuat (Tahap 4)'}, '—'), h('td', {class: 'redup kecil', title: 'Terisi setelah kontrak vendor dibuat (Tahap 4)'}, '—'),
    ], (v) => bukaFormVendor(v.id), 'Tidak ada vendor yang cocok dengan pencarian atau saringan.'));
  };
  segarDaftar();
  el.append(wadah, h('p', {class: 'kecil redup'}, 'Klik baris untuk melihat atau mengubah. Total kontrak dan hutang berjalan terisi setelah modul kontrak vendor (Tahap 4).'));
}

const vendorKeBaris = (v) => ({nama: v.nama, jenis: v.jenis, bentuk: v.bentuk, keahlian: (v.keahlian || []).join(', '), pic: v.pic, hp: v.hp, email: v.email, alamat: v.alamat, nik: v.nik, npwp: v.npwp,
  bank: v.bank, no_rekening: v.no_rekening, atas_nama: v.atas_nama, afiliasi: v.afiliasi ? 'Ya' : 'Tidak', status: v.aktif === false ? 'Nonaktif' : 'Aktif', catatan: v.catatan});

export function bukaFormVendor(id) {
  const lama = id ? S.db.vendor_tukang.find((v) => v.id === id) : null;
  const bisa = bisaUbah('vendor');
  let dlg, lanjut = false;
  const galat = h('div', {class: 'kotak-galat', role: 'alert', hidden: true});
  const peringatan = h('div', {class: 'kotak-info', role: 'alert', hidden: true});
  const nama = teks('v-nama', lama?.nama, {required: true});
  const miripEl = h('div', {class: 'medan medan-lebar kotak-info', hidden: true});
  nama.addEventListener('input', () => {
    const m = mirip(nama.value, S.db.vendor_tukang, id);
    miripEl.hidden = !m.length;
    miripEl.replaceChildren(h('b', null, 'Sudah ada vendor dengan nama mirip:'), h('ul', {class: 'cocok'}, m.map((x) => h('li', null, x.nama + ' · ' + x.jenis + (x.hp ? ' · ' + x.hp : '')))));
  });
  const jenis = pilihan('v-jenis', [['', 'Pilih…'], ...JENIS_VENDOR.map((x) => [x, x])], lama?.jenis || '', {required: true});
  const ketJenis = h('span', {class: 'kecil redup'});
  const segarJenis = () => { ketJenis.textContent = JENIS_VENDOR_TIM.includes(jenis.value) ? 'Muncul di pilihan Tim Proyek (kelompok "Mandor, Tukang & Freelance") selama aktif.' : jenis.value ? 'Tidak muncul di pilihan Tim Proyek.' : ''; };
  jenis.addEventListener('change', segarJenis); segarJenis();
  const bentuk = pilihan('v-bentuk', BENTUK_PIHAK, lama?.bentuk || 'Perorangan');
  const keahlian = multiPilih('v-keahlian', OPSI.keahlianVendor, lama?.keahlian, 'Keahlian');
  const pic = teks('v-pic', lama?.pic), hp = teks('v-hp', lama?.hp), email = teks('v-email', lama?.email);
  const alamat = h('textarea', {id: 'v-alamat', rows: '2'}, lama?.alamat ?? '');
  const nik = teks('v-nik', lama?.nik), npwp = teks('v-npwp', lama?.npwp);
  const bank = teks('v-bank', lama?.bank), norek = teks('v-norek', lama?.no_rekening, {inputmode: 'numeric'}), atas = teks('v-atas', lama?.atas_nama);
  const afiliasi = centang('v-afiliasi', lama?.afiliasi, 'Pihak afiliasi (punya hubungan istimewa dengan perusahaan)');
  const aktif = centang('v-aktif', lama ? lama.aktif !== false : true, 'Aktif');
  const catatan = h('textarea', {id: 'v-catatan', rows: '2'}, lama?.catatan ?? '');
  const dokumen = daftarBerkas('v-dok', lama?.dokumen, {label: 'Dokumen (KTP, NPWP, perjanjian, dll.)', pilihJenis: ['KTP', 'NPWP', 'Perjanjian', 'Lainnya']});
  const simpan = h('button', {class: 'btn btn-utama', type: 'submit'}, 'Simpan');
  const jmlProyek = lama ? proyekVendor(lama.id).length : 0, dipakai = lama && vendorDipakai(lama.id);
  const kirim = async (ev) => {
    ev?.preventDefault();
    if (simpan.disabled) return;
    galat.hidden = true; peringatan.hidden = true;
    const {data, galat: g} = validasiVendor({nama: nama.value, jenis: jenis.value, bentuk: bentuk.value, keahlian: keahlian.nilai(), pic: pic.value, hp: hp.value, email: email.value, alamat: alamat.value,
      nik: nik.value, npwp: npwp.value, bank: bank.value, no_rekening: norek.value, atas_nama: atas.value, afiliasi: nilaiCentang(afiliasi), aktif: nilaiCentang(aktif), catatan: catatan.value});
    if (g.length) { galat.replaceChildren(h('b', null, 'Perbaiki dulu:'), h('ul', null, g.map((x) => h('li', null, x.kolom + ': ' + x.pesan)))); galat.hidden = false; cekSemua(form)?.focus(); return; }
    const d = duplikatVendor(data, S.db.vendor_tukang, S.db.sdm, id);
    const blok = [['NIK sama', d.nik], ['NPWP sama', d.npwp]].filter(([, x]) => x.length);
    if (blok.length) { galat.replaceChildren(h('b', null, 'Tidak bisa disimpan: nomor identitas sudah terdaftar pada vendor lain.'), ...blok.map(([l, x]) => h('div', null, l + ': ' + x.map((v) => v.nama).join(', ')))); galat.hidden = false; return; }
    const temuan = [['NIK sama dengan pegawai SDM', d.nikSdm], ['Nama mirip', d.nama], ['No. HP sama', d.hp]].filter(([, x]) => x.length);
    if (temuan.length && !lanjut) { kotakPeringatan(peringatan, 'Periksa dulu sebelum menyimpan:', temuan, () => { lanjut = true; kirim(); }); return; }
    simpan.disabled = true; simpan.textContent = 'Menyimpan…';
    try {
      const vid = id || idBaru();
      const berkas = await dokumen.ambil('vendor/' + vid);
      if (berkas.daftar.length) data.dokumen = berkas.daftar;
      await store.simpan('vendor_tukang', vid, data);
      if (berkas.dilepas.length) await store.hapusBerkas(berkas.dilepas, BUCKET_MASTER).catch(() => {});
      dlg.close(); await segarkan(); pesan('Vendor tersimpan.');
    } catch (e) {
      galat.replaceChildren(h('b', null, 'Gagal menyimpan: '), e.message); galat.hidden = false; lanjut = false;
      simpan.disabled = false; simpan.textContent = 'Simpan';
    }
  };
  [nama, nik, npwp, hp].forEach((x) => x.addEventListener('input', () => { lanjut = false; }));
  const form = h('form', {class: 'form', onsubmit: kirim},
    h('div', {class: 'form-grid'},
      medan('Nama', nama, {wajib: true, lebar: true}), miripEl,
      medan('Jenis', h('div', null, jenis, ketJenis), {wajib: true, id: 'v-jenis'}), medan('Perorangan / Badan usaha', bentuk),
      medan('Keahlian', keahlian, {lebar: true, bantuan: 'Boleh lebih dari satu. Daftar diatur di Pengaturan → Pilihan dropdown.'}),
      medan('PIC', pic), medan('No. HP / WA', kotakCek(hp, 'hp'), {id: 'v-hp'}), medan('Email', kotakCek(email, 'email'), {id: 'v-email'}), medan('Alamat', alamat),
      medan('NIK', kotakCek(nik, 'nik', 'Opsional. 16 digit sesuai KTP.'), {id: 'v-nik'}), medan('NPWP', kotakCek(npwp, 'npwp'), {id: 'v-npwp'}),
      medan('Bank', bank), medan('No. rekening', norek), medan('Rekening atas nama', atas),
      h('div', {class: 'medan medan-lebar'}, afiliasi, aktif),
      medan('Catatan', catatan, {lebar: true}), dokumen.el),
    lama && h('p', {class: 'kecil redup'}, 'Dihitung otomatis: ' + jmlProyek + ' proyek di Tim Proyek. Total kontrak dan hutang berjalan terisi setelah Tahap 4.'),
    galat, peringatan,
    h('div', {class: 'form-kaki'},
      lama && bisa && (dipakai ? h('span', {class: 'kecil redup'}, 'Sudah dipakai (Tim Proyek / riwayat harga); nonaktifkan saja.') : tombolHapus(async () => {
        await store.hapus(lama.id);
        const tim = S.db.tim.find((t) => t.vendor_id === lama.id);
        if (tim) await store.hapus(tim.id).catch(() => {});
        if (lama.dokumen?.length) await store.hapusBerkas(lama.dokumen.map((b) => b.path), BUCKET_MASTER).catch(() => {});
        dlg.close(); await segarkan(); pesan('Vendor dihapus.');
      })),
      h('span', {class: 'pegas'}), h('button', {class: 'btn', type: 'button', onclick: () => dlg.close()}, bisa ? 'Batal' : 'Tutup'), bisa && simpan));
  if (!bisa) form.querySelectorAll('input,select,textarea').forEach((x) => { x.disabled = true; });
  dlg = dialog(lama ? 'Vendor: ' + lama.nama : 'Tambah vendor / tukang', form);
}

// ---------- Supplier ----------
S.urutSupplier = S.urutSupplier || {k: 'nama', arah: 1};
S.saringSupplier = S.saringSupplier || {kategori: '', status: 'Aktif'};
const supplierDipakai = (id) => S.db.harga.some((x) => x.pihak_id === id);
const supplierKeBaris = (v) => ({nama: v.nama, kategori: (v.kategori || []).join(', '), pic: v.pic, hp: v.hp, email: v.email, alamat: v.alamat, npwp: v.npwp, pkp: v.pkp ? 'Ya' : 'Tidak',
  bank: v.bank, no_rekening: v.no_rekening, atas_nama: v.atas_nama, termin: v.termin || 'Tunai', tempo_hari: v.tempo_hari, afiliasi: v.afiliasi ? 'Ya' : 'Tidak', status: v.aktif === false ? 'Nonaktif' : 'Aktif', catatan: v.catatan});

export function renderSupplier(el) {
  const ss = S.saringSupplier, bisa = bisaUbah('supplier');
  const semua = S.db.supplier.map((v) => ({...v, kategori_teks: (v.kategori || []).join(', '), status: v.aktif === false ? 'Nonaktif' : 'Aktif', termin_teks: teksTermin(v), jml_harga: S.db.harga.filter((x) => x.pihak_id === v.id).length}));
  const saring = () => urutkan(saringTeks(semua.filter((v) => (!ss.kategori || (v.kategori || []).includes(ss.kategori)) && (!ss.status || v.status === ss.status)), S.cari.trim().toLowerCase(), (v) => [v.nama, v.pic, v.hp, v.npwp, v.kategori_teks, v.alamat]), S.urutSupplier);
  const KOLOM = [['nama', 'Nama'], ['kategori_teks', 'Kategori barang'], ['pic', 'PIC'], ['hp', 'HP / WA'], ['pkp', 'PKP'], ['termin_teks', 'Termin'], ['status', 'Status'], ['jml_harga', 'Harga tercatat', true]];
  const excel = tombolExcel({def: DEF.supplier, nama: 'supplier', bolehImpor: bisa, baris: () => saring().map(supplierKeBaris),
    saatImpor: (isiFile) => bukaPratinjau({judul: 'Pratinjau impor supplier', satuan: 'supplier', def: DEF.supplier,
      hasil: evaluasiMaster('supplier', isiFile, {ada: S.db.supplier}),
      kepala: ['Nama', 'NPWP', 'HP / WA', 'Termin'], sel: (r) => [h('td', null, r.data.nama), h('td', null, isi(r.data.npwp)), h('td', null, isi(r.data.hp)), h('td', null, teksTermin(r.data))],
      simpan: (dipilih) => simpanImpor('supplier', dipilih)})});
  el.append(
    h('div', {class: 'kepala'}, h('h1', null, 'Supplier'), h('p', {class: 'redup'}, 'Pemasok material. Dipakai di riwayat harga (Barang & Harga) dan nanti di Pembelian Material (Tahap 4).')),
    h('div', {class: 'alat'},
      h('input', {type: 'search', placeholder: 'Cari nama, HP, NPWP…', 'aria-label': 'Cari supplier', value: S.cari, oninput: (ev) => { S.cari = ev.target.value; segarDaftar(); }}),
      pilihan('ss-kat', [['', 'Semua kategori'], ...OPSI.kategoriBarang.map((x) => [x, x])], ss.kategori, {'aria-label': 'Saring kategori', onchange: (ev) => { ss.kategori = ev.target.value; S.render(); }}),
      pilihan('ss-status', [['Aktif', 'Aktif'], ['Nonaktif', 'Nonaktif'], ['', 'Semua status']], ss.status, {'aria-label': 'Saring status', onchange: (ev) => { ss.status = ev.target.value; S.render(); }}),
      h('span', {class: 'pegas'}), ...excel, bisa && h('button', {class: 'btn btn-utama', type: 'button', onclick: () => bukaFormSupplier(null)}, '+ Tambah supplier')));
  if (!semua.length) {
    el.append(h('div', {class: 'kartu kosong-ajakan'}, h('h2', null, 'Belum ada supplier'),
      h('p', null, 'Catat toko dan pemasok material beserta termin pembayarannya. Supplier dipilih saat mencatat harga barang.'),
      bisa && h('div', {class: 'baris-tombol tengah-isi'}, h('button', {class: 'btn btn-utama', type: 'button', onclick: () => bukaFormSupplier(null)}, '+ Tambah supplier pertama'), h('span', {class: 'redup kecil'}, 'atau pakai Unduh Template lalu Impor Excel.'))));
    return;
  }
  const wadah = h('div', {class: 'gulir'});
  const segarDaftar = () => wadah.replaceChildren(tabelDaftar(S.urutSupplier, KOLOM, saring(), (v) => [
    h('td', null, v.nama, v.afiliasi && [' ', h('span', {class: 'pill pill-waspada', title: 'Pihak afiliasi'}, 'Afiliasi')]), h('td', {class: 'kecil'}, isi(v.kategori_teks)), h('td', null, isi(v.pic)),
    h('td', {class: 'nw'}, v.hp ? h('a', {href: 'https://wa.me/' + v.hp, target: '_blank', rel: 'noopener', onclick: (ev) => ev.stopPropagation()}, v.hp) : '—'),
    h('td', null, v.pkp ? 'PKP' : '—'), h('td', null, v.termin_teks), h('td', null, pill(v.status)), h('td', {class: 'kanan'}, idn(v.jml_harga)),
  ], (v) => bukaFormSupplier(v.id), 'Tidak ada supplier yang cocok dengan pencarian atau saringan.'));
  segarDaftar();
  el.append(wadah);
}

export function bukaFormSupplier(id, {setelahSimpan} = {}) {
  const lama = id ? S.db.supplier.find((v) => v.id === id) : null;
  const bisa = bisaUbah('supplier');
  let dlg, lanjut = false;
  const galat = h('div', {class: 'kotak-galat', role: 'alert', hidden: true});
  const peringatan = h('div', {class: 'kotak-info', role: 'alert', hidden: true});
  const nama = teks('s-nama', lama?.nama, {required: true});
  const miripEl = h('div', {class: 'medan medan-lebar kotak-info', hidden: true});
  nama.addEventListener('input', () => {
    const m = mirip(nama.value, S.db.supplier, id);
    miripEl.hidden = !m.length;
    miripEl.replaceChildren(h('b', null, 'Sudah ada supplier dengan nama mirip:'), h('ul', {class: 'cocok'}, m.map((x) => h('li', null, x.nama + (x.hp ? ' · ' + x.hp : '')))));
  });
  const kategori = multiPilih('s-kategori', OPSI.kategoriBarang, lama?.kategori, 'Kategori barang');
  const pic = teks('s-pic', lama?.pic), hp = teks('s-hp', lama?.hp), email = teks('s-email', lama?.email);
  const alamat = h('textarea', {id: 's-alamat', rows: '2'}, lama?.alamat ?? '');
  const npwp = teks('s-npwp', lama?.npwp);
  const pkp = centang('s-pkp', lama?.pkp, 'Supplier berstatus PKP');
  const bank = teks('s-bank', lama?.bank), norek = teks('s-norek', lama?.no_rekening, {inputmode: 'numeric'}), atas = teks('s-atas', lama?.atas_nama);
  const termin = pilihan('s-termin', TERMIN_SUPPLIER, lama?.termin || 'Tunai');
  const tempo = h('input', {id: 's-tempo', type: 'number', min: '1', step: '1', value: lama?.tempo_hari ?? ''});
  const medanTempo = medan('Tempo (hari)', h('div', {class: 'berakhiran'}, tempo, h('span', null, 'hari')), {id: 's-tempo', wajib: true});
  const segarTermin = () => { medanTempo.hidden = termin.value !== 'Tempo'; };
  termin.addEventListener('change', segarTermin); segarTermin();
  const afiliasi = centang('s-afiliasi', lama?.afiliasi, 'Pihak afiliasi (punya hubungan istimewa dengan perusahaan)');
  const aktif = centang('s-aktif', lama ? lama.aktif !== false : true, 'Aktif');
  const catatan = h('textarea', {id: 's-catatan', rows: '2'}, lama?.catatan ?? '');
  const simpan = h('button', {class: 'btn btn-utama', type: 'submit'}, 'Simpan');
  const kirim = async (ev) => {
    ev?.preventDefault();
    if (simpan.disabled) return;
    galat.hidden = true; peringatan.hidden = true;
    const {data, galat: g} = validasiSupplier({nama: nama.value, kategori: kategori.nilai(), pic: pic.value, hp: hp.value, email: email.value, alamat: alamat.value, npwp: npwp.value, pkp: nilaiCentang(pkp),
      bank: bank.value, no_rekening: norek.value, atas_nama: atas.value, termin: termin.value, tempo_hari: tempo.value, afiliasi: nilaiCentang(afiliasi), aktif: nilaiCentang(aktif), catatan: catatan.value});
    if (g.length) { galat.replaceChildren(h('b', null, 'Perbaiki dulu:'), h('ul', null, g.map((x) => h('li', null, x.kolom + ': ' + x.pesan)))); galat.hidden = false; cekSemua(form)?.focus(); return; }
    const d = duplikatSupplier(data, S.db.supplier, id);
    if (d.npwp.length) { galat.replaceChildren(h('b', null, 'Tidak bisa disimpan: NPWP ini sudah terdaftar pada supplier "' + d.npwp[0].nama + '".')); galat.hidden = false; return; }
    const temuan = [['Nama mirip', d.nama], ['No. HP sama', d.hp]].filter(([, x]) => x.length);
    if (temuan.length && !lanjut) { kotakPeringatan(peringatan, 'Supplier ini mungkin sudah ada:', temuan, () => { lanjut = true; kirim(); }); return; }
    simpan.disabled = true; simpan.textContent = 'Menyimpan…';
    try {
      const rec = await store.simpan('supplier', id, data);
      dlg.close(); await segarkan(); pesan('Supplier tersimpan.');
      setelahSimpan?.(rec);
    } catch (e) {
      galat.replaceChildren(h('b', null, 'Gagal menyimpan: '), e.message); galat.hidden = false; lanjut = false;
      simpan.disabled = false; simpan.textContent = 'Simpan';
    }
  };
  [nama, npwp, hp].forEach((x) => x.addEventListener('input', () => { lanjut = false; }));
  const form = h('form', {class: 'form', onsubmit: kirim},
    h('div', {class: 'form-grid'},
      medan('Nama', nama, {wajib: true, lebar: true}), miripEl,
      medan('Kategori barang', kategori, {lebar: true, bantuan: 'Boleh lebih dari satu.'}),
      medan('PIC', pic), medan('No. HP / WA', kotakCek(hp, 'hp'), {id: 's-hp'}), medan('Email', kotakCek(email, 'email'), {id: 's-email'}), medan('Alamat', alamat),
      medan('NPWP', kotakCek(npwp, 'npwp'), {id: 's-npwp'}), h('div', {class: 'medan'}, h('span', {class: 'label-kosong', 'aria-hidden': 'true'}, ' '), pkp),
      medan('Bank', bank), medan('No. rekening', norek), medan('Rekening atas nama', atas),
      medan('Termin pembayaran bawaan', termin), medanTempo,
      h('div', {class: 'medan medan-lebar'}, afiliasi, aktif),
      medan('Catatan', catatan, {lebar: true})),
    galat, peringatan,
    h('div', {class: 'form-kaki'},
      lama && bisa && (supplierDipakai(lama.id) ? h('span', {class: 'kecil redup'}, 'Sudah dipakai di riwayat harga; nonaktifkan saja.') : tombolHapus(async () => { await store.hapus(lama.id); dlg.close(); await segarkan(); pesan('Supplier dihapus.'); })),
      h('span', {class: 'pegas'}), h('button', {class: 'btn', type: 'button', onclick: () => dlg.close()}, bisa ? 'Batal' : 'Tutup'), bisa && simpan));
  if (!bisa) form.querySelectorAll('input,select,textarea').forEach((x) => { x.disabled = true; });
  dlg = dialog(lama ? 'Supplier: ' + lama.nama : 'Tambah supplier', form);
}
