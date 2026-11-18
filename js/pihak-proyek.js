// Tahap 4A — Pihak Proyek: kontrak vendor per proyek (4 skema pembayaran), opname, pembayaran, pencairan retensi.
// Angka (hak, retensi, dibayar, hutang, progres) dihitung dari opname dan pembayaran (js/proyek-util.js); tidak diketik.
import {S, segarkan, segarkanKeuangan} from './state.js';
import {hariIni} from './calc.js';
import {store, idBaru} from './store.js';
import {bisaUbah} from './akses.js';
import {h, rp, tgl, isi, pill, pesan, sambilMenyimpan, pilihCari, kepalaUrut, bandingkan, formatUang, batangProgres} from './ui.js';
import {medan, teks, tanggal, pilihan, uang, kaki, tombolHapus, catatanKunci, namaRekening, pilihBukti, tombolBukti} from './keuangan.js';
import {terkunci, akunKode} from './keuangan-data.js';
import {SKEMA, SUMBER_DANA, JENIS_BAYAR_VENDOR, STATUS_OPNAME, nilaiTerminVendor, periksaKontrakVendor, nilaiOpname, retensiDari, kali} from './proyek-util.js';
import {persenKeBp, bpKePersen} from './kontrak-util.js';
import {satuanBarang} from './master-util.js';
import {K, namaProyek, persenBp, pct, angkaId, bacaDesimalId, rincian, ubin, dialogLebar, opsiProyek, opsiVendor, opsiBarang, barangDari, hargaTerakhir, pemeriksaProyek, belumSiap} from './proyek-bersama.js';

const bisa = () => bisaUbah('pihak_proyek');
const vendorDari = (id) => S.d.vendor.find((v) => v.id === id);
const nm = (kode) => kode + ' ' + (akunKode(K(), kode)?.nama || '');

// Ringkasan isi opname dalam satu baris teks.
export function teksOpname(o, v) {
  const d = o.detail || {};
  if (v.skema === 'volume') return v.items.filter((i) => +d.volume?.[i.id]).map((i) => i.uraian + ' ' + angkaId(d.volume[i.id]) + ' ' + i.satuan).join('; ') || '—';
  if (v.skema === 'persen') return 'Progres kumulatif ' + persenBp(d.persen_bp);
  if (v.skema === 'harian') return d.hari + ' hari kerja';
  return v.termin.filter((t) => (d.termin || []).includes(t.id)).map((t) => t.milestone || 'Termin ' + t.ke).join('; ') || '—';
}

// =====================================================================
// Tabel kontrak vendor (menu Pihak Proyek, tab Vendor di Kontrak, Detail Proyek)
// =====================================================================
S.urutPihak = S.urutPihak || {k: 'nama_proyek', arah: 1};
export function tabelKontrakVendor(rows, {kosongTeks = 'Belum ada kontrak vendor.'} = {}) {
  const KOLOM = [['nama_proyek', 'Proyek'], ['vendor_nama', 'Vendor'], ['skema', 'Skema'], ['sumber_dana', 'Sumber dana'], ['nilai_kontrak', 'Nilai kontrak', true], ['progres', 'Progres'],
    ['hak', 'Hak', true], ['dibayar', 'Dibayar', true], ['hutang', 'Hutang', true], ['retensi_ditahan', 'Retensi ditahan', true], [null, 'SPK']];
  const badan = h('tbody'), tabel = h('table', {class: 'tabel'}, h('thead'), badan);
  const gambar = () => {
    const urut = rows.slice().sort((a, b) => bandingkan(a[S.urutPihak.k], b[S.urutPihak.k]) * S.urutPihak.arah || bandingkan(a.vendor_nama, b.vendor_nama));
    tabel.querySelector('thead').replaceWith(kepalaUrut(KOLOM, S.urutPihak, gambar));
    badan.replaceChildren(...(urut.length ? urut.map((v) => {
      const buka = () => { location.hash = '#pihak-proyek-' + v.id; };
      return h('tr', {class: 'bisa-klik', tabindex: '0', onclick: buka, onkeydown: (ev) => { if (ev.key === 'Enter') buka(); }},
        h('td', null, h('span', null, v.kode), h('span', {class: 'kecil redup blok'}, isi(S.d.proyek.find((p) => p.kode === v.kode)?.nama))),
        h('td', null, v.vendor_nama, v.lingkup && h('span', {class: 'kecil redup blok'}, v.lingkup)), h('td', null, SKEMA[v.skema]),
        h('td', null, pill(v.sumber_dana === 'titipan' ? 'Dana titipan klien' : 'Dana perusahaan')), h('td', {class: 'kanan'}, rp(v.nilai_kontrak)),
        h('td', null, batangProgres(v.progres)), h('td', {class: 'kanan'}, rp(v.hak)), h('td', {class: 'kanan'}, rp(v.dibayar + v.potongan)),
        h('td', {class: 'kanan' + (v.hutang < 0 ? ' teks-buruk' : '')}, v.hutang < 0 ? 'Lebih bayar ' + rp(-v.hutang) : rp(v.hutang)), h('td', {class: 'kanan'}, rp(v.retensi_ditahan)),
        h('td', null, tombolBukti(v.file)));
    }) : [h('tr', null, h('td', {colspan: String(KOLOM.length), class: 'redup'}, kosongTeks))]));
  };
  gambar();
  return h('div', {class: 'gulir'}, tabel);
}

S.saringPihak = S.saringPihak || {proyek: '', skema: '', q: ''};
export function renderPihakProyek(el) {
  el.append(h('div', {class: 'kepala'}, h('h1', null, 'Vendor / Tukang / Pihak Terkait Proyek'),
    h('p', {class: 'redup'}, 'Satu baris per kontrak vendor per proyek. Hak vendor bertambah dari opname yang disetujui; hutang = hak − retensi − dibayar − potongan pajak.')));
  if (belumSiap(el)) return;
  const sr = S.saringPihak, wadah = h('div'), hitungan = h('span', {class: 'redup kecil'});
  const gambar = () => {
    const q = sr.q.trim().toLowerCase();
    const rows = S.d.vendor.filter((v) => (!sr.proyek || v.kode === sr.proyek) && (!sr.skema || v.skema === sr.skema)
      && (!q || [v.vendor_nama, v.lingkup, v.no_spk].some((x) => String(x || '').toLowerCase().includes(q))));
    hitungan.textContent = rows.length + ' kontrak · hutang ' + rp(rows.reduce((s, v) => s + Math.max(0, v.hutang), 0)) + ' · retensi ditahan ' + rp(rows.reduce((s, v) => s + v.retensi_ditahan, 0));
    wadah.replaceChildren(tabelKontrakVendor(rows, {kosongTeks: S.d.vendor.length ? 'Tidak ada kontrak yang cocok dengan saringan.' : 'Belum ada kontrak vendor. Klik "+ Kontrak vendor".'}));
  };
  const proyekAda = [...new Set(S.d.vendor.map((v) => v.kode))].sort(bandingkan);
  el.append(h('div', {class: 'kartu'},
    h('div', {class: 'alat'},
      h('input', {type: 'search', placeholder: 'Cari vendor / lingkup / No. SPK…', 'aria-label': 'Cari', value: sr.q, oninput: (ev) => { sr.q = ev.target.value; gambar(); }}),
      pilihan('sp-proyek', [['', 'Semua proyek'], ...proyekAda.map((x) => [x, namaProyek(x)])], sr.proyek, {'aria-label': 'Saring proyek', onchange: (ev) => { sr.proyek = ev.target.value; gambar(); }}),
      pilihan('sp-skema', [['', 'Semua skema'], ...Object.entries(SKEMA)], sr.skema, {'aria-label': 'Saring skema', onchange: (ev) => { sr.skema = ev.target.value; gambar(); }}),
      hitungan, h('span', {class: 'pegas'}),
      bisa() && h('button', {class: 'btn btn-utama', type: 'button', onclick: () => bukaFormKontrakVendor(null)}, '+ Kontrak vendor')),
    wadah));
  gambar();
}

// =====================================================================
// Detail satu kontrak vendor
// =====================================================================
export function renderDetailPihak(el, id) {
  if (belumSiap(el)) return;
  const v = vendorDari(id);
  const kembali = h('a', {href: '#pihak-proyek', class: 'kecil'}, '← Pihak Proyek');
  if (!v) { el.append(h('div', {class: 'kepala'}, kembali, h('h1', null, 'Kontrak vendor tidak ditemukan'))); return; }
  const dompet = S.d.dompet[v.kode];
  el.append(
    h('div', {class: 'kepala'}, h('div', {class: 'baris-tombol'}, kembali, h('a', {href: '#proyek-' + (S.d.proyek.find((p) => p.kode === v.kode)?.id || ''), class: 'kecil'}, 'Buka proyek ' + v.kode + ' →')),
      h('div', {class: 'judul-baris'}, h('h1', null, v.vendor_nama), pill(v.sumber_dana === 'titipan' ? 'Dana titipan klien' : 'Dana perusahaan'), h('span', {class: 'pill pill-netral'}, SKEMA[v.skema]),
        h('span', {class: 'pegas'}), v.file && tombolBukti(v.file),
        bisa() && h('button', {class: 'btn', type: 'button', onclick: () => bukaFormKontrakVendor(v)}, 'Ubah kontrak'),
        bisa() && h('button', {class: 'btn', type: 'button', onclick: () => bukaFormOpname(v, null)}, '+ Opname'),
        bisa() && h('button', {class: 'btn btn-utama', type: 'button', onclick: () => bukaFormBayarVendor(v, null, 'bayar')}, '+ Pembayaran')),
      h('p', {class: 'redup'}, [namaProyek(v.kode), v.lingkup, v.no_spk && 'SPK ' + v.no_spk, tgl(v.tanggal)].filter(Boolean).join(' · '))),
    h('section', {class: 'ubin-grid', 'aria-label': 'Ringkasan kontrak vendor'},
      ubin('Nilai kontrak', rp(v.nilai_kontrak), v.skema === 'harian' ? 'perkiraan ' + (v.perkiraan_hari ?? '—') + ' hari × ' + rp(v.upah_harian) : SKEMA[v.skema]),
      ubin('Hak vendor', rp(v.hak), 'progres ' + pct(v.progres) + (v.ada_draft ? ' · ada opname Draft' : '')),
      ubin('Dibayar', rp(v.dibayar + v.potongan), v.potongan ? 'termasuk potongan pajak ' + rp(v.potongan) : v.pembayaran.length + ' pembayaran'),
      ubin(v.hutang < 0 ? 'Lebih bayar' : 'Hutang', rp(Math.abs(v.hutang)), 'hak − retensi − dibayar − potongan', {buruk: v.hutang < 0}),
      ubin('Retensi ditahan', rp(v.retensi_ditahan), v.retensi_bp ? persenBp(v.retensi_bp) + (v.tgl_cair_retensi ? ' · cair mulai ' + tgl(v.tgl_cair_retensi) : ' · isi tanggal selesai pekerjaan') : 'tanpa retensi')),
    v.hutang < 0 && h('div', {class: 'kotak-galat'}, '⚠ Pembayaran sudah melebihi hak vendor sebesar ' + rp(-v.hutang) + '. Pastikan ini uang muka yang disengaja; hak bertambah saat opname berikutnya disetujui.'),
    v.sumber_dana === 'titipan' && dompet && dompet.saldo_titipan < 0 && h('div', {class: 'kotak-galat'}, '⚠ Dana titipan proyek ' + v.kode + ' minus ' + rp(-dompet.saldo_titipan) + '. Proyek ini sedang dibiayai dana lain.'),
    v.retensi_bisa_cair && h('div', {class: 'kotak-info'}, 'Masa retensi sudah selesai (' + tgl(v.tgl_cair_retensi) + '). Retensi ' + rp(v.retensi_ditahan) + ' bisa dicairkan.',
      bisa() && h('button', {class: 'btn btn-kecil', type: 'button', onclick: () => bukaFormBayarVendor(v, null, 'retensi')}, 'Catat pencairan retensi')),
    h('section', {class: 'kartu'}, h('h2', null, 'Isi kontrak'),
      rincian([['Proyek', namaProyek(v.kode)], ['Vendor', v.vendor_nama], ['Lingkup', v.lingkup], ['No. SPK', v.no_spk], ['Tanggal', tgl(v.tanggal)],
        ['Sumber dana', SUMBER_DANA[v.sumber_dana]], ['Skema', SKEMA[v.skema]], v.skema === 'harian' && ['Upah per hari', rp(v.upah_harian)],
        ['Retensi', v.retensi_bp ? persenBp(v.retensi_bp) + ' dari setiap opname disetujui' : 'Tidak ada'], v.retensi_bp && ['Masa retensi', (v.masa_retensi_hari ?? '—') + ' hari setelah selesai'],
        ['Tanggal selesai pekerjaan', v.tgl_selesai ? tgl(v.tgl_selesai) : 'belum diisi'], ['Catatan', v.catatan]]),
      v.skema === 'volume' && h('div', {class: 'gulir'}, h('table', {class: 'tabel'},
        h('thead', null, h('tr', null, ['Item pekerjaan', 'Satuan', 'Volume kontrak', 'Harga satuan', 'Nilai', 'Terpasang (disetujui)', 'Sisa volume'].map((x, i) => h('th', {class: i >= 2 ? 'kanan' : null}, x)))),
        h('tbody', null, v.items.map((i) => {
          const kum = v.vol_kumulatif[i.id] || 0, lebih = kum > +i.volume;
          return h('tr', null, h('td', null, i.uraian), h('td', null, i.satuan), h('td', {class: 'kanan'}, angkaId(i.volume)), h('td', {class: 'kanan'}, rp(i.harga)),
            h('td', {class: 'kanan'}, rp(kali(i.volume, i.harga))), h('td', {class: 'kanan' + (lebih ? ' teks-buruk' : '')}, angkaId(kum) + (lebih ? ' ⚠' : '')), h('td', {class: 'kanan'}, angkaId(+i.volume - kum)));
        })),
        h('tfoot', null, h('tr', null, h('th', {colspan: '4'}, 'Total'), h('th', {class: 'kanan'}, rp(v.nilai_kontrak)), h('th', {colspan: '2'}))))),
      v.skema === 'termin' && h('div', {class: 'gulir'}, h('table', {class: 'tabel'},
        h('thead', null, h('tr', null, ['Ke', 'Milestone', 'Persen', 'Nilai', 'Status'].map((x, i) => h('th', {class: i === 2 || i === 3 ? 'kanan' : null}, x)))),
        h('tbody', null, v.termin.map((t) => h('tr', null, h('td', null, String(t.ke)), h('td', null, isi(t.milestone)), h('td', {class: 'kanan'}, persenBp(t.persen_bp)),
          h('td', {class: 'kanan'}, rp(t.nilai)), h('td', null, pill(t.tercapai ? 'Selesai' : 'Belum')))))))),
    h('section', {class: 'kartu'}, h('div', {class: 'judul-baris'}, h('h2', null, 'Riwayat opname'), h('span', {class: 'pegas'}),
      bisa() && h('button', {class: 'btn btn-kecil', type: 'button', onclick: () => bukaFormOpname(v, null)}, '+ Opname')),
    h('div', {class: 'gulir'}, h('table', {class: 'tabel'},
      h('thead', null, h('tr', null, ['Tanggal', 'Isi opname', 'Nilai', 'Retensi', 'Diperiksa oleh', 'Foto', 'Status', ''].map((x, i) => h('th', {class: i === 2 || i === 3 ? 'kanan' : null}, x)))),
      h('tbody', null, v.opname.length ? v.opname.map((o) => h('tr', null, h('td', {class: 'nw'}, tgl(o.tanggal), terkunci(K(), o.tanggal) && ' 🔒'), h('td', {class: 'lebar'}, teksOpname(o, v), o.catatan && h('span', {class: 'kecil redup blok'}, o.catatan)),
        h('td', {class: 'kanan'}, o.status === 'disetujui' ? rp(o.nilai) : h('span', {class: 'redup'}, rp(o.nilai))), h('td', {class: 'kanan'}, o.retensi ? rp(o.retensi) : '—'),
        h('td', null, isi(o.diperiksa_nama)), h('td', null, tombolBukti(o.foto)), h('td', null, pill(o.status === 'disetujui' ? 'Disetujui' : 'Draft')),
        h('td', null, h('button', {class: 'btn btn-kecil', type: 'button', onclick: () => bukaFormOpname(v, o)}, bisa() ? 'Ubah' : 'Lihat'))))
        : h('tr', null, h('td', {colspan: '8', class: 'redup'}, 'Belum ada opname. Opname Draft tidak menambah hak; hanya opname Disetujui yang dihitung dan dijurnal.')))))),
    h('section', {class: 'kartu'}, h('div', {class: 'judul-baris'}, h('h2', null, 'Riwayat pembayaran'), h('span', {class: 'pegas'}),
      bisa() && v.retensi_ditahan > 0 && h('button', {class: 'btn btn-kecil', type: 'button', onclick: () => bukaFormBayarVendor(v, null, 'retensi')}, 'Pencairan retensi'),
      bisa() && h('button', {class: 'btn btn-kecil btn-utama', type: 'button', onclick: () => bukaFormBayarVendor(v, null, 'bayar')}, '+ Pembayaran')),
    h('div', {class: 'gulir'}, h('table', {class: 'tabel'},
      h('thead', null, h('tr', null, ['Tanggal', 'Jenis', 'Dibayar', 'Potongan pajak', 'Rekening', 'Bukti potong', 'Bukti transfer', 'Catatan', ''].map((x, i) => h('th', {class: i === 2 || i === 3 ? 'kanan' : null}, x)))),
      h('tbody', null, v.pembayaran.length ? v.pembayaran.map((b) => h('tr', null, h('td', {class: 'nw'}, tgl(b.tanggal), terkunci(K(), b.tanggal) && ' 🔒'), h('td', null, JENIS_BAYAR_VENDOR[b.jenis]),
        h('td', {class: 'kanan'}, rp(b.jumlah)), h('td', {class: 'kanan'}, b.potongan_pajak ? rp(b.potongan_pajak) : '—'), h('td', null, b.rekening_id ? namaRekening(b.rekening_id) : '—'),
        h('td', null, tombolBukti(b.bukti_potong)), h('td', null, tombolBukti(b.bukti_transfer)), h('td', {class: 'lebar'}, isi(b.catatan)),
        h('td', null, h('button', {class: 'btn btn-kecil', type: 'button', onclick: () => bukaFormBayarVendor(v, b, b.jenis)}, bisa() ? 'Ubah' : 'Lihat'))))
        : h('tr', null, h('td', {colspan: '9', class: 'redup'}, 'Belum ada pembayaran.')))))));
}

// =====================================================================
// Formulir kontrak vendor
// =====================================================================
export function bukaFormKontrakVendor(lama, awal = {}) {
  const x = lama || awal;
  const kunci = !!lama && lama.opname.some((o) => o.status === 'disetujui');
  const galat = h('p', {class: 'form-galat', role: 'alert'});
  const proyek = pilihCari('kv-proyek', opsiProyek(), x.proyek_kode || '', {wajib: true, label: 'Cari proyek', placeholder: 'Ketik kode / nama proyek'});
  const vendor = pilihCari('kv-vendor', opsiVendor(x.vendor_id), x.vendor_id || '', {wajib: true, label: 'Cari vendor', placeholder: 'Ketik nama vendor / tukang', kosongTeks: 'Tidak ada. Tambahkan dulu di menu Vendor & Tukang.'});
  const lingkup = teks('kv-lingkup', x.lingkup, {placeholder: 'Mis. Kitchen set & plafon lantai 1'});
  const spk = teks('kv-spk', x.no_spk);
  const tglEl = tanggal('kv-tgl', x.tanggal || hariIni(), {required: true});
  const file = pilihBukti('kv-file', lama?.file, {label: 'File SPK (PDF)', hanyaPdf: true});
  const sumber = pilihan('kv-sumber', [['', 'Pilih…'], ...Object.entries(SUMBER_DANA)], x.sumber_dana || '', {required: true});
  const retensi = teks('kv-ret', x.retensi_bp ? String(bpKePersen(x.retensi_bp)).replace('.', ',') : '', {inputmode: 'decimal', placeholder: '0'});
  const masa = teks('kv-masa', x.masa_retensi_hari ?? '', {inputmode: 'numeric', placeholder: 'mis. 30'});
  const selesai = tanggal('kv-selesai', x.tgl_selesai || '');
  const skema = pilihan('kv-skema', [['', 'Pilih…'], ...Object.entries(SKEMA)], x.skema || '', {required: true});
  const nilai = uang('kv-nilai', x.skema === 'termin' || x.skema === 'persen' ? x.nilai : '');
  const upah = uang('kv-upah', x.upah_harian);
  const perkiraan = teks('kv-hari', x.perkiraan_hari ?? '', {inputmode: 'numeric'});
  const catatan = h('textarea', {id: 'kv-catatan', rows: '2'}, x.catatan ?? '');
  if (kunci) [proyek.querySelector('input:not([type=hidden])'), vendor.querySelector('input:not([type=hidden])'), sumber, retensi, skema, nilai.inp, upah.inp].forEach((e) => { e.disabled = true; });

  // Item pekerjaan (skema volume)
  const badanItem = h('tbody'), totalItem = h('b');
  const barisItem = [];
  let nomor = 0;
  const tambahItem = (it = {}) => {
    const i = ++nomor;
    const pilihPek = pilihCari('kvi-b-' + i, opsiBarang('pekerjaan', [it.barang_id]), it.barang_id || '', {wajib: true, label: 'Item pekerjaan', placeholder: 'Ketik nama item pekerjaan', kosongTeks: 'Tidak ada. Tambahkan di Barang & Harga → Harga Pekerjaan.'});
    const uraian = h('input', {type: 'text', value: it.uraian || '', 'aria-label': 'Uraian', autocomplete: 'off'});
    const satuan = h('select', {'aria-label': 'Satuan'});
    const vol = h('input', {type: 'text', inputmode: 'decimal', value: it.volume != null ? String(it.volume).replace('.', ',') : '', 'aria-label': 'Volume', class: 'kanan'});
    const harga = uang('kvi-h-' + i, it.harga);
    const nilaiEl = h('td', {class: 'kanan nw'});
    const isiSatuan = (pilih) => {
      const b = barangDari(pilihPek.querySelector('input[type=hidden]').value);
      const daftar = b ? satuanBarang(b) : [];
      satuan.replaceChildren(...daftar.map((s) => h('option', {value: s, selected: s === pilih}, s)));
    };
    isiSatuan(it.satuan);
    pilihPek.querySelector('input[type=hidden]').addEventListener('change', () => {
      const b = barangDari(pilihPek.querySelector('input[type=hidden]').value);
      if (b && !uraian.value.trim()) uraian.value = b.nama;
      isiSatuan(b?.satuan);
      const hg = b && hargaTerakhir(b.id, vendor.querySelector('input[type=hidden]').value, satuan.value);
      if (hg && !harga.nilai()) harga.inp.value = formatUang(String(hg));
      segar();
    });
    const item = {id: it.id || null, pilihPek, uraian, satuan, vol, harga, nilaiEl};
    const tr = h('tr', null, h('td', null, pilihPek), h('td', null, uraian), h('td', null, satuan), h('td', null, vol), h('td', null, harga.el), nilaiEl,
      h('td', null, !kunci && h('button', {class: 'btn btn-kecil', type: 'button', onclick: () => { barisItem.splice(barisItem.indexOf(item), 1); tr.remove(); segar(); }}, 'Hapus')));
    [vol, harga.inp].forEach((e) => e.addEventListener('input', () => segar()));
    if (kunci) tr.querySelectorAll('input,select,button').forEach((e) => { e.disabled = true; });
    barisItem.push(item); badanItem.append(tr);
  };
  const bacaItem = () => barisItem.map((b) => ({id: b.id, barang_id: b.pilihPek.querySelector('input[type=hidden]').value, uraian: b.uraian.value.trim(), satuan: b.satuan.value,
    volume: bacaDesimalId(b.vol.value), harga: b.harga.nilai()}));
  (lama?.items || []).forEach(tambahItem);

  // Termin (skema borongan bertermin)
  const badanTermin = h('tbody'), totalTermin = h('b');
  const barisTermin = [];
  const tambahTermin = (t = {}) => {
    const m = h('input', {type: 'text', value: t.milestone || '', 'aria-label': 'Milestone', autocomplete: 'off', placeholder: 'Mis. Rangka selesai'});
    const p = h('input', {type: 'text', inputmode: 'decimal', value: t.persen_bp ? String(bpKePersen(t.persen_bp)).replace('.', ',') : '', 'aria-label': 'Persen', class: 'kanan'});
    const nilaiEl = h('td', {class: 'kanan nw'});
    const item = {id: t.id || null, m, p, nilaiEl};
    const tr = h('tr', null, h('td', null, m), h('td', null, h('div', {class: 'berakhiran'}, p, h('span', null, '%'))), nilaiEl,
      h('td', null, !kunci && h('button', {class: 'btn btn-kecil', type: 'button', onclick: () => { barisTermin.splice(barisTermin.indexOf(item), 1); tr.remove(); segar(); }}, 'Hapus')));
    p.addEventListener('input', () => segar());
    if (kunci) tr.querySelectorAll('input,button').forEach((e) => { e.disabled = true; });
    barisTermin.push(item); badanTermin.append(tr);
  };
  const bacaTermin = () => barisTermin.map((b) => ({id: b.id, milestone: b.m.value.trim(), persen_bp: persenKeBp(b.p.value)}));
  (lama?.termin || []).forEach(tambahTermin);

  const bagianTermin = h('div', {class: 'medan medan-lebar'}, h('label', null, 'Jadwal termin (milestone)'),
    h('table', {class: 'tabel tabel-isian'}, h('thead', null, h('tr', null, ['Milestone', 'Persen', 'Nilai', ''].map((x) => h('th', null, x)))), badanTermin),
    h('div', {class: 'baris-tombol'}, !kunci && h('button', {class: 'btn btn-kecil', type: 'button', onclick: () => { tambahTermin(); segar(); }}, '+ Termin'), h('span', {class: 'pegas'}), totalTermin));
  const bagianItem = h('div', {class: 'medan medan-lebar'}, h('label', null, 'Item pekerjaan (volume × harga satuan)'),
    h('div', {class: 'gulir'}, h('table', {class: 'tabel tabel-isian'}, h('thead', null, h('tr', null, ['Item (master Harga Pekerjaan)', 'Uraian', 'Satuan', 'Volume', 'Harga satuan', 'Nilai', ''].map((x) => h('th', null, x)))), badanItem)),
    h('div', {class: 'baris-tombol'}, !kunci && h('button', {class: 'btn btn-kecil', type: 'button', onclick: () => { tambahItem(); segar(); }}, '+ Item'), h('span', {class: 'pegas'}), totalItem),
    h('span', {class: 'kecil redup'}, 'Harga satuan otomatis masuk riwayat harga di Barang & Harga → Harga Pekerjaan.'));
  const mNilai = medan('Nilai kontrak', nilai.el, {wajib: true, id: 'kv-nilai'});
  const mUpah = medan('Upah per hari', upah.el, {wajib: true, id: 'kv-upah'});
  const mHari = medan('Perkiraan jumlah hari', perkiraan, {bantuan: 'Untuk perkiraan nilai kontrak dan progres.'});
  const segar = () => {
    const s = skema.value;
    mNilai.hidden = !['termin', 'persen'].includes(s); mUpah.hidden = mHari.hidden = s !== 'harian';
    bagianTermin.hidden = s !== 'termin'; bagianItem.hidden = s !== 'volume';
    if (s === 'termin' && !barisTermin.length && !kunci) tambahTermin();
    if (s === 'volume' && !barisItem.length && !kunci) tambahItem();
    const n = nilai.nilai() || 0, tr = bacaTermin(), nt = nilaiTerminVendor(n, tr.map((t) => ({persen_bp: t.persen_bp || 0})));
    barisTermin.forEach((b, i) => { b.nilaiEl.textContent = rp(nt[i] || 0); });
    const tot = tr.reduce((a, t) => a + (t.persen_bp || 0), 0);
    totalTermin.textContent = 'Total ' + (tot / 100).toLocaleString('id-ID', {maximumFractionDigits: 2}) + '%';
    totalTermin.className = tot === 10000 ? '' : 'teks-buruk';
    const it = bacaItem();
    barisItem.forEach((b, i) => { b.nilaiEl.textContent = it[i].volume > 0 && it[i].harga ? rp(kali(it[i].volume, it[i].harga)) : '—'; });
    totalItem.textContent = 'Total ' + rp(it.reduce((a, x) => a + (x.volume > 0 && x.harga ? kali(x.volume, x.harga) : 0), 0));
    ketRetensi.hidden = !(persenKeBp(retensi.value) > 0);
  };
  const ketRetensi = medan('Masa retensi (hari)', masa, {wajib: true, bantuan: 'Retensi bisa dicairkan setelah tanggal selesai + masa retensi.'});
  [skema, retensi].forEach((e) => e.addEventListener('change', segar));
  retensi.addEventListener('input', segar); nilai.inp.addEventListener('input', segar);
  const simpan = h('button', {class: 'btn btn-utama', type: 'submit'}, 'Simpan');
  let dlg;
  const form = h('form', {class: 'form', onsubmit: async (ev) => {
    ev.preventDefault();
    galat.textContent = '';
    const bp = persenKeBp(retensi.value);
    if (bp == null) { galat.textContent = 'Retensi diisi angka persen, mis. 5 atau 2,5.'; return; }
    const d = {proyek_kode: proyek.querySelector('input[type=hidden]').value, vendor_id: vendor.querySelector('input[type=hidden]').value, lingkup: lingkup.value.trim(), no_spk: spk.value.trim(),
      tanggal: tglEl.value, sumber_dana: sumber.value, skema: skema.value, nilai: nilai.nilai(), upah_harian: upah.nilai(), perkiraan_hari: perkiraan.value.trim() === '' ? null : +perkiraan.value,
      retensi_bp: bp, masa_retensi_hari: masa.value.trim() === '' ? null : +masa.value, tgl_selesai: selesai.value || null, catatan: catatan.value.trim() || null};
    const items = d.skema === 'volume' ? bacaItem() : [], termin = d.skema === 'termin' ? bacaTermin() : [];
    if (items.some((i) => Number.isNaN(i.volume))) { galat.textContent = 'Volume diisi angka, maksimal 3 desimal (mis. 12,5).'; return; }
    if (termin.some((t) => t.persen_bp == null)) { galat.textContent = 'Persen termin diisi angka, maksimal 2 desimal.'; return; }
    if (!kunci) {
      const salah = periksaKontrakVendor(d, items, termin, {proyek: S.db.proyek.map((p) => p.kode)});
      if (salah.length) { galat.textContent = salah[0]; return; }
    }
    try {
      await sambilMenyimpan(simpan, async () => {
        d.file = await file.ambil('pihak-proyek/' + (lama?.id || idBaru()));
        const hasil = await store.keu.simpanKontrakVendor(lama?.id, d, items, termin);
        dlg.close();
        await segarkan();
        pesan('Kontrak vendor tersimpan.');
        location.hash = '#pihak-proyek-' + (typeof hasil === 'string' ? hasil : hasil.id);
      });
    } catch (e) { galat.textContent = e.message; }
  }},
    kunci && h('div', {class: 'kotak-info'}, 'Sudah ada opname disetujui: proyek, vendor, skema, sumber dana, nilai, upah, retensi, item, dan termin dikunci agar hak dan jurnal yang sudah ada tetap benar. Lingkup, No. SPK, file, tanggal selesai, masa retensi, dan catatan masih bisa diubah.'),
    h('div', {class: 'form-grid'},
      medan('Proyek', proyek, {wajib: true, id: 'kv-proyek-cari'}), medan('Vendor (master Vendor & Tukang)', vendor, {wajib: true, id: 'kv-vendor-cari'}),
      medan('Lingkup pekerjaan', lingkup), medan('No. SPK', spk), medan('Tanggal', tglEl, {wajib: true}),
      medan('Sumber dana', sumber, {wajib: true, bantuan: 'Dana titipan klien (turn-key) mengurangi Hutang Dana Titipan, bukan beban perusahaan.'}),
      medan('Retensi', h('div', {class: 'berakhiran'}, retensi, h('span', null, '%')), {id: 'kv-ret', bantuan: 'Ditahan otomatis dari setiap opname yang disetujui.'}), ketRetensi,
      medan('Tanggal selesai pekerjaan', selesai, {bantuan: 'Diisi saat pekerjaan selesai (awal masa retensi).'}),
      medan('Skema pembayaran', skema, {wajib: true}), mNilai, mUpah, mHari, bagianTermin, bagianItem,
      file.el, medan('Catatan', catatan, {lebar: true})),
    galat,
    kaki(lama && bisa() && !kunci && !lama.pembayaran.length && tombolHapus(async () => { await store.keu.hapusKontrakVendor(lama.id); dlg.close(); location.hash = '#pihak-proyek'; await segarkan(); pesan('Kontrak vendor dihapus.'); }),
      h('span', {class: 'pegas'}), h('button', {class: 'btn', type: 'button', onclick: () => dlg.close()}, bisa() ? 'Batal' : 'Tutup'), bisa() && simpan));
  if (!bisa()) form.querySelectorAll('input,select,textarea,button[type=button]:not(.btn)').forEach((e) => { e.disabled = true; });
  dlg = dialogLebar(lama ? 'Ubah kontrak vendor' : 'Kontrak vendor baru', form);
  segar();
}

// =====================================================================
// Formulir opname
// =====================================================================
export function bukaFormOpname(v, o) {
  const kunciBulan = o && terkunci(K(), o.tanggal);
  const lain = v.opname.filter((x) => x.status === 'disetujui' && x.id !== o?.id);
  const akhir = lain.slice().sort((a, b) => bandingkan(a.tanggal, b.tanggal) || bandingkan(a.dibuat, b.dibuat)).at(-1);
  const bukanTerakhir = o?.status === 'disetujui' && akhir && (akhir.tanggal > o.tanggal || (akhir.tanggal === o.tanggal && akhir.dibuat > o.dibuat));
  const boleh = bisa() && !kunciBulan && !bukanTerakhir;
  const galat = h('p', {class: 'form-galat', role: 'alert'});
  const d0 = o?.detail || {};
  const tglEl = tanggal('op-tgl', o?.tanggal || hariIni(), {required: true});
  const status = pilihan('op-status', Object.entries(STATUS_OPNAME), o?.status || 'draft');
  const pemeriksa = pemeriksaProyek(v.kode);
  const periksa = pilihan('op-periksa', [['', pemeriksa.length ? 'Pilih anggota Tim Proyek…' : 'Belum ada Tim Proyek di proyek ini'], ...pemeriksa.map((p) => [p.v, p.label]),
    ...(o?.diperiksa_oleh && !pemeriksa.some((p) => p.v === o.diperiksa_oleh) ? [[o.diperiksa_oleh, o.diperiksa_nama || o.diperiksa_oleh]] : [])], o?.diperiksa_oleh || '');
  const foto = pilihBukti('op-foto', o?.foto, {label: 'Foto opname'});
  const catatan = h('textarea', {id: 'op-catatan', rows: '2'}, o?.catatan ?? '');
  const sebelumBp = Math.max(0, ...lain.map((x) => +x.detail?.persen_bp || 0));
  // Isi per skema
  let bacaDetail, isiSkema;
  if (v.skema === 'volume') {
    const inp = v.items.map((i) => h('input', {type: 'text', inputmode: 'decimal', class: 'kanan', 'aria-label': 'Volume ' + i.uraian, value: d0.volume?.[i.id] != null ? String(d0.volume[i.id]).replace('.', ',') : ''}));
    const kumLain = (i) => lain.reduce((s, x) => s + (+x.detail?.volume?.[i.id] || 0), 0);
    isiSkema = h('div', {class: 'medan medan-lebar'}, h('label', null, 'Volume terpasang pada opname ini'),
      h('div', {class: 'gulir'}, h('table', {class: 'tabel tabel-isian'}, h('thead', null, h('tr', null, ['Item', 'Satuan', 'Volume kontrak', 'Sudah disetujui', 'Opname ini'].map((x, j) => h('th', {class: j >= 2 ? 'kanan' : null}, x)))),
        h('tbody', null, v.items.map((i, j) => h('tr', null, h('td', null, i.uraian), h('td', null, i.satuan), h('td', {class: 'kanan'}, angkaId(i.volume)), h('td', {class: 'kanan'}, angkaId(kumLain(i))), h('td', null, inp[j])))))));
    inp.forEach((e) => e.addEventListener('input', () => segar()));
    bacaDetail = () => ({volume: Object.fromEntries(v.items.map((i, j) => [i.id, bacaDesimalId(inp[j].value)]).filter(([, x]) => x != null && x !== 0))});
    bacaDetail.salah = () => v.items.some((i, j) => Number.isNaN(bacaDesimalId(inp[j].value))) && 'Volume diisi angka, maksimal 3 desimal.';
    bacaDetail.lebih = (det) => v.items.filter((i) => kumLain(i) + (det.volume[i.id] || 0) > +i.volume).map((i) => i.uraian);
  } else if (v.skema === 'persen') {
    const p = h('input', {id: 'op-persen', type: 'text', inputmode: 'decimal', class: 'kanan', value: d0.persen_bp ? String(bpKePersen(d0.persen_bp)).replace('.', ',') : ''});
    p.addEventListener('input', () => segar());
    isiSkema = medan('Progres kumulatif s.d. opname ini', h('div', {class: 'berakhiran'}, p, h('span', null, '%')), {wajib: true, id: 'op-persen', bantuan: 'Opname disetujui sebelumnya: ' + persenBp(sebelumBp) + '. Hak opname ini = selisihnya × nilai kontrak.'});
    bacaDetail = () => ({persen_bp: persenKeBp(p.value)});
    bacaDetail.salah = () => persenKeBp(p.value) == null && 'Persen diisi angka, maksimal 2 desimal.';
  } else if (v.skema === 'harian') {
    const hr = h('input', {id: 'op-hari', type: 'text', inputmode: 'numeric', class: 'kanan', value: d0.hari ?? ''});
    hr.addEventListener('input', () => segar());
    isiSkema = medan('Jumlah hari kerja', hr, {wajib: true, bantuan: 'Upah ' + rp(v.upah_harian) + ' per hari.'});
    bacaDetail = () => ({hari: hr.value.trim() === '' ? null : +hr.value});
    bacaDetail.salah = () => !/^\d+$/.test(hr.value.trim()) && 'Jumlah hari diisi angka bulat.';
  } else {
    const dipakai = new Set(lain.flatMap((x) => x.detail?.termin || []));
    const cek = v.termin.map((t) => h('input', {type: 'checkbox', checked: (d0.termin || []).includes(t.id), disabled: dipakai.has(t.id)}));
    cek.forEach((e) => e.addEventListener('change', () => segar()));
    isiSkema = h('div', {class: 'medan medan-lebar'}, h('label', null, 'Milestone yang tercapai'),
      ...v.termin.map((t, j) => h('label', {class: 'centang'}, cek[j], ' ', (t.milestone || 'Termin ' + t.ke) + ' · ' + persenBp(t.persen_bp) + ' · ' + rp(t.nilai) + (dipakai.has(t.id) ? ' (sudah di opname lain)' : ''))));
    bacaDetail = () => ({termin: v.termin.filter((t, j) => cek[j].checked && !cek[j].disabled).map((t) => t.id)});
    bacaDetail.salah = () => false;
  }
  const pratinjau = h('div', {class: 'kotak-info kecil'});
  const dompet = S.d.dompet[v.kode];
  const segar = () => {
    if (bacaDetail.salah()) { pratinjau.replaceChildren(h('span', {class: 'form-galat'}, bacaDetail.salah())); return; }
    const det = bacaDetail();
    const nilai = nilaiOpname({detail: det}, v, v.items, v.termin, sebelumBp), ret = retensiDari(nilai, v);
    const lebih = bacaDetail.lebih?.(det) || [];
    const titipanMinus = status.value === 'disetujui' && v.sumber_dana === 'titipan' && dompet && dompet.saldo_titipan < nilai - ret;
    pratinjau.replaceChildren(...[
      h('div', null, h('b', null, 'Nilai opname ini: ' + rp(nilai)), ret ? ' · retensi ' + persenBp(v.retensi_bp) + ' ditahan ' + rp(ret) + ' · menambah hutang ' + rp(nilai - ret) : ''),
      status.value === 'disetujui' ? h('div', null, 'Jurnal: D ' + nm(v.sumber_dana === 'titipan' ? '2-4' : '5-2') + ' ' + rp(nilai) + ' / K ' + nm('2-1') + ' ' + rp(nilai - ret) + (ret ? ' / K ' + nm('2-2') + ' ' + rp(ret) : ''))
        : h('div', {class: 'redup'}, 'Draft: belum menambah hak vendor dan belum dijurnal.'),
      lebih.length && h('div', {class: 'form-galat'}, '⚠ Volume kumulatif melebihi volume kontrak: ' + lebih.join(', ') + '. Boleh disimpan bila memang ada pekerjaan tambah.'),
      titipanMinus && h('div', {class: 'form-galat'}, '⚠ Dana titipan proyek ' + v.kode + ' tinggal ' + rp(dompet.saldo_titipan) + '. Tetap boleh disetujui; dompet titipan akan minus (dibiayai dana lain).'),
      terkunci(K(), tglEl.value) && h('div', {class: 'form-galat'}, 'Bulan ' + tglEl.value.slice(0, 7) + ' sudah ditutup.'),
    ].filter(Boolean));
  };
  [tglEl, status].forEach((e) => e.addEventListener('change', segar));
  const simpan = h('button', {class: 'btn btn-utama', type: 'submit'}, 'Simpan');
  let dlg;
  const form = h('form', {class: 'form', onsubmit: async (ev) => {
    ev.preventDefault();
    galat.textContent = '';
    const salah = bacaDetail.salah();
    if (salah) { galat.textContent = salah; return; }
    const p = pemeriksa.find((x) => x.v === periksa.value);
    const d = {kontrak_id: v.id, tanggal: tglEl.value, status: status.value, detail: bacaDetail(), diperiksa_oleh: periksa.value || null,
      diperiksa_nama: p?.nama || (periksa.value ? o?.diperiksa_nama : null) || null, catatan: catatan.value.trim() || null};
    if (d.status === 'disetujui' && !d.diperiksa_oleh) { galat.textContent = 'Pilih siapa yang memeriksa (Tim Proyek: pengawas / PIC) sebelum menyetujui.'; periksa.focus(); return; }
    try {
      await sambilMenyimpan(simpan, async () => {
        d.foto = await foto.ambil('pihak-proyek/' + v.id);
        await store.keu.simpanOpname(o?.id, d);
      });
      dlg.close(); await segarkanKeuangan(); pesan(d.status === 'disetujui' ? 'Opname disetujui dan dijurnal.' : 'Opname Draft tersimpan.');
    } catch (e) { galat.textContent = e.message; }
  }},
    kunciBulan && catatanKunci(o.tanggal),
    bukanTerakhir && h('div', {class: 'kotak-info'}, 'Hanya opname disetujui terakhir yang bisa diubah atau dihapus, agar hak dan jurnal tetap urut.'),
    h('p', null, v.vendor_nama + ' · ' + namaProyek(v.kode) + ' · ' + SKEMA[v.skema]),
    h('div', {class: 'form-grid'}, medan('Tanggal opname', tglEl, {wajib: true}), medan('Status', status, {bantuan: 'Hanya opname Disetujui yang menambah hak vendor.'}),
      isiSkema, medan('Diperiksa oleh', periksa, {bantuan: pemeriksa.length ? 'Anggota Tim Proyek (pengawas / PIC).' : 'Isi Tim Proyek dulu di data proyek ' + v.kode + '.'}),
      foto.el, medan('Catatan', catatan, {lebar: true})),
    pratinjau, galat,
    kaki(o && boleh && tombolHapus(async () => { await store.keu.hapusOpname(o.id); dlg.close(); await segarkanKeuangan(); pesan('Opname dihapus beserta jurnalnya.'); }),
      h('span', {class: 'pegas'}), h('button', {class: 'btn', type: 'button', onclick: () => dlg.close()}, boleh ? 'Batal' : 'Tutup'), boleh && simpan));
  if (!boleh) form.querySelectorAll('input,select,textarea').forEach((e) => { e.disabled = true; });
  dlg = dialogLebar(o ? 'Opname ' + tgl(o.tanggal) : 'Opname baru', form);
  segar();
}

// =====================================================================
// Formulir pembayaran vendor / pencairan retensi
// =====================================================================
export function bukaFormBayarVendor(v, b, jenis = 'bayar') {
  const kunciBulan = b && terkunci(K(), b.tanggal);
  const boleh = bisa() && !kunciBulan;
  const galat = h('p', {class: 'form-galat', role: 'alert'});
  const retensi = jenis === 'retensi';
  const lainBayar = v.pembayaran.filter((x) => x.id !== b?.id);
  const sisaHutang = v.hak - v.retensi - lainBayar.filter((x) => x.jenis !== 'retensi').reduce((s, x) => s + x.jumlah + x.potongan_pajak, 0);
  const sisaRetensi = v.retensi - lainBayar.filter((x) => x.jenis === 'retensi').reduce((s, x) => s + x.jumlah + x.potongan_pajak, 0);
  const batas = retensi ? sisaRetensi : sisaHutang;
  const tglEl = tanggal('bv-tgl', b?.tanggal || (retensi && v.tgl_cair_retensi > hariIni() ? v.tgl_cair_retensi : hariIni()), {required: true});
  const jumlah = uang('bv-jumlah', b ? b.jumlah : Math.max(0, batas));
  const potongan = uang('bv-pot', b?.potongan_pajak || '');
  let jumlahDiubah = !!b;
  jumlah.inp.addEventListener('input', () => { jumlahDiubah = true; });
  const rekAktif = K().rekening.filter((r) => r.aktif || r.id === b?.rekening_id);
  const rek = pilihan('bv-rek', [['', 'Pilih rekening…'], ...rekAktif.map((r) => [r.id, r.nama])], b?.rekening_id || (rekAktif.length === 1 ? rekAktif[0].id : ''));
  const buktiPotong = pilihBukti('bv-bp', b?.bukti_potong, {label: 'Bukti potong pajak'});
  const buktiTransfer = pilihBukti('bv-bt', b?.bukti_transfer, {label: 'Bukti transfer'});
  const catatan = h('textarea', {id: 'bv-catatan', rows: '2'}, b?.catatan ?? '');
  const pratinjau = h('div', {class: 'kotak-info kecil'});
  const segar = () => {
    const pot = potongan.nilai() || 0;
    if (!jumlahDiubah) jumlah.inp.value = formatUang(String(Math.max(0, batas - pot)));
    const jml = jumlah.nilai() || 0, total = jml + pot;
    pratinjau.replaceChildren(...[
      h('b', null, 'Jurnal otomatis:'),
      h('div', null, 'D ' + nm(retensi ? '2-2' : '2-1') + ' ' + rp(total)),
      jml > 0 && h('div', null, 'K ' + (rek.value ? namaRekening(rek.value) : 'rekening') + ' ' + rp(jml)),
      pot > 0 && h('div', null, 'K ' + nm('2-6') + ' ' + rp(pot) + ' (pajak dipotong, disetor kemudian)'),
      retensi && total > sisaRetensi && h('div', {class: 'form-galat'}, 'Melebihi retensi yang ditahan (' + rp(sisaRetensi) + ').'),
      retensi && v.tgl_cair_retensi && tglEl.value < v.tgl_cair_retensi && h('div', {class: 'form-galat'}, 'Retensi baru bisa dicairkan mulai ' + tgl(v.tgl_cair_retensi) + '.'),
      retensi && !v.tgl_cair_retensi && h('div', {class: 'form-galat'}, 'Isi tanggal selesai pekerjaan dan masa retensi di kontrak vendor dulu.'),
      !retensi && total > sisaHutang && h('div', {class: 'form-galat'}, '⚠ Melebihi hak vendor yang belum dibayar (' + rp(Math.max(0, sisaHutang)) + '). Lebih bayar ' + rp(total - Math.max(0, sisaHutang)) + ' — tetap boleh disimpan (mis. uang muka).'),
      terkunci(K(), tglEl.value) && h('div', {class: 'form-galat'}, 'Bulan ' + tglEl.value.slice(0, 7) + ' sudah ditutup.'),
    ].filter(Boolean));
  };
  [tglEl, rek].forEach((e) => e.addEventListener('change', segar));
  jumlah.inp.addEventListener('input', segar); potongan.inp.addEventListener('input', segar);
  const simpan = h('button', {class: 'btn btn-utama', type: 'submit'}, 'Simpan');
  let dlg;
  const form = h('form', {class: 'form', onsubmit: async (ev) => {
    ev.preventDefault();
    galat.textContent = '';
    const d = {kontrak_id: v.id, jenis, tanggal: tglEl.value, jumlah: jumlah.nilai() || 0, potongan_pajak: potongan.nilai() || 0, rekening_id: rek.value || null, catatan: catatan.value.trim() || null};
    if (!d.tanggal) { galat.textContent = 'Tanggal wajib diisi.'; return; }
    if (d.jumlah + d.potongan_pajak <= 0) { galat.textContent = 'Isi jumlah dibayar dan/atau potongan pajak.'; return; }
    if (d.jumlah > 0 && !d.rekening_id) { galat.textContent = 'Rekening pembayar wajib dipilih.'; rek.focus(); return; }
    try {
      await sambilMenyimpan(simpan, async () => {
        d.bukti_potong = await buktiPotong.ambil('pihak-proyek/' + v.id);
        d.bukti_transfer = await buktiTransfer.ambil('pihak-proyek/' + v.id);
        await store.keu.simpanBayarVendor(b?.id, d);
      });
      dlg.close(); await segarkanKeuangan(); pesan((retensi ? 'Pencairan retensi' : 'Pembayaran') + ' tersimpan dan dijurnal.');
    } catch (e) { galat.textContent = e.message; }
  }},
    kunciBulan && catatanKunci(b.tanggal),
    h('p', null, v.vendor_nama + ' · ' + namaProyek(v.kode) + ' · ', retensi ? ['retensi ditahan ', h('b', null, rp(sisaRetensi))] : ['hutang saat ini ', h('b', null, rp(Math.max(0, sisaHutang)))]),
    h('div', {class: 'form-grid'},
      medan('Tanggal', tglEl, {wajib: true}), medan('Rekening pembayar', rek, {wajib: true}),
      medan('Jumlah dibayar (keluar rekening)', jumlah.el, {wajib: true, id: 'bv-jumlah'}),
      medan('Potongan pajak', potongan.el, {id: 'bv-pot', bantuan: 'Mis. PPh 21 / PPh 23 yang dipotong dari vendor. Dicatat sebagai Hutang Pajak Lainnya.'}),
      buktiPotong.el, buktiTransfer.el, medan('Catatan', catatan, {lebar: true})),
    pratinjau, galat,
    kaki(b && boleh && tombolHapus(async () => { await store.keu.hapusBayarVendor(b.id); dlg.close(); await segarkanKeuangan(); pesan('Pembayaran dihapus beserta jurnalnya.'); }),
      h('span', {class: 'pegas'}), h('button', {class: 'btn', type: 'button', onclick: () => dlg.close()}, boleh ? 'Batal' : 'Tutup'), boleh && simpan));
  if (!boleh) form.querySelectorAll('input,select,textarea').forEach((e) => { e.disabled = true; });
  dlg = dialogLebar((retensi ? 'Pencairan retensi' : 'Pembayaran vendor') + (b ? ' ' + tgl(b.tanggal) : ''), form);
  segar();
}
