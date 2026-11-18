import {TABEL, OPSI, TAHAP, NAMA_TABEL} from './schema.js';
import {ringkasan, temuan, hariIni, n} from './calc.js';
import {store} from './store.js';
import {S, muatData, bersih} from './state.js';
import {h, idn, rp, rpRingkas, persen, tgl, kosong, isi, pill, batangProgres, FORMAT, RATA_KANAN, pesan, aman, sekali, dialog, formatUang, buangTeksPalsu} from './ui.js';
import {MENU, menuDari, menuTampil, hak, bisaUbah, bolehAkses, bolehUbahTabel, modulAktif, namaPeran} from './akses.js';
import {renderKas, renderMutasi, renderJurnal} from './keuangan.js';
import {renderKontrak, renderDetailKontrak, renderPiutang, kontrakProyek} from './kontrak.js';
import {renderPengaturan, NAMA_APLIKASI_BAWAAN, WARNA_BAWAAN, periksaCadanganOtomatis} from './pengaturan.js';
import {lonceng, muatStatusNotifikasi, mulaiPemeriksaanHarian} from './notifikasi.js';
import {renderKlien, renderDetailKlien, pilihKlien} from './klien.js';
import {renderVendor, renderSupplier} from './master.js';
import {renderBarang, renderDetailBarang} from './barang.js';
import {kotakCek, cekSemua, periksaIsian} from './cek.js';
import {renderSdm, renderDetailPegawai} from './sdm.js';
import {editorTimProyek, pilihAnggota, namaTimInternal} from './tim-proyek.js';
import {renderPihakProyek, renderDetailPihak} from './pihak-proyek.js';
import {renderPembelian, renderDetailPembelian} from './pembelian.js';
import {renderDetailProyek} from './detail-proyek.js';
import {ringkasTitipanDipinjamkan} from './dompet.js';
import {bacaKeuangan} from './proyek-bersama.js';

const akar = document.getElementById('app');

// ---------- rute ----------
const rute = () => (location.hash.replace(/^#/, '') || 'dashboard');
const jumlahMenu = (m) => (m.tabel && S.db[m.tabel] ? S.db[m.tabel].filter((x) => x.aktif !== false && (m.tabel !== 'barang' || (x.jenis || 'barang') === 'barang')).length : m.k === 'kas' ? S.keu.rekening.filter((r) => r.aktif).length || null : m.k === 'kontrak' ? S.keu.kontrak_klien?.length || null : m.k === 'pihak_proyek' ? S.keu.kontrak_vendor?.length || null : m.k === 'pembelian' ? S.keu.pembelian?.length || null : null);
// Rute -> kunci menu yang disorot.
function menuAktif(r) {
  if (r.startsWith('sdm-')) return 'sdm';
  if (r.startsWith('klien-')) return 'klien';
  if (r.startsWith('kas')) return 'kas';
  if (r.startsWith('kontrak')) return 'kontrak';
  if (r.startsWith('pihak-proyek')) return 'pihak_proyek';
  if (r.startsWith('pembelian')) return 'pembelian';
  if (r.startsWith('proyek-')) return 'proyek';
  if (r.startsWith('piutang')) return 'termin';
  if (r.startsWith('barang')) return 'barang';
  if (r.startsWith('pengaturan')) return 'pengaturan';
  return MENU.find((m) => m.ke === r)?.k || null;
}

// Identitas aplikasi dari Profil Perusahaan: nama, logo, warna aksen.
export const identitas = () => ({nama: S.profil?.nama_aplikasi || S.identitas?.nama_aplikasi || NAMA_APLIKASI_BAWAAN,
  badan: S.profil?.badan_hukum || S.identitas?.badan_hukum || '', logo: S.profil?.logo || S.identitas?.logo || 'assets/logo.svg',
  warna: S.profil?.warna || S.identitas?.warna || WARNA_BAWAAN});
function terapkanIdentitas() {
  const i = identitas(), akar = document.documentElement.style;
  document.title = i.nama + (i.badan ? ' · ' + i.badan : '');
  if (i.warna && i.warna.toLowerCase() !== WARNA_BAWAAN) {
    const gelap = matchMedia('(prefers-color-scheme: dark)').matches;
    akar.setProperty('--aksen', gelap ? 'color-mix(in srgb, ' + i.warna + ' 60%, white)' : i.warna);
    akar.setProperty('--aksen-lembut', 'color-mix(in srgb, ' + i.warna + (gelap ? ' 22%' : ' 12%') + ', var(--panel))');
  } else { akar.removeProperty('--aksen'); akar.removeProperty('--aksen-lembut'); }
}
const merek = () => { const i = identitas(); return [h('img', {class: 'logo', src: i.logo, alt: ''}), i.nama, i.badan && h('span', null, '· ' + i.badan)]; };

function render() {
  if (!S.user) return renderMasuk();
  if (!S.user.aktif) return renderMenunggu();
  const r = rute();
  terapkanIdentitas();
  const aktif = menuAktif(r);
  const nav = h('nav', {class: 'nav', id: 'nav', 'aria-label': 'Menu utama'});
  let grupSekarang;
  for (const m of MENU.filter(menuTampil)) {
    if (m.grup && m.grup !== grupSekarang) { grupSekarang = m.grup; nav.append(h('div', {class: 'nav-grup'}, m.grup)); }
    nav.append(tautanNav(m, aktif === m.k, jumlahMenu(m)));
  }

  const utama = h('main', {class: 'utama', id: 'utama'});
  const tabel = r.startsWith('t-') ? r.slice(2) : null;
  if (tabel && TABEL[tabel] && !TABEL[tabel].tersembunyi && bolehAkses(tabel)) ({klien: renderKlien, sdm: renderSdm}[tabel] || renderTabel)(utama, tabel);
  else if (r.startsWith('sdm-') && bolehAkses('sdm')) renderDetailPegawai(utama, r.slice(4));
  else if (r.startsWith('klien-') && bolehAkses('klien')) renderDetailKlien(utama, r.slice(6));
  else if (r === 'vendor-tukang' && hak('vendor')) renderVendor(utama);
  else if (r === 'supplier' && hak('supplier')) renderSupplier(utama);
  else if (r === 'barang' && hak('barang')) renderBarang(utama);
  else if (r.startsWith('barang-') && hak('barang')) renderDetailBarang(utama, r.slice(7));
  else if (r === 'kas' && hak('kas')) renderKas(utama);
  else if (r.startsWith('kas-') && hak('kas')) renderMutasi(utama, r.slice(4));
  else if (r === 'jurnal' && hak('jurnal')) renderJurnal(utama);
  else if (r === 'kontrak' && hak('kontrak')) renderKontrak(utama);
  else if (r === 'pihak-proyek' && hak('pihak_proyek')) renderPihakProyek(utama);
  else if (r.startsWith('pihak-proyek-') && hak('pihak_proyek')) renderDetailPihak(utama, r.slice(13));
  else if (r === 'pembelian' && hak('pembelian')) renderPembelian(utama);
  else if (r.startsWith('pembelian-') && hak('pembelian')) renderDetailPembelian(utama, r.slice(10));
  else if (r.startsWith('proyek-') && bolehAkses('proyek')) renderDetailProyek(utama, r.slice(7), {bukaForm});
  else if (r === 't-vendor' || r === 'segera-pembelian') { history.replaceState(null, '', r === 't-vendor' ? '#pihak-proyek' : '#pembelian'); return render(); }
  else if (r.startsWith('kontrak-') && (hak('kontrak') || hak('termin'))) renderDetailKontrak(utama, r.slice(8));
  else if (r === 'piutang' && hak('termin')) renderPiutang(utama);
  else if (r.startsWith('piutang-') && hak('termin')) {
    // Tautan ke satu tagihan: buka daftarnya, tampilkan dialog tagihan itu, lalu kembalikan alamat ke daftar.
    history.replaceState(null, '', '#piutang');
    renderPiutang(utama, r.slice(8));
  }
  else if (r === 't-kontrak' || r === 't-termin') { history.replaceState(null, '', r === 't-kontrak' ? '#kontrak' : '#piutang'); return render(); }
  else if (r === 'rab' && hak('rab') && modulAktif('rab')) renderSegera(utama, menuDari('rab'));
  else if (r.startsWith('segera-') && menuDari(r.slice(7)) && hak(r.slice(7))) renderSegera(utama, menuDari(r.slice(7)));
  else if (r.startsWith('pengaturan') && (hak('pengaturan') || hak('kas') || hak('jurnal') || S.user.super_admin)) renderPengaturan(utama, r.slice(11));
  else renderDashboard(utama);

  akar.replaceChildren(...[
    h('header', {class: 'atas'},
      h('button', {class: 'tombol-menu', type: 'button', 'aria-label': 'Buka menu', 'aria-controls': 'nav', onclick: () => document.body.classList.toggle('nav-buka')}, '☰'),
      h('a', {class: 'merek', href: '#dashboard'}, merek()),
      h('div', {class: 'atas-kanan'},
        lonceng(),
        h('span', {class: 'pengguna'}, S.user.email, ' · ', namaPeran()),
        store.mode === 'supabase' && h('button', {class: 'btn btn-halus', type: 'button', onclick: aman(async () => { await store.keluar(); S.user = null; render(); })}, 'Keluar'))),
    store.mode === 'lokal' && h('div', {class: 'pita'}, 'Mode demo: data hanya tersimpan di browser ini dan tidak terlihat oleh orang lain. Sambungkan Supabase di js/config.js untuk data bersama.'),
    h('div', {class: 'badan'}, nav, utama)].filter(Boolean));
  document.body.classList.remove('nav-buka');
  buangTeksPalsu(akar);
}
S.render = render;
const tautanNav = (m, aktif, jumlah) => h('a', {href: '#' + m.ke, title: m.judul || null, class: 'nav-item' + (aktif ? ' aktif' : ''), 'aria-current': aktif ? 'page' : null},
  h('span', null, m.label), m.segera ? h('span', {class: 'label-segera'}, 'Segera') : jumlah != null && h('span', {class: 'nav-jml'}, String(jumlah)));

// Menu yang belum dibangun.
const TEKS_SEGERA = {rab: 'Modul ini sedang dikembangkan. Nantinya RAB dan penawaran dapat disusun dengan memakai database harga dari menu Barang & Harga.'};
function renderSegera(el, m) {
  el.append(h('div', {class: 'kepala'}, h('h1', null, m.label), m.judul && h('p', {class: 'redup'}, m.judul)),
    h('div', {class: 'kartu kosong-ajakan'}, h('h2', null, 'Dalam pengembangan'),
      h('p', null, TEKS_SEGERA[m.k] || 'Menu ini sedang dikembangkan dan akan tersedia pada tahap berikutnya.')));
}

// ---------- masuk ----------
function renderMasuk() {
  const galat = h('p', {class: 'form-galat', role: 'alert'});
  const email = h('input', {id: 'masuk-email', type: 'email', required: true, autocomplete: 'username'});
  const sandi = h('input', {id: 'masuk-sandi', type: 'password', required: true, minlength: '8', autocomplete: 'current-password'});
  const jalankan = (aksi) => sekali(async () => {
    galat.textContent = '';
    if (!email.reportValidity() || !sandi.reportValidity()) return;
    try {
      if (aksi === 'masuk') S.user = await store.masuk(email.value.trim(), sandi.value);
      else {
        const hasil = await store.daftar(email.value.trim(), sandi.value);
        S.user = store.user;
        if (hasil.perluKonfirmasiEmail) { galat.textContent = 'Akun dibuat. Buka email Anda dan klik tautan konfirmasi, lalu masuk di sini.'; return; }
      }
      if (S.user?.aktif) await mulaiSesi();
      render();
    } catch (e) { galat.textContent = e.message; }
  });
  terapkanIdentitas();
  const i = identitas();
  akar.replaceChildren(h('div', {class: 'tengah'}, h('form', {class: 'kartu kartu-masuk', onsubmit: jalankan('masuk')},
    h('div', {class: 'masuk-merek'}, h('img', {class: 'logo logo-besar', src: i.logo, alt: ''}), h('div', null, h('h1', null, i.nama), i.badan && h('p', {class: 'redup'}, i.badan))),
    h('p', {class: 'redup'}, 'Masuk untuk membuka data back office dan proyek.'),
    h('label', {for: 'masuk-email'}, 'Email'), email,
    h('label', {for: 'masuk-sandi'}, 'Kata sandi'), sandi,
    galat,
    h('button', {class: 'btn btn-utama', type: 'submit'}, 'Masuk'),
    h('button', {class: 'btn btn-halus', type: 'button', onclick: jalankan('daftar')}, 'Daftar akun baru'),
    h('p', {class: 'redup kecil'}, 'Akun baru belum bisa melihat data sampai diaktifkan oleh admin.'))));
}
function renderMenunggu() {
  akar.replaceChildren(h('div', {class: 'tengah'}, h('div', {class: 'kartu kartu-masuk'},
    h('h1', null, 'Menunggu aktivasi'),
    h('p', null, 'Akun ', h('b', null, S.user.email), ' sudah terdaftar tetapi belum diaktifkan. Minta super admin ' + identitas().nama + ' mengaktifkannya di Pengaturan → Pengguna & peran.'),
    h('button', {class: 'btn btn-utama', type: 'button', onclick: aman(async () => { S.user = await store.init(); if (S.user?.aktif) await mulaiSesi(); render(); })}, 'Periksa lagi'),
    h('button', {class: 'btn btn-halus', type: 'button', onclick: aman(async () => { await store.keluar(); S.user = null; render(); })}, 'Keluar'))));
}

// ---------- dashboard ----------
const ubin = (label, nilai, kaki) => h('div', {class: 'ubin'}, h('span', {class: 'ubin-label'}, label), h('span', {class: 'ubin-nilai'}, nilai), h('span', {class: 'ubin-kaki'}, kaki));
const tabelSederhana = (judul, rows, kosongTeks) => h('div', {class: 'gulir'}, h('table', {class: 'tabel'},
  h('thead', null, h('tr', null, judul.map(([label, kanan]) => h('th', {class: kanan ? 'kanan' : null}, label)))),
  h('tbody', null, rows.length ? rows.map((sel) => h('tr', null, sel.map((s, i) => h('td', {class: judul[i][1] ? 'kanan' : null}, s))))
    : h('tr', null, h('td', {colspan: String(judul.length), class: 'redup'}, kosongTeks)))));
const duaBaris = (atas, bawah) => [h('span', null, atas), h('span', {class: 'kecil redup blok'}, bawah)];

function renderDashboard(el) {
  const d = S.d, r = ringkasan(d);
  const admin = hak('kontrak') != null || hak('termin') != null;
  const adaData = NAMA_TABEL.some((t) => S.db[t].length) || S.keu.rekening.length;
  el.append(h('div', {class: 'kepala'}, h('h1', null, 'Dashboard'), h('p', {class: 'redup'}, 'Per ' + tgl(hariIni()) + '. Semua angka dihitung langsung dari data yang tersimpan.')));
  if (!adaData) {
    el.append(h('div', {class: 'kartu'}, h('h2', null, 'Belum ada data'),
      h('p', null, 'Mulai dengan melengkapi profil perusahaan dan rekening Kas & Bank, lalu isi proyek dan klien. Data yang sudah ada di Excel bisa diimpor per menu (contoh: Klien → Impor).'),
      h('div', {class: 'baris-tombol'},
        hak('pengaturan') && h('a', {class: 'btn btn-utama', href: '#pengaturan-profil'}, 'Isi profil perusahaan'),
        bisaUbah('kas') && h('a', {class: 'btn', href: '#kas'}, 'Tambah rekening'),
        bisaUbah('proyek') && h('a', {class: 'btn', href: '#t-proyek'}, 'Tambah proyek pertama'))));
    return;
  }
  const ub = [];
  if (admin) ub.push(
    ubin('Nilai kontrak', rpRingkas(r.nilai_kontrak), r.jumlah_kontrak + ' kontrak tercatat'),
    ubin('Sudah diterima', rpRingkas(r.diterima), persen(r.pct_diterima) + ' dari nilai kontrak'),
    ubin('Piutang', rpRingkas(r.piutang), 'sudah ditagih, belum dibayar'),
    ubin('Belum ditagih', rpRingkas(r.belum_ditagih), 'sisa nilai kontrak'));
  if (hak('sdm') && S.db.sdm.length) ub.push(h('a', {class: 'ubin ubin-tautan', href: '#t-sdm', onclick: () => { S.saringSdm = {aktif: 'Aktif', status: '', peringatan: r.sdm_peringatan > 0}; }},
    h('span', {class: 'ubin-label'}, 'Peringatan SDM'), h('span', {class: 'ubin-nilai'}, String(r.sdm_peringatan)),
    h('span', {class: 'ubin-kaki'}, r.sdm_peringatan ? r.sdm_pegawai_peringatan + ' pegawai · kontrak, SKK/STRA, magang' : 'tidak ada yang perlu ditindaklanjuti')));
  ub.push(
    ubin('Proyek berjalan', String(r.proyek_berjalan), r.proyek_terlambat + ' terlambat, dari ' + r.proyek_total + ' proyek tercatat'),
    ubin('Masalah terbuka', String(r.masalah_terbuka), r.masalah_tinggi + ' berdampak tinggi, ' + r.masalah_lewat + ' lewat target'));
  if (!admin) ub.push(ubin('Rata-rata progres', persen(r.rata_progres), 'proyek berjalan'), ubin('Terlambat ringan', String(r.proyek_terlambat_ringan), 'proyek berjalan'));
  el.append(h('section', {class: 'ubin-grid', 'aria-label': 'Angka utama'}, ub));

  if (admin) {
    const komposisi = h('div', {class: 'bagan'}, d.kontrak.slice().sort((a, b) => b.total - a.total).map((k) => h('div', {class: 'bagan-baris'},
      h('div', {class: 'bagan-kepala'}, h('span', null, k.nama_proyek), h('span', null, rpRingkas(k.total) + ' · ' + persen(k.pct_terbayar) + ' diterima')),
      h('div', {class: 'batang'}, [['diterima', 'Diterima', 'seg-diterima'], ['piutang', 'Piutang', 'seg-piutang'], ['belum_ditagih', 'Belum ditagih', 'seg-belum']].map(([f, label, cls]) =>
        k.total > 0 && k[f] > 0 && h('div', {class: 'seg ' + cls, style: {width: (k[f] / k.total * 100) + '%'}, title: label + ': ' + rp(k[f]) + ' (' + persen(k[f] / k.total) + ')'}))))));
    const maks = Math.max(1, ...r.umur.map((u) => u.sisa));
    const umur = h('div', {class: 'bagan'}, r.umur.map((u) => h('div', {class: 'bagan-baris'},
      h('div', {class: 'bagan-kepala'}, h('span', null, u.kelompok === 'Belum jatuh tempo' ? u.kelompok : (u.kelompok === '>90' ? 'Lebih dari 90' : u.kelompok) + ' hari lewat'), h('span', null, rpRingkas(u.sisa) + ' · ' + u.jumlah + ' invoice')),
      h('div', {class: 'batang'}, u.sisa > 0 && h('div', {class: 'seg ' + (u.kelompok === 'Belum jatuh tempo' ? 'seg-diterima' : 'seg-piutang'), style: {width: (u.sisa / maks * 100) + '%'}})))));
    const tagihan = d.termin.filter((t) => t.no_invoice && t.sisa > 0).sort((a, b) => n(b.umur) - n(a.umur));
    el.append(h('section', {class: 'bagian'}, h('h2', null, 'Uang masuk per kontrak dan piutang'),
      h('div', {class: 'dua'},
        h('div', {class: 'kartu'}, h('h3', null, 'Bagian nilai kontrak yang sudah diterima'),
          h('div', {class: 'legenda'}, h('span', null, h('i', {class: 'sw seg-diterima'}), 'Diterima'), h('span', null, h('i', {class: 'sw seg-piutang'}), 'Piutang'), h('span', null, h('i', {class: 'sw seg-belum'}), 'Belum ditagih')),
          d.kontrak.length ? komposisi : h('p', {class: 'redup'}, 'Belum ada kontrak.')),
        h('div', {class: 'kartu'}, h('h3', null, 'Piutang menurut umur sejak jatuh tempo'), umur)),
      h('h3', null, 'Tagihan yang belum lunas'),
      tabelSederhana([['Proyek'], ['No. invoice'], ['Syarat tagih'], ['Jatuh tempo'], ['Sisa', 1], ['Umur (hari)', 1], ['Status']],
        tagihan.map((t) => [t.nama_proyek, h('a', {href: '#piutang-' + t.id}, t.no_invoice), isi(t.milestone), tgl(t.jatuh_tempo), rp(t.sisa), t.umur > 0 ? String(t.umur) : '—', pill(t.status)]), 'Tidak ada tagihan yang menunggu pembayaran.')));
  }

  const urutJadwal = {'Terlambat': 0, 'Terlambat ringan': 1, 'Data belum lengkap': 2, 'Sesuai jadwal': 3, 'Selesai': 4};
  const proyek = d.proyek.slice().sort((a, b) => (urutJadwal[a.status_jadwal] ?? 3) - (urutJadwal[b.status_jadwal] ?? 3) || n(b.mundur) - n(a.mundur));
  el.append(h('section', {class: 'bagian'}, h('h2', null, 'Progres dan jadwal proyek'),
    tabelSederhana([['Proyek'], ['PIC'], ['Tahap sekarang'], ['Progres'], ['Target kontrak'], ['Mundur (hari)', 1], ['Status'], ['Jadwal']],
      proyek.map((p) => [duaBaris(p.nama, p.kode + ' · ' + isi(p.layanan)), isi(p.pic), isi(p.tahap_sekarang), batangProgres(p.progres), tgl(p.target), isi(p.mundur), pill(p.status), pill(p.status_jadwal)]), 'Belum ada proyek.')));

  const urutDampak = {'Tinggi': 0, 'Sedang': 1, 'Rendah': 2};
  const masalah = d.masalah.filter((m) => m.status !== 'Selesai').sort((a, b) => (urutDampak[a.dampak] ?? 3) - (urutDampak[b.dampak] ?? 3) || n(b.umur) - n(a.umur));
  el.append(h('section', {class: 'bagian'}, h('h2', null, 'Masalah dan risiko yang belum selesai'),
    tabelSederhana([['Proyek'], ['Masalah dan tindakan'], ['Dampak'], ['PIC'], ['Target selesai'], ['Umur (hari)', 1], ['Target']],
      masalah.map((m) => [m.nama_proyek, duaBaris(m.uraian, 'Tindakan: ' + isi(m.tindakan)), pill(m.dampak), isi(m.pic), tgl(m.target), isi(m.umur), m.lewat ? pill('LEWAT') : 'Belum lewat']), 'Tidak ada masalah terbuka.')));

  if (admin && hak('hutang_lain') && modulAktif('hutang_lain')) {
    el.append(h('section', {class: 'bagian'}, h('h2', null, 'Hutang dan kewajiban'),
      h('div', {class: 'ubin-grid'},
        ubin('Hutang ke vendor / tukang', rpRingkas(r.hutang_vendor), 'retensi ditahan ' + rpRingkas(r.retensi)),
        ubin('Hutang supplier', rpRingkas(r.hutang_supplier || 0), 'pembelian tempo belum lunas'),
        ubin('Kewajiban lain', rpRingkas(r.hutang_lain), 'sisa di luar vendor proyek'),
        ubin('Gaji + tunjangan', rpRingkas(r.gaji_bulanan), 'per bulan'),
        ubin('Nilai buku aset', rpRingkas(r.nilai_buku_aset), 'perkiraan, garis lurus')),
      tabelSederhana([['Kreditur'], ['Uraian'], ['Sisa', 1], ['Jatuh tempo berikut'], ['Peringatan']],
        d.hutang_lain.slice().sort((a, b) => String(a.jatuh_tempo).localeCompare(String(b.jatuh_tempo))).map((x) => [isi(x.kreditur), isi(x.uraian), rp(x.sisa), tgl(x.jatuh_tempo), x.alert ? pill(x.alert) : 'Tidak ada']), 'Tidak ada kewajiban lain.')));
  }

  const tm = temuan(d, tgl);
  el.append(h('section', {class: 'bagian'}, h('h2', null, 'Yang perlu ditindaklanjuti'),
    tabelSederhana([['Area'], ['Temuan'], ['Jumlah', 1], ['Rincian']], tm.map((b) => [b.area, b.hal, String(b.jumlah), b.rincian]), 'Tidak ada temuan.')));
}

// ---------- daftar per tabel ----------
const urutkan = (rows, urut) => {
  if (!urut) return rows;
  const kunci = [].concat(urut);
  return rows.slice().sort((a, b) => {
    for (const k0 of kunci) {
      const turun = k0.startsWith('-'), k = turun ? k0.slice(1) : k0;
      const c = String(a[k] ?? '').localeCompare(String(b[k] ?? ''), 'id', {numeric: true});
      if (c) return turun ? -c : c;
    }
    return 0;
  });
};

function renderTabel(el, nama) {
  const def0 = TABEL[nama];
  // Tahap 4: daftar proyek menampilkan saldo dompet (bagi yang boleh membaca keuangan proyek).
  const dompetTampil = nama === 'proyek' && bacaKeuangan() && S.keu.siap && S.keu.proyek_siap !== false;
  const def = dompetTampil ? {...def0, kolom: [...def0.kolom, ['saldo_dompet', 'Saldo dompet', 'uang']]} : def0;
  const baris = (r) => (dompetTampil ? {...r, saldo_dompet: S.d.dompet[r.kode]?.saldo ?? null} : r);
  const adaProyek = def.isian.some((f) => f.t === 'proyek');
  const badan = h('tbody');
  const hitungan = h('span', {class: 'redup kecil'});
  const gambar = () => {
    const q = S.cari.trim().toLowerCase();
    let rows = urutkan(S.d[nama], def.urut);
    if (adaProyek && S.filterProyek) rows = rows.filter((r) => r.kode === S.filterProyek);
    if (q) rows = rows.filter((r) => def.kolom.some(([k]) => String(r[k] ?? '').toLowerCase().includes(q)) || def.isian.some((f) => String(r[f.k] ?? '').toLowerCase().includes(q)));
    hitungan.textContent = rows.length + ' dari ' + S.d[nama].length + ' ' + def.satuan;
    badan.replaceChildren(...(rows.length ? rows.map(baris).map((r) => {
      const buka = nama === 'proyek' ? () => { location.hash = '#proyek-' + r.id; } : () => bukaForm(nama, S.db[nama].find((x) => x.id === r.id));
      return h('tr', {class: 'bisa-klik', tabindex: '0', onclick: buka, onkeydown: (ev) => { if (ev.key === 'Enter') buka(); }},
        def.kolom.map(([k, , f]) => h('td', {class: (RATA_KANAN.includes(f) ? 'kanan ' : '') + (f === 'lebar' ? 'lebar' : '')}, f && FORMAT[f] ? FORMAT[f](r[k]) : isi(r[k]))));
    }) : [h('tr', null, h('td', {colspan: String(def.kolom.length), class: 'redup'}, S.d[nama].length ? 'Tidak ada baris yang cocok dengan pencarian.' : 'Belum ada data. Klik Tambah untuk mengisi baris pertama.'))]));
  };
  const cari = h('input', {id: 'cari', type: 'search', placeholder: 'Cari…', 'aria-label': 'Cari di tabel', value: S.cari, oninput: (ev) => { S.cari = ev.target.value; gambar(); }});
  const saring = adaProyek && h('select', {id: 'saring-proyek', 'aria-label': 'Saring menurut proyek', onchange: (ev) => { S.filterProyek = ev.target.value; gambar(); }},
    h('option', {value: ''}, 'Semua proyek'), urutkan(S.db.proyek, 'kode').map((p) => h('option', {value: p.kode, selected: p.kode === S.filterProyek}, p.kode + ' — ' + isi(p.nama))));
  const m = menuDari(MENU.find((x) => x.tabel === nama)?.k);
  el.append(h('div', {class: 'kepala'}, h('h1', null, m?.label || def.label), h('p', {class: 'redup'}, (m?.judul ? m.judul + '. ' : '') + def.bantuan)));
  if (nama === 'kontrak') {
    S.tabKontrak = S.tabKontrak || 'klien';
    el.append(h('div', {class: 'tabs', role: 'tablist'}, [['klien', 'Klien'], ['vendor', 'Vendor']].map(([k, l]) => h('button', {class: 'tab', type: 'button', role: 'tab', 'aria-selected': String(S.tabKontrak === k), onclick: () => { S.tabKontrak = k; render(); }}, l))));
    if (S.tabKontrak === 'vendor') { history.replaceState(null, '', '#kontrak'); return render(); }
  }
  el.append(
    h('div', {class: 'alat'}, cari, saring, hitungan, h('span', {class: 'pegas'}),
      nama === 'tahap' && bolehUbahTabel('tahap') && h('button', {class: 'btn', type: 'button', onclick: () => bukaTahapMassal()}, 'Tambah semua tahap proyek'),
      bolehUbahTabel(nama) && h('button', {class: 'btn btn-utama', type: 'button', onclick: () => bukaForm(nama, null)}, 'Tambah ' + def.satuan)),
    h('div', {class: 'gulir'}, h('table', {class: 'tabel'}, h('thead', null, h('tr', null, def.kolom.map(([, label, f]) => h('th', {class: RATA_KANAN.includes(f) ? 'kanan' : null}, label)))), badan)),
    dompetTampil && ringkasTitipanDipinjamkan());
  gambar();
}

// ---------- formulir ----------
// Proyek yang sudah dipakai data keuangan tidak boleh dihapus / diganti kodenya. Mengembalikan teks pemakainya, atau ''.
function dipakaiKeuangan(kode) {
  const K = S.keu, kk = S.d.kontrak.filter((k) => k.kode === kode);
  return [kk.length && 'kontrak klien ' + kk.map((k) => k.no_kontrak).join(', '),
    (K.kontrak_vendor || []).some((x) => x.proyek_kode === kode) && 'kontrak vendor',
    (K.pembelian || []).some((x) => x.proyek_kode === kode) && 'pembelian material',
    (K.pinjaman_proyek || []).some((x) => x.dari_proyek === kode || x.ke_proyek === kode) && 'pinjaman antar proyek',
    (K.kas_transaksi || []).some((x) => x.proyek_kode === kode) && 'transaksi kas'].filter(Boolean).join(', ');
}
const nilaiUnik = (tabel, k) => [...new Set((S.db[tabel] || []).map((r) => r[k]).filter((v) => !kosong(v)))].sort((a, b) => String(a).localeCompare(String(b), 'id'));
const pilihan = (id, daftar, nilai, wajib) => {
  const semua = kosong(nilai) || daftar.some((o) => o[0] === nilai) ? daftar : daftar.concat([[nilai, nilai + ' (tidak ada di daftar)']]);
  return h('select', {id, required: wajib}, h('option', {value: ''}, wajib ? 'Pilih…' : '—'), semua.map(([v, label]) => h('option', {value: v, selected: v === nilai}, label)));
};

function buatMasukan(f, nilai, tabel, ctx = {}) {
  const id = 'f-' + f.k;
  if (f.t === 'timproyek') return (ctx.editor = editorTimProyek(id, nilai, ctx.baris?.tim_pendukung));
  if (f.t === 'anggota') return pilihAnggota(id, nilai, f.wajib, ctx.editor);
  if (f.t === 'catatan') return h('textarea', {id, rows: '2', required: f.wajib}, nilai ?? '');
  if (f.t === 'pilih' || f.t === 'yt') return pilihan(id, OPSI[f.t === 'yt' ? 'yt' : f.opsi].map((o) => [o, o]), nilai, f.wajib);
  if (f.t === 'proyek') return pilihan(id, urutkan(S.db.proyek, 'kode').map((p) => [p.kode, p.kode + ' — ' + isi(p.nama)]), nilai, f.wajib);
  if (f.t === 'klien') return pilihKlien(id, nilai, bisaUbah('klien'), f.wajib);
  if (f.t === 'tim') return pilihan(id, namaTimInternal().map((x) => [x, x]), nilai, f.wajib);
  if (f.t === 'tanggal') return h('input', {id, type: 'date', value: nilai ?? '', required: f.wajib});
  if (['hp', 'email', 'npwp'].includes(f.t)) return kotakCek(h('input', {id, type: 'text', value: nilai ?? '', required: f.wajib, autocomplete: 'off'}), f.t, f.bantuan);
  if (f.t === 'angka') return h('input', {id, type: 'number', step: 'any', value: nilai ?? '', required: f.wajib});
  if (f.t === 'persen') return h('div', {class: 'berakhiran'}, h('input', {id, type: 'number', step: 'any', min: '0', value: kosong(nilai) ? '' : String(+(n(nilai) * 100).toFixed(4)), required: f.wajib}), h('span', null, '%'));
  if (f.t === 'uang') {
    const inp = h('input', {id, type: 'text', inputmode: 'numeric', value: kosong(nilai) ? '' : idn(Math.round(n(nilai))), required: f.wajib, autocomplete: 'off', oninput: () => { inp.value = formatUang(inp.value); }});
    return h('div', {class: 'berawalan'}, h('span', null, 'Rp'), inp);
  }
  const saran = f.saran ? nilaiUnik(tabel, f.k) : null;
  return [h('input', {id, type: 'text', value: nilai ?? '', required: f.wajib, placeholder: f.contoh, pattern: f.pola, list: saran ? id + '-saran' : null, autocomplete: 'off'}),
    saran && h('datalist', {id: id + '-saran'}, saran.map((s) => h('option', {value: s})))];
}
function bacaMasukan(f, form) {
  if (f.t === 'timproyek') { const tim = form.querySelector('#f-' + f.k).nilaiTim(); return tim.length ? tim : null; }
  const v = form.querySelector('#f-' + f.k).value.trim();
  if (v === '') return null;
  if (['hp', 'email', 'npwp'].includes(f.t)) return periksaIsian(f.t, v).nilai ?? null;
  if (f.t === 'angka') return +v;
  if (f.t === 'persen') return +(+v / 100).toFixed(6);
  if (f.t === 'uang') return +v.replace(/\./g, '').replace(/[^\d-]/g, '');
  return v;
}

function bukaForm(tabel, baris, awal = null) {
  const def = TABEL[tabel];
  const galat = h('p', {class: 'form-galat', role: 'alert'});
  let dlg, yakin = false;
  const hapus = baris && h('button', {class: 'btn btn-bahaya', type: 'button', onclick: aman(async () => {
    if (tabel === 'proyek' && dipakaiKeuangan(baris.kode)) throw new Error('Proyek ' + baris.kode + ' sudah dipakai ' + dipakaiKeuangan(baris.kode) + ', jadi tidak bisa dihapus.');
    if (!yakin) { yakin = true; hapus.textContent = 'Klik lagi untuk menghapus'; return; }
    await store.hapus(baris.id);
    await muatData(); dlg.close(); render(); pesan(def.label + ': baris dihapus.');
  })}, 'Hapus');
  const simpan = h('button', {class: 'btn btn-utama', type: 'submit'}, 'Simpan');
  const bisa = bolehUbahTabel(tabel);
  const ctx = {baris};
  const form = h('form', {class: 'form', onsubmit: async (ev) => {
    ev.preventDefault();
    galat.textContent = '';
    const salah = cekSemua(form);
    if (salah) { galat.textContent = 'Perbaiki dulu isian yang bertanda ✕.'; salah.focus(); return; }
    const galatTim = ctx.editor?.periksa();
    if (galatTim) { galat.textContent = galatTim; return; }
    // Kolom yang tidak ada di formulir (misalnya data lama hasil impor) tetap disimpan.
    const data = bersih(baris || {});
    for (const f of def.isian) {
      const v = bacaMasukan(f, form);
      if (v != null) data[f.k] = v; else delete data[f.k];
      if (f.t === 'klien' && f.wajib && v == null) {
        galat.textContent = 'Klien wajib dipilih dari daftar' + (bisaUbah('klien') ? '. Jika belum ada, pakai "+ Tambah klien baru".' : '. Jika belum ada, minta admin menambahkannya di menu Klien.');
        form.querySelector('#f-klien_id-cari')?.focus();
        return;
      }
      if (f.unik && v != null && S.db[tabel].some((r) => r.id !== baris?.id && String(r[f.k]).toLowerCase() === String(v).toLowerCase())) {
        galat.textContent = f.label + ' "' + v + '" sudah dipakai.';
        return;
      }
    }
    if (tabel === 'proyek' && baris && data.kode !== baris.kode && dipakaiKeuangan(baris.kode)) {
      galat.textContent = 'Kode proyek tidak bisa diubah karena sudah dipakai ' + dipakaiKeuangan(baris.kode) + '.';
      return;
    }
    simpan.disabled = true; simpan.textContent = 'Menyimpan…';
    try {
      await store.simpan(tabel, baris?.id, data);
      await muatData(); dlg.close(); render(); pesan(def.label + ': tersimpan.');
    } catch (e) { galat.textContent = e.message; simpan.disabled = false; simpan.textContent = 'Simpan'; }
  }},
    h('div', {class: 'form-grid'}, def.isian.map((f) => h('div', {class: 'medan' + (['catatan', 'timproyek'].includes(f.t) ? ' medan-lebar' : '')},
      h('label', {for: f.t === 'timproyek' ? 'f-tim-orang' : 'f-' + f.k}, f.label, f.wajib && h('span', {class: 'wajib', title: 'Wajib diisi'}, ' *')),
      buatMasukan(f, f.t === 'klien' ? S.d[tabel].find((x) => x.id === baris?.id)?.klien_ref : baris ? baris[f.k] : awal?.[f.k], tabel, ctx),
      f.bantuan && !['hp', 'email', 'npwp'].includes(f.t) && h('span', {class: 'kecil redup'}, f.bantuan)))),
    tabel === 'proyek' && baris && (hak('kontrak') != null) && kontrakProyek(baris.kode),
    galat,
    h('div', {class: 'form-kaki'}, bisa && hapus, h('span', {class: 'pegas'}), h('button', {class: 'btn', type: 'button', onclick: () => dlg.close()}, bisa ? 'Batal' : 'Tutup'), bisa && simpan));
  if (!bisa) form.querySelectorAll('input,select,textarea,.kombo button').forEach((x) => { x.disabled = true; });
  dlg = dialog((bisa ? (baris ? 'Ubah ' : 'Tambah ') : '') + def.satuan, form);
  if (tabel === 'kontrak') {
    // Memilih proyek mengisi klien dari proyek itu bila klien kontrak masih kosong.
    const pilihProyek = form.querySelector('#f-kode'), klien = form.querySelector('#f-klien_id');
    pilihProyek.addEventListener('change', () => {
      const ref = S.d.proyek.find((p) => p.kode === pilihProyek.value)?.klien_ref;
      if (ref && !klien.value) klien.pilih(ref);
    });
  }
  if (tabel === 'tahap') {
    const pilihTahap = form.querySelector('#f-tahap'), bobot = form.querySelector('#f-bobot');
    pilihTahap.addEventListener('change', () => { const t = TAHAP.find((x) => x.nama === pilihTahap.value); if (t) bobot.value = String(+(t.bobot * 100).toFixed(4)); });
  }
}

function bukaTahapMassal() {
  const proyek = pilihan('m-proyek', urutkan(S.db.proyek, 'kode').map((p) => [p.kode, p.kode + ' — ' + isi(p.nama)]), S.filterProyek, true);
  const jumlah = h('select', {id: 'm-jumlah'}, h('option', {value: '4'}, '4 tahap (sampai Gambar Kerja)'), h('option', {value: '6'}, '6 tahap (sampai Pengawasan Berkala)'));
  const galat = h('p', {class: 'form-galat', role: 'alert'});
  const dlg = dialog('Tambah semua tahap proyek', h('form', {class: 'form', onsubmit: sekali(async () => {
    const kode = proyek.value, p = S.db.proyek.find((x) => x.kode === kode);
    const sudah = new Set(S.db.tahap.filter((t) => t.kode === kode).map((t) => t.tahap));
    const baru = TAHAP.slice(0, +jumlah.value).filter((t) => !sudah.has(t.nama)).map((t) => ({tabel: 'tahap', data: bersih({kode, tahap: t.nama, pic: p?.pic, bobot: t.bobot, selesai: 0})}));
    if (!baru.length) { galat.textContent = 'Semua tahap itu sudah ada untuk proyek ini.'; return; }
    try {
      await store.tambahBanyak(baru);
      S.filterProyek = kode;
      await muatData(); dlg.close(); render(); pesan(baru.length + ' tahap ditambahkan.');
    } catch (e) { galat.textContent = e.message; }
  })},
    h('p', {class: 'redup'}, 'Membuat satu baris per tahap dengan bobot default. Tahap yang sudah ada tidak digandakan.'),
    h('div', {class: 'form-grid'}, h('div', {class: 'medan'}, h('label', {for: 'm-proyek'}, 'Proyek'), proyek), h('div', {class: 'medan'}, h('label', {for: 'm-jumlah'}, 'Lingkup'), jumlah)),
    galat,
    h('div', {class: 'form-kaki'}, h('span', {class: 'pegas'}), h('button', {class: 'btn', type: 'button', onclick: () => dlg.close()}, 'Batal'), h('button', {class: 'btn btn-utama', type: 'submit'}, 'Tambah'))));
}

// ---------- mulai ----------
async function mulaiSesi() {
  await muatData();
  await muatStatusNotifikasi();
  periksaCadanganOtomatis();
}
window.addEventListener('hashchange', () => { S.cari = ''; if (S.user?.aktif) render(); });
(async () => {
  try {
    S.user = await store.init();
    if (S.user?.aktif) await mulaiSesi();
    else S.identitas = await store.keu.identitas().catch(() => ({}));
    render();
    mulaiPemeriksaanHarian();
  } catch (e) {
    console.error(e);
    akar.replaceChildren(h('div', {class: 'tengah'}, h('div', {class: 'kartu kartu-masuk'}, h('h1', null, 'Aplikasi gagal dimuat'),
      h('p', null, e.message || String(e)), h('p', {class: 'redup kecil'}, 'Periksa sambungan internet dan isi js/config.js, lalu muat ulang halaman.'))));
  }
})();
