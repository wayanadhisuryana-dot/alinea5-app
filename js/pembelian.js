// Tahap 4B — Pembelian material: nota supplier untuk proyek atau stok kantor, dana perusahaan atau titipan klien, tunai atau tempo.
// Setiap baris menambah riwayat harga barang (Barang & Harga). Pembelian tempo menjadi Hutang Supplier sampai dibayar.
import {S, segarkan, segarkanKeuangan} from './state.js';
import {hariIni} from './calc.js';
import {store, idBaru} from './store.js';
import {bisaUbah} from './akses.js';
import {h, rp, tgl, isi, pill, pesan, sambilMenyimpan, pilihCari, kepalaUrut, bandingkan, formatUang} from './ui.js';
import {medan, teks, tanggal, pilihan, uang, centang, kaki, tombolHapus, catatanKunci, namaRekening, pilihBukti, tombolBukti} from './keuangan.js';
import {terkunci, akunKode} from './keuangan-data.js';
import {SUMBER_DANA, CARA_BAYAR, TUJUAN_BELI, hitungPembelian, periksaPembelian, subtotalBaris} from './proyek-util.js';
import {pkpPada, tambahHari, bagi} from './kontrak-util.js';
import {satuanBarang} from './master-util.js';
import {bukaFormBarang} from './barang.js';
import {K, namaProyek, angkaId, bacaDesimalId, ubin, dialogLebar, opsiProyek, opsiSupplier, opsiBarang, barangDari, hargaTerakhir, belumSiap} from './proyek-bersama.js';

const bisa = () => bisaUbah('pembelian');
const beliDari = (id) => S.d.pembelian.find((b) => b.id === id);
const supplierDari = (id) => S.db.supplier.find((x) => x.id === id);
const nm = (kode) => kode + ' ' + (akunKode(K(), kode)?.nama || '');

// =====================================================================
// Tabel pembelian (menu Pembelian dan tab Pembelian di Detail Proyek)
// =====================================================================
S.urutBeli = S.urutBeli || {k: 'tanggal', arah: -1};
export function tabelPembelian(rows, {kosongTeks = 'Belum ada pembelian.', denganProyek = true} = {}) {
  const KOLOM = [['tanggal', 'Tanggal'], ['supplier_nama', 'Supplier'], ['no_nota', 'No. nota'], denganProyek && ['nama_proyek', 'Untuk'], ['sumber_dana', 'Sumber dana'],
    ['cara_bayar', 'Cara bayar'], ['total', 'Total', true], ['sisa', 'Sisa hutang', true], ['status', 'Status'], [null, 'Nota']].filter(Boolean);
  const badan = h('tbody'), tabel = h('table', {class: 'tabel'}, h('thead'), badan);
  const gambar = () => {
    const urut = rows.slice().sort((a, b) => bandingkan(a[S.urutBeli.k], b[S.urutBeli.k]) * S.urutBeli.arah || bandingkan(b.dibuat, a.dibuat));
    tabel.querySelector('thead').replaceWith(kepalaUrut(KOLOM, S.urutBeli, gambar));
    badan.replaceChildren(...(urut.length ? urut.map((b) => {
      const buka = () => { location.hash = '#pembelian-' + b.id; };
      return h('tr', {class: 'bisa-klik', tabindex: '0', onclick: buka, onkeydown: (ev) => { if (ev.key === 'Enter') buka(); }},
        h('td', {class: 'nw'}, tgl(b.tanggal)), h('td', null, b.supplier_nama, h('span', {class: 'kecil redup blok'}, b.baris.length + ' barang')), h('td', null, isi(b.no_nota)),
        denganProyek && h('td', null, b.nama_proyek), h('td', null, pill(b.sumber_dana === 'titipan' ? 'Dana titipan klien' : 'Dana perusahaan')),
        h('td', null, b.cara_bayar === 'tempo' ? 'Tempo s.d. ' + tgl(b.jatuh_tempo) : 'Tunai'), h('td', {class: 'kanan'}, rp(b.total)),
        h('td', {class: 'kanan'}, b.cara_bayar === 'tempo' ? rp(Math.max(0, b.sisa)) : '—'), h('td', null, pill(b.status)), h('td', null, tombolBukti(b.file)));
    }) : [h('tr', null, h('td', {colspan: String(KOLOM.length), class: 'redup'}, kosongTeks))]));
  };
  gambar();
  return h('div', {class: 'gulir'}, tabel);
}

S.saringBeli = S.saringBeli || {proyek: '', status: '', q: ''};
export function renderPembelian(el) {
  el.append(h('div', {class: 'kepala'}, h('h1', null, 'Pembelian Material'),
    h('p', {class: 'redup'}, 'Nota pembelian dari supplier, untuk proyek atau stok kantor. Harga tiap baris otomatis masuk riwayat harga di Barang & Harga.')));
  if (belumSiap(el)) return;
  const sr = S.saringBeli, wadah = h('div'), hitungan = h('span', {class: 'redup kecil'});
  const tempo = S.d.pembelian.filter((b) => b.cara_bayar === 'tempo' && b.sisa > 0);
  el.append(h('section', {class: 'ubin-grid', 'aria-label': 'Ringkasan pembelian'},
    ubin('Hutang supplier', rp(tempo.reduce((s, b) => s + b.sisa, 0)), tempo.length + ' nota tempo belum lunas'),
    ubin('Lewat jatuh tempo', rp(tempo.filter((b) => b.status === 'Lewat jatuh tempo').reduce((s, b) => s + b.sisa, 0)), tempo.filter((b) => b.status === 'Lewat jatuh tempo').length + ' nota',
      {buruk: tempo.some((b) => b.status === 'Lewat jatuh tempo')}),
    ubin('Pembelian bulan ini', rp(S.d.pembelian.filter((b) => b.tanggal?.slice(0, 7) === hariIni().slice(0, 7)).reduce((s, b) => s + b.total, 0)), 'semua sumber dana')));
  const gambar = () => {
    const q = sr.q.trim().toLowerCase();
    const rows = S.d.pembelian.filter((b) => (!sr.proyek || (sr.proyek === '-stok' ? b.tujuan === 'stok' : b.proyek_kode === sr.proyek)) && (!sr.status || b.status === sr.status)
      && (!q || [b.supplier_nama, b.no_nota, ...b.baris.map((x) => x.barang_nama)].some((x) => String(x || '').toLowerCase().includes(q))));
    hitungan.textContent = rows.length + ' nota · total ' + rp(rows.reduce((s, b) => s + b.total, 0));
    wadah.replaceChildren(tabelPembelian(rows, {kosongTeks: S.d.pembelian.length ? 'Tidak ada pembelian yang cocok dengan saringan.' : 'Belum ada pembelian. Klik "+ Pembelian".'}));
  };
  const proyekAda = [...new Set(S.d.pembelian.filter((b) => b.proyek_kode).map((b) => b.proyek_kode))].sort(bandingkan);
  el.append(h('div', {class: 'kartu'},
    h('div', {class: 'alat'},
      h('input', {type: 'search', placeholder: 'Cari supplier / nota / barang…', 'aria-label': 'Cari', value: sr.q, oninput: (ev) => { sr.q = ev.target.value; gambar(); }}),
      pilihan('sb-proyek', [['', 'Semua tujuan'], ['-stok', 'Stok kantor'], ...proyekAda.map((x) => [x, namaProyek(x)])], sr.proyek, {'aria-label': 'Saring tujuan', onchange: (ev) => { sr.proyek = ev.target.value; gambar(); }}),
      pilihan('sb-status', [['', 'Semua status'], ...['Belum dibayar', 'Dibayar sebagian', 'Lewat jatuh tempo', 'Lunas'].map((x) => [x, x])], sr.status, {'aria-label': 'Saring status', onchange: (ev) => { sr.status = ev.target.value; gambar(); }}),
      hitungan, h('span', {class: 'pegas'}),
      bisa() && h('button', {class: 'btn btn-utama', type: 'button', onclick: () => bukaFormPembelian(null)}, '+ Pembelian')),
    wadah));
  gambar();
}

// =====================================================================
// Detail satu pembelian
// =====================================================================
export function renderDetailPembelian(el, id) {
  if (belumSiap(el)) return;
  const b = beliDari(id);
  const kembali = h('a', {href: '#pembelian', class: 'kecil'}, '← Pembelian');
  if (!b) { el.append(h('div', {class: 'kepala'}, kembali, h('h1', null, 'Pembelian tidak ditemukan'))); return; }
  const tempo = b.cara_bayar === 'tempo';
  el.append(
    h('div', {class: 'kepala'}, h('div', {class: 'baris-tombol'}, kembali, b.proyek_kode && h('a', {href: '#proyek-' + (S.d.proyek.find((p) => p.kode === b.proyek_kode)?.id || ''), class: 'kecil'}, 'Buka proyek ' + b.proyek_kode + ' →')),
      h('div', {class: 'judul-baris'}, h('h1', null, b.supplier_nama + (b.no_nota ? ' · ' + b.no_nota : '')), pill(b.status), h('span', {class: 'pegas'}), b.file && tombolBukti(b.file),
        h('button', {class: 'btn', type: 'button', onclick: () => bukaFormPembelian(b)}, bisa() && !terkunci(K(), b.tanggal) ? 'Ubah' : 'Lihat isian'),
        bisa() && tempo && b.sisa > 0 && h('button', {class: 'btn btn-utama', type: 'button', onclick: () => bukaFormBayarSupplier(b, null)}, '+ Pembayaran hutang')),
      h('p', {class: 'redup'}, [tgl(b.tanggal), b.nama_proyek, SUMBER_DANA[b.sumber_dana], tempo ? 'Tempo, jatuh tempo ' + tgl(b.jatuh_tempo) : 'Tunai dari ' + namaRekening(b.rekening_id)].join(' · '))),
    h('section', {class: 'ubin-grid', 'aria-label': 'Ringkasan pembelian'},
      ubin('Total nota', rp(b.total), 'subtotal ' + rp(b.subtotal) + (b.ppn ? ' + PPN ' + rp(b.ppn) : '') + (b.ongkir ? ' + ongkir ' + rp(b.ongkir) : '')),
      ubin('Dibebankan', rp(b.biaya), b.sumber_dana === 'titipan' ? 'mengurangi Hutang Dana Titipan' : b.tujuan === 'stok' ? 'masuk Persediaan' : 'Beban Material Proyek'),
      ubin('PPN masukan dikreditkan', rp(b.ppn_kredit_nilai), b.ppn && !b.ppn_kredit_nilai ? 'PPN ikut menjadi biaya' : 'akun 1-4'),
      tempo && ubin('Sisa hutang', rp(Math.max(0, b.sisa)), 'dibayar ' + rp(b.dibayar), {buruk: b.status === 'Lewat jatuh tempo'})),
    h('section', {class: 'kartu'}, h('h2', null, 'Barang'),
      h('div', {class: 'gulir'}, h('table', {class: 'tabel'},
        h('thead', null, h('tr', null, ['Barang', 'Qty', 'Satuan', 'Harga satuan', 'Diskon', 'Subtotal'].map((x, i) => h('th', {class: i === 1 || i >= 3 ? 'kanan' : null}, x)))),
        h('tbody', null, b.baris.map((x) => h('tr', null, h('td', null, h('a', {href: '#barang-' + x.barang_id}, x.barang_nama)), h('td', {class: 'kanan'}, angkaId(x.qty)),
          h('td', null, x.satuan + (x.faktor && +x.faktor !== 1 ? ' (= ' + angkaId(x.faktor) + ' ' + (barangDari(x.barang_id)?.satuan || '') + ')' : '')),
          h('td', {class: 'kanan'}, rp(x.harga)), h('td', {class: 'kanan'}, x.diskon ? rp(x.diskon) : '—'), h('td', {class: 'kanan'}, rp(subtotalBaris(x)))))),
        h('tfoot', null,
          h('tr', null, h('th', {colspan: '5'}, 'Subtotal'), h('th', {class: 'kanan'}, rp(b.subtotal))),
          b.ppn > 0 && h('tr', null, h('th', {colspan: '5'}, 'PPN' + (b.ppn_kredit_nilai ? ' (dikreditkan)' : ' (tidak dikreditkan)')), h('th', {class: 'kanan'}, rp(b.ppn))),
          b.ongkir > 0 && h('tr', null, h('th', {colspan: '5'}, 'Ongkir'), h('th', {class: 'kanan'}, rp(b.ongkir))),
          h('tr', null, h('th', {colspan: '5'}, 'Total'), h('th', {class: 'kanan'}, rp(b.total)))))),
      b.catatan && h('p', {class: 'redup'}, b.catatan)),
    tempo && h('section', {class: 'kartu'}, h('div', {class: 'judul-baris'}, h('h2', null, 'Riwayat pembayaran hutang'), h('span', {class: 'pegas'}),
      bisa() && b.sisa > 0 && h('button', {class: 'btn btn-kecil btn-utama', type: 'button', onclick: () => bukaFormBayarSupplier(b, null)}, '+ Pembayaran')),
    h('div', {class: 'gulir'}, h('table', {class: 'tabel'},
      h('thead', null, h('tr', null, ['Tanggal', 'Jumlah', 'Rekening', 'Bukti', 'Catatan', ''].map((x, i) => h('th', {class: i === 1 ? 'kanan' : null}, x)))),
      h('tbody', null, b.pembayaran.length ? b.pembayaran.map((p) => h('tr', null, h('td', {class: 'nw'}, tgl(p.tanggal), terkunci(K(), p.tanggal) && ' 🔒'), h('td', {class: 'kanan'}, rp(p.jumlah)),
        h('td', null, namaRekening(p.rekening_id)), h('td', null, tombolBukti(p.bukti)), h('td', {class: 'lebar'}, isi(p.catatan)),
        h('td', null, h('button', {class: 'btn btn-kecil', type: 'button', onclick: () => bukaFormBayarSupplier(b, p)}, bisa() ? 'Ubah' : 'Lihat'))))
        : h('tr', null, h('td', {colspan: '6', class: 'redup'}, 'Belum ada pembayaran. Hutang ' + rp(b.total) + ' jatuh tempo ' + tgl(b.jatuh_tempo) + '.')))))));
}

// =====================================================================
// Formulir pembelian
// =====================================================================
export function bukaFormPembelian(lama, awal = {}) {
  const x = lama || awal;
  const kunciBulan = lama && terkunci(K(), lama.tanggal);
  const boleh = bisa() && !kunciBulan;
  const galat = h('p', {class: 'form-galat', role: 'alert'});
  const tglEl = tanggal('pb-tgl', x.tanggal || hariIni(), {required: true});
  const supplier = pilihCari('pb-sup', opsiSupplier(x.supplier_id), x.supplier_id || '', {wajib: true, label: 'Cari supplier', placeholder: 'Ketik nama supplier', kosongTeks: 'Tidak ada. Tambahkan dulu di menu Supplier.'});
  const supId = supplier.querySelector('input[type=hidden]');
  const nota = teks('pb-nota', x.no_nota);
  const tujuan = pilihan('pb-tujuan', Object.entries(TUJUAN_BELI), x.tujuan || 'proyek');
  const proyek = pilihCari('pb-proyek', opsiProyek(), x.proyek_kode || '', {wajib: true, label: 'Cari proyek', placeholder: 'Ketik kode / nama proyek'});
  const proyekId = proyek.querySelector('input[type=hidden]');
  const sumber = pilihan('pb-sumber', [['', 'Pilih…'], ...Object.entries(SUMBER_DANA)], x.sumber_dana || '', {required: true});
  const cara = pilihan('pb-cara', Object.entries(CARA_BAYAR), x.cara_bayar || 'tunai');
  const rekAktif = K().rekening.filter((r) => r.aktif || r.id === x.rekening_id);
  const rek = pilihan('pb-rek', [['', 'Pilih rekening…'], ...rekAktif.map((r) => [r.id, r.nama])], x.rekening_id || (rekAktif.length === 1 ? rekAktif[0].id : ''));
  const jt = tanggal('pb-jt', x.jatuh_tempo || '');
  let jtDiubah = !!x.jatuh_tempo;
  jt.addEventListener('change', () => { jtDiubah = true; });
  const ppn = uang('pb-ppn', x.ppn || '');
  const ongkir = uang('pb-ongkir', x.ongkir || '');
  const ppnKredit = centang('pb-kredit', x.ppn_kredit, 'PPN masukan dapat dikreditkan');
  const kreditInp = ppnKredit.querySelector('input');
  let kreditDiubah = !!lama;
  kreditInp.addEventListener('change', () => { kreditDiubah = true; });
  const file = pilihBukti('pb-file', lama?.file, {label: 'Foto / PDF nota'});
  // Tahap 5: barang modal di bawah batas kapitalisasi (untuk Laporan Pajak aset), hanya stok kantor.
  const asetSiap = K().aset_siap !== false;
  const modal = centang('pb-modal', x.barang_modal, 'Barang modal di bawah batas kapitalisasi');
  const modalInp = modal.querySelector('input');
  const mModal = h('div', {class: 'medan medan-lebar'}, modal, h('span', {class: 'kecil redup'}, 'Centang bila barang ini sebenarnya barang modal (alat, perabot) yang nilainya di bawah batas kapitalisasi, jadi dibebankan. Masuk Laporan Pajak → (c).'));
  const catatan = h('textarea', {id: 'pb-catatan', rows: '2'}, x.catatan ?? '');

  // Baris barang
  const opsiB = opsiBarang('barang', (lama?.baris || []).map((b) => b.barang_id));
  const badan = h('tbody'), baris = [];
  let nomor = 0;
  const tambahBaris = (it = {}) => {
    const i = ++nomor;
    const pilih = pilihCari('pbb-' + i, opsiB, it.barang_id || '', {wajib: true, label: 'Barang', placeholder: 'Ketik nama barang', kosongTeks: 'Tidak ada. Klik "+ Barang baru".'});
    const bid = pilih.querySelector('input[type=hidden]');
    const satuan = h('select', {'aria-label': 'Satuan'});
    const qty = h('input', {type: 'text', inputmode: 'decimal', class: 'kanan', 'aria-label': 'Qty', value: it.qty != null ? String(it.qty).replace('.', ',') : ''});
    const harga = uang('pbh-' + i, it.harga ?? '');
    const diskon = uang('pbd-' + i, it.diskon || '');
    const sub = h('td', {class: 'kanan nw'});
    const isiSatuan = (pilihS) => {
      const b = barangDari(bid.value), daftar = b ? satuanBarang(b) : [];
      satuan.replaceChildren(...daftar.map((s) => h('option', {value: s, selected: s === pilihS}, s)));
    };
    const isiHarga = () => {
      const hg = bid.value && hargaTerakhir(bid.value, supId.value, satuan.value);
      if (hg != null && !harga.nilai()) harga.inp.value = formatUang(String(hg));
    };
    isiSatuan(it.satuan);
    bid.addEventListener('change', () => { isiSatuan(barangDari(bid.value)?.satuan); harga.inp.value = ''; isiHarga(); segar(); });
    satuan.addEventListener('change', () => { harga.inp.value = ''; isiHarga(); segar(); });
    [qty, harga.inp, diskon.inp].forEach((e) => e.addEventListener('input', () => segar()));
    const item = {pilih, bid, satuan, qty, harga, diskon, sub};
    const tr = h('tr', null, h('td', {class: 'lebar'}, pilih), h('td', null, qty), h('td', null, satuan), h('td', null, harga.el), h('td', null, diskon.el), sub,
      h('td', null, h('button', {class: 'btn btn-kecil', type: 'button', onclick: () => { baris.splice(baris.indexOf(item), 1); tr.remove(); segar(); }}, 'Hapus')));
    baris.push(item); badan.append(tr);
    return item;
  };
  const bacaBaris = () => baris.map((b) => ({barang_id: b.bid.value, satuan: b.satuan.value, qty: bacaDesimalId(b.qty.value), harga: b.harga.nilai() ?? 0, diskon: b.diskon.nilai() || 0}));
  (lama?.baris || []).forEach(tambahBaris);
  if (!baris.length) tambahBaris();
  const barangBaru = () => bukaFormBarang(null, 'barang', {setelahSimpan: (idB) => {
    const b = barangDari(idB);
    if (b) opsiB.push({v: b.id, label: b.nama, sub: [b.kode, b.merk, b.satuan].filter(Boolean).join(' · ')});
    const kosong = baris.find((x) => !x.bid.value) || tambahBaris();
    kosong.bid.pilih(idB);
  }});

  const mProyek = medan('Proyek', proyek, {wajib: true, id: 'pb-proyek-cari'});
  const mRek = medan('Rekening pembayaran', rek, {wajib: true});
  const mJt = medan('Jatuh tempo', jt, {wajib: true});
  const ringkas = h('div', {class: 'kotak-info kecil'});
  const totalEl = h('b');
  const nilaiP = () => ({tanggal: tglEl.value, supplier_id: supId.value, no_nota: nota.value.trim(), tujuan: tujuan.value, proyek_kode: tujuan.value === 'proyek' ? proyekId.value : null,
    sumber_dana: sumber.value, cara_bayar: cara.value, rekening_id: cara.value === 'tunai' ? rek.value || null : null, jatuh_tempo: cara.value === 'tempo' ? jt.value || null : null,
    ppn: ppn.nilai() || 0, ongkir: ongkir.nilai() || 0, ppn_kredit: kreditInp.checked && sumber.value === 'perusahaan' && (ppn.nilai() || 0) > 0, catatan: catatan.value.trim() || null,
    ...(asetSiap ? {barang_modal: tujuan.value === 'stok' && modalInp.checked} : {})});
  const segar = () => {
    const sup = supplierDari(supId.value);
    mProyek.hidden = tujuan.value !== 'proyek';
    mModal.hidden = !asetSiap || tujuan.value !== 'stok';
    sumber.querySelector('option[value=titipan]').disabled = tujuan.value === 'stok';
    if (tujuan.value === 'stok' && sumber.value === 'titipan') sumber.value = 'perusahaan';
    mRek.hidden = cara.value !== 'tunai'; mJt.hidden = cara.value !== 'tempo';
    if (cara.value === 'tempo' && !jtDiubah && tglEl.value) jt.value = tambahHari(tglEl.value, sup?.termin === 'Tempo' ? +sup.tempo_hari || 0 : 30);
    const pkpKami = pkpPada(S.profil, tglEl.value);
    if (!kreditDiubah) kreditInp.checked = pkpKami && !!sup?.pkp;
    ppnKredit.hidden = sumber.value !== 'perusahaan' || !(ppn.nilai() > 0);
    const br = bacaBaris();
    baris.forEach((b, i) => { const r = br[i]; b.sub.textContent = r.qty > 0 ? rp(subtotalBaris(r)) : '—'; });
    const p = nilaiP(), v = hitungPembelian(p, br.filter((r) => r.qty > 0));
    totalEl.textContent = 'Total ' + rp(v.total);
    const titipan = p.sumber_dana === 'titipan', dompet = p.proyek_kode && S.d.dompet[p.proyek_kode];
    const lamaTitipan = lama && lama.sumber_dana === 'titipan' && lama.proyek_kode === p.proyek_kode ? lama.dibayar : 0;
    const sisaTitipan = dompet ? dompet.saldo_titipan + lamaTitipan : 0;
    const debit = titipan ? [['2-4', v.total]] : [[p.tujuan === 'stok' ? '1-6' : '5-1', v.biaya], ...(v.ppn_kredit_nilai ? [['1-4', v.ppn_kredit_nilai]] : [])];
    ringkas.replaceChildren(...[
      h('b', null, 'Jurnal otomatis:'),
      ...debit.map(([k, n]) => h('div', null, 'D ' + nm(k) + ' ' + rp(n))),
      h('div', null, 'K ' + (p.cara_bayar === 'tempo' ? nm('2-3') : p.rekening_id ? namaRekening(p.rekening_id) : 'rekening') + ' ' + rp(v.total)),
      p.ppn > 0 && p.sumber_dana === 'perusahaan' && !p.ppn_kredit && h('div', {class: 'redup'}, 'PPN tidak dikreditkan: ikut menjadi biaya.'),
      p.ppn_kredit && !pkpKami && h('div', {class: 'form-galat'}, 'Perusahaan belum PKP pada tanggal ini (Pengaturan → Profil perusahaan); PPN tidak bisa dikreditkan.'),
      p.ppn_kredit && sup && !sup.pkp && h('div', {class: 'form-galat'}, '⚠ Supplier ini tercatat bukan PKP. Pastikan ada faktur pajak sebelum mengkreditkan PPN.'),
      titipan && p.cara_bayar === 'tunai' && dompet && v.total > sisaTitipan && h('div', {class: 'form-galat'}, '⚠ Dana titipan proyek ' + p.proyek_kode + ' tinggal ' + rp(sisaTitipan) + '. Tetap boleh disimpan; dompet titipan akan minus (dibiayai dana lain).'),
      terkunci(K(), tglEl.value) && h('div', {class: 'form-galat'}, 'Bulan ' + tglEl.value.slice(0, 7) + ' sudah ditutup.'),
    ].filter(Boolean));
  };
  const hitungPpn = h('button', {class: 'btn btn-kecil', type: 'button', onclick: () => {
    const v = hitungPembelian({}, bacaBaris().filter((r) => r.qty > 0));
    ppn.inp.value = formatUang(String(bagi(v.subtotal, K().akuntansi.tarif_ppn_bp || 0, 10000))); segar();
  }}, 'Hitung PPN ' + ((K().akuntansi.tarif_ppn_bp || 0) / 100).toLocaleString('id-ID') + '%');
  [tglEl, tujuan, sumber, cara, rek, jt].forEach((e) => e.addEventListener('change', segar));
  [supId, proyekId].forEach((e) => e.addEventListener('change', segar));
  [ppn.inp, ongkir.inp].forEach((e) => e.addEventListener('input', segar));
  const simpan = h('button', {class: 'btn btn-utama', type: 'submit'}, 'Simpan');
  let dlg;
  const form = h('form', {class: 'form', onsubmit: async (ev) => {
    ev.preventDefault();
    galat.textContent = '';
    const p = nilaiP(), br = bacaBaris();
    if (br.some((r) => Number.isNaN(r.qty))) { galat.textContent = 'Qty diisi angka, maksimal 3 desimal (mis. 2,5).'; return; }
    const salah = periksaPembelian(p, br, {proyek: S.db.proyek.map((q) => q.kode)});
    if (salah.length) { galat.textContent = salah[0]; return; }
    try {
      await sambilMenyimpan(simpan, async () => {
        p.file = await file.ambil('pembelian/' + (lama?.id || idBaru()));
        const hasil = await store.keu.simpanPembelian(lama?.id, p, br.map((r) => ({...r, qty: r.qty})));
        dlg.close();
        await segarkan();
        pesan('Pembelian tersimpan, dijurnal, dan harga masuk riwayat Barang & Harga.');
        location.hash = '#pembelian-' + (typeof hasil === 'string' ? hasil : hasil.id);
      });
    } catch (e) { galat.textContent = e.message; }
  }},
    kunciBulan && catatanKunci(lama.tanggal),
    lama?.pembayaran?.length > 0 && h('div', {class: 'kotak-info'}, 'Sudah ada pembayaran hutang ' + rp(lama.dibayar) + ': cara bayar harus tetap tempo dan total tidak boleh di bawah yang sudah dibayar.'),
    h('div', {class: 'form-grid'},
      medan('Tanggal', tglEl, {wajib: true}), medan('Supplier (master Supplier)', supplier, {wajib: true, id: 'pb-sup-cari'}), medan('No. nota', nota),
      medan('Untuk', tujuan, {wajib: true}), mProyek,
      medan('Sumber dana', sumber, {wajib: true, bantuan: 'Dana titipan klien mengurangi Hutang Dana Titipan, bukan beban perusahaan.'}),
      medan('Cara bayar', cara, {wajib: true}), mRek, mJt),
    h('div', {class: 'medan medan-lebar'}, h('label', null, 'Barang'),
      h('div', {class: 'gulir'}, h('table', {class: 'tabel tabel-isian'}, h('thead', null, h('tr', null, ['Barang (master)', 'Qty', 'Satuan', 'Harga satuan', 'Diskon (Rp)', 'Subtotal', ''].map((t) => h('th', null, t)))), badan)),
      h('div', {class: 'baris-tombol'}, h('button', {class: 'btn btn-kecil', type: 'button', onclick: () => { tambahBaris(); segar(); }}, '+ Baris'),
        bisaUbah('barang') && h('button', {class: 'btn btn-kecil', type: 'button', onclick: barangBaru}, '+ Barang baru'), h('span', {class: 'pegas'}), totalEl),
      h('span', {class: 'kecil redup'}, 'Harga bawaan diambil dari harga terakhir barang itu (dari supplier yang sama bila ada). Satuan beli dikonversi ke satuan dasar barang.')),
    h('div', {class: 'form-grid'},
      medan('PPN', h('div', {class: 'baris-tombol'}, ppn.el, hitungPpn), {id: 'pb-ppn'}), medan('Ongkir', ongkir.el, {id: 'pb-ongkir'}),
      h('div', {class: 'medan medan-lebar'}, ppnKredit, h('span', {class: 'kecil redup'}, 'Bawaan: dicentang bila perusahaan PKP pada tanggal nota dan supplier PKP. Bisa diubah.')),
      mModal, file.el, medan('Catatan', catatan, {lebar: true})),
    ringkas, galat,
    kaki(lama && boleh && !lama.pembayaran.length && tombolHapus(async () => { await store.keu.hapusPembelian(lama.id); dlg.close(); location.hash = '#pembelian'; await segarkan(); pesan('Pembelian dihapus beserta jurnal dan riwayat harganya.'); }),
      h('span', {class: 'pegas'}), h('button', {class: 'btn', type: 'button', onclick: () => dlg.close()}, boleh ? 'Batal' : 'Tutup'), boleh && simpan));
  if (!boleh) form.querySelectorAll('input,select,textarea,.tabel-isian button,.baris-tombol button').forEach((e) => { e.disabled = true; });
  dlg = dialogLebar(lama ? 'Pembelian ' + tgl(lama.tanggal) : 'Pembelian baru', form);
  segar();
}

// =====================================================================
// Pembayaran hutang supplier (pembelian tempo)
// =====================================================================
export function bukaFormBayarSupplier(b, p) {
  const kunciBulan = p && terkunci(K(), p.tanggal);
  const boleh = bisa() && !kunciBulan;
  const galat = h('p', {class: 'form-galat', role: 'alert'});
  const sisa = b.total - b.pembayaran.filter((x) => x.id !== p?.id).reduce((s, x) => s + x.jumlah, 0);
  const tglEl = tanggal('bs-tgl', p?.tanggal || hariIni(), {required: true});
  const jumlah = uang('bs-jumlah', p ? p.jumlah : sisa);
  const rekAktif = K().rekening.filter((r) => r.aktif || r.id === p?.rekening_id);
  const rek = pilihan('bs-rek', [['', 'Pilih rekening…'], ...rekAktif.map((r) => [r.id, r.nama])], p?.rekening_id || (rekAktif.length === 1 ? rekAktif[0].id : ''));
  const bukti = pilihBukti('bs-bukti', p?.bukti, {label: 'Bukti transfer'});
  const catatan = h('textarea', {id: 'bs-catatan', rows: '2'}, p?.catatan ?? '');
  const info = h('div', {class: 'kotak-info kecil'});
  const segar = () => {
    const j = jumlah.nilai() || 0;
    info.replaceChildren(...[h('b', null, 'Jurnal otomatis:'), h('div', null, 'D ' + nm('2-3') + ' ' + rp(j)), h('div', null, 'K ' + (rek.value ? namaRekening(rek.value) : 'rekening') + ' ' + rp(j)),
      j > sisa && h('div', {class: 'form-galat'}, 'Melebihi sisa hutang (' + rp(sisa) + ').'),
      terkunci(K(), tglEl.value) && h('div', {class: 'form-galat'}, 'Bulan ' + tglEl.value.slice(0, 7) + ' sudah ditutup.')].filter(Boolean));
  };
  [tglEl, rek].forEach((e) => e.addEventListener('change', segar)); jumlah.inp.addEventListener('input', segar);
  const simpan = h('button', {class: 'btn btn-utama', type: 'submit'}, 'Simpan');
  let dlg;
  const form = h('form', {class: 'form', onsubmit: async (ev) => {
    ev.preventDefault();
    galat.textContent = '';
    const d = {pembelian_id: b.id, tanggal: tglEl.value, jumlah: jumlah.nilai() || 0, rekening_id: rek.value || null, catatan: catatan.value.trim() || null};
    if (!d.rekening_id) { galat.textContent = 'Rekening pembayar wajib dipilih.'; rek.focus(); return; }
    try {
      await sambilMenyimpan(simpan, async () => {
        d.bukti = await bukti.ambil('pembelian/' + b.id);
        await store.keu.simpanBayarSupplier(p?.id, d);
      });
      dlg.close(); await segarkanKeuangan(); pesan('Pembayaran hutang supplier tersimpan dan dijurnal.');
    } catch (e) { galat.textContent = e.message; }
  }},
    kunciBulan && catatanKunci(p.tanggal),
    h('p', null, b.supplier_nama + (b.no_nota ? ' · ' + b.no_nota : '') + ' · sisa hutang ', h('b', null, rp(sisa)), ' · jatuh tempo ' + tgl(b.jatuh_tempo)),
    h('div', {class: 'form-grid'}, medan('Tanggal', tglEl, {wajib: true}), medan('Rekening pembayar', rek, {wajib: true}),
      medan('Jumlah dibayar', jumlah.el, {wajib: true, id: 'bs-jumlah'}), bukti.el, medan('Catatan', catatan, {lebar: true})),
    info, galat,
    kaki(p && boleh && tombolHapus(async () => { await store.keu.hapusBayarSupplier(p.id); dlg.close(); await segarkanKeuangan(); pesan('Pembayaran dihapus beserta jurnalnya.'); }),
      h('span', {class: 'pegas'}), h('button', {class: 'btn', type: 'button', onclick: () => dlg.close()}, boleh ? 'Batal' : 'Tutup'), boleh && simpan));
  if (!boleh) form.querySelectorAll('input,select,textarea').forEach((e) => { e.disabled = true; });
  dlg = dialogLebar('Pembayaran hutang supplier', form);
  segar();
}
