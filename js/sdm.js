// Modul SDM: daftar pegawai, halaman detail, dan formulir (riwayat kontrak, riwayat gaji, file PDF).
// Hanya admin yang membuka modul ini.
import {S, muatData, bersih} from './state.js';
import {store, idBaru} from './store.js';
import {h, idn, rp, tgl, isi, pill, pesan, aman, dialog, formatUang, bacaUang, ukuranFile, buangTeksPalsu} from './ui.js';
import {kotakCek, cekSemua, periksaIsian} from './cek.js';
import {hariIni} from './calc.js';
import {OPSI} from './schema.js';
import {
  STATUS, STATUS_KERJA, STATUS_PENDEK, ALASAN_KELUAR, BATAS_FILE, aturSdm, bawaanTimProyek, kontrakDari, dokumenDari, gajiDari,
  cekBatasPkwt, jatahHabis, namaKontrak, tambahHari, nikSama, namaMiripPegawai,
} from './sdm-util.js';

const atur = () => aturSdm(S.pengaturan?.data);
const keDetail = (id) => { location.hash = '#sdm-' + id; };

// ---------- bagian kecil ----------
export const daftarPeringatan = (s) => (s.peringatan.length
  ? h('div', {class: 'peringatan-daftar'}, s.peringatan.map((p) => h('span', {class: 'peringatan' + (p.berat ? ' peringatan-berat' : '')}, '⚠️ ' + p.teks)))
  : h('span', {class: 'redup'}, '—'));

// Tombol untuk membuka file PDF di tab baru. Tab dibuka lebih dulu agar tidak diblokir browser.
export function tombolPdf(file, label = 'Lihat PDF') {
  return h('button', {class: 'btn btn-kecil', type: 'button', title: file.nama + ' (' + ukuranFile(file.ukuran || 0) + ')', onclick: aman(async () => {
    const tab = window.open('', '_blank');
    try {
      const url = await store.urlBerkas(file.path);
      if (tab) tab.location.href = url; else location.href = url;
    } catch (e) { tab?.close(); throw e; }
  })}, label);
}
const keteranganFile = (file) => h('span', {class: 'kecil redup'}, file.nama + ' · ' + ukuranFile(file.ukuran || 0));
const rincian = (pasangan) => h('dl', {class: 'rincian'}, pasangan.filter(Boolean).map(([k, v]) => [h('dt', null, k), h('dd', null, v == null || v === '' ? '—' : v)]));
const waTautan = (hp) => (hp ? h('a', {href: 'https://wa.me/' + hp, target: '_blank', rel: 'noopener', title: 'Buka WhatsApp'}, hp) : '—');

// ---------- daftar pegawai ----------
const KOLOM = [['nama', 'Nama'], ['jabatan_nama', 'Jabatan'], ['status_pendek', 'Status kerja'], ['kontrak_akhir', 'Kontrak berakhir'], ['tim_proyek', 'Tim proyek'], ['jml_peringatan', 'Peringatan']];

export function renderSdm(el) {
  const sar = S.saringSdm;
  const badan = h('tbody'), kepalaTabel = h('tr');
  const hitungan = h('span', {class: 'redup kecil'});
  const gambar = () => {
    const q = S.cari.trim().toLowerCase();
    const {k, arah} = S.urutSdm;
    const nilaiUrut = (r) => (k === 'tim_proyek' ? (r.tim_proyek ? 1 : 0) : r[k]);
    const tampil = S.d.sdm
      .filter((r) => sar.aktif === 'Semua' || r.aktif === sar.aktif)
      .filter((r) => !sar.status || r.status === sar.status)
      .filter((r) => !sar.peringatan || r.jml_peringatan)
      .filter((r) => !q || [r.nama, r.nik, r.jabatan_nama, r.status, r.hp, r.email].some((v) => String(v ?? '').toLowerCase().includes(q)))
      .sort((a, b) => {
        const x = nilaiUrut(a), y = nilaiUrut(b);
        if (typeof x === 'number' || typeof y === 'number') return arah * ((x || 0) - (y || 0));
        if (!x !== !y) return x ? -1 : 1; // yang kosong selalu di bawah
        return arah * String(x ?? '').localeCompare(String(y ?? ''), 'id', {numeric: true});
      });
    hitungan.textContent = tampil.length + ' dari ' + S.d.sdm.length + ' pegawai';
    kepalaTabel.replaceChildren(...KOLOM.map(([kunci, label]) => h('th', {'aria-sort': k === kunci ? (arah > 0 ? 'ascending' : 'descending') : null},
      h('button', {class: 'th-urut', type: 'button', onclick: () => { S.urutSdm = {k: kunci, arah: k === kunci ? -arah : 1}; gambar(); }}, label, k === kunci ? (arah > 0 ? ' ▲' : ' ▼') : ''))));
    if (!S.d.sdm.length) {
      badan.replaceChildren(h('tr', null, h('td', {colspan: String(KOLOM.length), class: 'kosong-tabel'}, h('p', null, 'Belum ada pegawai. Klik Tambah pegawai untuk mulai.'))));
      return;
    }
    badan.replaceChildren(...(tampil.length ? tampil.map((r) => h('tr', {class: 'bisa-klik', onclick: (ev) => { if (!ev.target.closest('a,button')) keDetail(r.id); }},
      h('td', {class: 'sel-nama'}, h('a', {href: '#sdm-' + r.id}, r.nama || '(tanpa nama)'), r.aktif === 'Keluar' && h('span', {class: 'kecil redup blok'}, 'Keluar' + (r.tgl_keluar ? ' ' + tgl(r.tgl_keluar) : ''))),
      h('td', null, isi(r.jabatan_nama)),
      h('td', {class: 'nw'}, isi(r.status_pendek)),
      h('td', {class: 'nw'}, r.kontrak_akhir ? [tgl(r.kontrak_akhir), r.status === STATUS.magang && h('span', {class: 'kecil redup blok'}, 'akhir magang')] : '—'),
      h('td', {class: 'tengah-teks'}, r.tim_proyek ? h('span', {title: 'Dapat dipilih sebagai Tim Proyek'}, '✓') : h('span', {class: 'redup', title: 'Tidak muncul di pilihan Tim Proyek'}, '–')),
      h('td', null, daftarPeringatan(r))))
      : [h('tr', null, h('td', {colspan: String(KOLOM.length), class: 'redup'}, 'Tidak ada pegawai yang cocok dengan saringan.'))]));
  };
  const saring = (id, label, nilai, opsi, ubah) => h('select', {id, 'aria-label': label, onchange: (ev) => { ubah(ev.target.value); gambar(); }}, opsi.map(([v, t]) => h('option', {value: v, selected: v === nilai}, t)));
  el.append(
    h('div', {class: 'kepala'}, h('h1', null, 'SDM'), h('p', {class: 'redup'}, 'Data kepegawaian dan kontrak kerja. Peringatan diatur di Pengaturan.')),
    h('div', {class: 'alat'},
      h('input', {id: 'cari', type: 'search', placeholder: 'Cari…', 'aria-label': 'Cari pegawai', value: S.cari, oninput: (ev) => { S.cari = ev.target.value; gambar(); }}),
      saring('saring-aktif', 'Status aktif', sar.aktif, [['Aktif', 'Aktif'], ['Keluar', 'Keluar'], ['Semua', 'Aktif & keluar']], (v) => { sar.aktif = v; }),
      saring('saring-status', 'Status kerja', sar.status, [['', 'Semua status kerja'], ...STATUS_KERJA.map((s) => [s, STATUS_PENDEK[s]])], (v) => { sar.status = v; }),
      h('label', {class: 'centang'}, h('input', {type: 'checkbox', id: 'saring-peringatan', checked: sar.peringatan, onchange: (ev) => { sar.peringatan = ev.target.checked; gambar(); }}), 'Hanya yang ada peringatan'),
      hitungan, h('span', {class: 'pegas'}),
      h('button', {class: 'btn btn-utama', type: 'button', onclick: () => bukaFormPegawai(null)}, 'Tambah pegawai')),
    h('div', {class: 'gulir'}, h('table', {class: 'tabel tabel-sdm'}, h('thead', null, kepalaTabel), badan)));
  gambar();
}

// ---------- detail pegawai ----------
const TAB = [['profil', 'Profil'], ['kepegawaian', 'Kepegawaian'], ['kontrak', 'Kontrak & dokumen'], ['gaji', 'Riwayat gaji'], ['proyek', 'Proyek']];

export function renderDetailPegawai(el, id) {
  const s = S.d.sdm.find((x) => x.id === id);
  const kembali = h('a', {href: '#t-sdm', class: 'kecil'}, '← Daftar SDM');
  if (!s) { el.append(h('div', {class: 'kepala'}, kembali, h('h1', null, 'Pegawai tidak ditemukan'), h('p', {class: 'redup'}, 'Data ini mungkin sudah dihapus.'))); return; }
  const magang = s.status === STATUS.magang;
  const panel = h('div', {class: 'kartu', role: 'tabpanel', id: 'panel-sdm'});
  const tombolTab = TAB.map(([k, label]) => h('button', {class: 'tab', type: 'button', role: 'tab', id: 'tab-' + k, 'aria-controls': 'panel-sdm', onclick: () => pilihTab(k)}, label));
  const pilihTab = (k) => {
    S.tabSdm = k;
    tombolTab.forEach((b, i) => b.setAttribute('aria-selected', String(TAB[i][0] === k)));
    panel.setAttribute('aria-labelledby', 'tab-' + k);
    panel.replaceChildren(...[].concat(ISI_TAB[k]()).filter((x) => x != null && x !== false));
    buangTeksPalsu(panel);
  };
  const ISI_TAB = {
    profil: () => [
      h('h3', null, 'Identitas'),
      rincian([['Nama', s.nama], ['NIK', s.nik], ['Tanggal lahir', s.tgl_lahir && tgl(s.tgl_lahir)], ['Alamat', s.alamat], ['No. HP / WA', waTautan(s.hp)], ['Email', s.email]]),
      h('h3', null, 'Kontak darurat'),
      rincian([['Nama', s.darurat_nama], ['Hubungan', s.darurat_hubungan], ['No. HP', waTautan(s.darurat_hp)]]),
      h('h3', null, 'Rekening bank'),
      rincian([['Bank', s.bank_nama], ['Nomor rekening', s.bank_rek], ['Atas nama', s.bank_atas_nama]]),
    ],
    kepegawaian: () => [
      rincian([
        ['Jabatan', s.jabatan_nama], ['Status kerja', s.status], ['Tanggal masuk', s.tgl_masuk && tgl(s.tgl_masuk)], ['Masa kerja', s.masa_kerja],
        ['Dapat dipilih sebagai Tim Proyek', s.tim_proyek ? 'Ya' : 'Tidak'],
        ['Status', s.aktif === 'Keluar' ? 'Keluar' + (s.tgl_keluar ? ' sejak ' + tgl(s.tgl_keluar) : '') + (s.alasan_keluar ? ' · ' + s.alasan_keluar + (s.alasan_lain ? ': ' + s.alasan_lain : '') : '') : 'Aktif'],
        magang && ['Periode magang', tgl(s.magang_mulai) + ' – ' + tgl(s.magang_selesai)],
        magang && ['Institusi asal', s.institusi],
        ['No. BPJS Kesehatan', s.bpjs_kes_no || (s.bpjs_kes === 'Ya' ? 'Terdaftar (nomor belum diisi)' : '')],
        ['No. BPJS Ketenagakerjaan', s.bpjs_tk_no || (s.bpjs_tk === 'Ya' ? 'Terdaftar (nomor belum diisi)' : '')],
        ['No. NPWP / NIK', s.npwp_no],
        s.perlu_skk && ['No. SKK / STRA', s.skk_no],
        s.perlu_skk && ['SKK / STRA berlaku s.d.', s.skk_berlaku && tgl(s.skk_berlaku)],
        s.perlu_skk && ['File sertifikat', s.skk_file ? h('span', {class: 'baris-tombol'}, tombolPdf(s.skk_file), keteranganFile(s.skk_file)) : ''],
        ['Catatan', s.catatan],
      ]),
    ],
    kontrak: () => {
      const tabelKontrak = s.kontrak_list.length ? [
        s.status !== STATUS.pkwt && h('p', {class: 'kecil redup'}, 'Status kerja sekarang ' + s.status_pendek + '; riwayat kontrak PKWT di bawah tetap disimpan sebagai arsip.'),
        h('div', {class: 'gulir'}, h('table', {class: 'tabel'},
          h('thead', null, h('tr', null, ['Kontrak', 'Mulai', 'Berakhir', 'File kontrak', 'Catatan'].map((x) => h('th', null, x)))),
          h('tbody', null, s.kontrak_list.slice().reverse().map((k, i) => h('tr', null,
            h('td', null, namaKontrak(k.ke), i === 0 && h('span', {class: 'kecil redup blok'}, 'terbaru')),
            h('td', {class: 'nw'}, tgl(k.mulai)), h('td', {class: 'nw'}, tgl(k.berakhir)),
            h('td', null, k.file ? h('div', {class: 'baris-tombol'}, tombolPdf(k.file), keteranganFile(k.file)) : h('span', {class: 'redup'}, 'Belum ada file')),
            h('td', null, isi(k.catatan)))))))]
        : s.status === STATUS.pkwt ? h('p', {class: 'redup'}, 'Belum ada kontrak tercatat. Klik Ubah data untuk mengisi kontrak awal.') : null;
      const tabelDokumen = s.dokumen_list.length ? h('div', {class: 'gulir'}, h('table', {class: 'tabel'},
        h('thead', null, h('tr', null, ['Dokumen', 'Nomor', 'Tanggal', 'File', 'Catatan'].map((x) => h('th', null, x)))),
        h('tbody', null, s.dokumen_list.slice().reverse().map((d) => h('tr', null,
          h('td', null, isi(d.jenis)), h('td', null, isi(d.nomor)), h('td', {class: 'nw'}, tgl(d.tanggal)),
          h('td', null, d.file ? h('div', {class: 'baris-tombol'}, tombolPdf(d.file), keteranganFile(d.file)) : h('span', {class: 'redup'}, 'Belum ada file')),
          h('td', null, isi(d.catatan)))))))
        : h('p', {class: 'redup'}, 'Belum ada dokumen kerja. Klik Ubah data, lalu + Tambah dokumen.');
      return [tabelKontrak && h('h3', null, 'Riwayat kontrak PKWT'), tabelKontrak, h('h3', null, 'Dokumen kerja'),
        h('p', {class: 'kecil redup'}, 'Perjanjian kerja, SK pengangkatan, perjanjian magang, addendum, dan dokumen kerja lainnya.'), tabelDokumen].flat();
    },
    gaji: () => {
      const kini = s.gaji_saat_ini;
      return s.gaji_list.length ? h('div', {class: 'gulir'}, h('table', {class: 'tabel'},
        h('thead', null, h('tr', null, h('th', null, 'Berlaku mulai'), h('th', {class: 'kanan'}, magang ? 'Gaji pokok / uang saku' : 'Gaji pokok'), h('th', {class: 'kanan'}, 'Tunjangan'), h('th', {class: 'kanan'}, 'Total'), h('th', null, 'Catatan'))),
        h('tbody', null, s.gaji_list.slice().reverse().map((g) => h('tr', null,
          h('td', {class: 'nw'}, g.berlaku ? tgl(g.berlaku) : '—', g === kini || (kini && g.berlaku === kini.berlaku && g.gaji === kini.gaji && g.tunjangan === kini.tunjangan) ? h('span', {class: 'kecil blok'}, pill('Berlaku saat ini')) : g.berlaku > hariIni() && h('span', {class: 'kecil redup blok'}, 'belum berlaku')),
          h('td', {class: 'kanan'}, g.gaji == null ? '—' : rp(g.gaji)), h('td', {class: 'kanan'}, g.tunjangan == null ? '—' : rp(g.tunjangan)),
          h('td', {class: 'kanan'}, rp((g.gaji || 0) + (g.tunjangan || 0))), h('td', null, isi(g.catatan)))))))
        : h('p', {class: 'redup'}, 'Belum ada data gaji.');
    },
    proyek: () => {
      const tabel = (rows, kosongTeks) => (rows.length ? h('div', {class: 'gulir'}, h('table', {class: 'tabel'},
        h('thead', null, h('tr', null, ['Proyek', 'Peran', 'Mulai', 'Selesai', 'Status proyek'].map((x) => h('th', null, x)))),
        h('tbody', null, rows.map((p) => h('tr', null, h('td', null, h('span', null, p.nama || p.kode), h('span', {class: 'kecil redup blok'}, p.kode)), h('td', null, isi(p.peran)), h('td', {class: 'nw'}, tgl(p.mulai)), h('td', {class: 'nw'}, tgl(p.selesai)), h('td', null, pill(p.status)))))))
        : h('p', {class: 'redup'}, kosongTeks));
      return [h('h3', null, 'Sedang diikuti'), tabel(s.proyek_diikuti.filter((p) => p.sedang), 'Tidak ada proyek yang sedang diikuti.'),
        h('h3', null, 'Pernah diikuti'), tabel(s.proyek_diikuti.filter((p) => !p.sedang), 'Belum ada.'),
        h('p', {class: 'kecil redup'}, 'Diambil dari Tim Proyek di setiap proyek.')];
    },
  };
  el.append(
    h('div', {class: 'kepala'}, kembali,
      h('div', {class: 'judul-baris'}, h('h1', null, s.nama), h('span', {class: 'pegas'}), h('button', {class: 'btn btn-utama', type: 'button', onclick: () => bukaFormPegawai(s.id)}, 'Ubah data')),
      h('p', {class: 'redup'}, [s.jabatan_nama, s.status, s.aktif === 'Keluar' ? 'Keluar' : 'Aktif', s.gaji_saat_ini && (magang ? 'Uang saku ' : 'Gaji + tunjangan ') + rp(s.gaji_total) + ' / bulan'].filter(Boolean).join(' · ')),
      s.peringatan.length > 0 && daftarPeringatan(s)),
    h('div', {class: 'tabs', role: 'tablist', 'aria-label': 'Bagian data pegawai'}, tombolTab),
    panel);
  pilihTab(TAB.some(([k]) => k === S.tabSdm) ? S.tabSdm : 'profil');
}

// ---------- formulir pegawai ----------
const LAMA = ['kontrak_mulai', 'kontrak_berakhir', 'gaji', 'tunjangan', 'no_skk', 'dokumen_kontrak', 'bpjs_kes', 'bpjs_tk', 'npwp', 'jabatan'];
let nomorKontrak = 0;

// Kotak pilih file PDF: hanya PDF dan maksimal 10 MB. .berkas() = File yang dipilih (atau null).
function pilihPdf(id, label) {
  const ket = h('span', {class: 'kecil redup'}, 'PDF, maksimal ' + ukuranFile(BATAS_FILE) + '.');
  const inp = h('input', {id, type: 'file', accept: 'application/pdf,.pdf', 'aria-label': label, onchange: () => {
    const f = inp.files[0];
    ket.classList.remove('teks-buruk');
    if (!f) { ket.textContent = 'PDF, maksimal ' + ukuranFile(BATAS_FILE) + '.'; return; }
    const pdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
    if (!pdf || f.size > BATAS_FILE) {
      inp.value = '';
      ket.textContent = !pdf ? 'Hanya file PDF yang diterima.' : 'File terlalu besar (' + ukuranFile(f.size) + '). Maksimal ' + ukuranFile(BATAS_FILE) + '.';
      ket.classList.add('teks-buruk');
      return;
    }
    ket.textContent = 'Akan diunggah saat disimpan: ' + f.name + ' (' + ukuranFile(f.size) + ')';
  }});
  const wadah = h('div', {class: 'pilih-pdf'}, inp, ket);
  wadah.berkas = () => inp.files[0] || null;
  return wadah;
}

export function bukaFormPegawai(id) {
  const lama = id ? S.db.sdm.find((x) => x.id === id) : null;
  const lihat = id ? S.d.sdm.find((x) => x.id === id) : null;
  const pid = id || idBaru();
  const {jabatan, param} = atur();
  const today = hariIni();
  let dlg, lanjut = false;

  const idDari = (m) => m.id || m.querySelector('input,select,textarea')?.id;
  const medan = (label, masukan, o = {}) => h('div', {class: 'medan' + (o.lebar ? ' medan-lebar' : ''), hidden: o.hidden},
    h('label', {for: idDari(masukan)}, label, o.wajib && h('span', {class: 'wajib', title: 'Wajib diisi'}, ' *')), masukan, o.bantuan && h('span', {class: 'kecil redup'}, o.bantuan));
  const teks = (iid, nilai, a = {}) => h('input', {id: iid, type: 'text', value: nilai ?? '', autocomplete: 'off', ...a});
  const tanggal = (iid, nilai) => h('input', {id: iid, type: 'date', value: nilai ?? ''});
  const uang = (iid, nilai) => {
    const inp = h('input', {id: iid, type: 'text', inputmode: 'numeric', autocomplete: 'off', value: nilai == null ? '' : idn(nilai), oninput: () => { inp.value = formatUang(inp.value); }});
    return h('div', {class: 'berawalan'}, h('span', null, 'Rp'), inp);
  };
  const bagian = (judul, ...isiBagian) => h('section', {class: 'form-bagian'}, h('h3', null, judul), ...isiBagian);
  const grid = (...anak) => h('div', {class: 'form-grid'}, ...anak);
  const pilih = (iid, opsi, nilai, kosongTeks = 'Pilih…') => h('select', {id: iid}, h('option', {value: ''}, kosongTeks), opsi.map(([v, t]) => h('option', {value: v, selected: v === nilai}, t)));

  // Identitas
  const nama = teks('p-nama', lama?.nama);
  const mirip = h('div', {class: 'medan medan-lebar kotak-info', hidden: true});
  const cekMirip = () => {
    const cocok = namaMiripPegawai(nama.value, S.d.sdm, id);
    mirip.hidden = !cocok.length;
    mirip.replaceChildren(h('b', null, 'Sudah ada pegawai dengan nama mirip:'), h('ul', {class: 'cocok'}, cocok.map((s) => h('li', null, s.nama + ' · ' + (s.jabatan_nama || 'tanpa jabatan') + (s.aktif === 'Keluar' ? ' (keluar)' : '')))));
  };
  nama.addEventListener('input', cekMirip);
  const nik = kotakCek(teks('p-nik', lama?.nik), 'nik');
  const hp = kotakCek(teks('p-hp', lama?.hp), 'hp');
  const email = kotakCek(teks('p-email', lama?.email), 'email');
  const alamat = h('textarea', {id: 'p-alamat', rows: '2'}, lama?.alamat ?? '');
  const daruratHp = kotakCek(teks('p-darurat-hp', lama?.darurat_hp), 'hp');

  // Kepegawaian
  const jabatanLama = lihat?.jabatan_id;
  const pilihanJabatan = jabatan.filter((j) => j.aktif !== false || j.id === jabatanLama).map((j) => [j.id, j.nama + (j.aktif === false ? ' (nonaktif)' : '')]);
  const selJabatan = pilih('p-jabatan', pilihanJabatan, jabatanLama);
  if (lihat?.jabatan_nama && !jabatanLama) selJabatan.append(h('option', {value: '', selected: true, disabled: true}, lihat.jabatan_nama + ' (tidak ada di daftar, pilih ulang)'));
  const statusLama = STATUS_KERJA.includes(lama?.status) ? lama.status : '';
  const selStatus = pilih('p-status', STATUS_KERJA.map((s) => [s, s]), statusLama);
  const tglMasuk = tanggal('p-tgl-masuk', lama?.tgl_masuk);
  const centangTim = h('input', {type: 'checkbox', id: 'p-tim', checked: lihat ? lihat.tim_proyek : bawaanTimProyek(selJabatan.value)});
  let timDisentuh = !!lihat;
  centangTim.addEventListener('change', () => { timDisentuh = true; });

  // Gaji (riwayat)
  const riwayatGaji = gajiDari(lama);
  const terakhir = riwayatGaji.at(-1) || null;
  const gaji = uang('p-gaji', terakhir?.gaji);
  const tunjangan = uang('p-tunjangan', terakhir?.tunjangan);
  const berlaku = tanggal('p-gaji-berlaku', '');
  const catatanGaji = teks('p-gaji-catatan', '', {placeholder: 'Misalnya: kenaikan tahunan'});
  const labelGaji = h('label', {for: 'p-gaji'});
  const mGaji = h('div', {class: 'medan'}, labelGaji, gaji);
  const mTunjangan = medan('Tunjangan per bulan', tunjangan);
  const mBerlaku = medan('Berlaku mulai tanggal', berlaku, {wajib: true, bantuan: 'Perubahan gaji disimpan sebagai baris baru di Riwayat gaji.'});
  const mCatatanGaji = medan('Catatan perubahan', catatanGaji);
  const infoGaji = h('p', {class: 'kecil redup medan-lebar'});
  const nilaiGaji = () => ({gaji: bacaUang(gaji.querySelector('input').value), tunjangan: selStatus.value === STATUS.magang ? null : bacaUang(tunjangan.querySelector('input').value)});
  const gajiBerubah = () => {
    const g = nilaiGaji();
    if (g.gaji == null && g.tunjangan == null) return false;
    return g.gaji !== (terakhir?.gaji ?? null) || g.tunjangan !== (terakhir?.tunjangan ?? null);
  };
  const segarGaji = () => {
    const berubah = gajiBerubah();
    mBerlaku.hidden = mCatatanGaji.hidden = !berubah;
    if (berubah && !berlaku.value && !terakhir && tglMasuk.value) berlaku.value = tglMasuk.value;
  };
  for (const m of [gaji, tunjangan]) m.querySelector('input').addEventListener('input', segarGaji);
  const kini = lihat?.gaji_saat_ini;
  if (kini) infoGaji.textContent = 'Berlaku saat ini: ' + rp(kini.gaji || 0) + (kini.tunjangan ? ' + tunjangan ' + rp(kini.tunjangan) : '') + (kini.berlaku ? ' (sejak ' + tgl(kini.berlaku) + ')' : '') + '. Ubah angkanya bila ada perubahan.';

  // Magang
  const magangMulai = tanggal('p-magang-mulai', lama?.magang_mulai);
  const magangSelesai = tanggal('p-magang-selesai', lama?.magang_selesai);
  const institusi = teks('p-institusi', lama?.institusi);

  // Riwayat kontrak
  const barisKontrak = [];
  const wadahKontrak = h('div', {class: 'kontak-wadah'});
  const infoKontrak = h('div', {class: 'kotak-info', hidden: true});
  const tambahKontrak = (k, baru) => {
    const i = ++nomorKontrak;
    const mulai = tanggal('pk-mulai-' + i, k.mulai), akhir = tanggal('pk-akhir-' + i, k.berakhir);
    const catatan = teks('pk-catatan-' + i, k.catatan);
    const pdf = pilihPdf('pk-file-' + i, 'File kontrak ' + namaKontrak(k.ke));
    const item = {ke: k.ke, file: k.file || null, mulai, akhir, catatan, pdf, baru};
    const kartu = h('fieldset', {class: 'kontak'}, h('legend', null, namaKontrak(k.ke) + (baru ? ' (baru)' : '')),
      grid(medan('Kontrak mulai', mulai, {wajib: true}), medan('Kontrak berakhir', akhir, {wajib: true}),
        h('div', {class: 'medan'}, h('label', {for: 'pk-file-' + i}, 'File kontrak (PDF)'),
          item.file && h('div', {class: 'baris-tombol'}, tombolPdf(item.file), keteranganFile(item.file)),
          item.file && h('span', {class: 'kecil redup'}, 'Pilih file lain hanya bila ingin mengganti file ini.'), pdf),
        medan('Catatan', catatan)),
      baru && barisKontrak.length > 0 && h('div', {class: 'baris-tombol'}, h('span', {class: 'pegas'}), h('button', {class: 'btn btn-kecil', type: 'button', onclick: () => { barisKontrak.splice(barisKontrak.indexOf(item), 1); kartu.remove(); infoKontrak.hidden = true; }}, 'Batalkan perpanjangan ini')));
    barisKontrak.push(item);
    wadahKontrak.append(kartu);
  };
  kontrakDari(lama).forEach((k) => tambahKontrak(k, false));
  const daftarKontrak = () => barisKontrak.map((b) => ({ke: b.ke, mulai: b.mulai.value, berakhir: b.akhir.value}));
  const perpanjang = h('button', {class: 'btn', type: 'button', onclick: () => {
    const akhir = barisKontrak.at(-1);
    if (!akhir) { tambahKontrak({ke: 0, mulai: tglMasuk.value}, true); return; }
    if (!akhir.akhir.value) { pesan('Isi dulu tanggal berakhir ' + namaKontrak(akhir.ke).toLowerCase() + '.', 'galat'); akhir.akhir.focus(); return; }
    const habis = jatahHabis(daftarKontrak(), param);
    tambahKontrak({ke: akhir.ke + 1, mulai: tambahHari(akhir.akhir.value, 1)}, true);
    infoKontrak.hidden = !habis;
    if (habis) infoKontrak.replaceChildren(h('b', null, 'Jatah perpanjangan sudah habis.'), h('span', null, 'Batas di Pengaturan: maksimal ' + param.pkwt_maks_perpanjangan + ' kali perpanjangan. Perpanjangan ini tetap bisa disimpan.'));
  }}, '+ Perpanjang kontrak');

  // Dokumen kerja (semua status). Dokumen yang sudah tersimpan tidak bisa dihapus dari sini.
  const barisDok = [];
  const wadahDok = h('div', {class: 'kontak-wadah'});
  const kosongDok = h('p', {class: 'kecil redup'}, 'Belum ada dokumen.');
  const tambahDok = (d, baru) => {
    const i = ++nomorKontrak;
    const daftarJenis = !d.jenis || OPSI.jenisDokumenKerja.includes(d.jenis) ? OPSI.jenisDokumenKerja : OPSI.jenisDokumenKerja.concat(d.jenis);
    const jenis = pilih('pd-jenis-' + i, daftarJenis.map((x) => [x, x]), d.jenis);
    const nomorDok = teks('pd-nomor-' + i, d.nomor), tglDok = tanggal('pd-tgl-' + i, d.tanggal), catatanDok = teks('pd-catatan-' + i, d.catatan);
    const pdf = pilihPdf('pd-file-' + i, 'File dokumen');
    const judul = h('legend', null, (d.jenis || 'Dokumen baru') + (baru ? ' (baru)' : ''));
    jenis.addEventListener('change', () => { judul.textContent = (jenis.value || 'Dokumen baru') + (baru ? ' (baru)' : ''); });
    const item = {file: d.file || null, jenis, nomorDok, tglDok, catatanDok, pdf, baru};
    const kartu = h('fieldset', {class: 'kontak'}, judul,
      grid(medan('Jenis dokumen', jenis, {wajib: true}), medan('Nomor dokumen', nomorDok), medan('Tanggal dokumen', tglDok, {wajib: true}),
        h('div', {class: 'medan'}, h('label', {for: 'pd-file-' + i}, 'File (PDF)', !item.file && h('span', {class: 'wajib', title: 'Wajib diisi'}, ' *')),
          item.file && h('div', {class: 'baris-tombol'}, tombolPdf(item.file), keteranganFile(item.file)),
          item.file && h('span', {class: 'kecil redup'}, 'Pilih file lain hanya bila ingin mengganti file ini.'), pdf),
        medan('Catatan', catatanDok, {lebar: true})),
      baru && h('div', {class: 'baris-tombol'}, h('span', {class: 'pegas'}), h('button', {class: 'btn btn-kecil', type: 'button', onclick: () => { barisDok.splice(barisDok.indexOf(item), 1); kartu.remove(); kosongDok.hidden = barisDok.length > 0; }}, 'Batalkan dokumen ini')));
    barisDok.push(item);
    wadahDok.append(kartu);
    kosongDok.hidden = true;
  };
  dokumenDari(lama).forEach((d) => tambahDok(d, false));
  kosongDok.hidden = barisDok.length > 0;
  const tambahDokumen = h('button', {class: 'btn', type: 'button', onclick: () => {
    const st = selStatus.value;
    const saran = st === STATUS.magang ? 'Perjanjian magang' : st === STATUS.tetap && !barisDok.length ? 'Perjanjian kerja (PKWTT)' : '';
    tambahDok({jenis: OPSI.jenisDokumenKerja.includes(saran) ? saran : ''}, true);
    barisDok.at(-1).jenis.focus();
  }}, '+ Tambah dokumen');

  // Administrasi & SKK
  const bpjsKes = teks('p-bpjs-kes', lama?.bpjs_kes_no, {inputmode: 'numeric'});
  const bpjsTk = teks('p-bpjs-tk', lama?.bpjs_tk_no, {inputmode: 'numeric'});
  const npwp = kotakCek(teks('p-npwp', lama?.npwp_no), 'npwp');
  const bantuBpjs = h('p', {class: 'kecil redup medan-lebar'}, 'Untuk magang, BPJS boleh dikosongkan.');
  const skkNo = teks('p-skk-no', lama?.skk_no ?? lama?.no_skk);
  const skkBerlaku = tanggal('p-skk-berlaku', lama?.skk_berlaku);
  const skkPdf = pilihPdf('p-skk-file', 'File sertifikat SKK/STRA');

  // Status aktif
  const selAktif = pilih('p-aktif', [['Aktif', 'Aktif'], ['Keluar', 'Keluar']], lama?.aktif === 'Keluar' ? 'Keluar' : 'Aktif', null);
  selAktif.querySelector('option[value=""]').remove();
  const tglKeluar = tanggal('p-tgl-keluar', lama?.tgl_keluar);
  const alasan = pilih('p-alasan', ALASAN_KELUAR.map((a) => [a, a]), lama?.alasan_keluar);
  const alasanLain = teks('p-alasan-lain', lama?.alasan_lain);
  const mAlasanLain = medan('Keterangan alasan', alasanLain, {wajib: true});
  const catatan = h('textarea', {id: 'p-catatan', rows: '2'}, lama?.catatan ?? '');

  // Bagian yang tampil menurut status kerja, jabatan, dan status aktif.
  const bagGaji = bagian('Gaji', grid(infoGaji, mGaji, mTunjangan, mBerlaku, mCatatanGaji));
  const bagMagang = bagian('Periode magang', grid(medan('Mulai magang', magangMulai, {wajib: true}), medan('Selesai magang', magangSelesai, {wajib: true}), medan('Institusi asal', institusi)));
  const bagKontrak = bagian('Riwayat kontrak', h('p', {class: 'kecil redup'}, 'Setiap kontrak dan perpanjangan disimpan sebagai baris sendiri; kontrak lama tidak ditimpa. Kontrak berakhir di tabel dan peringatan diambil dari kontrak terbaru.'), wadahKontrak, infoKontrak, h('div', null, perpanjang));
  const bagDokumen = bagian('Dokumen kerja', h('p', {class: 'kecil redup'}, 'Perjanjian kerja (PKWTT), SK pengangkatan, perjanjian magang, addendum, dan dokumen kerja lainnya. Tiap dokumen disimpan sebagai baris sendiri; dokumen lama tidak ditimpa.'),
    wadahDok, kosongDok, h('div', null, tambahDokumen));
  const bagSkk = bagian('SKK / STRA', grid(medan('No. SKK / STRA', skkNo), medan('Berlaku s.d.', skkBerlaku),
    h('div', {class: 'medan medan-lebar'}, h('label', {for: 'p-skk-file'}, 'File sertifikat (PDF)'),
      lama?.skk_file && h('div', {class: 'baris-tombol'}, tombolPdf(lama.skk_file), keteranganFile(lama.skk_file)), skkPdf)));
  const mKeluar = [medan('Tanggal keluar', tglKeluar, {wajib: true}), medan('Alasan keluar', alasan, {wajib: true}), mAlasanLain];
  const terapkan = () => {
    const st = selStatus.value, jab = jabatan.find((j) => j.id === selJabatan.value);
    const magang = st === STATUS.magang;
    bagGaji.hidden = !st;
    labelGaji.textContent = magang ? 'Uang saku per bulan' : 'Gaji pokok per bulan';
    mTunjangan.hidden = magang;
    bagMagang.hidden = !magang;
    bagKontrak.hidden = st !== STATUS.pkwt;
    bagDokumen.hidden = !st;
    if (st === STATUS.pkwt && !barisKontrak.length) tambahKontrak({ke: 0, mulai: tglMasuk.value}, true);
    bantuBpjs.hidden = !magang;
    bagSkk.hidden = !(jab?.skk || (!jab && (lama?.skk_no || lama?.no_skk)));
    mKeluar.forEach((m) => { m.hidden = selAktif.value !== 'Keluar'; });
    mAlasanLain.hidden = selAktif.value !== 'Keluar' || alasan.value !== 'Lainnya';
    if (!timDisentuh) centangTim.checked = bawaanTimProyek(selJabatan.value);
    segarGaji();
  };
  for (const el of [selStatus, selJabatan, selAktif, alasan]) el.addEventListener('change', terapkan);
  tglMasuk.addEventListener('change', segarGaji);

  // Tombol
  const galat = h('div', {class: 'kotak-galat', role: 'alert', hidden: true});
  const peringatan = h('div', {class: 'kotak-info', hidden: true});
  const simpan = h('button', {class: 'btn btn-utama', type: 'submit'}, 'Simpan');
  let yakin = false;
  const terhubung = lihat?.proyek_diikuti.length || 0;
  const hapus = id && h('button', {class: 'btn btn-bahaya', type: 'button', disabled: terhubung > 0, title: terhubung ? 'Sudah tercatat di ' + terhubung + ' Tim Proyek. Tandai Keluar bila sudah tidak bekerja.' : 'Hanya untuk data yang salah input', onclick: aman(async () => {
    if (!yakin) { yakin = true; hapus.textContent = 'Klik lagi untuk menghapus'; return; }
    const berkas = [...kontrakDari(lama).map((k) => k.file?.path), ...dokumenDari(lama).map((d) => d.file?.path), lama.skk_file?.path].filter(Boolean);
    await store.hapus(id);
    try { await store.hapusBerkas(berkas); } catch (e) { console.warn('File tidak terhapus', e); }
    await muatData(); dlg.close();
    if (location.hash === '#sdm-' + id) location.hash = '#t-sdm'; else S.render();
    pesan('Data pegawai dihapus.');
  })}, 'Hapus');
  const tampilGalat = (judul, butir) => {
    galat.hidden = false;
    galat.replaceChildren(h('b', null, judul), butir && h('ul', null, butir.map((b) => h('li', null, b))));
    galat.scrollIntoView({block: 'nearest'});
  };

  const form = h('form', {class: 'form', novalidate: true, onsubmit: async (ev) => {
    ev.preventDefault();
    if (simpan.disabled) return;
    galat.hidden = true;
    const salahFormat = cekSemua(form);
    if (salahFormat) { tampilGalat('Perbaiki dulu isian yang bertanda ✕.'); salahFormat.focus(); return; }
    const st = selStatus.value, keluar = selAktif.value === 'Keluar';
    const nikNilai = periksaIsian('nik', nik.querySelector('input').value).nilai;
    const kurang = [];
    if (!nama.value.trim()) kurang.push('Nama');
    if (!nikNilai) kurang.push('NIK (16 digit)');
    if (!selJabatan.value) kurang.push('Jabatan');
    if (!st) kurang.push('Status kerja');
    if (!tglMasuk.value) kurang.push('Tanggal masuk');
    if (st === STATUS.magang && (!magangMulai.value || !magangSelesai.value)) kurang.push('Periode magang (mulai dan selesai)');
    if (st === STATUS.pkwt) barisKontrak.forEach((b) => { if (!b.mulai.value || !b.akhir.value) kurang.push(namaKontrak(b.ke) + ': tanggal mulai dan berakhir'); });
    if (gajiBerubah() && !berlaku.value) kurang.push('Gaji: tanggal berlaku mulai');
    barisDok.forEach((b, i) => {
      const nama = 'Dokumen kerja ' + (i + 1) + (b.jenis.value ? ' (' + b.jenis.value + ')' : '');
      if (!b.jenis.value) kurang.push(nama + ': jenis dokumen');
      if (!b.tglDok.value) kurang.push(nama + ': tanggal dokumen');
      if (!b.file && !b.pdf.berkas()) kurang.push(nama + ': file PDF');
    });
    if (keluar && !tglKeluar.value) kurang.push('Tanggal keluar');
    if (keluar && !alasan.value) kurang.push('Alasan keluar');
    if (keluar && alasan.value === 'Lainnya' && !alasanLain.value.trim()) kurang.push('Keterangan alasan keluar');
    if (kurang.length) { tampilGalat('Isian wajib belum lengkap:', kurang); return; }
    const urutan = [];
    if (st === STATUS.magang && magangSelesai.value < magangMulai.value) urutan.push('Selesai magang lebih awal dari mulai magang.');
    if (st === STATUS.pkwt) barisKontrak.forEach((b) => { if (b.akhir.value < b.mulai.value) urutan.push(namaKontrak(b.ke) + ': tanggal berakhir lebih awal dari tanggal mulai.'); });
    if (keluar && tglKeluar.value < tglMasuk.value) urutan.push('Tanggal keluar lebih awal dari tanggal masuk.');
    if (urutan.length) { tampilGalat('Periksa tanggal:', urutan); return; }
    const sama = nikSama(nikNilai, S.db.sdm, id);
    if (sama.length) { tampilGalat('NIK ini sudah terdaftar pada pegawai lain, jadi tidak bisa disimpan:', sama.map((s) => s.nama + (s.aktif === 'Keluar' ? ' (keluar)' : ''))); return; }
    // Cek NIK terhadap Master Vendor/Tukang ditambahkan setelah modul itu dibuat.

    if (!lanjut) {
      const catatanPeringatan = [];
      const cocok = namaMiripPegawai(nama.value, S.d.sdm, id);
      if (cocok.length) catatanPeringatan.push('Sudah ada pegawai dengan nama mirip: ' + cocok.map((s) => s.nama).join(', ') + '.');
      if (st === STATUS.pkwt) catatanPeringatan.push(...cekBatasPkwt(daftarKontrak(), param).map((x) => x + ' (batas di Pengaturan).'));
      if (catatanPeringatan.length) {
        peringatan.hidden = false;
        peringatan.replaceChildren(h('b', null, 'Periksa sebelum menyimpan:'), h('ul', null, catatanPeringatan.map((x) => h('li', null, x))),
          h('div', {class: 'baris-tombol'}, h('button', {class: 'btn', type: 'button', onclick: () => { lanjut = true; peringatan.hidden = true; form.requestSubmit(); }}, 'Tetap simpan')));
        peringatan.scrollIntoView({block: 'nearest'});
        return;
      }
    }
    lanjut = false;

    simpan.disabled = true; simpan.textContent = 'Menyimpan…';
    try {
      const unggah = async (pdf) => {
        const f = pdf.berkas();
        if (!f) return null;
        const path = 'sdm/' + pid + '/' + idBaru() + '.pdf';
        await store.unggah(path, f);
        return {path, nama: f.name, ukuran: f.size, diunggah: today};
      };
      const data = Object.fromEntries(Object.entries(lama || {}).filter(([k]) => !LAMA.includes(k)));
      const nilai = (el) => el.value.trim() || null;
      const nilaiCek = (kotak, jenis) => periksaIsian(jenis, kotak.querySelector('input').value).nilai ?? null;
      Object.assign(data, {
        nama: nilai(nama), nik: nikNilai, tgl_lahir: nilai(tglLahir), alamat: nilai(alamat), hp: nilaiCek(hp, 'hp'), email: nilaiCek(email, 'email'),
        darurat_nama: nilai(daruratNama), darurat_hubungan: nilai(daruratHubungan), darurat_hp: nilaiCek(daruratHp, 'hp'),
        bank_nama: nilai(bankNama), bank_rek: nilai(bankRek), bank_atas_nama: nilai(bankAtasNama),
        jabatan_id: selJabatan.value, status: st, tgl_masuk: tglMasuk.value, tim_proyek: centangTim.checked,
        bpjs_kes_no: nilai(bpjsKes), bpjs_tk_no: nilai(bpjsTk), npwp_no: nilaiCek(npwp, 'npwp'),
        aktif: keluar ? 'Keluar' : 'Aktif', tgl_keluar: keluar ? tglKeluar.value : null, alasan_keluar: keluar ? alasan.value : null,
        alasan_lain: keluar && alasan.value === 'Lainnya' ? nilai(alasanLain) : null, catatan: nilai(catatan),
      });
      if (st === STATUS.magang) Object.assign(data, {magang_mulai: magangMulai.value, magang_selesai: magangSelesai.value, institusi: nilai(institusi)});
      if (!bagSkk.hidden) {
        const file = await unggah(skkPdf);
        Object.assign(data, {skk_no: nilai(skkNo), skk_berlaku: skkBerlaku.value || null, skk_file: file || lama?.skk_file || null});
      }
      if (st === STATUS.pkwt) {
        const kontrak = [];
        for (const b of barisKontrak) {
          const file = await unggah(b.pdf);
          kontrak.push(bersih({ke: b.ke, mulai: b.mulai.value, berakhir: b.akhir.value, file: file || b.file, catatan: b.catatan.value.trim()}));
        }
        data.kontrak = kontrak;
      } else if (lama) data.kontrak = kontrakDari(lama).map(bersih); // arsip tetap disimpan
      const dokumen = [];
      for (const b of barisDok) {
        const file = await unggah(b.pdf);
        dokumen.push(bersih({jenis: b.jenis.value, nomor: b.nomorDok.value.trim(), tanggal: b.tglDok.value, file: file || b.file, catatan: b.catatanDok.value.trim()}));
      }
      data.dokumen = dokumen;
      const gajiBaru = riwayatGaji.map((g) => bersih(g));
      if (gajiBerubah()) gajiBaru.push(bersih({berlaku: berlaku.value, ...nilaiGaji(), catatan: catatanGaji.value.trim()}));
      data.gaji_riwayat = gajiBaru;
      const isiSimpan = bersih(data);
      if (!isiSimpan.kontrak?.length) delete isiSimpan.kontrak;
      if (!isiSimpan.gaji_riwayat?.length) delete isiSimpan.gaji_riwayat;
      if (!isiSimpan.dokumen?.length) delete isiSimpan.dokumen;
      await store.simpan('sdm', pid, isiSimpan);
      await muatData(); dlg.close(); S.render(); pesan('Data pegawai tersimpan.');
    } catch (e) {
      tampilGalat('Gagal menyimpan: ' + e.message);
      simpan.disabled = false; simpan.textContent = 'Simpan';
    }
  }});

  const tglLahir = tanggal('p-tgl-lahir', lama?.tgl_lahir);
  const daruratNama = teks('p-darurat-nama', lama?.darurat_nama);
  const daruratHubungan = teks('p-darurat-hubungan', lama?.darurat_hubungan, {placeholder: 'Istri, suami, orang tua…'});
  const bankNama = teks('p-bank', lama?.bank_nama);
  const bankRek = teks('p-rek', lama?.bank_rek, {inputmode: 'numeric'});
  const bankAtasNama = teks('p-atas-nama', lama?.bank_atas_nama);

  form.append(
    bagian('Identitas', grid(medan('Nama', nama, {wajib: true}), medan('NIK', nik, {wajib: true}), mirip, medan('Tanggal lahir', tglLahir), medan('No. HP / WA', hp), medan('Email', email), medan('Alamat', alamat, {lebar: true}))),
    bagian('Kontak darurat', grid(medan('Nama', daruratNama), medan('Hubungan', daruratHubungan), medan('No. HP', daruratHp))),
    bagian('Rekening bank', grid(medan('Nama bank', bankNama), medan('Nomor rekening', bankRek), medan('Atas nama', bankAtasNama))),
    bagian('Kepegawaian', grid(medan('Jabatan', selJabatan, {wajib: true, bantuan: 'Daftar jabatan diatur di Pengaturan.'}), medan('Status kerja', selStatus, {wajib: true}), medan('Tanggal masuk', tglMasuk, {wajib: true}),
      h('div', {class: 'medan medan-lebar'}, h('label', {class: 'centang'}, centangTim, 'Dapat dipilih sebagai Tim Proyek'), h('span', {class: 'kecil redup'}, 'Staf manajemen seperti principal, admin, dan keuangan biasanya tidak dicentang.')))),
    bagMagang, bagGaji, bagKontrak, bagDokumen,
    bagian('Administrasi', grid(medan('No. BPJS Kesehatan', bpjsKes), medan('No. BPJS Ketenagakerjaan', bpjsTk), medan('No. NPWP / NIK', npwp), bantuBpjs)),
    bagSkk,
    bagian('Status', grid(medan('Status aktif', selAktif, {bantuan: 'Pegawai yang keluar tidak dihapus; riwayatnya tetap tersimpan.'}), ...mKeluar, medan('Catatan', catatan, {lebar: true}))),
    peringatan, galat,
    h('div', {class: 'form-kaki'}, hapus, terhubung > 0 && h('span', {class: 'kecil redup'}, 'Tidak bisa dihapus: sudah tercatat di Tim Proyek.'), h('span', {class: 'pegas'}), h('button', {class: 'btn', type: 'button', onclick: () => dlg.close()}, 'Batal'), simpan));
  terapkan();
  dlg = dialog(id ? 'Ubah data pegawai' : 'Tambah pegawai', form);
  dlg.classList.add('dialog-lebar');
  if (id) cekMirip();
}
