// Kerangka notifikasi: daftar pengingat dihitung dari data setiap kali aplikasi dibuka (dan diperiksa ulang
// berkala selama aplikasi terbuka). Status dibaca / ditunda disimpan per pengguna.
// Jenis dan batas H-X diatur di Pengaturan → Notifikasi.
import {S} from './state.js';
import {store} from './store.js';
import {hariIni} from './calc.js';
import {hak, modulAktif} from './akses.js';
import {kontrakDari, STATUS, tambahHari, selisihHari} from './sdm-util.js';
import {h, tgl, aman, pesan} from './ui.js';

// hari: berapa hari sebelum tanggal jatuh tempo pengingat mulai muncul.
// sdm: kunci parameter SDM lama yang ikut disamakan (dipakai juga oleh peringatan di tabel SDM).
export const JENIS_NOTIF = {
  kontrak_pkwt: {label: 'Kontrak kerja PKWT akan habis', hari: 60, menu: 'sdm', sdm: 'hari_kontrak'},
  skk: {label: 'SKK / STRA pegawai akan habis', hari: 90, menu: 'sdm', modul: 'skk', sdm: 'hari_skk'},
  magang: {label: 'Periode magang akan berakhir', hari: 30, menu: 'sdm', sdm: 'hari_magang'},
  legal: {label: 'Dokumen legal / izin akan habis', hari: 60, menu: 'legal', modul: 'legal'},
  aset: {label: 'Lisensi / pajak aset akan habis', hari: 30, menu: 'aset', modul: 'aset'},
  hutang_lain: {label: 'Jatuh tempo hutang lain', hari: 14, menu: 'hutang_lain', modul: 'hutang_lain'},
  termin: {label: 'Jatuh tempo tagihan klien', hari: 7, menu: 'termin'},
};

// Pengaturan notifikasi efektif: {jenis: {aktif, hari}}. Untuk jenis SDM, batas hari diambil dari parameter SDM.
export function aturNotif(data = S.pengaturan?.data) {
  const hasil = {};
  for (const [k, j] of Object.entries(JENIS_NOTIF)) {
    const atur = data?.notifikasi?.[k] || {};
    const hariSdm = j.sdm && data?.sdm?.[j.sdm];
    const hari = Number.isFinite(+atur.hari) && atur.hari !== '' && atur.hari != null ? +atur.hari : hariSdm != null && hariSdm !== '' ? +hariSdm : j.hari;
    hasil[k] = {aktif: atur.aktif !== false, hari};
  }
  return hasil;
}

// Semua pengingat yang berlaku hari ini untuk pengguna yang sedang masuk.
export function hitungNotifikasi(today = hariIni()) {
  const atur = aturNotif(), d = S.d, hasil = [];
  const boleh = (k) => atur[k].aktif && hak(JENIS_NOTIF[k].menu) != null && (!JENIS_NOTIF[k].modul || modulAktif(JENIS_NOTIF[k].modul));
  const tambah = (jenis, id, tanggal, judul, ke) => {
    if (!tanggal || tanggal > tambahHari(today, atur[jenis].hari)) return;
    hasil.push({kunci: jenis + ':' + id + ':' + tanggal, jenis, tanggal, judul, ke, sisa: selisihHari(tanggal, today)});
  };
  if (d) {
    for (const s of d.sdm || []) {
      if (s.aktif === 'Keluar') continue;
      const akhir = kontrakDari(s).at(-1)?.berakhir;
      if (boleh('kontrak_pkwt') && (s.status === STATUS.pkwt || (!s.status && akhir))) tambah('kontrak_pkwt', s.id, akhir, 'Kontrak ' + s.nama + ' berakhir', '#sdm-' + s.id);
      if (boleh('skk') && s.perlu_skk) tambah('skk', s.id, s.skk_berlaku, 'SKK/STRA ' + s.nama + ' habis', '#sdm-' + s.id);
      if (boleh('magang') && s.status === STATUS.magang) tambah('magang', s.id, s.magang_selesai, 'Magang ' + s.nama + ' berakhir', '#sdm-' + s.id);
    }
    if (boleh('legal')) for (const x of d.legal || []) tambah('legal', x.id, x.berlaku_sd, x.dokumen + ' habis berlaku', '#t-legal');
    if (boleh('aset')) for (const x of d.aset || []) tambah('aset', x.id, x.lisensi_sd, 'Lisensi / pajak ' + x.nama + ' habis', '#t-aset');
    if (boleh('hutang_lain')) for (const x of d.hutang_lain || []) if (x.sisa > 0) tambah('hutang_lain', x.id, x.jatuh_tempo, 'Hutang ' + x.kreditur + ' jatuh tempo', '#t-hutang_lain');
    if (boleh('termin')) for (const x of d.termin || []) if (x.tgl_invoice && x.sisa > 0) tambah('termin', x.id, x.jatuh_tempo, 'Tagihan ' + (x.no_invoice || 'termin ' + x.termin_ke) + ' · ' + (x.nama_proyek || x.kode) + ' jatuh tempo', '#t-termin');
  }
  return hasil.sort((a, b) => a.tanggal.localeCompare(b.tanggal));
}

// ---------- status dibaca / ditunda ----------
let status = new Map();
export async function muatStatusNotifikasi() {
  try { status = new Map((await store.keu.statusNotifikasi()).map((x) => [x.kunci, x])); } catch { status = new Map(); }
}
const tampil = (n, today) => !(status.get(n.kunci)?.tunda_sampai > today);
const belumDibaca = (n) => !status.get(n.kunci)?.dibaca;
async function atur(daftar) {
  await store.keu.aturStatusNotifikasi(daftar);
  for (const x of daftar) status.set(x.kunci, {...status.get(x.kunci), ...x});
}
export const jumlahBelumDibaca = (today = hariIni()) => hitungNotifikasi(today).filter((n) => tampil(n, today) && belumDibaca(n)).length;

// ---------- lonceng dan panel ----------
let panelBuka = false, lihatSemua = false;
export function lonceng() {
  const today = hariIni();
  const jml = jumlahBelumDibaca(today);
  const wadah = h('div', {class: 'lonceng'});
  const tombol = h('button', {class: 'btn btn-halus tombol-lonceng', type: 'button', 'aria-label': 'Notifikasi' + (jml ? ', ' + jml + ' belum dibaca' : ''), 'aria-expanded': String(panelBuka),
    onclick: () => { panelBuka = !panelBuka; gambarUlang(); }}, '🔔', jml > 0 && h('span', {class: 'lencana'}, jml > 99 ? '99+' : String(jml)));
  wadah.append(tombol);
  const gambarUlang = () => { wadah.replaceWith(lonceng()); };
  if (panelBuka) wadah.append(panelNotifikasi(today, gambarUlang));
  return wadah;
}
document.addEventListener('click', (ev) => {
  if (panelBuka && !ev.target.closest?.('.lonceng')) { panelBuka = false; document.querySelector('.lonceng')?.replaceWith(lonceng()); }
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && panelBuka) { panelBuka = false; document.querySelector('.lonceng')?.replaceWith(lonceng()); }
});

function panelNotifikasi(today, gambarUlang) {
  const semua = hitungNotifikasi(today).filter((n) => tampil(n, today));
  const daftar = lihatSemua ? semua : semua.filter(belumDibaca);
  const grup = [['Terlambat', daftar.filter((n) => n.tanggal < today)], ['Hari ini', daftar.filter((n) => n.tanggal === today)], ['Akan datang', daftar.filter((n) => n.tanggal > today)]];
  const tandai = (n) => aman(async (ev) => { ev.stopPropagation(); await atur([{kunci: n.kunci, dibaca: new Date().toISOString()}]); gambarUlang(); S.render(); });
  const tunda = (n, hari) => aman(async (ev) => { ev.stopPropagation(); await atur([{kunci: n.kunci, tunda_sampai: tambahHari(today, hari)}]); pesan('Ditunda sampai ' + tgl(tambahHari(today, hari)) + '.'); gambarUlang(); S.render(); });
  const sisaTeks = (n) => (n.sisa < 0 ? 'lewat ' + -n.sisa + ' hari' : n.sisa === 0 ? 'hari ini' : n.sisa + ' hari lagi');
  return h('div', {class: 'panel-notif', role: 'dialog', 'aria-label': 'Notifikasi'},
    h('div', {class: 'panel-notif-kepala'}, h('b', null, 'Notifikasi'), h('span', {class: 'pegas'}),
      h('label', {class: 'kecil redup centang'}, h('input', {type: 'checkbox', checked: lihatSemua, onchange: (ev) => { lihatSemua = ev.target.checked; gambarUlang(); }}), ' Tampilkan yang sudah dibaca'),
      semua.some(belumDibaca) && h('button', {class: 'btn btn-kecil', type: 'button', onclick: aman(async (ev) => {
        ev.stopPropagation();
        const waktu = new Date().toISOString();
        await atur(semua.filter(belumDibaca).map((n) => ({kunci: n.kunci, dibaca: waktu})));
        gambarUlang(); S.render();
      })}, 'Tandai semua dibaca')),
    daftar.length ? grup.filter(([, x]) => x.length).map(([judul, x]) => h('div', {class: 'notif-grup'},
      h('div', {class: 'notif-grup-judul' + (judul === 'Terlambat' ? ' buruk' : '')}, judul + ' (' + x.length + ')'),
      x.map((n) => h('div', {class: 'notif-item' + (belumDibaca(n) ? ' baru' : '')},
        h('a', {href: n.ke, class: 'notif-isi', onclick: () => { panelBuka = false; }}, h('span', null, n.judul), h('span', {class: 'kecil redup'}, tgl(n.tanggal) + ' · ' + sisaTeks(n) + ' · ' + JENIS_NOTIF[n.jenis].label)),
        h('div', {class: 'notif-aksi'},
          belumDibaca(n) && h('button', {class: 'btn btn-kecil', type: 'button', title: 'Tandai dibaca', onclick: tandai(n)}, '✓ Dibaca'),
          h('select', {class: 'pilih-kecil', 'aria-label': 'Tunda', onclick: (ev) => ev.stopPropagation(), onchange: (ev) => { const v = +ev.target.value; if (v) tunda(n, v)(ev); }},
            h('option', {value: ''}, 'Tunda…'), [1, 3, 7].map((d) => h('option', {value: String(d)}, d + ' hari'))))))))
      : h('p', {class: 'redup kecil notif-kosong'}, semua.length ? 'Semua notifikasi sudah dibaca.' : 'Tidak ada notifikasi.'),
    h('div', {class: 'panel-notif-kaki'}, h('a', {href: '#pengaturan-notifikasi', class: 'kecil', onclick: () => { panelBuka = false; }}, 'Atur notifikasi')));
}

// Pemeriksaan berkala selama aplikasi terbuka: bila tanggal berganti, notifikasi dihitung ulang.
let tanggalTerakhir = null;
export function mulaiPemeriksaanHarian() {
  tanggalTerakhir = hariIni();
  setInterval(() => {
    if (hariIni() !== tanggalTerakhir && S.user?.aktif) { tanggalTerakhir = hariIni(); S.render(); }
  }, 10 * 60 * 1000);
}
