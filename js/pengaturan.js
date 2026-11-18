// Halaman Pengaturan, dibagi per bagian (#pengaturan-<bagian>).
import {OPSI_BISA_DIATUR, opsiBawaan, opsiSekarang, NAMA_TABEL} from './schema.js';
import {hariIni, ZONA_WAKTU, zonaAktif} from './calc.js';
import {store} from './store.js';
import {S, muatData, bersih, segarkanKeuangan} from './state.js';
import {h, idn, rp, tgl, isi, pill, pesan, aman, dialog, formatUang, bacaUang, unduh, sambilMenyimpan, pilihCari} from './ui.js';
import {aturSdm, PARAM_BAWAAN} from './sdm-util.js';
import {MENU_HAK, KHUSUS, MODUL, hak, bisaUbah, modulAktif, bolehAkses, namaPeran} from './akses.js';
import {JENIS_NOTIF, aturNotif} from './notifikasi.js';
import {tabelRekening, bukaFormRekening, kartuBelumSiap} from './keuangan.js';
import {GOLONGAN, saldoNormal, ISI_PEMETAAN, akunKode, urutKode, NAMA_BULAN_PANJANG} from './keuangan-data.js';
import {eksporExcel} from './excel.js';

export const NAMA_APLIKASI_BAWAAN = 'Alinea 5';
export const WARNA_BAWAAN = '#1d6b57';
export const BENTUK_BADAN = ['PT', 'PT Perorangan', 'CV', 'Firma', 'Koperasi', 'Yayasan', 'Usaha perorangan', 'Lainnya'];

const BAGIAN = [
  ['profil', 'Profil perusahaan', () => hak('pengaturan') != null],
  ['modul', 'Modul aktif', () => hak('pengaturan') != null],
  ['pengguna', 'Pengguna & peran', () => S.user.super_admin],
  ['kas', 'Kas & Bank', () => hak('pengaturan') != null || hak('kas') != null],
  ['akun', 'Bagan akun', () => hak('pengaturan') != null || hak('jurnal') != null],
  ['pemetaan', 'Pemetaan jurnal', () => hak('pengaturan') != null || hak('jurnal') != null],
  ['akuntansi', 'Akuntansi', () => hak('pengaturan') != null],
  ['notifikasi', 'Notifikasi', () => hak('pengaturan') != null],
  ['umum', 'Umum', () => hak('pengaturan') != null],
  ['sdm', 'SDM', () => hak('pengaturan') != null],
  ['barang', 'Barang & Harga', () => hak('pengaturan') != null],
  ['dropdown', 'Pilihan dropdown', () => hak('pengaturan') != null],
  ['cadangan', 'Cadangan', () => hak('pengaturan') != null],
  ['audit', 'Audit log', () => S.user.super_admin || hak('jurnal') != null],
];
const ubahPengaturan = () => bisaUbah('pengaturan');

export function renderPengaturan(el, bagian) {
  const boleh = BAGIAN.filter(([, , f]) => f());
  const aktif = boleh.find(([k]) => k === bagian)?.[0] || boleh[0]?.[0];
  el.append(h('div', {class: 'kepala'}, h('h1', null, 'Pengaturan'), h('p', {class: 'redup'}, store.mode === 'lokal'
    ? 'Penyimpanan: browser ini saja (mode demo).'
    : 'Penyimpanan: Supabase. Anda masuk sebagai ' + S.user.email + ' (' + namaPeran() + ').' + (ubahPengaturan() ? '' : ' Anda hanya bisa melihat pengaturan.'))));
  el.append(h('div', {class: 'tabs', role: 'tablist'}, boleh.map(([k, label]) => h('a', {class: 'tab', href: '#pengaturan-' + k, role: 'tab', 'aria-selected': String(k === aktif)}, label))));
  const isiBagian = {profil: bagianProfil, modul: bagianModul, pengguna: bagianPengguna, kas: bagianKas, akun: bagianAkun, pemetaan: bagianPemetaan,
    akuntansi: bagianAkuntansi, notifikasi: bagianNotifikasi, umum: bagianUmum, sdm: () => [bagianJabatan(), bagianParamSdm()], barang: bagianBarang, dropdown: bagianDropdown,
    cadangan: bagianCadangan, audit: bagianAudit}[aktif];
  if (isiBagian) el.append(...[].concat(isiBagian()).filter(Boolean));
  if (!ubahPengaturan()) el.querySelectorAll('.kartu.atur input, .kartu.atur select, .kartu.atur textarea, .kartu.atur button.btn-utama').forEach((x) => { x.disabled = true; });
}

// Menyimpan satu bagian pengaturan tanpa menyentuh bagian lain.
export async function simpanPengaturan(bagian, isiBaru) {
  try {
    await store.simpan('pengaturan', S.pengaturan?.id, {...S.pengaturan?.data, [bagian]: isiBaru});
  } catch (e) {
    throw new Error('Pengaturan belum bisa disimpan ke database. (' + e.message + ')');
  }
  await muatData(); S.render();
}

const medan = (label, el, {wajib, bantuan, lebar, id} = {}) => h('div', {class: 'medan' + (lebar ? ' medan-lebar' : '')},
  h('label', {for: id || el.id}, label, wajib && h('span', {class: 'wajib', title: 'Wajib diisi'}, ' *')), el, bantuan && h('span', {class: 'kecil redup'}, bantuan));
const kartu = (judul, ...isiKartu) => h('section', {class: 'kartu atur'}, h('h2', null, judul), ...isiKartu);

// ---------- profil perusahaan dan identitas aplikasi ----------
async function kecilkanLogo(file) {
  if (file.type === 'image/svg+xml') {
    if (file.size > 150 * 1024) throw new Error('File SVG terlalu besar (maksimal 150 KB).');
    return await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(file); });
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, gagal) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => gagal(new Error('Gambar tidak bisa dibaca.')); i.src = url; });
    const skala = Math.min(1, 256 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * skala); c.height = Math.round(img.height * skala);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  } finally { URL.revokeObjectURL(url); }
}

function bagianProfil() {
  const p = S.profil || {};
  if (!S.keu.siap) { const d = h('div'); kartuBelumSiap(d); return d.firstChild; }
  const galat = h('p', {class: 'form-galat', role: 'alert'});
  const t = (id, v, o = {}) => h('input', {id, type: 'text', value: v ?? '', autocomplete: 'off', ...o});
  const badan = t('pp-badan', p.badan_hukum, {required: true, placeholder: 'mis. PT Alinea Lima Studio'});
  const bentuk = h('select', {id: 'pp-bentuk'}, h('option', {value: ''}, '—'), BENTUK_BADAN.map((b) => h('option', {value: b, selected: b === p.bentuk}, b)));
  const nib = t('pp-nib', p.nib, {inputmode: 'numeric'}), npwp = t('pp-npwp', p.npwp, {inputmode: 'numeric', placeholder: '16 digit'});
  const alamat = h('textarea', {id: 'pp-alamat', rows: '2'}, p.alamat ?? '');
  const telp = t('pp-telp', p.telepon, {inputmode: 'tel'}), email = t('pp-email', p.email, {type: 'email'});
  const pkp = h('select', {id: 'pp-pkp'}, [['Tidak', 'Tidak'], ['Ya', 'Ya']].map(([v, l]) => h('option', {value: v, selected: (p.pkp ? 'Ya' : 'Tidak') === v}, l)));
  const tglPkp = h('input', {id: 'pp-tglpkp', type: 'date', value: p.tgl_pkp ?? ''});
  const ttdNama = t('pp-ttd-nama', p.penandatangan_nama), ttdJabatan = t('pp-ttd-jabatan', p.penandatangan_jabatan, {placeholder: 'mis. Direktur'});
  const namaApp = t('pp-app', p.nama_aplikasi || NAMA_APLIKASI_BAWAAN, {required: true});
  const warna = h('input', {id: 'pp-warna', type: 'color', value: p.warna || WARNA_BAWAAN});
  let logo = p.logo || null;
  const gambarLogo = h('div', {class: 'logo-pratinjau'});
  const pratinjau = h('div', {class: 'atas atas-pratinjau'});
  const segar = () => {
    gambarLogo.replaceChildren(logo ? h('img', {src: logo, alt: 'Logo'}) : h('span', {class: 'kecil redup'}, 'Memakai logo bawaan Alinea.'));
    pratinjau.style.setProperty('--aksen', warna.value);
    pratinjau.replaceChildren(h('span', {class: 'merek'}, h('img', {class: 'logo', src: logo || 'assets/logo.svg', alt: ''}), namaApp.value.trim() || NAMA_APLIKASI_BAWAAN,
      h('span', null, '· ' + (badan.value.trim() || 'Nama badan hukum'))), h('span', {class: 'pegas'}), h('span', {class: 'btn btn-utama btn-kecil'}, 'Contoh tombol'));
    tglPkp.closest('.medan').hidden = pkp.value !== 'Ya';
  };
  [namaApp, badan, warna].forEach((x) => x.addEventListener('input', segar));
  pkp.addEventListener('change', segar);
  const fileLogo = h('input', {id: 'pp-logo', type: 'file', accept: 'image/png,image/jpeg,image/svg+xml', onchange: aman(async () => {
    const f = fileLogo.files[0];
    if (!f) return;
    if (!['image/png', 'image/jpeg', 'image/svg+xml'].includes(f.type)) throw new Error('Logo harus PNG, JPG, atau SVG.');
    logo = await kecilkanLogo(f); segar();
  })});
  const simpan = h('button', {class: 'btn btn-utama', type: 'submit'}, 'Simpan profil');
  const form = h('form', {class: 'form', onsubmit: async (ev) => {
    ev.preventDefault();
    galat.textContent = '';
    const digitNpwp = npwp.value.replace(/\D/g, '');
    if (!badan.value.trim()) { galat.textContent = 'Nama badan hukum wajib diisi.'; badan.focus(); return; }
    if (npwp.value.trim() && digitNpwp.length !== 16) { galat.textContent = 'NPWP harus 16 digit (sekarang ' + digitNpwp.length + ' digit).'; npwp.focus(); return; }
    if (email.value.trim() && !email.checkValidity()) { galat.textContent = 'Format email tidak sah.'; email.focus(); return; }
    if (pkp.value === 'Ya' && !tglPkp.value) { galat.textContent = 'Tanggal dikukuhkan PKP wajib diisi bila status PKP Ya.'; tglPkp.focus(); return; }
    if (!namaApp.value.trim()) { galat.textContent = 'Nama aplikasi wajib diisi.'; namaApp.focus(); return; }
    const data = bersih({
      badan_hukum: badan.value.trim(), bentuk: bentuk.value, nib: nib.value.trim(), npwp: digitNpwp || null, alamat: alamat.value.trim(), telepon: telp.value.trim(), email: email.value.trim(),
      pkp: pkp.value === 'Ya', tgl_pkp: pkp.value === 'Ya' ? tglPkp.value : null, penandatangan_nama: ttdNama.value.trim(), penandatangan_jabatan: ttdJabatan.value.trim(),
      nama_aplikasi: namaApp.value.trim(), logo, warna: warna.value,
    });
    data.pkp = pkp.value === 'Ya';
    try {
      await sambilMenyimpan(simpan, () => store.keu.simpanProfil(data));
      await segarkanKeuangan(); pesan('Profil perusahaan tersimpan.');
    } catch (e) { galat.textContent = e.message; }
  }},
    h('h3', null, 'Data badan hukum'),
    h('div', {class: 'form-grid'},
      medan('Nama badan hukum', badan, {wajib: true}), medan('Bentuk badan hukum', bentuk), medan('NIB', nib), medan('NPWP', npwp, {bantuan: '16 digit, disimpan sebagai teks.'}),
      medan('Alamat', alamat, {lebar: true}), medan('Telepon', telp), medan('Email', email),
      medan('Status PKP', pkp), medan('Tanggal dikukuhkan PKP', tglPkp, {wajib: true}),
      medan('Nama penandatangan', ttdNama), medan('Jabatan penandatangan', ttdJabatan)),
    h('h3', null, 'Identitas aplikasi'),
    h('div', {class: 'form-grid'},
      medan('Nama aplikasi', namaApp, {wajib: true}), medan('Warna aksen', warna),
      h('div', {class: 'medan medan-lebar'}, h('label', {for: 'pp-logo'}, 'Logo'), gambarLogo, fileLogo,
        h('div', {class: 'baris-tombol'}, h('button', {class: 'btn btn-kecil', type: 'button', onclick: () => { logo = null; fileLogo.value = ''; segar(); }}, 'Pakai logo bawaan')),
        h('span', {class: 'kecil redup'}, 'PNG, JPG, atau SVG. Gambar diperkecil otomatis.'))),
    h('p', {class: 'kecil redup'}, 'Pratinjau kepala aplikasi:'), pratinjau,
    h('p', {class: 'kecil redup'}, 'Nama badan hukum, alamat, NPWP, dan penandatangan dipakai di dokumen cetak (invoice, SPK) pada tahap berikutnya.'),
    galat, h('div', {class: 'baris-tombol'}, simpan));
  segar();
  return kartu('Profil perusahaan', form);
}

// ---------- modul aktif ----------
function bagianModul() {
  const kotak = {};
  return kartu('Modul aktif',
    h('p', null, 'Modul yang dimatikan hilang dari menu dan notifikasi. Datanya tetap tersimpan dan muncul lagi saat modul dinyalakan.'),
    h('div', {class: 'daftar-centang'}, Object.entries(MODUL).map(([k, label]) => h('label', {class: 'centang'}, kotak[k] = h('input', {type: 'checkbox', checked: modulAktif(k)}), ' ', label))),
    h('div', {class: 'baris-tombol'}, h('button', {class: 'btn btn-utama', type: 'button', onclick: aman(async () => {
      await simpanPengaturan('modul', Object.fromEntries(Object.keys(MODUL).map((k) => [k, kotak[k].checked])));
      pesan('Modul aktif tersimpan.');
    })}, 'Simpan modul')));
}

// ---------- pengguna dan peran (super admin) ----------
function bagianPengguna() {
  const peran = S.keu.peran.slice().sort((a, b) => a.nama.localeCompare(b.nama, 'id'));
  const dipakai = new Map();
  const kartuPeran = kartu('Peran & hak akses',
    h('p', null, 'Setiap peran menentukan hak per menu: Tidak ada (menu tidak tampil), Lihat (hanya membaca), atau Ubah (menambah, mengubah, menghapus). Super admin selalu bisa semuanya.'),
    h('div', {class: 'gulir'}, h('table', {class: 'tabel'},
      h('thead', null, h('tr', null, ['Peran', 'Menu yang bisa diubah', 'Menu hanya lihat', 'Hak khusus'].map((x) => h('th', null, x)))),
      h('tbody', null, peran.length ? peran.map((p) => h('tr', {class: 'bisa-klik', tabindex: '0', onclick: () => bukaFormPeran(p), onkeydown: (ev) => { if (ev.key === 'Enter') bukaFormPeran(p); }},
        h('td', null, h('b', null, p.nama)),
        h('td', {class: 'lebar'}, MENU_HAK.filter((m) => p.hak?.[m.k] === 'ubah').map((m) => m.label).join(', ') || '—'),
        h('td', {class: 'lebar'}, MENU_HAK.filter((m) => p.hak?.[m.k] === 'lihat').map((m) => m.label).join(', ') || '—'),
        h('td', null, Object.entries(KHUSUS).filter(([k]) => p.khusus?.[k]).map(([, l]) => l).join(', ') || '—')))
        : h('tr', null, h('td', {colspan: '4', class: 'redup'}, 'Belum ada peran.'))))),
    h('div', {class: 'baris-tombol'}, h('button', {class: 'btn', type: 'button', onclick: () => bukaFormPeran(null)}, '+ Peran baru')));
  const daftar = h('div', null, h('p', {class: 'redup'}, store.mode === 'lokal' ? 'Mode demo hanya punya satu pengguna (super admin).' : 'Memuat pengguna…'));
  const kartuPengguna = kartu('Pengguna',
    h('p', null, 'Akun baru mendaftar sendiri dari halaman masuk, lalu diaktifkan dan diberi peran di sini. Super admin bisa mengatur peran, pengguna, dan membuka kembali buku yang sudah ditutup.'), daftar);
  if (store.mode === 'supabase') aman(async () => {
    const orang = await store.keu.pengguna();
    for (const o of orang) if (o.peran_id) dipakai.set(o.peran_id, (dipakai.get(o.peran_id) || 0) + 1);
    daftar.replaceChildren(h('div', {class: 'gulir'}, h('table', {class: 'tabel'},
      h('thead', null, h('tr', null, ['Email', 'Peran', 'Super admin', 'Aktif'].map((x) => h('th', null, x)))),
      h('tbody', null, orang.map((o) => {
        const diri = o.id === S.user.id;
        const ubah = (perubahan, teks) => aman(async (ev) => {
          try { await store.keu.aturPengguna(o.id, perubahan(ev)); pesan(teks(ev)); } catch (e) { pesan(e.message, 'galat'); S.render(); }
        });
        return h('tr', null, h('td', null, o.email, diri && ' (Anda)'),
          h('td', null, h('select', {'aria-label': 'Peran ' + o.email, disabled: o.super_admin, onchange: ubah((ev) => ({peran_id: ev.target.value || null}), () => 'Peran diperbarui.')},
            h('option', {value: ''}, o.super_admin ? 'Super admin (semua)' : 'Tanpa peran (tidak bisa membuka menu apa pun)'), peran.map((p) => h('option', {value: p.id, selected: p.id === o.peran_id}, p.nama)))),
          h('td', null, h('input', {type: 'checkbox', 'aria-label': 'Super admin ' + o.email, checked: o.super_admin, disabled: diri, onchange: ubah((ev) => ({super_admin: ev.target.checked}), (ev) => ev.target.checked ? 'Dijadikan super admin.' : 'Bukan super admin lagi.')})),
          h('td', null, h('input', {type: 'checkbox', 'aria-label': 'Aktif ' + o.email, checked: o.aktif, disabled: diri, onchange: ubah((ev) => ({aktif: ev.target.checked}), (ev) => ev.target.checked ? 'Akun diaktifkan.' : 'Akun dinonaktifkan.')})));
      })))));
  })();
  return [kartuPengguna, kartuPeran];

  function bukaFormPeran(p) {
    const galat = h('p', {class: 'form-galat', role: 'alert'});
    const nama = h('input', {id: 'peran-nama', type: 'text', value: p?.nama ?? '', required: true, autocomplete: 'off'});
    const pilih = {};
    const grup = {};
    for (const m of MENU_HAK) (grup[m.grup] ||= []).push(m);
    const kotakKhusus = {};
    const simpan = h('button', {class: 'btn btn-utama', type: 'submit'}, 'Simpan');
    let dlg;
    const hapus = p && h('button', {class: 'btn btn-bahaya', type: 'button', onclick: aman(async () => {
      if (dipakai.get(p.id)) throw new Error('Peran ini masih dipakai ' + dipakai.get(p.id) + ' pengguna. Ganti dulu peran mereka.');
      if (hapus.dataset.yakin !== '1') { hapus.dataset.yakin = '1'; hapus.textContent = 'Klik lagi untuk menghapus'; return; }
      await store.keu.hapusPeran(p.id); dlg.close(); await segarkanKeuangan(); pesan('Peran dihapus.');
    })}, 'Hapus');
    dlg = dialog(p ? 'Peran: ' + p.nama : 'Peran baru', h('form', {class: 'form', onsubmit: async (ev) => {
      ev.preventDefault();
      if (!nama.value.trim()) { galat.textContent = 'Nama peran wajib diisi.'; return; }
      const hakBaru = Object.fromEntries(MENU_HAK.map((m) => [m.k, pilih[m.k].value]).filter(([, v]) => v));
      try {
        await sambilMenyimpan(simpan, () => store.keu.simpanPeran(p?.id, {nama: nama.value.trim(), hak: hakBaru, khusus: Object.fromEntries(Object.keys(KHUSUS).map((k) => [k, kotakKhusus[k].checked]))}));
        dlg.close(); await segarkanKeuangan(); pesan('Peran tersimpan. Pengguna dengan peran ini perlu memuat ulang halaman.');
      } catch (e) { galat.textContent = e.message; }
    }},
      medan('Nama peran', nama, {wajib: true}),
      h('div', {class: 'gulir'}, h('table', {class: 'tabel tabel-isian'},
        h('thead', null, h('tr', null, h('th', null, 'Menu'), h('th', null, 'Hak'))),
        h('tbody', null, Object.entries(grup).flatMap(([g, daftarMenu]) => [h('tr', null, h('td', {colspan: '2', class: 'kecil redup'}, g)),
          ...daftarMenu.map((m) => h('tr', null, h('td', null, m.label, m.segera && h('span', {class: 'kecil redup'}, ' (segera)')),
            h('td', null, pilih[m.k] = h('select', {'aria-label': 'Hak ' + m.label}, [['', 'Tidak ada'], ['lihat', 'Lihat'], ['ubah', 'Ubah']].map(([v, l]) => h('option', {value: v, selected: (p?.hak?.[m.k] || '') === v}, l))))))])))),
      h('h3', null, 'Hak khusus'),
      h('div', {class: 'daftar-centang'}, Object.entries(KHUSUS).map(([k, l]) => h('label', {class: 'centang'}, kotakKhusus[k] = h('input', {type: 'checkbox', checked: !!p?.khusus?.[k]}), ' ', l))),
      galat,
      h('div', {class: 'form-kaki'}, hapus, h('span', {class: 'pegas'}), h('button', {class: 'btn', type: 'button', onclick: () => dlg.close()}, 'Batal'), simpan)));
  }
}

// ---------- Kas & Bank ----------
function bagianKas() {
  if (!S.keu.siap) { const d = h('div'); kartuBelumSiap(d); return d.firstChild; }
  const rek = S.keu.rekening.slice().sort((a, b) => (b.aktif - a.aktif) || a.nama.localeCompare(b.nama, 'id'));
  return h('section', {class: 'kartu'}, h('h2', null, 'Rekening Kas & Bank'),
    h('p', null, 'Setiap rekening otomatis menjadi sub-akun 1-1 Kas dan Setara Kas. Saldo awal dijurnal ke 3-2-01 Ekuitas saldo awal. Transaksi dan mutasi ada di menu Keuangan → ', h('a', {href: '#kas'}, 'Kas & Bank'), '.'),
    rek.length ? tabelRekening(rek) : h('p', {class: 'redup'}, 'Belum ada rekening.'),
    (bisaUbah('kas') || bisaUbah('pengaturan')) && h('div', {class: 'baris-tombol'}, h('button', {class: 'btn btn-utama', type: 'button', onclick: () => bukaFormRekening(null)}, '+ Rekening')));
}

// ---------- Bagan akun ----------
function bagianAkun() {
  if (!S.keu.siap) { const d = h('div'); kartuBelumSiap(d); return d.firstChild; }
  const K = S.keu, bisa = bisaUbah('pengaturan') || bisaUbah('jurnal');
  const akun = K.akun.slice().sort(urutKode);
  const anak = new Map();
  for (const a of akun) if (a.induk_id) (anak.get(a.induk_id) || anak.set(a.induk_id, []).get(a.induk_id)).push(a);
  const saldoSendiri = new Map();
  for (const b of K.jurnal_baris) saldoSendiri.set(b.akun_id, (saldoSendiri.get(b.akun_id) || 0) + b.debit - b.kredit);
  const saldo = (a) => (saldoSendiri.get(a.id) || 0) + (anak.get(a.id) || []).reduce((s, c) => s + saldo(c), 0);
  const tampilSaldo = (a) => { const s = saldo(a) * (saldoNormal(a.golongan) === 'D' ? 1 : -1); return s ? rp(s) : '—'; };
  const jenis = (a) => (a.standar ? 'Standar' : a.rekening_id ? 'Rekening' : a.sistem ? 'Sistem' : 'Sub-akun');
  const tingkat = (a) => a.kode.split('-').length - 1;
  const baris = akun.map((a) => h('tr', {class: (tingkat(a) === 0 ? 'akun-golongan ' : '') + (!a.standar && !a.sistem && !a.rekening_id && bisa ? 'bisa-klik' : ''), onclick: !a.standar && !a.sistem && !a.rekening_id && bisa ? () => bukaFormAkun(a) : null},
    h('td', null, h('span', {style: {paddingLeft: tingkat(a) * 16 + 'px'}}, a.kode)), h('td', null, a.nama),
    h('td', null, GOLONGAN[a.golongan]), h('td', null, saldoNormal(a.golongan) === 'D' ? 'Debit' : 'Kredit'), h('td', null, jenis(a)),
    h('td', null, a.aktif ? '' : pill('Nonaktif')), h('td', {class: 'kanan'}, tampilSaldo(a))));
  return h('section', {class: 'kartu'}, h('h2', null, 'Bagan akun'),
    h('p', null, 'Struktur akun standar sama di setiap instalasi. Akun standar tidak bisa dihapus dan kodenya tetap. Sub-akun boleh ditambah di bawah akun standar (level 2 ke bawah). Sub-akun Kas dan Setara Kas dibuat otomatis dari rekening.'),
    h('div', {class: 'alat'}, h('span', {class: 'pegas'}),
      h('button', {class: 'btn', type: 'button', onclick: aman(() => eksporExcel('bagan-akun-' + hariIni() + '.xlsx', [{nama: 'Bagan akun', kolom: [
        {judul: 'Kode', k: 'kode', jenis: 'teks'}, {judul: 'Nama akun', k: 'nama', lebar: 40}, {judul: 'Golongan', k: 'gol', lebar: 18}, {judul: 'Saldo normal', k: 'normal'}, {judul: 'Jenis', k: 'jenis'}, {judul: 'Aktif', k: 'aktif'}],
      baris: akun.map((a) => ({kode: a.kode, nama: a.nama, gol: GOLONGAN[a.golongan], normal: saldoNormal(a.golongan) === 'D' ? 'Debit' : 'Kredit', jenis: jenis(a), aktif: a.aktif ? 'Ya' : 'Tidak'}))}]))}, 'Ekspor Excel'),
      bisa && h('button', {class: 'btn btn-utama', type: 'button', onclick: () => bukaFormAkun(null)}, '+ Sub-akun')),
    h('div', {class: 'gulir'}, h('table', {class: 'tabel tabel-akun'},
      h('thead', null, h('tr', null, ['Kode', 'Nama akun', 'Golongan', 'Saldo normal', 'Jenis', '', 'Saldo'].map((x, i) => h('th', {class: i === 6 ? 'kanan' : null}, x)))),
      h('tbody', null, baris))));

  function bukaFormAkun(a) {
    const galat = h('p', {class: 'form-galat', role: 'alert'});
    const opsiInduk = K.akun.filter((x) => x.kode.includes('-') && x.kode !== '1-1' && !x.kode.startsWith('1-1-') && x.aktif).sort(urutKode)
      .map((x) => ({v: x.id, label: x.kode + ' ' + x.nama, grup: GOLONGAN[x.golongan]}));
    const induk = pilihCari('ak-induk', opsiInduk, a?.induk_id || '', {wajib: true, label: 'Cari akun induk'});
    if (a) induk.querySelector('input[type=text]').disabled = true;
    const nama = h('input', {id: 'ak-nama', type: 'text', value: a?.nama ?? '', required: true, autocomplete: 'off'});
    const aktif = h('input', {id: 'ak-aktif', type: 'checkbox', checked: a ? a.aktif : true});
    const kodeInfo = h('p', {class: 'kecil redup'}, a ? 'Kode: ' + a.kode : 'Kode dibuat otomatis: <kode induk>-01, -02, dan seterusnya.');
    const dipakai = a && (K.jurnal_baris.some((b) => b.akun_id === a.id) || K.kas_transaksi.some((k) => k.akun_id === a.id) || K.akun.some((c) => c.induk_id === a.id));
    const simpan = h('button', {class: 'btn btn-utama', type: 'submit'}, 'Simpan');
    let dlg;
    const hapus = a && !dipakai && h('button', {class: 'btn btn-bahaya', type: 'button', onclick: aman(async () => {
      if (hapus.dataset.yakin !== '1') { hapus.dataset.yakin = '1'; hapus.textContent = 'Klik lagi untuk menghapus'; return; }
      await store.keu.hapusAkun(a.id); dlg.close(); await segarkanKeuangan(); pesan('Sub-akun dihapus.');
    })}, 'Hapus');
    dlg = dialog(a ? 'Sub-akun ' + a.kode : 'Tambah sub-akun', h('form', {class: 'form', onsubmit: async (ev) => {
      ev.preventDefault();
      galat.textContent = '';
      const indukId = induk.querySelector('input[type=hidden]').value;
      if (!indukId) { galat.textContent = 'Akun induk wajib dipilih.'; return; }
      if (!nama.value.trim()) { galat.textContent = 'Nama akun wajib diisi.'; nama.focus(); return; }
      if (K.akun.some((x) => x.id !== a?.id && x.induk_id === indukId && x.nama.trim().toLowerCase() === nama.value.trim().toLowerCase())) { galat.textContent = 'Sudah ada sub-akun bernama "' + nama.value.trim() + '" di bawah induk ini.'; return; }
      try {
        await sambilMenyimpan(simpan, () => store.keu.simpanAkun(a?.id, a ? {nama: nama.value.trim(), aktif: aktif.checked} : {nama: nama.value.trim(), induk_id: indukId, golongan: K.akun.find((x) => x.id === indukId).golongan, aktif: aktif.checked}));
        dlg.close(); await segarkanKeuangan(); pesan('Sub-akun tersimpan.');
      } catch (e) { galat.textContent = e.message; }
    }},
      h('div', {class: 'form-grid'}, medan('Akun induk', induk, {wajib: true, id: 'ak-induk-cari'}), medan('Nama sub-akun', nama, {wajib: true}),
        h('div', {class: 'medan'}, h('label', {class: 'centang', for: 'ak-aktif'}, aktif, ' Aktif'), dipakai && h('span', {class: 'kecil redup'}, 'Sudah dipakai: tidak bisa dihapus, hanya dinonaktifkan.'))),
      kodeInfo, galat,
      h('div', {class: 'form-kaki'}, hapus, h('span', {class: 'pegas'}), h('button', {class: 'btn', type: 'button', onclick: () => dlg.close()}, 'Batal'), simpan)));
  }
}

// ---------- pemetaan jurnal ----------
export function barisPemetaan(K = S.keu) {
  return K.pemetaan_jurnal.slice().sort((a, b) => a.jenis.localeCompare(b.jenis) || a.urut - b.urut).map((m) => {
    const a = /^\d/.test(m.akun) ? akunKode(K, m.akun) : null;
    return {...m, akun_teks: a ? a.kode + ' ' + a.nama : ISI_PEMETAAN[m.akun] || m.akun};
  });
}
function bagianPemetaan() {
  const rows = barisPemetaan();
  const urutJenis = ['saldo_awal', 'kas_masuk', 'kas_keluar', 'transfer', 'transfer_biaya'];
  rows.sort((a, b) => urutJenis.indexOf(a.jenis) - urutJenis.indexOf(b.jenis) || a.urut - b.urut);
  return h('section', {class: 'kartu'}, h('h2', null, 'Pemetaan jurnal'),
    h('p', null, 'Tabel ini menentukan akun debit dan kredit setiap jurnal otomatis. Tabel disimpan di database; aplikasi hanya membacanya. Jenis transaksi baru (invoice, pembelian, aset) ditambahkan pada tahap berikutnya.'),
    h('div', {class: 'alat'}, h('span', {class: 'pegas'}), h('button', {class: 'btn', type: 'button', onclick: aman(() => eksporExcel('pemetaan-jurnal-' + hariIni() + '.xlsx', [{nama: 'Pemetaan jurnal', kolom: [
      {judul: 'Jenis transaksi', k: 'nama', lebar: 34}, {judul: 'Kode jenis', k: 'jenis', lebar: 16}, {judul: 'Sisi', k: 'sisi'}, {judul: 'Akun', k: 'akun_teks', lebar: 36}, {judul: 'Keterangan', k: 'keterangan', lebar: 60}], baris: rows}]))}, 'Ekspor Excel')),
    h('div', {class: 'gulir'}, h('table', {class: 'tabel'},
      h('thead', null, h('tr', null, ['Jenis transaksi', 'Sisi', 'Akun', 'Keterangan'].map((x) => h('th', null, x)))),
      h('tbody', null, rows.map((m) => h('tr', null, h('td', null, m.nama), h('td', null, m.sisi === 'D' ? 'Debit' : 'Kredit'), h('td', null, m.akun_teks), h('td', {class: 'lebar kecil redup'}, isi(m.keterangan))))))));
}

// ---------- pengaturan akuntansi ----------
function bagianAkuntansi() {
  if (!S.keu.siap) { const d = h('div'); kartuBelumSiap(d); return d.firstChild; }
  const a = S.keu.akuntansi;
  const galat = h('p', {class: 'form-galat', role: 'alert'});
  const basis = h('select', {id: 'ak-basis'}, [['kas', 'Kas (bawaan)'], ['akrual', 'Akrual']].map(([v, l]) => h('option', {value: v, selected: a.basis === v}, l)));
  const bulan = h('select', {id: 'ak-bulan'}, NAMA_BULAN_PANJANG.map((l, i) => h('option', {value: String(i + 1), selected: a.bulan_awal_buku === i + 1}, l)));
  const batas = h('input', {id: 'ak-batas', type: 'text', inputmode: 'numeric', value: idn(a.batas_kapitalisasi), oninput: () => { batas.value = formatUang(batas.value); }});
  const bolehBasis = +hariIni().slice(5, 7) === a.bulan_awal_buku || !S.keu.jurnal.length;
  return kartu('Pengaturan akuntansi',
    h('div', {class: 'form-grid'},
      medan('Basis pengakuan pendapatan', basis, {bantuan: 'Kas: pendapatan dicatat saat uang diterima; invoice tidak membuat jurnal. Akrual: pendapatan dicatat saat invoice terbit.'}),
      medan('Awal tahun buku', bulan, {bantuan: 'Bulan pertama periode buku.'}),
      medan('Batas kapitalisasi aset', h('div', {class: 'berawalan'}, h('span', null, 'Rp'), batas), {id: 'ak-batas', bantuan: 'Pembelian barang di atas nilai ini dicatat sebagai aset (dipakai mulai Tahap 5).'})),
    !bolehBasis && h('p', {class: 'kecil redup'}, 'Basis hanya bisa diubah di bulan pertama tahun buku (' + NAMA_BULAN_PANJANG[a.bulan_awal_buku - 1] + '). Setiap perubahan dicatat di audit log.'),
    galat,
    h('div', {class: 'baris-tombol'}, h('button', {class: 'btn btn-utama', type: 'button', onclick: aman(async () => {
      galat.textContent = '';
      const nilai = bacaUang(batas.value);
      if (nilai == null || nilai < 0) { galat.textContent = 'Batas kapitalisasi wajib diisi (0 atau lebih).'; return; }
      try { await store.keu.aturAkuntansi({basis: basis.value, bulan_awal_buku: +bulan.value, batas_kapitalisasi: nilai}); }
      catch (e) { galat.textContent = e.message; return; }
      await segarkanKeuangan(); pesan('Pengaturan akuntansi tersimpan.');
    })}, 'Simpan')));
}

// ---------- notifikasi ----------
function bagianNotifikasi() {
  const atur = aturNotif();
  const kotak = {};
  const galat = h('p', {class: 'form-galat', role: 'alert'});
  return kartu('Notifikasi',
    h('p', null, 'Pengingat di lonceng 🔔 di kepala aplikasi. Dihitung setiap kali aplikasi dibuka dan diperiksa ulang saat tanggal berganti. "H-" = berapa hari sebelum tanggalnya pengingat mulai muncul.'),
    h('div', {class: 'gulir'}, h('table', {class: 'tabel tabel-isian'},
      h('thead', null, h('tr', null, ['Jenis', 'Aktif', 'Muncul H-', 'Catatan'].map((x) => h('th', null, x)))),
      h('tbody', null, Object.entries(JENIS_NOTIF).map(([k, j]) => {
        kotak[k] = {aktif: h('input', {type: 'checkbox', checked: atur[k].aktif, 'aria-label': 'Aktif ' + j.label}), hari: h('input', {type: 'number', min: '0', max: '365', step: '1', value: String(atur[k].hari), 'aria-label': 'Hari ' + j.label, class: 'angka-pendek'})};
        return h('tr', null, h('td', null, j.label), h('td', {class: 'tengah-teks'}, kotak[k].aktif), h('td', null, h('div', {class: 'berakhiran'}, kotak[k].hari, h('span', null, 'hari'))),
          h('td', {class: 'kecil redup'}, j.modul && !modulAktif(j.modul) ? 'Modul ' + MODUL[j.modul] + ' sedang mati.' : j.sdm ? 'Juga dipakai untuk tanda peringatan di tabel SDM.' : ''));
      })))),
    galat,
    h('div', {class: 'baris-tombol'}, h('button', {class: 'btn btn-utama', type: 'button', onclick: aman(async () => {
      galat.textContent = '';
      const hasil = {}, sdm = {...S.pengaturan?.data?.sdm};
      for (const [k, j] of Object.entries(JENIS_NOTIF)) {
        const v = kotak[k].hari.value.trim();
        if (!/^\d+$/.test(v)) { galat.textContent = j.label + ': isi H- dengan angka 0 atau lebih.'; kotak[k].hari.focus(); return; }
        hasil[k] = {aktif: kotak[k].aktif.checked, hari: +v};
        if (j.sdm) sdm[j.sdm] = +v;
      }
      await store.simpan('pengaturan', S.pengaturan?.id, {...S.pengaturan?.data, notifikasi: hasil, sdm});
      await muatData(); S.render(); pesan('Pengaturan notifikasi tersimpan.');
    })}, 'Simpan notifikasi')));
}

// ---------- umum: zona waktu dan unggahan ----------
function bagianUmum() {
  const pilih = h('select', {id: 'zona-waktu'}, Object.entries(ZONA_WAKTU).map(([v, l]) => h('option', {value: v, selected: v === zonaAktif()}, l)));
  const mb = h('input', {id: 'unggah-mb', type: 'number', min: '1', max: '50', step: '1', value: String(S.pengaturan?.data?.unggah_mb || 10)});
  return kartu('Umum',
    h('div', {class: 'form-grid'},
      medan('Zona waktu', pilih, {bantuan: 'Menentukan tanggal "hari ini" untuk notifikasi, umur piutang, jatuh tempo, dan tutup buku. Hari ini: ' + tgl(hariIni()) + '.'}),
      medan('Batas ukuran unggahan bukti', h('div', {class: 'berakhiran'}, mb, h('span', null, 'MB')), {id: 'unggah-mb', bantuan: 'Per file bukti transaksi (PDF, JPG, PNG). Maksimal 50 MB. File SDM tetap maksimal 10 MB.'})),
    h('div', {class: 'baris-tombol'}, h('button', {class: 'btn btn-utama', type: 'button', onclick: aman(async () => {
      const v = +mb.value;
      if (!Number.isInteger(v) || v < 1 || v > 50) throw new Error('Batas unggahan harus 1–50 MB.');
      await store.simpan('pengaturan', S.pengaturan?.id, {...S.pengaturan?.data, zona_waktu: pilih.value, unggah_mb: v});
      await muatData(); S.render(); pesan('Pengaturan umum tersimpan.');
    })}, 'Simpan')));
}

// ---------- Barang & Harga: batas harga lama ----------
function bagianBarang() {
  const bln = h('input', {id: 'harga-lama', type: 'number', min: '1', max: '60', step: '1', value: String(S.pengaturan?.data?.harga_lama_bulan || 6)});
  return kartu('Barang & Harga',
    h('div', {class: 'form-grid'},
      medan('Penanda "Harga lama – perlu cek ulang"', h('div', {class: 'berakhiran'}, bln, h('span', null, 'bulan')), {id: 'harga-lama', bantuan: 'Muncul bila harga terakhir sebuah barang lebih tua dari batas ini. Bawaan 6 bulan.'})),
    h('p', {class: 'kecil redup'}, 'Kategori barang, kategori pekerjaan, satuan, dan keahlian vendor diatur di ', h('a', {href: '#pengaturan-dropdown'}, 'Pilihan dropdown'), '.'),
    h('div', {class: 'baris-tombol'}, h('button', {class: 'btn btn-utama', type: 'button', onclick: aman(async () => {
      const v = +bln.value;
      if (!Number.isInteger(v) || v < 1 || v > 60) throw new Error('Batas harga lama harus 1–60 bulan.');
      await store.simpan('pengaturan', S.pengaturan?.id, {...S.pengaturan?.data, harga_lama_bulan: v});
      await muatData(); S.render(); pesan('Pengaturan Barang & Harga tersimpan.');
    })}, 'Simpan')));
}

// ---------- SDM: jabatan dan batas PKWT ----------
function bagianJabatan() {
  const {jabatan} = aturSdm(S.pengaturan?.data);
  const dipakai = (jid) => S.d.sdm.filter((s) => s.jabatan_id === jid).length;
  const badan = h('tbody');
  const galat = h('p', {class: 'form-galat', role: 'alert'});
  const baris = [];
  let nomor = 0;
  const tambah = (j) => {
    const i = ++nomor, pakai = j.id ? dipakai(j.id) : 0;
    const nama = h('input', {type: 'text', id: 'jab-nama-' + i, value: j.nama || '', autocomplete: 'off', 'aria-label': 'Nama jabatan'});
    const skk = h('input', {type: 'checkbox', checked: !!j.skk, 'aria-label': 'Memerlukan SKK/STRA'});
    const aktif = h('input', {type: 'checkbox', checked: j.aktif !== false, 'aria-label': 'Aktif'});
    const item = {id: j.id, nama, skk, aktif};
    const tr = h('tr', null, h('td', null, nama), modulAktif('skk') && h('td', {class: 'tengah-teks'}, skk), h('td', {class: 'tengah-teks'}, aktif),
      h('td', {class: 'kanan'}, pakai ? idn(pakai) + ' pegawai' : '—'),
      h('td', null, pakai ? h('span', {class: 'kecil redup'}, 'Dipakai; nonaktifkan saja') : h('button', {class: 'btn btn-kecil', type: 'button', onclick: () => { baris.splice(baris.indexOf(item), 1); tr.remove(); }}, 'Hapus')));
    baris.push(item);
    badan.append(tr);
    return nama;
  };
  // Saat modul SKK mati, centang SKK disimpan apa adanya (diambil dari data, bukan dari tampilan).
  const asli = Array.isArray(S.pengaturan?.data?.jabatan) ? S.pengaturan.data.jabatan : jabatan;
  asli.forEach(tambah);
  return kartu('Jabatan (SDM)',
    h('p', null, 'Daftar jabatan untuk formulir pegawai.', modulAktif('skk') && ' Centang "Memerlukan SKK/STRA" agar isian nomor, masa berlaku, dan file sertifikat muncul untuk jabatan itu.', ' Jabatan yang sudah dipakai tidak bisa dihapus, hanya dinonaktifkan.'),
    h('div', {class: 'gulir'}, h('table', {class: 'tabel tabel-isian'},
      h('thead', null, h('tr', null, h('th', null, 'Nama jabatan'), modulAktif('skk') && h('th', null, 'Memerlukan SKK/STRA'), h('th', null, 'Aktif'), h('th', {class: 'kanan'}, 'Dipakai'), h('th', null, ''))), badan)),
    galat,
    h('div', {class: 'baris-tombol'},
      h('button', {class: 'btn', type: 'button', onclick: () => tambah({skk: false, aktif: true}).focus()}, '+ Tambah jabatan'),
      h('button', {class: 'btn btn-utama', type: 'button', onclick: aman(async () => {
        galat.textContent = '';
        const hasil = [], nama = new Set();
        for (const b of baris) {
          const n = b.nama.value.replace(/\s+/g, ' ').trim();
          if (!n) { galat.textContent = 'Nama jabatan tidak boleh kosong.'; b.nama.focus(); return; }
          if (nama.has(n.toLowerCase())) { galat.textContent = 'Jabatan "' + n + '" tertulis dua kali.'; b.nama.focus(); return; }
          nama.add(n.toLowerCase());
          hasil.push({id: b.id || 'j-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), nama: n, skk: b.skk.checked, aktif: b.aktif.checked});
        }
        if (!hasil.some((j) => j.aktif)) { galat.textContent = 'Minimal satu jabatan aktif.'; return; }
        await simpanPengaturan('jabatan', hasil);
        pesan('Daftar jabatan tersimpan.');
      })}, 'Simpan jabatan')));
}

// Batas kontrak PKWT. Batas H- peringatan SDM diatur di bagian Notifikasi.
function bagianParamSdm() {
  const {param} = aturSdm(S.pengaturan?.data);
  const galat = h('p', {class: 'form-galat', role: 'alert'});
  const BARIS = [
    ['pkwt_awal_bln', 'Durasi maksimal kontrak awal', 'bulan'],
    ['pkwt_maks_perpanjangan', 'Jumlah maksimal perpanjangan', 'kali'],
    ['pkwt_perpanjangan_bln', 'Durasi maksimal per perpanjangan', 'bulan'],
  ];
  const kotak = {};
  return kartu('Batas kontrak PKWT (opsional)',
    h('p', {class: 'kecil redup'}, 'Bila diisi, aplikasi memberi peringatan saat kontrak yang diinput melebihi batas ini atau jatah perpanjangan sudah habis. Kosongkan bila tidak dibatasi. Kapan peringatan kontrak, SKK/STRA, dan magang muncul diatur di ', h('a', {href: '#pengaturan-notifikasi'}, 'Notifikasi'), '.'),
    h('div', {class: 'form-grid'}, BARIS.map(([k, label, satuan]) => {
      const inp = kotak[k] = h('input', {id: 'param-' + k, type: 'number', min: '0', step: '1', value: param[k] ?? '', placeholder: 'tidak dibatasi'});
      return h('div', {class: 'medan'}, h('label', {for: 'param-' + k}, label), h('div', {class: 'berakhiran'}, inp, h('span', null, satuan)));
    })),
    galat,
    h('div', {class: 'baris-tombol'}, h('button', {class: 'btn btn-utama', type: 'button', onclick: aman(async () => {
      galat.textContent = '';
      const hasil = Object.fromEntries(['hari_kontrak', 'hari_skk', 'hari_magang'].map((k) => [k, S.pengaturan?.data?.sdm?.[k] ?? PARAM_BAWAAN[k]]));
      for (const [k, label] of BARIS) {
        const v = kotak[k].value.trim();
        if (v !== '' && !/^\d+$/.test(v)) { galat.textContent = label + ': isi dengan angka bulat 0 atau lebih.'; kotak[k].focus(); return; }
        hasil[k] = v === '' ? null : +v;
      }
      await simpanPengaturan('sdm', hasil);
      pesan('Batas kontrak PKWT tersimpan.');
    })}, 'Simpan batas PKWT')));
}

// ---------- pilihan dropdown ----------
function bagianDropdown() {
  const kotak = {};
  const galat = h('p', {class: 'form-galat', role: 'alert'});
  return kartu('Pilihan dropdown',
    h('p', null, 'Atur isi daftar pilihan di formulir. Tulis satu pilihan per baris; urutannya menjadi urutan di dropdown.'),
    h('p', {class: 'kecil redup'}, 'Mengganti nama pilihan tidak mengubah data yang sudah tersimpan: baris lama tetap menyimpan nama lama. Pada Sumber klien, "Referensi" dan "Lainnya" memunculkan kotak isian tambahan selama namanya tidak diubah. Daftar yang dipakai rumus tidak bisa diubah.'),
    Object.entries(OPSI_BISA_DIATUR).map(([k, label]) => {
      const ta = h('textarea', {id: 'opsi-' + k, rows: '7'}, opsiSekarang(k).join('\n'));
      kotak[k] = ta;
      return h('details', {class: 'opsi'}, h('summary', null, label, h('span', {class: 'redup kecil'}, ' · ' + opsiSekarang(k).length + ' pilihan')),
        h('label', {for: 'opsi-' + k, class: 'kecil redup'}, 'Satu pilihan per baris'), ta,
        h('div', null, h('button', {class: 'btn btn-kecil', type: 'button', onclick: () => { ta.value = opsiBawaan(k).join('\n'); }}, 'Isi dengan pilihan bawaan')));
    }),
    galat,
    h('div', {class: 'baris-tombol'}, h('button', {class: 'btn btn-utama', type: 'button', onclick: aman(async () => {
      galat.textContent = '';
      const opsi = {};
      for (const [k, label] of Object.entries(OPSI_BISA_DIATUR)) {
        const daftar = [...new Set(kotak[k].value.split('\n').map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean))];
        if (!daftar.length) { galat.textContent = label + ': minimal satu pilihan.'; return; }
        if (k === 'sumberKlien' && daftar.some((x) => x.includes(','))) { galat.textContent = label + ': pilihan tidak boleh memuat koma (dipakai sebagai dropdown di file Excel).'; return; }
        if (['keahlianVendor', 'kategoriBarang'].includes(k) && daftar.some((x) => /[,;]/.test(x))) { galat.textContent = label + ': pilihan tidak boleh memuat koma atau titik koma (dipakai sebagai pemisah di file Excel).'; return; }
        if (k === 'satuanBarang' && daftar.some((x) => /[;=]/.test(x))) { galat.textContent = label + ': satuan tidak boleh memuat ; atau = (dipakai di kolom konversi Excel).'; return; }
        opsi[k] = daftar;
      }
      await simpanPengaturan('opsi', opsi);
      pesan('Pilihan dropdown tersimpan.');
    })}, 'Simpan pilihan')));
}

// ---------- cadangan ----------
const KUNCI_OTOMATIS = 'alinea5:cadangan-otomatis';
const bacaOtomatis = () => { try { return JSON.parse(localStorage.getItem(KUNCI_OTOMATIS)) || {}; } catch { return {}; } };
const tulisOtomatis = (x) => { try { localStorage.setItem(KUNCI_OTOMATIS, JSON.stringify(x)); } catch { /* penyimpanan browser tidak tersedia */ } };
const tabelCadangan = () => NAMA_TABEL.filter((t) => bolehAkses(t));

// Isi file cadangan: seluruh data yang bisa diakses pengguna + pengaturan + keuangan.
export async function buatCadangan() {
  const records = Object.fromEntries(tabelCadangan().map((t) => [t, S.db[t].map(bersih)]));
  return {aplikasi: 'Alinea 5', versi: 2, dibuat: new Date().toISOString(), oleh: S.user.email, records, pengaturan: S.pengaturan?.data || null,
    keuangan: S.keu.siap ? await store.keu.cadangan() : null};
}
export async function unduhCadangan(otomatis = false) {
  const isiFile = await buatCadangan();
  const jam = new Date().toTimeString().slice(0, 5).replace(':', '');
  unduh('alinea5-cadangan-' + hariIni() + '-' + jam + '.json', JSON.stringify(isiFile, null, 2));
  tulisOtomatis({...bacaOtomatis(), terakhir: new Date().toISOString()});
  if (otomatis) pesan('Cadangan otomatis diunduh ke folder Unduhan komputer ini.');
}
// Dipanggil saat aplikasi dibuka: mengunduh cadangan bila sudah waktunya.
export async function periksaCadanganOtomatis() {
  const a = bacaOtomatis();
  if (!a.aktif || hak('pengaturan') == null) return;
  const lewat = a.terakhir ? (Date.now() - Date.parse(a.terakhir)) / 864e5 : Infinity;
  if (lewat >= (+a.hari || 7)) { try { await unduhCadangan(true); } catch (e) { console.error('Cadangan otomatis gagal', e); } }
}

function bagianCadangan() {
  const a = bacaOtomatis();
  const aktif = h('input', {id: 'otomatis-aktif', type: 'checkbox', checked: !!a.aktif});
  const hari = h('select', {id: 'otomatis-hari'}, [[1, 'Setiap hari'], [3, 'Setiap 3 hari'], [7, 'Setiap minggu'], [14, 'Setiap 2 minggu'], [30, 'Setiap 30 hari']].map(([v, l]) => h('option', {value: String(v), selected: (+a.hari || 7) === v}, l)));
  const hasilPulih = h('div');
  const pulih = h('input', {id: 'pulih-json', type: 'file', accept: '.json,application/json', disabled: !S.user.super_admin, onchange: aman(async () => {
    const f = pulih.files[0];
    if (!f) return;
    hasilPulih.replaceChildren();
    let isiFile;
    try { isiFile = JSON.parse(await f.text()); } catch { throw new Error('File ini bukan file cadangan Alinea 5 (.json).'); }
    // Format lama (sebelum Tahap 1): {tabel: [baris]} langsung.
    const records = isiFile.versi >= 2 ? isiFile.records || {} : isiFile;
    const tabel = NAMA_TABEL.filter((t) => t !== 'pengaturan' && Array.isArray(records[t]));
    const keu = isiFile.keuangan;
    if (!tabel.length && !keu) throw new Error('File cadangan tidak berisi data yang dikenali.');
    const jumlah = tabel.reduce((s, t) => s + records[t].length, 0);
    const ketik = h('input', {id: 'pulih-ketik', type: 'text', autocomplete: 'off', placeholder: 'PULIHKAN'});
    const tombol = h('button', {class: 'btn btn-bahaya', type: 'button', onclick: aman(async () => {
      if (ketik.value.trim() !== 'PULIHKAN') throw new Error('Ketik PULIHKAN (huruf besar) untuk melanjutkan.');
      tombol.textContent = 'Mencadangkan data sekarang…';
      await unduhCadangan();
      tombol.textContent = 'Memulihkan…';
      await store.gantiTabel(tabel, tabel.flatMap((t) => records[t].map((r) => ({tabel: t, data: bersih(r)}))));
      if (isiFile.pengaturan) await store.simpan('pengaturan', S.pengaturan?.id, isiFile.pengaturan);
      if (keu && S.keu.siap) await store.keu.pulihkan(keu);
      await muatData(); S.render(); pesan('Cadangan dipulihkan. Cadangan data sebelum pemulihan sudah diunduh.');
    })}, 'Pulihkan sekarang');
    hasilPulih.replaceChildren(h('div', {class: 'kotak-info'},
      h('p', null, h('b', null, f.name), isiFile.dibuat ? ' · dibuat ' + new Date(isiFile.dibuat).toLocaleString('id-ID') + (isiFile.oleh ? ' oleh ' + isiFile.oleh : '') : ' · format lama'),
      h('ul', null, tabel.map((t) => h('li', null, t + ': ' + records[t].length + ' baris (sekarang ' + (S.db[t]?.length ?? 0) + ')')),
        keu && h('li', null, 'Keuangan: ' + (keu.rekening?.length || 0) + ' rekening, ' + (keu.kas_transaksi?.length || 0) + ' transaksi kas, ' + (keu.transfer?.length || 0) + ' transfer, ' + (keu.jurnal_manual?.length || 0) + ' jurnal manual'),
        isiFile.pengaturan && h('li', null, 'Pengaturan aplikasi')),
      h('p', null, h('b', null, 'Isi tabel-tabel di atas akan DIGANTI seluruhnya'), ' dengan isi file (' + jumlah + ' baris data). Sebelum itu aplikasi otomatis mengunduh cadangan data yang sekarang.'),
      h('div', {class: 'medan'}, h('label', {for: 'pulih-ketik'}, 'Ketik PULIHKAN untuk melanjutkan'), ketik),
      h('div', {class: 'baris-tombol'}, tombol)));
  })});
  return [
    h('section', {class: 'kartu'}, h('h2', null, 'Unduh cadangan'),
      h('p', null, 'Seluruh data yang bisa Anda akses (proyek, klien, SDM, keuangan, pengaturan) diunduh sebagai satu file .json ke komputer ini. Simpan file itu di tempat aman.'),
      h('div', {class: 'baris-tombol'}, h('button', {class: 'btn btn-utama', type: 'button', onclick: aman(() => unduhCadangan())}, 'Unduh cadangan sekarang')),
      h('p', {class: 'kecil redup'}, 'Cadangan terakhir dari browser ini: ' + (a.terakhir ? new Date(a.terakhir).toLocaleString('id-ID') : 'belum pernah') + '.')),
    h('section', {class: 'kartu'}, h('h2', null, 'Cadangan otomatis'),
      h('p', null, 'Saat aplikasi dibuka di komputer ini dan sudah waktunya, file cadangan otomatis diunduh ke folder Unduhan. Pengaturan ini berlaku per komputer/browser.'),
      h('div', {class: 'form-grid'}, h('div', {class: 'medan'}, h('label', {class: 'centang', for: 'otomatis-aktif'}, aktif, ' Aktifkan cadangan otomatis')), medan('Seberapa sering', hari)),
      h('div', {class: 'baris-tombol'}, h('button', {class: 'btn btn-utama', type: 'button', onclick: () => { tulisOtomatis({...bacaOtomatis(), aktif: aktif.checked, hari: +hari.value}); pesan(aktif.checked ? 'Cadangan otomatis aktif.' : 'Cadangan otomatis dimatikan.'); }}, 'Simpan'))),
    h('section', {class: 'kartu'}, h('h2', null, 'Pulihkan cadangan'),
      h('p', null, 'Mengganti data di aplikasi dengan isi file cadangan, misalnya setelah data terhapus tidak sengaja atau pindah server. Hanya super admin.'),
      !S.user.super_admin && h('p', {class: 'kecil redup'}, 'Anda bukan super admin, jadi tidak bisa memulihkan cadangan.'),
      h('label', {for: 'pulih-json', class: 'kecil redup'}, 'Pilih file cadangan (.json)'), pulih, hasilPulih),
  ];
}

// ---------- audit log ----------
const NAMA_AUDIT = {rekening: 'Rekening', kas_transaksi: 'Kas umum', transfer: 'Transfer', jurnal: 'Jurnal', jurnal_baris: 'Baris jurnal', akun: 'Bagan akun',
  tutup_buku: 'Tutup buku', akuntansi: 'Pengaturan akuntansi', peran: 'Peran', perusahaan: 'Profil perusahaan', profiles: 'Pengguna'};
const AKSI = {insert: 'Tambah', update: 'Ubah', delete: 'Hapus'};
const ringkasNilai = (v) => (v == null ? '—' : typeof v === 'object' ? (v.nama || v.path ? v.nama || v.path : JSON.stringify(v).slice(0, 60)) : typeof v === 'number' ? idn(v) : String(v).slice(0, 60));
function perubahan(lama, baru) {
  if (!lama || !baru) return Object.entries(baru || lama || {}).filter(([k, v]) => v != null && !['id', 'perusahaan_id', 'dibuat', 'dibuat_oleh'].includes(k)).slice(0, 6).map(([k, v]) => k + ': ' + ringkasNilai(v)).join(' · ');
  return Object.keys({...lama, ...baru}).filter((k) => JSON.stringify(lama[k]) !== JSON.stringify(baru[k]) && !['dibuat'].includes(k)).map((k) => k + ': ' + ringkasNilai(lama[k]) + ' → ' + ringkasNilai(baru[k])).join(' · ');
}
function bagianAudit() {
  const isiAudit = h('div', null, h('p', {class: 'redup'}, 'Memuat audit log…'));
  const saring = h('select', {'aria-label': 'Saring tabel'}, h('option', {value: ''}, 'Semua'), Object.entries(NAMA_AUDIT).map(([k, l]) => h('option', {value: k}, l)));
  let data = [];
  const gambar = () => {
    const rows = data.filter((r) => !saring.value || r.tabel === saring.value);
    isiAudit.replaceChildren(h('div', {class: 'gulir'}, h('table', {class: 'tabel'},
      h('thead', null, h('tr', null, ['Waktu', 'Oleh', 'Data', 'Aksi', 'Perubahan (lama → baru)'].map((x) => h('th', null, x)))),
      h('tbody', null, rows.length ? rows.map((r) => h('tr', null, h('td', null, new Date(r.waktu).toLocaleString('id-ID')), h('td', null, isi(r.email)),
        h('td', null, NAMA_AUDIT[r.tabel] || r.tabel), h('td', null, AKSI[r.aksi] || r.aksi), h('td', {class: 'lebar kecil'}, perubahan(r.lama, r.baru))))
        : h('tr', null, h('td', {colspan: '5', class: 'redup'}, 'Belum ada catatan.'))))));
  };
  saring.addEventListener('change', gambar);
  aman(async () => { data = await store.keu.auditLog(); gambar(); })();
  return h('section', {class: 'kartu'}, h('h2', null, 'Audit log'),
    h('p', null, 'Catatan siapa mengubah apa dan kapan, untuk semua data keuangan, peran, dan profil perusahaan. Catatan tidak bisa diubah atau dihapus dari aplikasi. Ditampilkan 500 catatan terbaru.'),
    h('div', {class: 'alat'}, h('label', {class: 'kecil redup'}, 'Data ', saring)), isiAudit);
}

