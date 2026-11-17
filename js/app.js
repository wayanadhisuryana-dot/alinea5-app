import {TABEL, OPSI, TAHAP, NAMA_TABEL, bolehAkses} from './schema.js';
import {ringkasan, temuan, hariIni, n} from './calc.js';
import {store} from './store.js';
import {bacaExcel} from './import-excel.js';
import {S, muatData, bersih} from './state.js';
import {h, idn, rp, rpRingkas, persen, tgl, kosong, isi, pill, batangProgres, FORMAT, RATA_KANAN, pesan, aman, dialog} from './ui.js';
import {renderKlien, pilihKlien} from './klien.js';

const akar = document.getElementById('app');

// ---------- rute ----------
const rute = () => (location.hash.replace(/^#/, '') || 'dashboard');
const tabelBoleh = () => NAMA_TABEL.filter((t) => bolehAkses(t, S.user.role));

function render() {
  if (!S.user) return renderMasuk();
  if (!S.user.aktif) return renderMenunggu();
  const r = rute();
  const nav = h('nav', {class: 'nav', id: 'nav', 'aria-label': 'Menu utama'}, tautanNav('dashboard', 'Dashboard', r));
  const grup = {};
  for (const t of tabelBoleh()) (grup[TABEL[t].grup] ||= []).push(t);
  for (const [nama, daftar] of Object.entries(grup)) {
    nav.append(h('div', {class: 'nav-grup'}, nama), ...daftar.map((t) => tautanNav('t-' + t, TABEL[t].label, r, S.db[t].length)));
  }
  nav.append(h('div', {class: 'nav-grup'}, 'Lainnya'), tautanNav('pengaturan', 'Pengaturan', r));

  const utama = h('main', {class: 'utama', id: 'utama'});
  const tabel = r.startsWith('t-') ? r.slice(2) : null;
  if (tabel && TABEL[tabel] && bolehAkses(tabel, S.user.role)) (tabel === 'klien' ? renderKlien : renderTabel)(utama, tabel);
  else if (r === 'pengaturan') renderPengaturan(utama);
  else renderDashboard(utama);

  akar.replaceChildren(...[
    h('header', {class: 'atas'},
      h('button', {class: 'tombol-menu', type: 'button', 'aria-label': 'Buka menu', 'aria-controls': 'nav', onclick: () => document.body.classList.toggle('nav-buka')}, '☰'),
      h('a', {class: 'merek', href: '#dashboard'}, 'Alinea 5', h('span', null, 'Back office & proyek')),
      h('div', {class: 'atas-kanan'},
        h('span', {class: 'pengguna'}, S.user.email, ' · ', S.user.role === 'admin' ? 'Admin' : 'Arsitek'),
        store.mode === 'supabase' && h('button', {class: 'btn btn-halus', type: 'button', onclick: aman(async () => { await store.keluar(); S.user = null; render(); })}, 'Keluar'))),
    store.mode === 'lokal' && h('div', {class: 'pita'}, 'Mode demo: data hanya tersimpan di browser ini dan tidak terlihat oleh orang lain. Sambungkan Supabase di js/config.js untuk data bersama.'),
    h('div', {class: 'badan'}, nav, utama)].filter(Boolean));
  document.body.classList.remove('nav-buka');
}
S.render = render;
const tautanNav = (ke, label, aktif, jumlah) => h('a', {href: '#' + ke, class: 'nav-item' + (aktif === ke ? ' aktif' : ''), 'aria-current': aktif === ke ? 'page' : null}, h('span', null, label), jumlah != null && h('span', {class: 'nav-jml'}, String(jumlah)));

// ---------- masuk ----------
function renderMasuk() {
  const galat = h('p', {class: 'form-galat', role: 'alert'});
  const email = h('input', {id: 'masuk-email', type: 'email', required: true, autocomplete: 'username'});
  const sandi = h('input', {id: 'masuk-sandi', type: 'password', required: true, minlength: '8', autocomplete: 'current-password'});
  const jalankan = (aksi) => async (ev) => {
    ev.preventDefault();
    galat.textContent = '';
    if (!email.reportValidity() || !sandi.reportValidity()) return;
    try {
      if (aksi === 'masuk') S.user = await store.masuk(email.value.trim(), sandi.value);
      else {
        const hasil = await store.daftar(email.value.trim(), sandi.value);
        S.user = store.user;
        if (hasil.perluKonfirmasiEmail) { galat.textContent = 'Akun dibuat. Buka email Anda dan klik tautan konfirmasi, lalu masuk di sini.'; return; }
      }
      if (S.user?.aktif) await muatData();
      render();
    } catch (e) { galat.textContent = e.message; }
  };
  akar.replaceChildren(h('div', {class: 'tengah'}, h('form', {class: 'kartu kartu-masuk', onsubmit: jalankan('masuk')},
    h('h1', null, 'Alinea 5'),
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
    h('p', null, 'Akun ', h('b', null, S.user.email), ' sudah terdaftar tetapi belum diaktifkan. Minta admin Alinea 5 mengaktifkannya di menu Pengaturan.'),
    h('button', {class: 'btn btn-utama', type: 'button', onclick: aman(async () => { S.user = await store.init(); if (S.user?.aktif) await muatData(); render(); })}, 'Periksa lagi'),
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
  const d = S.d, r = ringkasan(d), admin = S.user.role === 'admin';
  const adaData = NAMA_TABEL.some((t) => S.db[t].length);
  el.append(h('div', {class: 'kepala'}, h('h1', null, 'Dashboard'), h('p', {class: 'redup'}, 'Per ' + tgl(hariIni()) + '. Semua angka dihitung langsung dari data yang tersimpan.')));
  if (!adaData) {
    el.append(h('div', {class: 'kartu'}, h('h2', null, 'Belum ada data'),
      h('p', null, 'Mulai dengan mengimpor dua file Excel Alinea 5, atau isi langsung dari menu Proyek.'),
      h('div', {class: 'baris-tombol'}, h('a', {class: 'btn btn-utama', href: '#pengaturan'}, 'Impor dari Excel'), h('a', {class: 'btn', href: '#t-proyek'}, 'Tambah proyek pertama'))));
    return;
  }
  const ub = [];
  if (admin) ub.push(
    ubin('Nilai kontrak', rpRingkas(r.nilai_kontrak), r.jumlah_kontrak + ' kontrak tercatat'),
    ubin('Sudah diterima', rpRingkas(r.diterima), persen(r.pct_diterima) + ' dari nilai kontrak'),
    ubin('Piutang', rpRingkas(r.piutang), 'sudah ditagih, belum dibayar'),
    ubin('Belum ditagih', rpRingkas(r.belum_ditagih), 'sisa nilai kontrak'));
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
      h('div', {class: 'bagan-kepala'}, h('span', null, (u.kelompok === '>90' ? 'Lebih dari 90' : u.kelompok) + ' hari'), h('span', null, rpRingkas(u.sisa) + ' · ' + u.jumlah + ' invoice')),
      h('div', {class: 'batang'}, u.sisa > 0 && h('div', {class: 'seg ' + (u.kelompok === '0-30' ? 'seg-diterima' : 'seg-piutang'), style: {width: (u.sisa / maks * 100) + '%'}})))));
    const tagihan = d.termin.filter((t) => t.tgl_invoice && t.sisa > 0).sort((a, b) => n(b.umur) - n(a.umur));
    el.append(h('section', {class: 'bagian'}, h('h2', null, 'Uang masuk per kontrak dan piutang'),
      h('div', {class: 'dua'},
        h('div', {class: 'kartu'}, h('h3', null, 'Bagian nilai kontrak yang sudah diterima'),
          h('div', {class: 'legenda'}, h('span', null, h('i', {class: 'sw seg-diterima'}), 'Diterima'), h('span', null, h('i', {class: 'sw seg-piutang'}), 'Piutang'), h('span', null, h('i', {class: 'sw seg-belum'}), 'Belum ditagih')),
          d.kontrak.length ? komposisi : h('p', {class: 'redup'}, 'Belum ada kontrak.')),
        h('div', {class: 'kartu'}, h('h3', null, 'Piutang menurut umur sejak jatuh tempo'), umur)),
      h('h3', null, 'Tagihan yang belum lunas'),
      tabelSederhana([['Proyek'], ['No. invoice'], ['Syarat tagih'], ['Jatuh tempo'], ['Sisa', 1], ['Umur (hari)', 1], ['Status']],
        tagihan.map((t) => [t.nama_proyek, isi(t.no_invoice), isi(t.milestone), tgl(t.jatuh_tempo), rp(t.sisa), isi(t.umur), pill(t.status)]), 'Tidak ada tagihan yang menunggu pembayaran.')));
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

  if (admin) {
    el.append(h('section', {class: 'bagian'}, h('h2', null, 'Hutang dan kewajiban'),
      h('div', {class: 'ubin-grid'},
        ubin('Hutang ke vendor / tukang', rpRingkas(r.hutang_vendor), 'retensi ditahan ' + rpRingkas(r.retensi)),
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
  const def = TABEL[nama];
  const adaProyek = def.isian.some((f) => f.t === 'proyek');
  const badan = h('tbody');
  const hitungan = h('span', {class: 'redup kecil'});
  const gambar = () => {
    const q = S.cari.trim().toLowerCase();
    let rows = urutkan(S.d[nama], def.urut);
    if (adaProyek && S.filterProyek) rows = rows.filter((r) => r.kode === S.filterProyek);
    if (q) rows = rows.filter((r) => def.kolom.some(([k]) => String(r[k] ?? '').toLowerCase().includes(q)) || def.isian.some((f) => String(r[f.k] ?? '').toLowerCase().includes(q)));
    hitungan.textContent = rows.length + ' dari ' + S.d[nama].length + ' ' + def.satuan;
    badan.replaceChildren(...(rows.length ? rows.map((r) => {
      const buka = () => bukaForm(nama, S.db[nama].find((x) => x.id === r.id));
      return h('tr', {class: 'bisa-klik', tabindex: '0', onclick: buka, onkeydown: (ev) => { if (ev.key === 'Enter') buka(); }},
        def.kolom.map(([k, , f]) => h('td', {class: (RATA_KANAN.includes(f) ? 'kanan ' : '') + (f === 'lebar' ? 'lebar' : '')}, f && FORMAT[f] ? FORMAT[f](r[k]) : isi(r[k]))));
    }) : [h('tr', null, h('td', {colspan: String(def.kolom.length), class: 'redup'}, S.d[nama].length ? 'Tidak ada baris yang cocok dengan pencarian.' : 'Belum ada data. Klik Tambah untuk mengisi baris pertama.'))]));
  };
  const cari = h('input', {id: 'cari', type: 'search', placeholder: 'Cari…', 'aria-label': 'Cari di tabel', value: S.cari, oninput: (ev) => { S.cari = ev.target.value; gambar(); }});
  const saring = adaProyek && h('select', {id: 'saring-proyek', 'aria-label': 'Saring menurut proyek', onchange: (ev) => { S.filterProyek = ev.target.value; gambar(); }},
    h('option', {value: ''}, 'Semua proyek'), urutkan(S.db.proyek, 'kode').map((p) => h('option', {value: p.kode, selected: p.kode === S.filterProyek}, p.kode + ' — ' + isi(p.nama))));
  el.append(
    h('div', {class: 'kepala'}, h('h1', null, def.label), h('p', {class: 'redup'}, def.bantuan)),
    h('div', {class: 'alat'}, cari, saring, hitungan, h('span', {class: 'pegas'}),
      nama === 'tahap' && h('button', {class: 'btn', type: 'button', onclick: () => bukaTahapMassal()}, 'Tambah semua tahap proyek'),
      h('button', {class: 'btn btn-utama', type: 'button', onclick: () => bukaForm(nama, null)}, 'Tambah ' + def.satuan)),
    h('div', {class: 'gulir'}, h('table', {class: 'tabel'}, h('thead', null, h('tr', null, def.kolom.map(([, label, f]) => h('th', {class: RATA_KANAN.includes(f) ? 'kanan' : null}, label)))), badan)));
  gambar();
}

// ---------- formulir ----------
const nilaiUnik = (tabel, k) => [...new Set((S.db[tabel] || []).map((r) => r[k]).filter((v) => !kosong(v)))].sort((a, b) => String(a).localeCompare(String(b), 'id'));
const pilihan = (id, daftar, nilai, wajib) => {
  const semua = kosong(nilai) || daftar.some((o) => o[0] === nilai) ? daftar : daftar.concat([[nilai, nilai + ' (tidak ada di daftar)']]);
  return h('select', {id, required: wajib}, h('option', {value: ''}, wajib ? 'Pilih…' : '—'), semua.map(([v, label]) => h('option', {value: v, selected: v === nilai}, label)));
};
const formatUang = (teks) => {
  const minus = /^\s*-/.test(teks), angka = teks.replace(/\D/g, '');
  return angka ? (minus ? '-' : '') + idn(angka) : '';
};

function buatMasukan(f, nilai, tabel) {
  const id = 'f-' + f.k;
  if (f.t === 'catatan') return h('textarea', {id, rows: '2', required: f.wajib}, nilai ?? '');
  if (f.t === 'pilih' || f.t === 'yt') return pilihan(id, OPSI[f.t === 'yt' ? 'yt' : f.opsi].map((o) => [o, o]), nilai, f.wajib);
  if (f.t === 'proyek') return pilihan(id, urutkan(S.db.proyek, 'kode').map((p) => [p.kode, p.kode + ' — ' + isi(p.nama)]), nilai, f.wajib);
  if (f.t === 'klien') return pilihKlien(id, nilai, S.user.role === 'admin');
  if (f.t === 'tim') return pilihan(id, nilaiUnik('tim', 'nama').map((x) => [x, x]), nilai, f.wajib);
  if (f.t === 'tanggal') return h('input', {id, type: 'date', value: nilai ?? '', required: f.wajib});
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
  const v = form.querySelector('#f-' + f.k).value.trim();
  if (v === '') return null;
  if (f.t === 'angka') return +v;
  if (f.t === 'persen') return +(+v / 100).toFixed(6);
  if (f.t === 'uang') return +v.replace(/\./g, '').replace(/[^\d-]/g, '');
  return v;
}

function bukaForm(tabel, baris) {
  const def = TABEL[tabel];
  const galat = h('p', {class: 'form-galat', role: 'alert'});
  let dlg, yakin = false;
  const hapus = baris && h('button', {class: 'btn btn-bahaya', type: 'button', onclick: aman(async () => {
    if (!yakin) { yakin = true; hapus.textContent = 'Klik lagi untuk menghapus'; return; }
    await store.hapus(baris.id);
    await muatData(); dlg.close(); render(); pesan(def.label + ': baris dihapus.');
  })}, 'Hapus');
  const simpan = h('button', {class: 'btn btn-utama', type: 'submit'}, 'Simpan');
  const form = h('form', {class: 'form', onsubmit: async (ev) => {
    ev.preventDefault();
    galat.textContent = '';
    const data = {};
    for (const f of def.isian) {
      const v = bacaMasukan(f, form);
      if (v != null) data[f.k] = v;
      if (f.unik && v != null && S.db[tabel].some((r) => r.id !== baris?.id && String(r[f.k]).toLowerCase() === String(v).toLowerCase())) {
        galat.textContent = f.label + ' "' + v + '" sudah dipakai.';
        return;
      }
    }
    simpan.disabled = true; simpan.textContent = 'Menyimpan…';
    try {
      await store.simpan(tabel, baris?.id, data);
      await muatData(); dlg.close(); render(); pesan(def.label + ': tersimpan.');
    } catch (e) { galat.textContent = e.message; simpan.disabled = false; simpan.textContent = 'Simpan'; }
  }},
    h('div', {class: 'form-grid'}, def.isian.map((f) => h('div', {class: 'medan' + (f.t === 'catatan' ? ' medan-lebar' : '')},
      h('label', {for: 'f-' + f.k}, f.label, f.wajib && h('span', {class: 'wajib', title: 'Wajib diisi'}, ' *')),
      buatMasukan(f, f.t === 'klien' ? S.d[tabel].find((x) => x.id === baris?.id)?.klien_ref : baris?.[f.k], tabel),
      f.bantuan && h('span', {class: 'kecil redup'}, f.bantuan)))),
    galat,
    h('div', {class: 'form-kaki'}, hapus, h('span', {class: 'pegas'}), h('button', {class: 'btn', type: 'button', onclick: () => dlg.close()}, 'Batal'), simpan));
  dlg = dialog((baris ? 'Ubah ' : 'Tambah ') + def.satuan, form);
  if (tabel === 'tahap') {
    const pilihTahap = form.querySelector('#f-tahap'), bobot = form.querySelector('#f-bobot');
    pilihTahap.addEventListener('change', () => { const t = TAHAP.find((x) => x.nama === pilihTahap.value); if (t) bobot.value = String(+(t.bobot * 100).toFixed(4)); });
  }
}

function bukaTahapMassal() {
  const proyek = pilihan('m-proyek', urutkan(S.db.proyek, 'kode').map((p) => [p.kode, p.kode + ' — ' + isi(p.nama)]), S.filterProyek, true);
  const jumlah = h('select', {id: 'm-jumlah'}, h('option', {value: '4'}, '4 tahap (sampai Gambar Kerja)'), h('option', {value: '6'}, '6 tahap (sampai Pengawasan Berkala)'));
  const galat = h('p', {class: 'form-galat', role: 'alert'});
  const dlg = dialog('Tambah semua tahap proyek', h('form', {class: 'form', onsubmit: async (ev) => {
    ev.preventDefault();
    const kode = proyek.value, p = S.db.proyek.find((x) => x.kode === kode);
    const sudah = new Set(S.db.tahap.filter((t) => t.kode === kode).map((t) => t.tahap));
    const baru = TAHAP.slice(0, +jumlah.value).filter((t) => !sudah.has(t.nama)).map((t) => ({tabel: 'tahap', data: bersih({kode, tahap: t.nama, pic: p?.pic, bobot: t.bobot, selesai: 0})}));
    if (!baru.length) { galat.textContent = 'Semua tahap itu sudah ada untuk proyek ini.'; return; }
    try {
      await store.tambahBanyak(baru);
      S.filterProyek = kode;
      await muatData(); dlg.close(); render(); pesan(baru.length + ' tahap ditambahkan.');
    } catch (e) { galat.textContent = e.message; }
  }},
    h('p', {class: 'redup'}, 'Membuat satu baris per tahap dengan bobot default. Tahap yang sudah ada tidak digandakan.'),
    h('div', {class: 'form-grid'}, h('div', {class: 'medan'}, h('label', {for: 'm-proyek'}, 'Proyek'), proyek), h('div', {class: 'medan'}, h('label', {for: 'm-jumlah'}, 'Lingkup'), jumlah)),
    galat,
    h('div', {class: 'form-kaki'}, h('span', {class: 'pegas'}), h('button', {class: 'btn', type: 'button', onclick: () => dlg.close()}, 'Batal'), h('button', {class: 'btn btn-utama', type: 'submit'}, 'Tambah'))));
}

// ---------- pengaturan ----------
function renderPengaturan(el) {
  const admin = S.user.role === 'admin';
  el.append(h('div', {class: 'kepala'}, h('h1', null, 'Pengaturan'), h('p', {class: 'redup'}, store.mode === 'lokal'
    ? 'Penyimpanan: browser ini saja (mode demo).'
    : 'Penyimpanan: Supabase. Anda masuk sebagai ' + S.user.email + ' (' + S.user.role + ').')));

  // Impor Excel
  const hasilImpor = h('div');
  const berkas = h('input', {id: 'impor-excel', type: 'file', accept: '.xlsx', onchange: aman(async () => {
    const f = berkas.files[0];
    if (!f) return;
    hasilImpor.replaceChildren(h('p', {class: 'redup'}, 'Membaca ' + f.name + '…'));
    const hasil = await bacaExcel(await f.arrayBuffer());
    if (hasil.jenis === 'admin' && !admin) throw new Error('File Back Office hanya bisa diimpor oleh admin.');
    const tabel = Object.keys(hasil.data);
    const tombol = h('button', {class: 'btn btn-utama', type: 'button', onclick: aman(async () => {
      tombol.disabled = true;
      const rows = tabel.flatMap((t) => hasil.data[t].map((data) => ({tabel: t, data})));
      await store.gantiTabel(tabel, rows);
      await muatData();
      const ada = new Set(S.db.proyek.map((p) => p.kode));
      const rintisan = hasil.masterProyek.filter((p) => !ada.has(p.kode)).map((p) => ({tabel: 'proyek', data: bersih(p)}));
      if (rintisan.length) { await store.tambahBanyak(rintisan); await muatData(); }
      render(); pesan('Impor selesai: ' + rows.length + ' baris.');
    })}, 'Ganti isi tabel tersebut dengan data file ini');
    hasilImpor.replaceChildren(
      h('p', null, 'Terbaca sebagai ', h('b', null, hasil.jenis === 'admin' ? 'file Back Office (Admin)' : 'file Data Proyek (Tim Arsitek)'), ':'),
      h('ul', null, tabel.map((t) => h('li', null, TABEL[t].label + ': ' + hasil.data[t].length + ' baris (sekarang ' + S.db[t].length + ')'))),
      h('p', {class: 'redup kecil'}, 'Isi tabel di atas akan diganti seluruhnya. Tabel lain tidak disentuh.'), tombol);
  })});
  el.append(h('section', {class: 'kartu'}, h('h2', null, 'Impor dari Excel'),
    h('p', null, 'Pilih file Back Office (Admin) atau Data Proyek (Tim Arsitek). Hanya kolom isian yang dibaca; kolom rumus dihitung ulang oleh aplikasi.'),
    h('label', {for: 'impor-excel', class: 'kecil redup'}, 'File .xlsx'), berkas, hasilImpor));

  // Cadangan
  const pulih = h('input', {id: 'pulih-json', type: 'file', accept: '.json,application/json', onchange: aman(async () => {
    const f = pulih.files[0];
    if (!f) return;
    const isiFile = JSON.parse(await f.text());
    const tabel = tabelBoleh().filter((t) => Array.isArray(isiFile[t]));
    if (!tabel.length) throw new Error('File cadangan tidak berisi tabel yang dikenali.');
    const rows = tabel.flatMap((t) => isiFile[t].map((r) => ({tabel: t, data: bersih(r)})));
    hasilPulih.replaceChildren(h('p', null, 'Cadangan berisi ' + rows.length + ' baris di ' + tabel.length + ' tabel. Isi tabel-tabel itu akan diganti.'),
      h('button', {class: 'btn btn-utama', type: 'button', onclick: aman(async () => { await store.gantiTabel(tabel, rows); await muatData(); render(); pesan('Cadangan dipulihkan.'); })}, 'Pulihkan sekarang'));
  })});
  const hasilPulih = h('div');
  el.append(h('section', {class: 'kartu'}, h('h2', null, 'Cadangan'),
    h('p', null, 'Unduh seluruh data yang bisa Anda akses sebagai satu file JSON, atau pulihkan dari file cadangan.'),
    h('div', {class: 'baris-tombol'}, h('button', {class: 'btn', type: 'button', onclick: () => {
      const data = Object.fromEntries(tabelBoleh().map((t) => [t, S.db[t].map(bersih)]));
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'}));
      const a = h('a', {href: url, download: 'alinea5-cadangan-' + hariIni() + '.json'});
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }}, 'Unduh cadangan (.json)')),
    h('label', {for: 'pulih-json', class: 'kecil redup'}, 'Pulihkan dari file cadangan'), pulih, hasilPulih));

  // Pengguna
  if (store.mode === 'supabase' && admin) {
    const daftar = h('div', null, h('p', {class: 'redup'}, 'Memuat pengguna…'));
    el.append(h('section', {class: 'kartu'}, h('h2', null, 'Pengguna'),
      h('p', null, 'Akun baru mendaftar sendiri dari halaman masuk, lalu diaktifkan di sini. Arsitek hanya melihat tabel Proyek dan Master; admin melihat semuanya.'), daftar));
    aman(async () => {
      const orang = await store.pengguna();
      daftar.replaceChildren(h('div', {class: 'gulir'}, h('table', {class: 'tabel'},
        h('thead', null, h('tr', null, ['Email', 'Peran', 'Aktif'].map((x) => h('th', null, x)))),
        h('tbody', null, orang.map((o) => {
          const diri = o.id === S.user.id;
          return h('tr', null, h('td', null, o.email, diri && ' (Anda)'),
            h('td', null, h('select', {'aria-label': 'Peran ' + o.email, disabled: diri, onchange: aman(async (ev) => { await store.aturPengguna(o.id, {role: ev.target.value}); pesan('Peran diperbarui.'); })},
              ['arsitek', 'admin'].map((x) => h('option', {value: x, selected: o.role === x}, x === 'admin' ? 'Admin' : 'Arsitek')))),
            h('td', null, h('input', {type: 'checkbox', 'aria-label': 'Aktif ' + o.email, checked: o.aktif, disabled: diri, onchange: aman(async (ev) => { await store.aturPengguna(o.id, {aktif: ev.target.checked}); pesan(ev.target.checked ? 'Akun diaktifkan.' : 'Akun dinonaktifkan.'); })})));
        })))));
    })();
  }

  // Hapus semua
  if (admin) {
    const ketik = h('input', {id: 'hapus-ketik', type: 'text', placeholder: 'Ketik HAPUS', autocomplete: 'off', 'aria-label': 'Ketik HAPUS untuk mengonfirmasi'});
    el.append(h('section', {class: 'kartu'}, h('h2', null, 'Hapus semua data'),
      h('p', null, 'Mengosongkan semua tabel. Tindakan ini tidak bisa dibatalkan; unduh cadangan lebih dulu.'),
      h('div', {class: 'baris-tombol'}, ketik, h('button', {class: 'btn btn-bahaya', type: 'button', onclick: aman(async () => {
        if (ketik.value.trim() !== 'HAPUS') throw new Error('Ketik HAPUS (huruf besar) untuk mengonfirmasi.');
        await store.gantiTabel(NAMA_TABEL, []);
        await muatData(); render(); pesan('Semua data dihapus.');
      })}, 'Hapus semua data'))));
  }
}

// ---------- mulai ----------
window.addEventListener('hashchange', () => { S.cari = ''; if (S.user?.aktif) render(); });
(async () => {
  try {
    S.user = await store.init();
    if (S.user?.aktif) await muatData();
    render();
  } catch (e) {
    console.error(e);
    akar.replaceChildren(h('div', {class: 'tengah'}, h('div', {class: 'kartu kartu-masuk'}, h('h1', null, 'Aplikasi gagal dimuat'),
      h('p', null, e.message || String(e)), h('p', {class: 'redup kecil'}, 'Periksa sambungan internet dan isi js/config.js, lalu muat ulang halaman.'))));
  }
})();
