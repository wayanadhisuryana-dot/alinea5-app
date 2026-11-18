// Tahap 2 — Barang & Harga: master barang (dan item Harga Pekerjaan) dengan konversi satuan dan riwayat harga.
// Riwayat harga tidak pernah menimpa: setiap pembelian / penawaran / input adalah baris baru.
import {OPSI} from './schema.js';
import {S, segarkan} from './state.js';
import {store, BUCKET_MASTER, idBaru} from './store.js';
import {hariIni} from './calc.js';
import {bisaUbah} from './akses.js';
import {h, idn, rp, tgl, isi, pill, pesan, aman, dialog, formatUang, bacaUang, pilihCari, bandingkan, kepalaUrut} from './ui.js';
import {medan, teks, pilihan, centang, nilaiCentang, daftarBerkas, bukaBerkas, tombolHapus, kotakPeringatan, tombolExcel, bukaPratinjau, simpanImpor} from './master.js';
import {validasiBarang, duplikatBarang, kodeBerikut, validasiHarga, ringkasHarga, hargaBaku, ongkirBaku, faktorSatuan, satuanBarang, fmtDesimal, bacaDesimal, mirip,
  SUMBER_HARGA, SUMBER_OTOMATIS, HARGA_LAMA_BAWAAN, normNamaBarang} from './master-util.js';
import {DEF, konversiKeTeks} from './master-excel.js';
import {evaluasiMaster, evaluasiHargaImpor} from './master-impor.js';

export const bulanHargaLama = () => +S.pengaturan?.data?.harga_lama_bulan || HARGA_LAMA_BAWAAN;
const JENIS = {barang: {judul: 'Barang', satuan: 'barang', pihakTabel: 'supplier', pihakLabel: 'Supplier'}, pekerjaan: {judul: 'Harga Pekerjaan', satuan: 'item pekerjaan', pihakTabel: 'vendor_tukang', pihakLabel: 'Vendor / tukang'}};
const jenisDari = (b) => b.jenis || 'barang';
const hargaDari = (bid) => S.db.harga.filter((x) => x.barang_id === bid);
const namaPihak = (r, jenis) => (r.pihak_id && S.db[JENIS[jenis].pihakTabel]?.find((x) => x.id === r.pihak_id)?.nama) || r.pihak_nama || '—';
// Harga rupiah dalam satuan baku (bisa berkoma) ditampilkan dibulatkan ke rupiah.
const rpBaku = (x) => (x == null ? '—' : rp(x));
const persenUbah = (x) => (x == null ? '—' : (x > 0 ? '▲ ' : x < 0 ? '▼ ' : '') + idn(Math.abs(x) * 100, 1) + '%');

// ---------- daftar ----------
S.tabBarang = S.tabBarang || 'barang';
S.urutBarang = S.urutBarang || {k: 'kode', arah: 1};
S.saringBarang = S.saringBarang || {kategori: '', status: 'Aktif', lama: false};

export function renderBarang(el) {
  const jenis = S.tabBarang, J = JENIS[jenis], bisa = bisaUbah('barang'), sb = S.saringBarang, today = hariIni(), batas = bulanHargaLama();
  const daftarKat = jenis === 'pekerjaan' ? OPSI.kategoriPekerjaan : OPSI.kategoriBarang;
  const semua = S.db.barang.filter((b) => jenisDari(b) === jenis).map((b) => {
    const r = ringkasHarga(hargaDari(b.id), today, batas);
    return {...b, status: b.aktif === false ? 'Nonaktif' : 'Aktif', _r: r, harga_terakhir: r.hargaTerakhir ?? null, tgl_terakhir: r.tanggalTerakhir || '', rata12: r.rata12 ?? null,
      penanda: !r.jumlah ? 'Belum ada harga' : r.lama ? 'Harga lama' : ''};
  });
  const saring = () => {
    const q = S.cari.trim().toLowerCase();
    return semua.filter((b) => (!sb.kategori || b.kategori === sb.kategori) && (!sb.status || b.status === sb.status) && (!sb.lama || b.penanda)
      && (!q || [b.kode, b.nama, b.merk, b.spesifikasi, b.kategori].some((v) => String(v ?? '').toLowerCase().includes(q))))
      .sort((a, b) => bandingkan(a[S.urutBarang.k], b[S.urutBarang.k]) * S.urutBarang.arah || bandingkan(a.kode, b.kode));
  };
  const kodeAda = () => S.db.barang.filter((b) => jenisDari(b) === jenis);
  const excelBarang = tombolExcel({def: () => DEF.barang(jenis), nama: jenis === 'pekerjaan' ? 'item pekerjaan' : 'barang', bolehImpor: bisa,
    baris: () => saring().map((b) => ({kode: b.kode, nama: b.nama, kategori: b.kategori, satuan: b.satuan, merk: b.merk, spesifikasi: b.spesifikasi, konversi: konversiKeTeks(b.konversi), status: b.status})),
    saatImpor: (isiFile) => bukaPratinjau({judul: 'Pratinjau impor ' + J.satuan, satuan: J.satuan, def: () => DEF.barang(jenis),
      hasil: evaluasiMaster('barang', isiFile, {ada: S.db.barang}, {jenisBarang: jenis}),
      kepala: ['Kode', 'Nama', 'Kategori', 'Satuan baku', 'Konversi'], sel: (r) => [h('td', null, r.data.kode || (r.cocok?.kode ?? 'otomatis')), h('td', null, r.data.nama), h('td', null, r.data.kategori), h('td', null, r.data.satuan), h('td', {class: 'kecil'}, konversiKeTeks(r.data.konversi) || '—')],
      simpan: (dipilih) => {
        const terpakai = kodeAda().slice();
        return simpanImpor('barang', dipilih, (d) => { const kode = kodeBerikut(d.kategori, terpakai, jenis); terpakai.push({kode}); return {...d, kode}; });
      }})});
  const excelHarga = tombolExcel({def: () => DEF.harga(jenis), nama: 'harga ' + J.satuan, bolehImpor: bisa,
    daftar: () => [{judul: 'Daftar kode', kolom: ['Kode', 'Nama', 'Satuan baku', 'Konversi'], baris: kodeAda().map((b) => [b.kode, b.nama, b.satuan, konversiKeTeks(b.konversi)])},
      {judul: 'Daftar ' + J.pihakLabel.toLowerCase().replace(/ \/ /g, '-'), kolom: ['Nama'], baris: S.db[J.pihakTabel].filter((x) => x.aktif !== false).map((x) => [x.nama])}],
    baris: () => S.db.harga.filter((r) => kodeAda().some((b) => b.id === r.barang_id)).sort((a, b) => bandingkan(a.tanggal, b.tanggal)).map((r) => {
      const b = S.db.barang.find((x) => x.id === r.barang_id);
      return {kode_barang: b.kode, nama_barang: b.nama, tanggal: r.tanggal, pihak: namaPihak(r, jenis) === '—' ? '' : namaPihak(r, jenis), harga: r.harga, satuan: r.satuan, ppn: r.ppn ? 'Ya' : 'Tidak', ongkir: r.ongkir, proyek_kode: r.proyek_kode, catatan: r.catatan};
    }),
    saatImpor: (isiFile) => bukaPratinjau({judul: 'Pratinjau impor riwayat harga', satuan: 'harga', def: () => DEF.harga(jenis),
      hasil: evaluasiHargaImpor(isiFile, {barang: kodeAda(), pihak: S.db[J.pihakTabel], proyek: S.db.proyek.map((p) => p.kode).filter(Boolean), ada: S.db.harga}),
      kepala: ['Kode', 'Tanggal', J.pihakLabel, 'Harga', 'Per satuan baku'], sel: (r) => [h('td', null, r.barang?.kode || isi(r.nilai.kode_barang)), h('td', null, tgl(r.data.tanggal)), h('td', null, isi(r.data.pihak_nama)),
        h('td', {class: 'kanan'}, r.data.harga ? rp(r.data.harga) + ' / ' + r.data.satuan : '—'), h('td', {class: 'kanan'}, r.data.harga ? rpBaku(hargaBaku(r.data)) + ' / ' + r.barang.satuan : '—')],
      simpan: (dipilih) => simpanImpor('harga', dipilih, (d) => ({...d, dibuat: new Date().toISOString(), dibuat_oleh: S.user?.email}))})});

  const KOLOM = [['kode', 'Kode'], ['nama', 'Nama'], ['kategori', 'Kategori'], ['satuan', 'Satuan baku'], ['harga_terakhir', 'Harga terakhir', true], ['tgl_terakhir', 'Tanggal'], ['rata12', 'Rata-rata 12 bln', true], ['penanda', 'Penanda']];
  const badan = h('tbody'), hitungan = h('span', {class: 'redup kecil'});
  const tabel = h('table', {class: 'tabel'}, h('thead'), badan);
  const gambar = () => {
    const rows = saring();
    hitungan.textContent = rows.length + ' dari ' + semua.length + ' ' + J.satuan;
    tabel.querySelector('thead').replaceWith(kepalaUrut(KOLOM, S.urutBarang, gambar));
    badan.replaceChildren(...(rows.length ? rows.map((b) => h('tr', {class: 'bisa-klik', tabindex: '0', onclick: () => { location.hash = '#barang-' + b.id; }, onkeydown: (ev) => { if (ev.key === 'Enter') location.hash = '#barang-' + b.id; }},
      h('td', {class: 'nw'}, b.kode), h('td', null, h('a', {href: '#barang-' + b.id, onclick: (ev) => ev.stopPropagation()}, b.nama), (b.merk || b.spesifikasi) && h('span', {class: 'kecil redup blok'}, [b.merk, b.spesifikasi].filter(Boolean).join(' · ')), b.status === 'Nonaktif' && [' ', pill('Nonaktif')]),
      h('td', null, b.kategori), h('td', null, b.satuan, b.konversi?.length && h('span', {class: 'kecil redup blok'}, konversiKeTeks(b.konversi))),
      h('td', {class: 'kanan'}, rpBaku(b.harga_terakhir)), h('td', {class: 'nw'}, tgl(b.tgl_terakhir)), h('td', {class: 'kanan'}, rpBaku(b.rata12)),
      h('td', null, b.penanda === 'Harga lama' ? h('span', {class: 'pill pill-waspada', title: 'Harga terakhir lebih tua dari ' + batas + ' bulan'}, 'Harga lama – perlu cek ulang') : b.penanda ? h('span', {class: 'pill pill-netral'}, b.penanda) : '')))
      : [h('tr', null, h('td', {colspan: String(KOLOM.length), class: 'redup'}, 'Tidak ada ' + J.satuan + ' yang cocok dengan pencarian atau saringan.'))]));
  };
  el.append(
    h('div', {class: 'kepala'}, h('h1', null, 'Barang & Harga'),
      h('p', {class: 'redup'}, 'Database barang dan harga satuan. Harga selalu bisa dilihat per satuan baku. Riwayat harga terisi dari input manual atau impor, dan nanti otomatis dari Pembelian Material (Tahap 4). Data ini kelak dipakai modul RAB.')),
    h('div', {class: 'tabs', role: 'tablist'}, Object.entries(JENIS).map(([k, j]) => h('button', {class: 'tab', type: 'button', role: 'tab', 'aria-selected': String(jenis === k), onclick: () => { S.tabBarang = k; sb.kategori = ''; S.render(); }}, j.judul))));
  const panel = h('div', {class: 'kartu', role: 'tabpanel'});
  el.append(panel);
  if (jenis === 'pekerjaan') panel.append(h('p', {class: 'kecil redup'}, 'Harga satuan pekerjaan (mis. kitchen set per m\', plafon per m²). Nanti terisi otomatis dari kontrak vendor skema volume (Tahap 4); sementara bisa diisi manual.'));
  panel.append(h('div', {class: 'alat'},
    h('input', {type: 'search', placeholder: 'Cari kode, nama, merk…', 'aria-label': 'Cari ' + J.satuan, value: S.cari, oninput: (ev) => { S.cari = ev.target.value; gambar(); }}),
    pilihan('sb-kat', [['', 'Semua kategori'], ...daftarKat.map((x) => [x, x])], sb.kategori, {'aria-label': 'Saring kategori', onchange: (ev) => { sb.kategori = ev.target.value; gambar(); }}),
    pilihan('sb-status', [['Aktif', 'Aktif'], ['Nonaktif', 'Nonaktif'], ['', 'Semua status']], sb.status, {'aria-label': 'Saring status', onchange: (ev) => { sb.status = ev.target.value; gambar(); }}),
    h('label', {class: 'centang kecil'}, h('input', {type: 'checkbox', checked: sb.lama, onchange: (ev) => { sb.lama = ev.target.checked; gambar(); }}), ' Hanya yang perlu cek harga'),
    hitungan, h('span', {class: 'pegas'}),
    bisa && h('button', {class: 'btn btn-utama', type: 'button', onclick: () => bukaFormBarang(null, jenis)}, '+ Tambah ' + J.satuan)));
  panel.append(h('div', {class: 'alat'}, h('span', {class: 'kecil redup'}, J.judul + ':'), ...excelBarang, h('span', {class: 'kecil redup'}, ' Riwayat harga:'), ...excelHarga));
  if (!semua.length) {
    panel.append(h('div', {class: 'kosong-ajakan'}, h('h2', null, jenis === 'pekerjaan' ? 'Belum ada item harga pekerjaan' : 'Belum ada barang'),
      h('p', null, jenis === 'pekerjaan' ? 'Tambahkan item pekerjaan beserta satuannya (mis. Kitchen set per m\'), lalu catat harganya per vendor.' : 'Tambahkan barang beserta satuan baku dan konversinya (mis. 1 lembar multipleks = 2,9768 m²), lalu catat harga dari supplier.'),
      bisa && h('div', {class: 'baris-tombol tengah-isi'}, h('button', {class: 'btn btn-utama', type: 'button', onclick: () => bukaFormBarang(null, jenis)}, '+ Tambah ' + J.satuan + ' pertama'))));
    return;
  }
  panel.append(h('div', {class: 'gulir'}, tabel), h('p', {class: 'kecil redup'}, 'Harga dalam satuan baku. Penanda "Harga lama" muncul bila harga terakhir lebih tua dari ' + batas + ' bulan (Pengaturan → Barang & Harga).'));
  gambar();
}

// ---------- detail ----------
export function renderDetailBarang(el, id) {
  const b = S.db.barang.find((x) => x.id === id);
  const kembali = h('a', {href: '#barang', class: 'kecil'}, '← Barang & Harga');
  if (!b) { el.append(h('div', {class: 'kepala'}, kembali, h('h1', null, 'Barang tidak ditemukan'))); return; }
  const jenis = jenisDari(b), J = JENIS[jenis], bisa = bisaUbah('barang'), today = hariIni(), batas = bulanHargaLama();
  const rows = hargaDari(b.id);
  const r = ringkasHarga(rows, today, batas);
  const satuanLain = b.konversi || [];
  const ubin = (label, nilai, kaki) => h('div', {class: 'ubin'}, h('span', {class: 'ubin-label'}, label), h('span', {class: 'ubin-nilai'}, nilai), kaki && h('span', {class: 'ubin-kaki'}, kaki));
  const per = (x) => (x == null ? '' : satuanLain.map((c) => rp(x * c.faktor) + ' / ' + c.satuan).join(' · '));
  el.append(
    h('div', {class: 'kepala'}, kembali,
      h('div', {class: 'judul-baris'}, h('h1', null, b.nama), h('span', {class: 'pegas'}),
        bisa && h('button', {class: 'btn', type: 'button', onclick: () => bukaFormBarang(b.id, jenis)}, 'Ubah data'),
        bisa && h('button', {class: 'btn btn-utama', type: 'button', onclick: () => bukaFormHarga(b, null)}, '+ Catat harga')),
      h('p', {class: 'redup'}, [b.kode, b.kategori, 'satuan baku ' + b.satuan, b.merk, b.spesifikasi, b.aktif === false && 'Nonaktif'].filter(Boolean).join(' · ')),
      satuanLain.length > 0 && h('p', {class: 'kecil'}, 'Konversi: ' + konversiKeTeks(satuanLain) + ' ' + b.satuan),
      b.foto && h('button', {class: 'btn btn-kecil', type: 'button', onclick: aman(() => bukaBerkas(b.foto))}, '🖼 Lihat foto')),
    r.lama && h('div', {class: 'kotak-info'}, h('b', null, 'Harga lama – perlu cek ulang. '), 'Harga terakhir tercatat ' + tgl(r.tanggalTerakhir) + ', lebih dari ' + batas + ' bulan lalu.'),
    h('section', {class: 'ubin-grid', 'aria-label': 'Ringkasan harga'},
      ubin('Harga terakhir / ' + b.satuan, rpBaku(r.hargaTerakhir), r.jumlah ? tgl(r.tanggalTerakhir) + ' · ' + namaPihak(r.terakhir, jenis) + (per(r.hargaTerakhir) ? ' · ' + per(r.hargaTerakhir) : '') : 'Belum ada harga'),
      ubin('Rata-rata 12 bulan', rpBaku(r.rata12), r.jumlah12 ? r.jumlah12 + ' harga sejak ' + tgl(tambah12(today)) : 'Tidak ada harga 12 bulan terakhir'),
      ubin('Terendah', rpBaku(r.jumlah ? r.terendah : null), r.jumlah ? 'dari ' + r.jumlah + ' harga' : ''),
      ubin('Tertinggi', rpBaku(r.jumlah ? r.tertinggi : null), r.jumlah ? 'dari ' + r.jumlah + ' harga' : '')));

  const kartu = (judul, ...isiK) => h('section', {class: 'kartu'}, h('h2', null, judul), ...isiK);
  const maksTren = Math.max(1, ...r.tren.map((x) => x.rata));
  el.append(
    kartu('Tren per tahun (per ' + b.satuan + ')', r.tren.length ? h('div', {class: 'gulir'}, h('table', {class: 'tabel'},
      h('thead', null, h('tr', null, ['Tahun', 'Jumlah', 'Rata-rata', '', 'Terendah', 'Tertinggi', 'Perubahan rata-rata'].map((x, i) => h('th', {class: [2, 4, 5, 6].includes(i) ? 'kanan' : null}, x)))),
      h('tbody', null, r.tren.map((x) => h('tr', null, h('td', null, x.tahun), h('td', null, idn(x.jumlah)), h('td', {class: 'kanan'}, rpBaku(x.rata)),
        h('td', {class: 'lebar'}, h('div', {class: 'batang-tren', 'aria-hidden': 'true'}, h('span', {style: {width: Math.round(x.rata / maksTren * 100) + '%'}}))),
        h('td', {class: 'kanan'}, rpBaku(x.terendah)), h('td', {class: 'kanan'}, rpBaku(x.tertinggi)), h('td', {class: 'kanan'}, persenUbah(x.perubahan)))))))
      : h('p', {class: 'redup'}, 'Belum ada harga.')),
    kartu('Perbandingan antar ' + J.pihakLabel.toLowerCase(), r.perPihak.length ? h('div', {class: 'gulir'}, h('table', {class: 'tabel'},
      h('thead', null, h('tr', null, [J.pihakLabel, 'Harga terakhir / ' + b.satuan, 'Tanggal', 'Rata-rata', 'Terendah', 'Jumlah'].map((x, i) => h('th', {class: [1, 3, 4].includes(i) ? 'kanan' : null}, x)))),
      h('tbody', null, r.perPihak.map((p, i) => h('tr', null, h('td', null, p.pihak_id ? (S.db[J.pihakTabel].find((x) => x.id === p.pihak_id)?.nama || p.pihak_nama) : p.pihak_nama || '(tanpa ' + J.pihakLabel.toLowerCase() + ')', i === 0 && r.perPihak.length > 1 && [' ', pill('Termurah')]),
        h('td', {class: 'kanan'}, rpBaku(p.terakhir)), h('td', {class: 'nw'}, tgl(p.tanggal)), h('td', {class: 'kanan'}, rpBaku(p.rata)), h('td', {class: 'kanan'}, rpBaku(p.terendah)), h('td', null, idn(p.jumlah)))))))
      : h('p', {class: 'redup'}, 'Belum ada harga.')),
    kartu('Riwayat harga', rows.length ? h('div', {class: 'gulir'}, h('table', {class: 'tabel'},
      h('thead', null, h('tr', null, ['Tanggal', J.pihakLabel, 'Harga dicatat', 'Per ' + b.satuan, 'PPN', 'Ongkir / ' + b.satuan, 'Sumber', 'Proyek', 'Catatan'].map((x, i) => h('th', {class: [2, 3, 5].includes(i) ? 'kanan' : null}, x)))),
      h('tbody', null, rows.slice().sort((a, c) => bandingkan(c.tanggal, a.tanggal) || bandingkan(c.dibuat, a.dibuat)).map((x) => h('tr', {class: 'bisa-klik', tabindex: '0', onclick: () => bukaFormHarga(b, x), onkeydown: (ev) => { if (ev.key === 'Enter') bukaFormHarga(b, x); }},
        h('td', {class: 'nw'}, tgl(x.tanggal)), h('td', null, namaPihak(x, jenis)), h('td', {class: 'kanan nw'}, rp(x.harga) + ' / ' + x.satuan), h('td', {class: 'kanan nw'}, rpBaku(hargaBaku(x))),
        h('td', null, x.ppn ? 'Termasuk' : '—'), h('td', {class: 'kanan'}, x.ongkir ? rpBaku(ongkirBaku(x)) : '—'), h('td', null, SUMBER_OTOMATIS.includes(x.sumber) ? h('span', {class: 'pill pill-netral', title: 'Hanya bisa diubah di transaksi ' + x.sumber}, '🔒 ' + x.sumber + (x.ref?.nomor ? ' · ' + x.ref.nomor : '')) : h('span', {class: 'pill pill-netral'}, x.sumber || 'Input manual')),
        h('td', null, isi(x.proyek_kode)), h('td', {class: 'kecil'}, isi(x.catatan)))))))
      : h('div', {class: 'kosong-ajakan'}, h('p', null, 'Belum ada harga untuk ' + b.nama + '.'), bisa && h('button', {class: 'btn btn-utama', type: 'button', onclick: () => bukaFormHarga(b, null)}, '+ Catat harga pertama')),
    h('p', {class: 'kecil redup'}, 'Harga baru selalu dicatat sebagai baris baru. Harga per ' + b.satuan + ' dihitung otomatis dari satuan yang dicatat. Harga bertanda 🔒 berasal dari transaksi dan hanya bisa diubah di transaksi itu; perubahan harga lain tercatat di Audit log.')));
}
const tambah12 = (t) => { const [y, m, d] = t.split('-'); return (+y - 1) + '-' + m + '-' + d; };

// ---------- formulir barang ----------
let nomorKonversi = 0;
export function bukaFormBarang(id, jenis = 'barang') {
  const lama = id ? S.db.barang.find((b) => b.id === id) : null;
  if (lama) jenis = jenisDari(lama);
  const J = JENIS[jenis], bisa = bisaUbah('barang');
  let dlg, lanjut = false;
  const galat = h('div', {class: 'kotak-galat', role: 'alert', hidden: true});
  const peringatan = h('div', {class: 'kotak-info', role: 'alert', hidden: true});
  const daftarKat = jenis === 'pekerjaan' ? OPSI.kategoriPekerjaan : OPSI.kategoriBarang;
  const kategori = pilihan('b-kat', [['', 'Pilih…'], ...daftarKat.concat(lama?.kategori && !daftarKat.includes(lama.kategori) ? [lama.kategori] : []).map((x) => [x, x])], lama?.kategori || '', {required: true});
  const kodeEl = h('input', {id: 'b-kode', type: 'text', readonly: true, value: lama?.kode || '', placeholder: 'dibuat otomatis'});
  const segarKode = () => { if (!lama) kodeEl.value = kategori.value ? kodeBerikut(kategori.value, S.db.barang, jenis) : ''; };
  kategori.addEventListener('change', segarKode); segarKode();
  const nama = teks('b-nama', lama?.nama, {required: true});
  const miripEl = h('div', {class: 'medan medan-lebar kotak-info', hidden: true});
  nama.addEventListener('input', () => {
    const m = mirip(nama.value, S.db.barang.filter((b) => jenisDari(b) === jenis), id, undefined, normNamaBarang);
    miripEl.hidden = !m.length;
    miripEl.replaceChildren(h('b', null, 'Sudah ada ' + J.satuan + ' dengan nama mirip:'), h('ul', {class: 'cocok'}, m.map((x) => h('li', null, x.kode + ' · ' + x.nama + (x.merk ? ' · ' + x.merk : '')))));
    lanjut = false;
  });
  const satuanOpsi = (v) => [['', 'Pilih…'], ...OPSI.satuanBarang.concat(v && !OPSI.satuanBarang.includes(v) ? [v] : []).map((x) => [x, x])];
  const satuan = pilihan('b-satuan', satuanOpsi(lama?.satuan), lama?.satuan || '', {required: true});
  const dipakaiHarga = lama && hargaDari(lama.id).length > 0;
  if (dipakaiHarga) satuan.disabled = true;
  const merk = teks('b-merk', lama?.merk), spek = teks('b-spek', lama?.spesifikasi, {placeholder: 'Ukuran, tebal, warna…'});
  const aktif = centang('b-aktif', lama ? lama.aktif !== false : true, 'Aktif');
  const foto = jenis === 'barang' && daftarBerkas('b-foto', lama?.foto ? [lama.foto] : [], {jenis: 'foto', label: 'Foto', satu: true});
  // Konversi satuan
  const badanKonv = h('tbody');
  const barisKonv = [];
  const satuanBakuTeks = () => satuan.value || 'satuan baku';
  const labelBaku = [];
  const tambahKonv = (c = {}) => {
    const i = ++nomorKonversi;
    const s = pilihan('bk-s-' + i, satuanOpsi(c.satuan), c.satuan || '', {'aria-label': 'Satuan konversi ' + i});
    const f = h('input', {id: 'bk-f-' + i, type: 'text', inputmode: 'decimal', value: c.faktor != null ? fmtDesimal(c.faktor) : '', placeholder: 'mis. 2,9768', 'aria-label': 'Jumlah satuan baku'});
    const lb = h('span', null, satuanBakuTeks());
    labelBaku.push(lb);
    const terpakai = c.satuan && lama && hargaDari(lama.id).some((x) => x.satuan === c.satuan);
    const item = {s, f};
    const tr = h('tr', null, h('td', null, '1 '), h('td', null, s), h('td', null, '='), h('td', null, f), h('td', null, lb),
      h('td', null, terpakai ? h('span', {class: 'kecil redup', title: 'Riwayat harga menyimpan salinan konversi saat dicatat, jadi mengubah angka ini tidak mengubah harga lama.'}, 'dipakai di riwayat') : h('button', {class: 'btn btn-kecil', type: 'button', onclick: () => { barisKonv.splice(barisKonv.indexOf(item), 1); tr.remove(); }}, '✕')));
    barisKonv.push(item); badanKonv.append(tr);
  };
  (lama?.konversi || []).forEach(tambahKonv);
  satuan.addEventListener('change', () => labelBaku.forEach((x) => { x.textContent = satuanBakuTeks(); }));
  const simpan = h('button', {class: 'btn btn-utama', type: 'submit'}, 'Simpan');
  const kirim = async (ev) => {
    ev?.preventDefault();
    if (simpan.disabled) return;
    galat.hidden = true; peringatan.hidden = true;
    const {data, galat: g} = validasiBarang({nama: nama.value, kategori: kategori.value, satuan: satuan.value, merk: merk.value, spesifikasi: spek.value, aktif: nilaiCentang(aktif),
      konversi: barisKonv.map((x) => ({satuan: x.s.value, faktor: x.f.value}))}, jenis);
    if (g.length) { galat.replaceChildren(h('b', null, 'Perbaiki dulu:'), h('ul', null, g.map((x) => h('li', null, x.kolom + ': ' + x.pesan)))); galat.hidden = false; return; }
    if (lama) {
      const hilang = [...new Set(hargaDari(lama.id).map((x) => x.satuan))].filter((s) => !satuanBarang(data).includes(s));
      if (hilang.length) { galat.replaceChildren(h('b', null, 'Satuan ' + hilang.join(', ') + ' masih dipakai di riwayat harga, jadi konversinya tidak bisa dihapus.')); galat.hidden = false; return; }
    }
    data.kode = lama?.kode || kodeBerikut(data.kategori, S.db.barang, jenis);
    const d = duplikatBarang(data, S.db.barang, id);
    if (d.kode.length) { galat.replaceChildren(h('b', null, 'Kode ' + data.kode + ' sudah dipakai. Muat ulang halaman lalu coba lagi.')); galat.hidden = false; return; }
    if (d.nama.length && !lanjut) { kotakPeringatan(peringatan, J.satuan[0].toUpperCase() + J.satuan.slice(1) + ' ini mungkin sudah ada:', [['Nama mirip', d.nama]], () => { lanjut = true; kirim(); }, (x) => x.kode + ' · ' + x.nama + (x.merk ? ' · ' + x.merk : '')); return; }
    simpan.disabled = true; simpan.textContent = 'Menyimpan…';
    try {
      const bid = id || idBaru();
      if (foto) {
        const f = await foto.ambil('barang/' + bid);
        if (f.daftar[0]) data.foto = f.daftar[0];
        if (f.dilepas.length) await store.hapusBerkas(f.dilepas, BUCKET_MASTER).catch(() => {});
      }
      await store.simpan('barang', bid, data);
      dlg.close(); await segarkan(); pesan(J.satuan[0].toUpperCase() + J.satuan.slice(1) + ' tersimpan.');
      if (!lama) location.hash = '#barang-' + bid;
    } catch (e) {
      galat.replaceChildren(h('b', null, 'Gagal menyimpan: '), e.message); galat.hidden = false; lanjut = false;
      simpan.disabled = false; simpan.textContent = 'Simpan';
    }
  };
  const form = h('form', {class: 'form', onsubmit: kirim},
    h('div', {class: 'form-grid'},
      medan('Kategori', kategori, {wajib: true}), medan('Kode', kodeEl, {bantuan: lama ? 'Kode tetap walau kategori diubah.' : 'Dibuat otomatis per kategori.'}),
      medan('Nama', nama, {wajib: true, lebar: true}), miripEl,
      medan('Satuan baku', satuan, {wajib: true, bantuan: dipakaiHarga ? 'Tidak bisa diubah karena sudah ada riwayat harga.' : 'Harga selalu bisa ditampilkan dalam satuan ini.'}),
      jenis === 'barang' && medan('Merk', merk), medan('Spesifikasi', spek, {lebar: jenis !== 'barang'}),
      h('div', {class: 'medan medan-lebar'}, h('label', {for: 'bk-tambah'}, 'Konversi satuan'),
        h('table', {class: 'tabel tabel-isian tabel-konversi'}, badanKonv),
        h('div', null, h('button', {id: 'bk-tambah', class: 'btn btn-kecil', type: 'button', onclick: () => tambahKonv()}, '+ Tambah konversi')),
        h('span', {class: 'kecil redup'}, 'Contoh: 1 lembar = 2,9768 m²; 1 dus = 1,44 m². Harga yang dicatat per lembar otomatis ditampilkan juga per m².')),
      foto && foto.el,
      h('div', {class: 'medan medan-lebar'}, aktif)),
    galat, peringatan,
    h('div', {class: 'form-kaki'},
      lama && bisa && (dipakaiHarga ? h('span', {class: 'kecil redup'}, 'Sudah punya riwayat harga; nonaktifkan saja.') : tombolHapus(async () => {
        await store.hapus(lama.id);
        if (lama.foto) await store.hapusBerkas([lama.foto.path], BUCKET_MASTER).catch(() => {});
        dlg.close(); location.hash = '#barang'; await segarkan(); pesan('Dihapus.');
      })),
      h('span', {class: 'pegas'}), h('button', {class: 'btn', type: 'button', onclick: () => dlg.close()}, bisa ? 'Batal' : 'Tutup'), bisa && simpan));
  if (!bisa) form.querySelectorAll('input,select,textarea').forEach((x) => { x.disabled = true; });
  dlg = dialog(lama ? J.satuan[0].toUpperCase() + J.satuan.slice(1) + ': ' + lama.nama : 'Tambah ' + J.satuan, form);
}

// ---------- formulir harga ----------
// Harga dari transaksi (Pembelian / Kontrak vendor) tidak bisa diubah di sini. Modul sumbernya (Tahap 4) mengisi
// x.ref = {id, nomor, tanggal} supaya pengguna tahu transaksi mana yang harus dibuka.
const MENU_SUMBER = {'Pembelian': 'Pembelian Material', 'Kontrak vendor': 'Kontrak'};
function peringatanSumber(x) {
  const nomor = x.ref?.nomor, menu = MENU_SUMBER[x.sumber] || x.sumber;
  const transaksi = 'transaksi ' + x.sumber + (nomor ? ' nomor ' + nomor : '') + ' tanggal ' + tgl(x.ref?.tanggal || x.tanggal) + (x.pihak_nama ? ' (' + x.pihak_nama + ')' : '');
  return h('div', {class: 'kotak-galat', role: 'alert'},
    h('b', null, 'Harga ini tidak bisa diubah atau dihapus di sini.'),
    h('span', null, 'Harga ini tercatat otomatis dari ' + transaksi + '.'),
    h('span', null, 'Bila harganya salah, buka menu ' + menu + ' → ' + (nomor ? 'transaksi ' + nomor : 'transaksi tersebut') + ', lalu perbaiki di sana. Riwayat harga ini ikut diperbaiki otomatis.'));
}

export function bukaFormHarga(b, x) {
  const jenis = jenisDari(b), J = JENIS[jenis];
  const otomatis = x && SUMBER_OTOMATIS.includes(x.sumber);
  const bisa = bisaUbah('barang') && !otomatis;
  let dlg;
  const galat = h('p', {class: 'form-galat', role: 'alert'});
  const tanggal = h('input', {id: 'h-tgl', type: 'date', value: x?.tanggal || hariIni(), required: true});
  const pihakOpsi = S.db[J.pihakTabel].filter((p) => p.aktif !== false || p.id === x?.pihak_id).sort((a, c) => bandingkan(a.nama, c.nama)).map((p) => ({v: p.id, label: p.nama, sub: J.pihakTabel === 'vendor_tukang' ? p.jenis : (p.kategori || []).join(', ')}));
  const pihak = pilihCari('h-pihak', pihakOpsi, x?.pihak_id || '', {label: 'Cari ' + J.pihakLabel.toLowerCase(), placeholder: 'Ketik nama ' + J.pihakLabel.toLowerCase(), kosongTeks: 'Tidak ada. Tambahkan dulu di menu ' + (jenis === 'pekerjaan' ? 'Vendor & Tukang' : 'Supplier') + '.'});
  const pihakLama = x && !x.pihak_id && x.pihak_nama && h('span', {class: 'kecil redup'}, 'Tercatat sebagai teks: ' + x.pihak_nama);
  const satuan = pilihan('h-satuan', satuanBarang(b), x?.satuan || b.satuan);
  const harga = h('input', {id: 'h-harga', type: 'text', inputmode: 'numeric', value: x?.harga ? idn(x.harga) : '', autocomplete: 'off', required: true});
  const ongkir = h('input', {id: 'h-ongkir', type: 'text', inputmode: 'numeric', value: x?.ongkir ? idn(x.ongkir) : '', autocomplete: 'off', placeholder: 'opsional'});
  const ppn = centang('h-ppn', x?.ppn, 'Harga termasuk PPN');
  const sumber = pilihan('h-sumber', otomatis ? [x.sumber] : SUMBER_HARGA.filter((s) => !SUMBER_OTOMATIS.includes(s) && (s !== 'Impor' || x?.sumber === 'Impor')), x?.sumber || 'Input manual');
  const proyek = pilihCari('h-proyek', S.db.proyek.slice().sort((a, c) => bandingkan(a.kode, c.kode)).map((p) => ({v: p.kode, label: p.kode + ' — ' + isi(p.nama)})), x?.proyek_kode || '', {label: 'Cari proyek', placeholder: 'Opsional'});
  const catatan = h('textarea', {id: 'h-catatan', rows: '2'}, x?.catatan ?? '');
  const hitung = h('div', {class: 'kotak-info kecil'});
  const faktor = () => (x && satuan.value === x.satuan ? x.faktor : faktorSatuan(b, satuan.value));
  const segar = () => {
    const hg = bacaUang(harga.value), f = faktor(), og = bacaUang(ongkir.value);
    const baris = [];
    if (hg > 0 && f) {
      baris.push(h('div', null, h('b', null, 'Per ' + b.satuan + ': ' + rp(hg / f)), satuan.value !== b.satuan ? ' (' + rp(hg) + ' / ' + satuan.value + ' ÷ ' + fmtDesimal(f) + ')' : ''));
      for (const c of (b.konversi || []).filter((k) => k.satuan !== satuan.value)) baris.push(h('div', {class: 'redup'}, 'Per ' + c.satuan + ': ' + rp(hg / f * c.faktor)));
      if (og > 0) baris.push(h('div', {class: 'redup'}, 'Ongkir per ' + b.satuan + ': ' + rp(og / f)));
    } else baris.push(h('span', {class: 'redup'}, 'Isi harga untuk melihat harga per ' + b.satuan + '.'));
    if (x && satuan.value === x.satuan && x.faktor !== faktorSatuan(b, x.satuan)) baris.push(h('div', {class: 'redup'}, 'Memakai konversi saat harga ini dicatat (1 ' + x.satuan + ' = ' + fmtDesimal(x.faktor) + ' ' + b.satuan + ').'));
    hitung.replaceChildren(...baris);
  };
  harga.addEventListener('input', () => { harga.value = formatUang(harga.value); segar(); });
  ongkir.addEventListener('input', () => { ongkir.value = formatUang(ongkir.value); segar(); });
  satuan.addEventListener('change', segar);
  const simpan = h('button', {class: 'btn btn-utama', type: 'submit'}, 'Simpan');
  const kirim = async (ev) => {
    ev.preventDefault();
    if (simpan.disabled) return;
    galat.textContent = '';
    const pid = pihak.querySelector('input[type=hidden]').value;
    const {data, galat: g} = validasiHarga({tanggal: tanggal.value, satuan: satuan.value, harga: bacaUang(harga.value), ongkir: bacaUang(ongkir.value), ppn: nilaiCentang(ppn), sumber: sumber.value,
      pihak_id: pid || null, pihak_nama: pid ? S.db[J.pihakTabel].find((p) => p.id === pid)?.nama : x?.pihak_nama, proyek_kode: proyek.querySelector('input[type=hidden]').value, catatan: catatan.value}, b);
    if (x && data.satuan === x.satuan) data.faktor = x.faktor; // konversi saat dicatat tidak berubah
    if (g.length) { galat.textContent = g.map((e) => e.kolom + ': ' + e.pesan).join(' · '); return; }
    simpan.disabled = true; simpan.textContent = 'Menyimpan…';
    try {
      await store.simpan('harga', x?.id, {...data, dibuat: x?.dibuat || new Date().toISOString(), dibuat_oleh: x?.dibuat_oleh || S.user?.email});
      dlg.close(); await segarkan(); pesan('Harga tersimpan.');
    } catch (e) { galat.textContent = e.message; simpan.disabled = false; simpan.textContent = 'Simpan'; }
  };
  const form = h('form', {class: 'form', onsubmit: kirim},
    otomatis && peringatanSumber(x),
    h('div', {class: 'form-grid'},
      medan('Tanggal', tanggal, {wajib: true}), medan(J.pihakLabel, h('div', null, pihak, pihakLama), {id: 'h-pihak-cari'}),
      medan('Harga satuan', h('div', {class: 'berawalan'}, h('span', null, 'Rp'), harga), {wajib: true, id: 'h-harga'}), medan('Per satuan', satuan, {bantuan: 'Satuan baku atau satuan konversi barang ini.'}),
      medan('Ongkir per satuan', h('div', {class: 'berawalan'}, h('span', null, 'Rp'), ongkir), {id: 'h-ongkir'}), h('div', {class: 'medan'}, h('span', {class: 'label-kosong', 'aria-hidden': 'true'}, ' '), ppn),
      medan('Sumber', sumber), medan('Proyek', proyek, {id: 'h-proyek-cari'}),
      medan('Catatan', catatan, {lebar: true})),
    hitung, galat,
    h('div', {class: 'form-kaki'},
      x && bisa && (S.user?.super_admin ? tombolHapus(async () => { await store.hapus(x.id); dlg.close(); await segarkan(); pesan('Baris harga dihapus.'); }, 'Hapus baris ini')
        : h('span', {class: 'kecil redup'}, 'Menghapus harga hanya bisa oleh Super admin.')),
      h('span', {class: 'pegas'}), h('button', {class: 'btn', type: 'button', onclick: () => dlg.close()}, bisa ? 'Batal' : 'Tutup'), bisa && simpan));
  if (!bisa) form.querySelectorAll('input,select,textarea').forEach((e) => { e.disabled = true; });
  dlg = dialog((x ? 'Harga: ' : 'Catat harga: ') + b.nama, form);
  segar();
}
export {bacaDesimal};
