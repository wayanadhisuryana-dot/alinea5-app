// Tahap 4E — Detail Proyek: ringkasan keuangan & jadwal satu proyek, dengan tab
// Kontrak | Termin | Pihak Proyek | Pembelian | Tim | Dompet & Pinjaman | Progres | Masalah & Risiko.
// Semua angka diambil dari hitungan yang sama dengan menu masing-masing (S.d), jadi selalu konsisten.
import {S} from './state.js';
import {hariIni} from './calc.js';
import {TABEL} from './schema.js';
import {bisaUbah, bolehUbahTabel, hak} from './akses.js';
import {h, rp, tgl, isi, pill, batangProgres, FORMAT, RATA_KANAN} from './ui.js';
import {tombolBukti} from './keuangan.js';
import {bukaTermin, bukaFormKontrak} from './kontrak.js';
import {tabelKontrakVendor, bukaFormKontrakVendor} from './pihak-proyek.js';
import {tabelPembelian, bukaFormPembelian} from './pembelian.js';
import {panelDompet, peringatanDompet} from './dompet.js';
import {K, ubin, pct, bacaKeuangan} from './proyek-bersama.js';

S.tabProyek = S.tabProyek || 'kontrak';

// Ringkasan angka satu proyek (dipakai juga di daftar Proyek).
export function angkaProyek(kode) {
  const kontrak = S.d.kontrak.filter((k) => k.kode === kode);
  const dp = S.d.dompet[kode];
  const nilai = kontrak.reduce((s, k) => s + k.total, 0), diterima = kontrak.reduce((s, k) => s + k.diterima, 0);
  const piutang = kontrak.reduce((s, k) => s + k.piutang, 0);
  if (!dp) return {nilai, diterima, piutang};
  return {nilai, diterima, piutang, biaya: dp.biaya_vendor + dp.biaya_material + dp.biaya_lain, hutang: dp.hutang_vendor + dp.hutang_supplier,
    hutang_vendor: dp.hutang_vendor, hutang_supplier: dp.hutang_supplier, saldo: dp.saldo, saldo_titipan: dp.saldo_titipan, pinjaman: dp.pinjaman_masuk_sisa,
    pinjaman_keluar: dp.pinjaman_keluar_sisa, laba: dp.laba_kotor, pendapatan: dp.pendapatan_diterima, beban: dp.beban_perusahaan, retensi_vendor: dp.retensi_vendor};
}

// Tabel generik dari definisi schema (untuk tahap dan masalah).
function tabelSchema(nama, rows, bukaForm) {
  const def = TABEL[nama];
  const kolom = def.kolom.filter(([k]) => k !== 'nama_proyek' && k !== 'kode');
  return h('div', {class: 'gulir'}, h('table', {class: 'tabel'},
    h('thead', null, h('tr', null, kolom.map(([, label, f]) => h('th', {class: RATA_KANAN.includes(f) ? 'kanan' : null}, label)))),
    h('tbody', null, rows.length ? rows.map((r) => h('tr', {class: 'bisa-klik', tabindex: '0', onclick: () => bukaForm(nama, S.db[nama].find((x) => x.id === r.id)),
      onkeydown: (ev) => { if (ev.key === 'Enter') bukaForm(nama, S.db[nama].find((x) => x.id === r.id)); }},
    kolom.map(([k, , f]) => h('td', {class: (RATA_KANAN.includes(f) ? 'kanan ' : '') + (f === 'lebar' ? 'lebar' : '')}, f && FORMAT[f] ? FORMAT[f](r[k]) : isi(r[k])))))
      : h('tr', null, h('td', {colspan: String(kolom.length), class: 'redup'}, 'Belum ada data.')))));
}

export function renderDetailProyek(el, id, {bukaForm}) {
  const p = S.d.proyek.find((x) => x.id === id);
  const kembali = h('a', {href: '#t-proyek', class: 'kecil'}, '← Daftar proyek');
  if (!p) { el.append(h('div', {class: 'kepala'}, kembali, h('h1', null, 'Proyek tidak ditemukan'))); return; }
  const kode = p.kode, today = hariIni();
  const keu = bacaKeuangan() && K().siap;
  const tahap4 = keu && K().proyek_siap !== false;
  const a = keu ? angkaProyek(kode) : null;
  const termin = S.d.termin.filter((t) => t.kode === kode);
  const masalah = S.d.masalah.filter((m) => m.kode === kode);
  const tahap = S.d.tahap.filter((t) => t.kode === kode);
  const vendor = tahap4 ? S.d.vendor.filter((v) => v.kode === kode) : [];
  const beli = tahap4 ? S.d.pembelian.filter((b) => b.proyek_kode === kode) : [];
  const pinjaman = tahap4 ? S.d.pinjaman.filter((x) => x.ke_proyek === kode || x.dari_proyek === kode) : [];

  // Tenggat & peringatan
  const peringatan = [
    p.target && p.status !== 'Selesai' && (p.target < today ? 'Target selesai ' + tgl(p.target) + ' sudah lewat.' : null),
    p.mundur > 0 && 'Perkiraan selesai mundur ' + p.mundur + ' hari dari target.',
    ...termin.filter((t) => t.sisa > 0 && t.jatuh_tempo && t.jatuh_tempo < today && t.no_invoice).map((t) => 'Tagihan ' + (t.milestone || 'termin ' + t.termin_ke) + ' (' + t.no_invoice + ') lewat jatuh tempo, sisa ' + rp(t.sisa) + '.'),
    ...vendor.filter((v) => v.hutang < 0).map((v) => 'Lebih bayar ke ' + v.vendor_nama + ' ' + rp(-v.hutang) + '.'),
    ...vendor.filter((v) => v.retensi_bisa_cair).map((v) => 'Retensi ' + v.vendor_nama + ' ' + rp(v.retensi_ditahan) + ' sudah bisa dicairkan.'),
    ...beli.filter((b) => b.status === 'Lewat jatuh tempo').map((b) => 'Hutang ' + b.supplier_nama + (b.no_nota ? ' ' + b.no_nota : '') + ' lewat jatuh tempo ' + tgl(b.jatuh_tempo) + ', sisa ' + rp(b.sisa) + '.'),
    ...pinjaman.filter((x) => x.lewat).map((x) => 'Pinjaman ' + (x.dari_proyek || 'Kas perusahaan') + ' → ' + x.ke_proyek + ' lewat rencana kembali ' + tgl(x.rencana_kembali) + ', sisa ' + rp(x.sisa) + '.'),
    ...masalah.filter((m) => m.lewat).map((m) => 'Masalah "' + m.uraian + '" lewat target.'),
  ].filter(Boolean);

  el.append(
    h('div', {class: 'kepala'}, kembali,
      h('div', {class: 'judul-baris'}, h('h1', null, kode + ' — ' + isi(p.nama)), pill(p.status), pill(p.status_jadwal), h('span', {class: 'pegas'}),
        h('button', {class: 'btn', type: 'button', onclick: () => bukaForm('proyek', S.db.proyek.find((x) => x.id === id))}, bolehUbahTabel('proyek') ? 'Ubah data proyek' : 'Lihat data proyek')),
      h('p', {class: 'redup'}, [p.klien, p.lokasi, p.jenis_bangunan, p.layanan, p.tahap_sekarang && 'Tahap: ' + p.tahap_sekarang].filter(Boolean).join(' · '))),
    tahap4 && peringatanDompet(S.d.dompet[kode], kode),
    keu && h('section', {class: 'ubin-grid', 'aria-label': 'Ringkasan proyek'},
      ubin('Nilai kontrak', rp(a.nilai), S.d.kontrak.filter((k) => k.kode === kode).length + ' kontrak klien'),
      ubin('Diterima', rp(a.diterima), a.nilai ? pct(a.diterima / a.nilai) + ' dari nilai kontrak' : '—'),
      ubin('Piutang', rp(a.piutang), 'sudah ditagih, belum diterima'),
      tahap4 && ubin('Biaya', rp(a.biaya), 'vendor (hak) + material + kas keluar'),
      tahap4 && ubin('Hutang', rp(a.hutang), 'vendor ' + rp(a.hutang_vendor) + ' · supplier ' + rp(a.hutang_supplier)),
      tahap4 && ubin('Saldo dompet', rp(a.saldo), 'titipan ' + rp(a.saldo_titipan), {buruk: a.saldo < 0 || a.saldo_titipan < 0}),
      tahap4 && ubin('Pinjaman', rp(a.pinjaman), a.pinjaman_keluar ? 'dipinjamkan keluar ' + rp(a.pinjaman_keluar) : 'sisa yang harus dikembalikan'),
      tahap4 && ubin('Laba kotor sementara', rp(a.laba), 'pendapatan diterima ' + rp(a.pendapatan) + ' − beban ' + rp(a.beban), {buruk: a.laba < 0})),
    h('section', {class: 'kartu'}, h('h2', null, 'Tenggat & peringatan'),
      h('p', null, 'Mulai ' + tgl(p.mulai) + ' · target ' + tgl(p.target) + ' · perkiraan ' + tgl(p.perkiraan) + ' · progres ', batangProgres(p.progres)),
      peringatan.length ? h('ul', null, peringatan.map((x) => h('li', {class: 'teks-buruk'}, x))) : h('p', {class: 'redup'}, 'Tidak ada peringatan.')));

  const TAB = [keu && hak('kontrak') != null && ['kontrak', 'Kontrak'], keu && hak('termin') != null && ['termin', 'Termin'], tahap4 && ['pihak', 'Pihak Proyek'], tahap4 && ['pembelian', 'Pembelian'],
    ['tim', 'Tim'], tahap4 && ['dompet', 'Dompet & Pinjaman'], ['progres', 'Progres'], ['masalah', 'Masalah & Risiko']].filter(Boolean);
  if (!TAB.some(([k]) => k === S.tabProyek)) S.tabProyek = TAB[0][0];
  const panel = h('div', {class: 'kartu', role: 'tabpanel'});
  el.append(h('div', {class: 'tabs', role: 'tablist'}, TAB.map(([k, label]) => h('button', {class: 'tab', type: 'button', role: 'tab', 'aria-selected': String(S.tabProyek === k),
    onclick: () => { S.tabProyek = k; S.render(); }}, label))), panel);
  const alat = (...isiAlat) => h('div', {class: 'alat'}, h('span', {class: 'pegas'}), ...isiAlat);

  if (S.tabProyek === 'kontrak') {
    const daftar = S.d.kontrak.filter((k) => k.kode === kode);
    panel.append(alat(bisaUbah('kontrak') && h('button', {class: 'btn btn-utama', type: 'button', onclick: () => bukaFormKontrak(null, {proyek_kode: kode})}, '+ Kontrak klien')),
      h('div', {class: 'gulir'}, h('table', {class: 'tabel'},
        h('thead', null, h('tr', null, ['No. kontrak', 'Tanggal', 'Nilai total', 'Ditagih', 'Diterima', 'Piutang', '% terbayar', 'Status', 'PDF'].map((x, i) => h('th', {class: i >= 2 && i <= 6 ? 'kanan' : null}, x)))),
        h('tbody', null, daftar.length ? daftar.map((k) => h('tr', {class: 'bisa-klik', tabindex: '0', onclick: () => { location.hash = '#kontrak-' + k.id; }},
          h('td', null, k.no_kontrak), h('td', {class: 'nw'}, tgl(k.tanggal)), h('td', {class: 'kanan'}, rp(k.total)), h('td', {class: 'kanan'}, rp(k.ditagih)), h('td', {class: 'kanan'}, rp(k.diterima)),
          h('td', {class: 'kanan'}, rp(k.piutang)), h('td', {class: 'kanan'}, pct(k.pct_terbayar)), h('td', null, pill(k.status)), h('td', null, tombolBukti(k.file))))
          : h('tr', null, h('td', {colspan: '9', class: 'redup'}, 'Belum ada kontrak klien untuk proyek ini.'))))));
  } else if (S.tabProyek === 'termin') {
    panel.append(h('div', {class: 'gulir'}, h('table', {class: 'tabel'},
      h('thead', null, h('tr', null, ['Kontrak', 'Ke', 'Milestone', 'Nilai tagihan', 'No. invoice', 'Jatuh tempo', 'Diterima', 'Sisa', 'Status'].map((x, i) => h('th', {class: [3, 6, 7].includes(i) ? 'kanan' : null}, x)))),
      h('tbody', null, termin.length ? termin.map((t) => h('tr', {class: 'bisa-klik', tabindex: '0', onclick: () => bukaTermin(t.id)},
        h('td', null, t.no_kontrak), h('td', null, t.jenis === 'retensi' ? 'Retensi' : String(t.termin_ke)), h('td', null, isi(t.milestone)), h('td', {class: 'kanan'}, rp(t.tagihan)),
        h('td', null, isi(t.no_invoice)), h('td', {class: 'nw'}, tgl(t.jatuh_tempo)), h('td', {class: 'kanan'}, rp(t.diterima)), h('td', {class: 'kanan'}, rp(t.sisa)), h('td', null, pill(t.status))))
        : h('tr', null, h('td', {colspan: '9', class: 'redup'}, 'Belum ada termin.'))))));
  } else if (S.tabProyek === 'pihak') {
    panel.append(alat(bisaUbah('pihak_proyek') && h('button', {class: 'btn btn-utama', type: 'button', onclick: () => bukaFormKontrakVendor(null, {proyek_kode: kode})}, '+ Kontrak vendor')),
      tabelKontrakVendor(vendor, {kosongTeks: 'Belum ada kontrak vendor untuk proyek ini.'}));
  } else if (S.tabProyek === 'pembelian') {
    panel.append(alat(bisaUbah('pembelian') && h('button', {class: 'btn btn-utama', type: 'button', onclick: () => bukaFormPembelian(null, {tujuan: 'proyek', proyek_kode: kode})}, '+ Pembelian')),
      tabelPembelian(beli, {denganProyek: false, kosongTeks: 'Belum ada pembelian untuk proyek ini.'}));
  } else if (S.tabProyek === 'tim') {
    const tim = Array.isArray(p.tim) ? p.tim : [];
    panel.append(alat(bolehUbahTabel('proyek') && h('button', {class: 'btn', type: 'button', onclick: () => bukaForm('proyek', S.db.proyek.find((x) => x.id === id))}, 'Ubah Tim Proyek')),
      h('p', null, 'Arsitek PIC: ' + isi(p.pic) + ' · Pengawas lapangan: ' + isi(p.pengawas)),
      h('div', {class: 'gulir'}, h('table', {class: 'tabel'},
        h('thead', null, h('tr', null, ['Nama', 'Peran', 'Mulai', 'Selesai'].map((x) => h('th', null, x)))),
        h('tbody', null, tim.length ? tim.map((x) => h('tr', null, h('td', null, isi(x.nama)), h('td', null, isi(x.peran)), h('td', {class: 'nw'}, tgl(x.mulai)), h('td', {class: 'nw'}, tgl(x.selesai))))
          : h('tr', null, h('td', {colspan: '4', class: 'redup'}, 'Belum ada anggota Tim Proyek.'))))),
      vendor.length > 0 && h('div', null, h('h3', null, 'Vendor / tukang di proyek ini'), h('ul', null, vendor.map((v) => h('li', null, h('a', {href: '#pihak-proyek-' + v.id}, v.vendor_nama), v.lingkup ? ' — ' + v.lingkup : '')))));
  } else if (S.tabProyek === 'dompet') {
    panel.append(panelDompet(kode));
  } else if (S.tabProyek === 'progres') {
    panel.append(alat(bolehUbahTabel('tahap') && h('button', {class: 'btn btn-utama', type: 'button', onclick: () => bukaForm('tahap', null, {kode})}, '+ Tahap')),
      h('p', null, 'Progres tertimbang: ', batangProgres(p.progres)), tabelSchema('tahap', tahap, bukaForm));
  } else if (S.tabProyek === 'masalah') {
    panel.append(alat(bolehUbahTabel('masalah') && h('button', {class: 'btn btn-utama', type: 'button', onclick: () => bukaForm('masalah', null, {kode})}, '+ Masalah / risiko')),
      tabelSchema('masalah', masalah, bukaForm));
  }
}
