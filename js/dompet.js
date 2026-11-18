// Tahap 4C–4D — Dompet proyek dan pinjaman antar proyek.
// Dompet = uang tunai per proyek (masuk − keluar). Pinjaman antar proyek hanya alokasi internal: TIDAK membuat jurnal.
import {S, segarkanKeuangan} from './state.js';
import {hariIni} from './calc.js';
import {store} from './store.js';
import {bisaUbah} from './akses.js';
import {h, rp, tgl, isi, pill, pesan, sambilMenyimpan, dialog} from './ui.js';
import {medan, teks, tanggal, pilihan, uang, centang, kaki, tombolHapus} from './keuangan.js';
import {batasPinjaman} from './proyek-util.js';
import {K, namaProyek, ubin, dialogLebar, opsiProyek} from './proyek-bersama.js';

const bisa = () => bisaUbah('kas');
const sumberNama = (kode) => (kode ? 'proyek ' + namaProyek(kode) : 'Kas perusahaan');
const pinjamanDari = (id) => S.d.pinjaman.find((p) => p.id === id);

// Kotak merah bila saldo dompet / titipan minus.
export function peringatanDompet(dp, kode) {
  if (!dp) return null;
  const pesanMinus = [dp.saldo < 0 && 'Saldo dompet ' + kode + ' minus ' + rp(-dp.saldo) + '.', dp.saldo_titipan < 0 && 'Saldo dana titipan ' + kode + ' minus ' + rp(-dp.saldo_titipan) + '.'].filter(Boolean);
  return pesanMinus.length ? h('div', {class: 'kotak-galat', role: 'alert'}, h('b', null, '⚠ Proyek ini sedang dibiayai dana lain. '), pesanMinus.join(' ')) : null;
}

// Panel dompet + pinjaman untuk satu proyek (tab "Dompet & Pinjaman" di Detail Proyek).
export function panelDompet(kode) {
  const dp = S.d.dompet[kode];
  if (!dp) return h('p', {class: 'redup'}, 'Data dompet belum tersedia.');
  const baris = (label, n, ket) => h('tr', null, h('td', {style: {whiteSpace: 'normal'}}, label, ket && h('span', {class: 'kecil redup blok'}, ket)), h('td', {class: 'kanan'}, rp(n)));
  const pinj = S.d.pinjaman.filter((p) => p.dari_proyek === kode || p.ke_proyek === kode);
  return h('div', null,
    peringatanDompet(dp, kode),
    h('section', {class: 'ubin-grid', 'aria-label': 'Ringkasan dompet'},
      ubin('Saldo dompet', rp(dp.saldo), 'masuk ' + rp(dp.masuk) + ' − keluar ' + rp(dp.keluar), {buruk: dp.saldo < 0}),
      ubin('Saldo dana titipan', rp(dp.saldo_titipan), 'titipan masuk − dipakai − dipinjamkan', {buruk: dp.saldo_titipan < 0}),
      ubin('Pinjaman diterima (sisa)', rp(dp.pinjaman_masuk_sisa), 'harus dikembalikan'),
      ubin('Dipinjamkan ke proyek lain (sisa)', rp(dp.pinjaman_keluar_sisa), 'belum kembali')),
    h('div', {class: 'dua-kolom'},
      h('section', {class: 'kartu'}, h('h2', null, 'Uang masuk'), h('table', {class: 'tabel'}, h('tbody', null,
        baris('Termin — bagian jasa', dp.masuk_jasa, 'pendapatan + PPN keluaran'), baris('Termin — dana titipan', dp.masuk_titipan, 'Hutang Dana Titipan klien'),
        baris('Kas umum masuk (ditandai proyek ini)', dp.kas_masuk), baris('Pinjaman diterima', dp.terima_pinjaman), baris('Pengembalian pinjaman diterima', dp.terima_kembali)),
        h('tfoot', null, h('tr', null, h('th', null, 'Total masuk'), h('th', {class: 'kanan'}, rp(dp.masuk)))))),
      h('section', {class: 'kartu'}, h('h2', null, 'Uang keluar'), h('table', {class: 'tabel'}, h('tbody', null,
        baris('Pembayaran vendor / tukang', dp.keluar_vendor, 'termasuk potongan pajak'), baris('Pembelian material (dibayar)', dp.keluar_material),
        baris('Kas umum keluar (ditandai proyek ini)', dp.kas_keluar), baris('Pinjaman diberikan', dp.beri_pinjaman), baris('Pengembalian pinjaman dibayar', dp.bayar_kembali)),
        h('tfoot', null, h('tr', null, h('th', null, 'Total keluar'), h('th', {class: 'kanan'}, rp(dp.keluar))))))),
    h('section', {class: 'kartu'}, h('div', {class: 'judul-baris'}, h('h2', null, 'Pinjaman antar proyek'), h('span', {class: 'pegas'}),
      bisa() && h('button', {class: 'btn btn-kecil', type: 'button', onclick: () => bukaFormPinjaman(null, {ke_proyek: kode})}, '+ Pinjam untuk proyek ini'),
      bisa() && h('button', {class: 'btn btn-kecil', type: 'button', onclick: () => bukaFormPinjaman(null, {dari_proyek: kode})}, '+ Pinjamkan ke proyek lain')),
    h('p', {class: 'kecil redup'}, 'Pinjaman antar proyek hanya mengatur dompet internal dan tidak membuat jurnal.'),
    tabelPinjaman(pinj, kode)));
}

export function tabelPinjaman(rows, kode) {
  return h('div', {class: 'gulir'}, h('table', {class: 'tabel'},
    h('thead', null, h('tr', null, ['Tanggal', 'Dari', 'Ke', 'Jumlah', 'Dikembalikan', 'Sisa', 'Rencana kembali', 'Status', 'Disetujui oleh', ''].map((x, i) => h('th', {class: i >= 3 && i <= 5 ? 'kanan' : null}, x)))),
    h('tbody', null, rows.length ? rows.slice().sort((a, b) => b.tanggal.localeCompare(a.tanggal)).map((p) => h('tr', null,
      h('td', {class: 'nw'}, tgl(p.tanggal)), h('td', null, p.dari_proyek ? (p.dari_proyek === kode ? h('b', null, p.dari_proyek) : p.dari_proyek) : 'Kas perusahaan'),
      h('td', null, p.ke_proyek === kode ? h('b', null, p.ke_proyek) : p.ke_proyek), h('td', {class: 'kanan'}, rp(p.jumlah)), h('td', {class: 'kanan'}, rp(p.dikembalikan)),
      h('td', {class: 'kanan'}, rp(p.sisa)), h('td', {class: 'nw' + (p.lewat ? ' teks-buruk' : '')}, tgl(p.rencana_kembali) + (p.lewat ? ' ⚠ lewat' : '')),
      h('td', null, pill(p.lewat ? 'Terlambat' : p.status === 'Kembali sebagian' ? 'Sebagian' : p.status)), h('td', null, isi(p.disetujui_oleh)),
      h('td', {class: 'nw'}, h('button', {class: 'btn btn-kecil', type: 'button', onclick: () => bukaDetailPinjaman(p.id)}, 'Rincian'))))
      : h('tr', null, h('td', {colspan: '10', class: 'redup'}, 'Belum ada pinjaman.')))));
}

// Ringkasan dana titipan yang sedang dipinjamkan (semua proyek).
export function ringkasTitipanDipinjamkan() {
  const aktif = S.d.pinjaman.filter((p) => p.sisa > 0);
  if (!aktif.length) return null;
  const dariProyek = aktif.filter((p) => p.dari_proyek), dariKas = aktif.filter((p) => !p.dari_proyek);
  return h('section', {class: 'kartu'}, h('h2', null, 'Pinjaman antar proyek yang berjalan'),
    h('p', null, 'Dana proyek yang sedang dipinjamkan: ', h('b', null, rp(dariProyek.reduce((s, p) => s + p.sisa, 0))),
      dariKas.length ? ' · dari kas perusahaan: ' : '', dariKas.length ? h('b', null, rp(dariKas.reduce((s, p) => s + p.sisa, 0))) : '',
      aktif.some((p) => p.lewat) ? h('span', {class: 'teks-buruk'}, ' · ' + aktif.filter((p) => p.lewat).length + ' lewat rencana kembali') : ''),
    tabelPinjaman(aktif));
}

// =====================================================================
// Formulir pinjaman
// =====================================================================
export function bukaFormPinjaman(lama, awal = {}) {
  const x = lama || awal;
  const boleh = bisa();
  const galat = h('p', {class: 'form-galat', role: 'alert'});
  const opsiDari = [['', 'Kas perusahaan'], ...opsiProyek().map((o) => [o.v, o.label])];
  const dari = pilihan('pj-dari', opsiDari, x.dari_proyek || '');
  const ke = pilihan('pj-ke', [['', 'Pilih proyek…'], ...opsiProyek().map((o) => [o.v, o.label])], x.ke_proyek || '', {required: true});
  const jumlah = uang('pj-jumlah', x.jumlah);
  const tglEl = tanggal('pj-tgl', x.tanggal || hariIni(), {required: true});
  const alasan = teks('pj-alasan', x.alasan, {placeholder: 'Mis. bayar tukang sebelum termin 2 cair'});
  const rencana = tanggal('pj-rencana', x.rencana_kembali || '', {required: true});
  const setuju = teks('pj-setuju', x.disetujui_oleh, {placeholder: 'Nama yang menyetujui'});
  const konfirmasi = centang('pj-konf', x.konfirmasi_pemilik, 'Saya (pemilik / super admin) menyetujui pinjaman melebihi batas');
  const konfInp = konfirmasi.querySelector('input');
  const catatan = h('textarea', {id: 'pj-catatan', rows: '2'}, x.catatan ?? '');
  const info = h('div', {class: 'kotak-info kecil'});
  const pct = K().akuntansi.batas_pinjam_titipan_persen;
  const segar = () => {
    const j = jumlah.nilai() || 0, kode = dari.value;
    const dp = kode && S.d.dompet[kode];
    // Saldo titipan pemberi tanpa pinjaman ini sendiri (saat diubah).
    const saldo = dp ? dp.saldo_titipan + (lama && lama.dari_proyek === kode ? lama.sisa : 0) : null;
    const batas = dp ? batasPinjaman(Math.max(0, saldo), pct) : null;
    const lebih = batas != null && j > batas;
    konfirmasi.hidden = !lebih;
    konfInp.disabled = !S.user?.super_admin;
    info.replaceChildren(...[
      h('div', null, 'Pinjaman ini tidak membuat jurnal. Dompet ' + (kode || 'kas perusahaan') + ' berkurang dan dompet ' + (ke.value || 'penerima') + ' bertambah ' + rp(j) + '.'),
      dp && h('div', null, 'Saldo dana titipan ' + kode + ': ' + rp(saldo) + (batas != null ? ' · batas pinjaman ' + pct + '% = ' + rp(batas) : ' · tanpa batas (atur di Pengaturan → Akuntansi)')),
      dp && saldo - j < 0 && h('div', {class: 'form-galat'}, '⚠ Setelah pinjaman ini, dana titipan ' + kode + ' akan minus.'),
      lebih && h('div', {class: 'form-galat'}, 'Melebihi batas ' + pct + '% saldo titipan. ' + (S.user?.super_admin ? 'Centang persetujuan pemilik di bawah untuk melanjutkan.' : 'Hanya pemilik (super admin) yang bisa menyetujui.')),
    ].filter(Boolean));
  };
  [dari, ke, tglEl].forEach((e) => e.addEventListener('change', segar)); jumlah.inp.addEventListener('input', segar);
  const simpan = h('button', {class: 'btn btn-utama', type: 'submit'}, 'Simpan');
  let dlg;
  const form = h('form', {class: 'form', onsubmit: async (ev) => {
    ev.preventDefault();
    galat.textContent = '';
    const d = {dari_proyek: dari.value || null, ke_proyek: ke.value, jumlah: jumlah.nilai() || 0, tanggal: tglEl.value, alasan: alasan.value.trim(), rencana_kembali: rencana.value,
      disetujui_oleh: setuju.value.trim(), konfirmasi_pemilik: !konfirmasi.hidden && konfInp.checked, catatan: catatan.value.trim() || null};
    if (!d.ke_proyek) { galat.textContent = 'Pilih proyek penerima pinjaman.'; return; }
    if (d.dari_proyek === d.ke_proyek) { galat.textContent = 'Proyek pemberi dan penerima tidak boleh sama.'; return; }
    try {
      await sambilMenyimpan(simpan, () => store.keu.simpanPinjaman(lama?.id, d));
      dlg.close(); await segarkanKeuangan(); pesan('Pinjaman tersimpan (tanpa jurnal).');
    } catch (e) { galat.textContent = e.message; }
  }},
    h('div', {class: 'form-grid'},
      medan('Dari', dari, {wajib: true, bantuan: 'Kas perusahaan atau dompet proyek lain.'}), medan('Ke proyek', ke, {wajib: true}),
      medan('Jumlah', jumlah.el, {wajib: true, id: 'pj-jumlah'}), medan('Tanggal', tglEl, {wajib: true}),
      medan('Alasan', alasan, {wajib: true, lebar: true}), medan('Rencana kembali', rencana, {wajib: true}), medan('Disetujui oleh', setuju, {wajib: true}),
      h('div', {class: 'medan medan-lebar'}, konfirmasi), medan('Catatan', catatan, {lebar: true})),
    info, galat,
    kaki(lama && boleh && !lama.pengembalian.length && tombolHapus(async () => { await store.keu.hapusPinjaman(lama.id); dlg.close(); await segarkanKeuangan(); pesan('Pinjaman dihapus.'); }),
      h('span', {class: 'pegas'}), h('button', {class: 'btn', type: 'button', onclick: () => dlg.close()}, boleh ? 'Batal' : 'Tutup'), boleh && simpan));
  if (!boleh) form.querySelectorAll('input,select,textarea').forEach((e) => { e.disabled = true; });
  dlg = dialogLebar(lama ? 'Ubah pinjaman' : 'Pinjaman antar proyek', form);
  segar();
}

// Rincian satu pinjaman + riwayat pengembalian.
export function bukaDetailPinjaman(id) {
  const p = pinjamanDari(id);
  if (!p) return;
  let dlg;
  const ulang = async (fn) => { dlg.close(); await fn(); };
  dlg = dialogLebar('Pinjaman ' + (p.dari_proyek || 'Kas perusahaan') + ' → ' + p.ke_proyek, h('div', null,
    h('section', {class: 'ubin-grid'}, ubin('Jumlah', rp(p.jumlah), tgl(p.tanggal)), ubin('Dikembalikan', rp(p.dikembalikan), p.pengembalian.length + ' kali'),
      ubin('Sisa', rp(p.sisa), 'rencana kembali ' + tgl(p.rencana_kembali), {buruk: p.lewat})),
    h('p', null, h('b', null, 'Alasan: '), p.alasan), h('p', {class: 'redup'}, 'Disetujui oleh ' + isi(p.disetujui_oleh) + (p.konfirmasi_pemilik ? ' · melebihi batas, dikonfirmasi pemilik' : '') + (p.catatan ? ' · ' + p.catatan : '')),
    h('table', {class: 'tabel'}, h('thead', null, h('tr', null, ['Tanggal', 'Jumlah', 'Catatan', ''].map((x, i) => h('th', {class: i === 1 ? 'kanan' : null}, x)))),
      h('tbody', null, p.pengembalian.length ? p.pengembalian.map((r) => h('tr', null, h('td', null, tgl(r.tanggal)), h('td', {class: 'kanan'}, rp(r.jumlah)), h('td', null, isi(r.catatan)),
        h('td', null, bisa() && h('button', {class: 'btn btn-kecil', type: 'button', onclick: () => ulang(() => bukaFormPengembalian(p, r))}, 'Ubah'))))
        : h('tr', null, h('td', {colspan: '4', class: 'redup'}, 'Belum ada pengembalian.')))),
    kaki(bisa() && h('button', {class: 'btn', type: 'button', onclick: () => ulang(() => bukaFormPinjaman(p))}, 'Ubah pinjaman'), h('span', {class: 'pegas'}),
      h('button', {class: 'btn', type: 'button', onclick: () => dlg.close()}, 'Tutup'),
      bisa() && p.sisa > 0 && h('button', {class: 'btn btn-utama', type: 'button', onclick: () => ulang(() => bukaFormPengembalian(p, null))}, '+ Pengembalian'))));
}

export function bukaFormPengembalian(p, r) {
  const galat = h('p', {class: 'form-galat', role: 'alert'});
  const sisa = p.jumlah - p.pengembalian.filter((x) => x.id !== r?.id).reduce((s, x) => s + x.jumlah, 0);
  const tglEl = tanggal('pg-tgl', r?.tanggal || hariIni(), {required: true});
  const jumlah = uang('pg-jumlah', r ? r.jumlah : sisa);
  const catatan = teks('pg-catatan', r?.catatan);
  const simpan = h('button', {class: 'btn btn-utama', type: 'submit'}, 'Simpan');
  let dlg;
  const form = h('form', {class: 'form', onsubmit: async (ev) => {
    ev.preventDefault();
    galat.textContent = '';
    try {
      await sambilMenyimpan(simpan, () => store.keu.simpanPengembalian(r?.id, {pinjaman_id: p.id, tanggal: tglEl.value, jumlah: jumlah.nilai() || 0, catatan: catatan.value.trim() || null}));
      dlg.close(); await segarkanKeuangan(); pesan('Pengembalian pinjaman tersimpan (tanpa jurnal).');
    } catch (e) { galat.textContent = e.message; }
  }},
    h('p', null, 'Dari ' + p.ke_proyek + ' kembali ke ' + sumberNama(p.dari_proyek) + ' · sisa ', h('b', null, rp(sisa))),
    h('div', {class: 'form-grid'}, medan('Tanggal', tglEl, {wajib: true}), medan('Jumlah dikembalikan', jumlah.el, {wajib: true, id: 'pg-jumlah'}), medan('Catatan', catatan, {lebar: true})),
    galat,
    kaki(r && tombolHapus(async () => { await store.keu.hapusPengembalian(r.id); dlg.close(); await segarkanKeuangan(); pesan('Pengembalian dihapus.'); }),
      h('span', {class: 'pegas'}), h('button', {class: 'btn', type: 'button', onclick: () => dlg.close()}, 'Batal'), simpan));
  dlg = dialog('Pengembalian pinjaman', form);
}

// Dipanggil setelah penerimaan termin disimpan: tawarkan pengembalian pinjaman proyek itu.
export function tawarkanPengembalian(kode) {
  if (!kode || !bisa()) return;
  const aktif = (S.d.pinjaman || []).filter((p) => p.ke_proyek === kode && p.sisa > 0);
  if (!aktif.length) return;
  let dlg;
  dlg = dialog('Pinjaman proyek ' + kode, h('div', null,
    ...aktif.map((p) => h('div', {class: 'kotak-info'}, 'Proyek ini masih punya pinjaman ' + rp(p.sisa) + ' dari ' + sumberNama(p.dari_proyek) + '. Kembalikan sekarang?',
      h('div', {class: 'baris-tombol'}, h('button', {class: 'btn btn-utama btn-kecil', type: 'button', onclick: () => { dlg.close(); bukaFormPengembalian(p, null); }}, 'Kembalikan sekarang')))),
    kaki(h('span', {class: 'pegas'}), h('button', {class: 'btn', type: 'button', onclick: () => dlg.close()}, 'Nanti saja'))));
}
