// Modul Klien: daftar, formulir, pencegahan duplikat, gabung klien, ekspor/template/impor Excel,
// dan pemilih klien untuk formulir Proyek dan Kontrak.
import {store} from './store.js';
import {S, bersih, segarkan} from './state.js';
import {h, idn, rpRingkas, tgl, isi, pill, pesan, aman, dialog} from './ui.js';
import {hariIni} from './calc.js';
import {hak, bisaUbah} from './akses.js';
import {JENIS_KLIEN, SUMBER_KLIEN, validasiKlien, cariDuplikat, namaMirip, kontakDari, gabungKontak, isiYangKosong} from './klien-util.js';
import {kotakCek, cekSemua} from './cek.js';
import {buatWorkbook, bacaWorkbook, evaluasiImpor, klienKeBaris} from './klien-excel.js';

const EXCELJS = 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js';
let memuat = null;
function muatExcelJS() {
  if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
  memuat ||= new Promise((ok, gagal) => {
    const s = document.createElement('script');
    s.src = EXCELJS;
    s.onload = () => ok(window.ExcelJS);
    s.onerror = () => { memuat = null; gagal(new Error('Pustaka Excel gagal dimuat. Periksa sambungan internet.')); };
    document.head.append(s);
  });
  return memuat;
}
async function unduhWorkbook(wb, nama) {
  const url = URL.createObjectURL(new Blob([await wb.xlsx.writeBuffer()], {type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
  const a = h('a', {href: url, download: nama});
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const ringkasKlien = (k) => [k.nama, k.kontak_utama, k.hp_utama].filter(Boolean).join(' · ');
const dataKlien = (id) => bersih(S.db.klien.find((k) => k.id === id) || {});

// ---------- daftar ----------
const KOLOM = [['nama', 'Nama klien'], ['jenis', 'Jenis'], ['kontak_utama', 'Kontak utama'], ['hp_utama', 'HP/WA'], ['status_klien', 'Status'], ['jml_proyek', 'Jml proyek', 1], ['total_kontrak', 'Total kontrak', 1], ['terakhir_aktif', 'Terakhir aktif']];

export function renderKlien(el) {
  const badan = h('tbody');
  const hitungan = h('span', {class: 'redup kecil'});
  const kepalaTabel = h('tr');
  let tampil = [];
  const gambar = () => {
    const q = S.cari.trim().toLowerCase();
    const {k, arah} = S.urutKlien;
    tampil = S.d.klien.filter((r) => !q || [r.nama, r.jenis, r.npwp, r.alamat, r.sumber, ...r.kontak.flatMap((c) => [c.nama, c.jabatan, c.hp, c.email])].some((v) => String(v ?? '').toLowerCase().includes(q)))
      .sort((a, b) => arah * (typeof a[k] === 'number' || typeof b[k] === 'number' ? (a[k] || 0) - (b[k] || 0) : String(a[k] ?? '').localeCompare(String(b[k] ?? ''), 'id', {numeric: true})));
    hitungan.textContent = tampil.length + ' dari ' + S.d.klien.length + ' klien';
    kepalaTabel.replaceChildren(...KOLOM.map(([kunci, label, kanan]) => h('th', {class: kanan ? 'kanan' : null, 'aria-sort': k === kunci ? (arah > 0 ? 'ascending' : 'descending') : null},
      h('button', {class: 'th-urut', type: 'button', onclick: () => { S.urutKlien = {k: kunci, arah: k === kunci ? -arah : 1}; gambar(); }}, label, k === kunci ? (arah > 0 ? ' ▲' : ' ▼') : ''))), h('th', null, 'Aksi'));
    if (!S.d.klien.length) {
      badan.replaceChildren(h('tr', null, h('td', {colspan: String(KOLOM.length + 1), class: 'kosong-tabel'},
        h('p', null, 'Belum ada klien. Klik Tambah klien atau Impor dari Excel.'),
        bisaUbah('klien') && h('div', {class: 'baris-tombol tengah-isi'}, h('button', {class: 'btn btn-utama', type: 'button', onclick: () => bukaFormKlien(null)}, 'Tambah klien'),
          h('button', {class: 'btn', type: 'button', onclick: () => pilihBerkas.click()}, 'Impor dari Excel')))));
      return;
    }
    badan.replaceChildren(...(tampil.length ? tampil.map((r) => {
      let yakin = false;
      const hapus = h('button', {class: 'btn btn-kecil btn-bahaya', type: 'button', onclick: aman(async () => {
        if (r.jml_proyek || r.jml_kontrak) throw new Error('"' + r.nama + '" masih punya ' + r.jml_proyek + ' proyek dan ' + r.jml_kontrak + ' kontrak, jadi tidak bisa dihapus. Pakai Gabung klien untuk memindahkannya ke klien lain.');
        if (!yakin) { yakin = true; hapus.textContent = 'Yakin hapus?'; return; }
        await store.hapus(r.id); await segarkan(); pesan('Klien dihapus.');
      })}, 'Hapus');
      return h('tr', null,
        h('td', null, h('a', {href: '#klien-' + r.id, title: 'Buka detail klien'}, r.nama)),
        h('td', null, isi(r.jenis)),
        h('td', null, r.kontak_utama ? [h('span', null, r.kontak_utama), r.jabatan_utama && h('span', {class: 'kecil redup blok'}, r.jabatan_utama)] : '—'),
        h('td', {class: 'nw'}, r.hp_utama ? h('a', {href: 'https://wa.me/' + r.hp_utama, target: '_blank', rel: 'noopener', title: 'Buka WhatsApp'}, r.hp_utama) : '—'),
        h('td', null, pill(r.status_klien)),
        h('td', {class: 'kanan'}, idn(r.jml_proyek)),
        h('td', {class: 'kanan'}, r.total_kontrak ? rpRingkas(r.total_kontrak) : '—'),
        h('td', {class: 'nw'}, tgl(r.terakhir_aktif)),
        h('td', {class: 'nw'}, h('div', {class: 'baris-tombol'}, h('button', {class: 'btn btn-kecil', type: 'button', onclick: () => bukaFormKlien(r.id)}, 'Edit'), hapus)));
    }) : [h('tr', null, h('td', {colspan: String(KOLOM.length + 1), class: 'redup'}, 'Tidak ada klien yang cocok dengan pencarian.'))]));
  };
  const pilihBerkas = h('input', {id: 'impor-klien', type: 'file', accept: '.xlsx', hidden: true, 'aria-label': 'File Excel klien', onchange: aman(async () => {
    const f = pilihBerkas.files[0];
    pilihBerkas.value = '';
    if (!f) return;
    pesan('Membaca ' + f.name + '…');
    const baris = await bacaWorkbook(await muatExcelJS(), await f.arrayBuffer());
    bukaPratinjauImpor(baris);
  })});
  el.append(
    h('div', {class: 'kepala'}, h('h1', null, 'Klien'), h('p', {class: 'redup'}, 'Satu baris per klien. Nama di sini menjadi pilihan di Proyek dan Kontrak. Jumlah proyek, total kontrak, terakhir aktif, dan status dihitung otomatis.')),
    h('div', {class: 'alat'},
      h('input', {id: 'cari', type: 'search', placeholder: 'Cari…', 'aria-label': 'Cari klien', value: S.cari, oninput: (ev) => { S.cari = ev.target.value; gambar(); }}), hitungan, h('span', {class: 'pegas'}),
      h('button', {class: 'btn', type: 'button', onclick: () => bukaGabung()}, 'Gabung klien'),
      h('button', {class: 'btn', type: 'button', onclick: aman(async () => { await unduhWorkbook(buatWorkbook(await muatExcelJS(), tampil.map(klienKeBaris)), 'alinea5-klien-' + hariIni() + '.xlsx'); })}, 'Ekspor Excel'),
      h('button', {class: 'btn', type: 'button', onclick: aman(async () => { await unduhWorkbook(buatWorkbook(await muatExcelJS(), [], {contoh: true}), 'alinea5-template-klien.xlsx'); })}, 'Unduh Template'),
      bisaUbah('klien') && [h('button', {class: 'btn', type: 'button', onclick: () => pilihBerkas.click()}, 'Impor Excel'), pilihBerkas,
        h('button', {class: 'btn btn-utama', type: 'button', onclick: () => bukaFormKlien(null)}, 'Tambah klien')]),
    h('div', {class: 'gulir'}, h('table', {class: 'tabel'}, h('thead', null, kepalaTabel), badan)));
  gambar();
}

// ---------- detail ----------
const waTautan = (hp) => (hp ? h('a', {href: 'https://wa.me/' + hp, target: '_blank', rel: 'noopener', title: 'Buka WhatsApp'}, hp) : '—');
const rincian = (pasangan) => h('dl', {class: 'rincian'}, pasangan.filter(Boolean).map(([k, v]) => [h('dt', null, k), h('dd', null, v == null || v === '' ? '—' : v)]));
const tabelKecil = (judul, kosongTeks, rows) => (rows.length
  ? h('div', {class: 'gulir'}, h('table', {class: 'tabel'}, h('thead', null, h('tr', null, judul.map(([l, kanan]) => h('th', {class: kanan ? 'kanan' : null}, l)))), h('tbody', null, rows)))
  : h('p', {class: 'redup'}, kosongTeks));

export function renderDetailKlien(el, id) {
  const k = S.d.klien.find((x) => x.id === id);
  const kembali = h('a', {href: '#t-klien', class: 'kecil'}, '← Daftar klien');
  if (!k) { el.append(h('div', {class: 'kepala'}, kembali, h('h1', null, 'Klien tidak ditemukan'), h('p', {class: 'redup'}, 'Data ini mungkin sudah digabung atau dihapus.'))); return; }
  const proyek = S.d.proyek.filter((p) => p.klien_ref === id);
  const kodeProyek = new Set(proyek.map((p) => p.kode));
  const kontrak = S.d.kontrak.filter((c) => (c.klien_ref || null) === id || (!c.klien_ref && kodeProyek.has(c.kode)));
  const sumber = k.sumber === 'Referensi' && k.referensi_oleh ? 'Referensi: ' + k.referensi_oleh : k.sumber === 'Lainnya' && k.sumber_lain ? 'Lainnya: ' + k.sumber_lain : k.sumber;
  el.append(
    h('div', {class: 'kepala'}, kembali,
      h('div', {class: 'judul-baris'}, h('h1', null, k.nama), h('span', {class: 'pegas'}), bisaUbah('klien') && h('button', {class: 'btn btn-utama', type: 'button', onclick: () => bukaFormKlien(k.id)}, 'Ubah data')),
      h('p', {class: 'redup'}, [k.jenis, k.status_klien, k.jml_proyek + ' proyek', k.total_kontrak ? 'total kontrak ' + rpRingkas(k.total_kontrak) : null, k.terakhir_aktif ? 'terakhir aktif ' + tgl(k.terakhir_aktif) : null].filter(Boolean).join(' · '))),
    h('section', {class: 'kartu'}, h('h2', null, 'Data klien'),
      rincian([['Jenis klien', k.jenis], ['Alamat penagihan', k.alamat], [k.jenis === 'Perorangan' ? 'NPWP / NIK' : 'NPWP', k.npwp], ['Sumber klien', sumber], ['Catatan', k.catatan]])),
    h('section', {class: 'kartu'}, h('h2', null, k.jenis === 'Perorangan' ? 'Kontak' : 'Kontak / PIC'),
      tabelKecil([['Nama'], ['Jabatan'], ['HP/WA'], ['Email'], ['']], 'Belum ada kontak.', k.kontak.map((c) => h('tr', null,
        h('td', null, isi(c.nama)), h('td', null, isi(c.jabatan)), h('td', {class: 'nw'}, waTautan(c.hp)),
        h('td', null, c.email ? h('a', {href: 'mailto:' + c.email}, c.email) : '—'), h('td', null, c.utama ? pill('Kontak utama') : ''))))),
    h('section', {class: 'kartu'}, h('h2', null, 'Proyek'),
      tabelKecil([['Kode'], ['Proyek'], ['Status'], ['Mulai']], 'Belum ada proyek untuk klien ini.', proyek.map((p) => h('tr', null,
        h('td', {class: 'nw'}, p.kode), h('td', null, isi(p.nama)), h('td', null, pill(p.status)), h('td', {class: 'nw'}, tgl(p.mulai)))))),
    hak('kontrak') != null && h('section', {class: 'kartu'}, h('h2', null, 'Kontrak'),
      tabelKecil([['Kode'], ['No. kontrak'], ['Tanggal'], ['Nilai total', 1], ['Diterima', 1], ['Piutang', 1]], 'Belum ada kontrak untuk klien ini.', kontrak.map((c) => h('tr', null,
        h('td', {class: 'nw'}, c.kode), h('td', null, isi(c.no_kontrak)), h('td', {class: 'nw'}, tgl(c.tgl_kontrak)),
        h('td', {class: 'kanan'}, rpRingkas(c.total)), h('td', {class: 'kanan'}, rpRingkas(c.diterima)), h('td', {class: 'kanan'}, rpRingkas(c.piutang)))))));
}

// ---------- formulir ----------
let nomorKontak = 0;
export function bukaFormKlien(id, opsi = {}) {
  const lama = id ? S.d.klien.find((k) => k.id === id) : null;
  let dlg, sibuk = false, lanjut = false;
  const medan = (label, masukan, bantuan, kelas) => h('div', {class: 'medan ' + (kelas || '')}, h('label', {for: masukan.id || masukan.querySelector('input')?.id}, label), masukan, bantuan);
  const bukaLain = (k) => { dlg.close(); bukaFormKlien(k.id, opsi); };
  const daftarCocok = (klien) => h('ul', {class: 'cocok'}, klien.map((k) => h('li', null, h('span', null, ringkasKlien(k)), ' ', h('button', {class: 'tautan', type: 'button', onclick: () => bukaLain(k)}, 'Buka klien ini'))));

  const nama = h('input', {id: 'k-nama', type: 'text', required: true, autocomplete: 'off', value: lama?.nama ?? ''});
  const mirip = h('div', {class: 'medan medan-lebar kotak-info', hidden: true});
  const cekMirip = () => {
    const cocok = namaMirip(nama.value, S.d.klien, id);
    mirip.hidden = !cocok.length;
    mirip.replaceChildren(h('b', null, 'Sudah ada klien dengan nama mirip:'), daftarCocok(cocok));
  };
  nama.addEventListener('input', cekMirip);
  const jenis = h('select', {id: 'k-jenis', required: true}, h('option', {value: ''}, 'Pilih…'), JENIS_KLIEN.map((j) => h('option', {value: j, selected: lama?.jenis === j}, j)));

  const perorangan = () => jenis.value === 'Perorangan';
  const wadahKontak = h('div', {class: 'kontak-wadah'});
  const tambahKontak = (c = {}) => {
    const i = ++nomorKontak;
    const judul = h('legend');
    const mNama = medan('Nama PIC', h('input', {id: 'kn-' + i, 'data-k': 'nama', type: 'text', value: c.nama ?? '', autocomplete: 'off'}));
    const mJabatan = medan('Jabatan PIC', h('input', {id: 'kj-' + i, 'data-k': 'jabatan', type: 'text', value: c.jabatan ?? '', autocomplete: 'off'}));
    const utama = h('label', {class: 'centang'}, h('input', {type: 'radio', name: 'k-utama', 'data-k': 'utama', checked: !!c.utama}), 'Kontak utama');
    const hapus = h('button', {class: 'btn btn-kecil', type: 'button', onclick: () => { kartu.remove(); terapkanJenis(); }});
    const kartu = h('fieldset', {class: 'kontak'}, judul,
      h('div', {class: 'form-grid'}, mNama, mJabatan,
        medan('No. HP / WA', kotakCek(h('input', {id: 'kh-' + i, 'data-k': 'hp', type: 'text', value: c.hp ?? '', autocomplete: 'off'}), 'hp')),
        medan('Email', kotakCek(h('input', {id: 'ke-' + i, 'data-k': 'email', type: 'text', value: c.email ?? '', autocomplete: 'off'}), 'email'))),
      h('div', {class: 'baris-tombol'}, utama, h('span', {class: 'pegas'}), hapus));
    // Perorangan: kartu pertama adalah kontak klien sendiri (tanpa nama/jabatan); kartu lain = kontak
    // lain seperti istri atau suami. Badan usaha: tiap kartu adalah satu PIC.
    kartu.atur = (pertama) => {
      const p = perorangan();
      judul.textContent = p ? (pertama ? 'Kontak klien' : 'Kontak lain') : 'PIC';
      mNama.hidden = mJabatan.hidden = p && pertama;
      mNama.querySelector('label').textContent = p ? 'Nama' : 'Nama PIC';
      mJabatan.querySelector('label').textContent = p ? 'Hubungan dengan klien' : 'Jabatan PIC';
      mJabatan.querySelector('input').placeholder = p ? 'Istri, suami, anak…' : 'Owner, Procurement, Keuangan…';
      utama.hidden = p; hapus.hidden = p && pertama; hapus.textContent = p ? 'Hapus kontak' : 'Hapus PIC';
    };
    wadahKontak.append(kartu);
  };
  const kontakAwal = (lama?.kontak || []).slice().sort((x, y) => (lama?.jenis === 'Perorangan' ? y.utama - x.utama : 0));
  (kontakAwal.length ? kontakAwal : [{utama: true}]).forEach(tambahKontak);

  const alamat = h('textarea', {id: 'k-alamat', rows: '3'}, lama?.alamat ?? '');
  const npwp = h('input', {id: 'k-npwp', type: 'text', autocomplete: 'off', value: lama?.npwp ?? ''});
  const kotakNpwp = kotakCek(npwp, 'npwp', () => (perorangan() ? 'Opsional. 15 atau 16 digit. Belum punya NPWP? Isi NIK.' : 'Opsional. 15 atau 16 digit.'));
  const sumber = h('select', {id: 'k-sumber'}, h('option', {value: ''}, '— Pilih sumber —'),
    SUMBER_KLIEN.concat(lama?.sumber && !SUMBER_KLIEN.includes(lama.sumber) ? [lama.sumber] : []).map((x) => h('option', {value: x, selected: lama?.sumber === x}, SUMBER_KLIEN.includes(x) ? x : x + ' (pilihan lama, ganti)')));
  const referensi = h('input', {id: 'k-referensi', type: 'text', value: lama?.referensi_oleh ?? '', autocomplete: 'off'});
  const sumberLain = h('input', {id: 'k-sumber-lain', type: 'text', value: lama?.sumber_lain ?? '', autocomplete: 'off'});
  const medanReferensi = medan('Direferensikan oleh', referensi), medanSumberLain = medan('Sebutkan sumber', sumberLain);
  const cekSumber = () => { medanReferensi.hidden = sumber.value !== 'Referensi'; medanSumberLain.hidden = sumber.value !== 'Lainnya'; };
  sumber.addEventListener('change', cekSumber); cekSumber();
  const catatan = h('textarea', {id: 'k-catatan', rows: '2'}, lama?.catatan ?? '');

  const galat = h('div', {class: 'kotak-galat', role: 'alert', hidden: true});
  const peringatan = h('div', {class: 'kotak-info', role: 'alert', hidden: true});
  const simpan = h('button', {class: 'btn btn-utama', type: 'submit'}, 'Simpan');
  const kumpul = () => ({
    nama: nama.value, jenis: jenis.value, alamat: alamat.value, npwp: npwp.value, sumber: sumber.value, referensi_oleh: referensi.value, sumber_lain: sumberLain.value, catatan: catatan.value,
    kontak: [...wadahKontak.querySelectorAll('.kontak')].map((kartu, i) => {
      const c = Object.fromEntries([...kartu.querySelectorAll('[data-k]')].map((e) => [e.dataset.k, e.type === 'radio' ? e.checked : e.value]));
      return perorangan() ? (i === 0 ? {...c, nama: nama.value, jabatan: '', utama: true} : {...c, utama: false}) : c;
    }),
  });
  const kirim = async (ev) => {
    ev?.preventDefault();
    if (sibuk) return;
    galat.hidden = true; peringatan.hidden = true;
    const hasil = validasiKlien(kumpul());
    if (hasil.galat.length) {
      galat.replaceChildren(h('b', null, 'Perbaiki dulu:'), h('ul', null, hasil.galat.map((g) => h('li', null, g.kolom + ': ' + g.pesan))));
      galat.hidden = false; lanjut = false;
      cekSemua(form)?.focus();
      return;
    }
    const dup = cariDuplikat(hasil.data, S.d.klien, id);
    if (dup.npwp.length) {
      galat.replaceChildren(h('b', null, 'NPWP ini sudah terdaftar pada klien lain, jadi tidak bisa disimpan:'), daftarCocok(dup.npwp));
      galat.hidden = false; lanjut = false;
      return;
    }
    const temuan = [['Nama mirip', dup.nama], ['No. HP sama', dup.hp], ['Email sama', dup.email]].filter(([, daftar]) => daftar.length);
    if (temuan.length && !lanjut) {
      peringatan.replaceChildren(h('b', null, 'Klien ini mungkin sudah ada:'), ...temuan.flatMap(([label, daftar]) => [h('p', {class: 'kecil'}, label + ':'), daftarCocok(daftar)]),
        h('div', {class: 'baris-tombol'}, h('button', {class: 'btn btn-utama', type: 'button', onclick: () => { lanjut = true; kirim(); }}, 'Tetap simpan'), h('button', {class: 'btn', type: 'button', onclick: () => { peringatan.hidden = true; }}, 'Batal')));
      peringatan.hidden = false;
      return;
    }
    sibuk = true; simpan.disabled = true; simpan.textContent = 'Menyimpan…';
    try {
      const rec = await store.simpan('klien', id, hasil.data);
      await segarkan(); dlg.close(); pesan('Klien tersimpan.');
      opsi.setelahSimpan?.(rec);
    } catch (e) {
      galat.replaceChildren(h('b', null, 'Gagal menyimpan: '), e.message);
      galat.hidden = false; sibuk = false; lanjut = false; simpan.disabled = false; simpan.textContent = 'Simpan';
    }
  };
  // Mengubah isian setelah peringatan muncul membatalkan "Tetap simpan".
  const labelNama = h('span'), labelNpwp = h('label', {for: 'k-npwp'});
  const tombolTambah = h('button', {class: 'btn btn-kecil', type: 'button', onclick: () => { tambahKontak(); terapkanJenis(); }});
  const petunjukJenis = h('span', {class: 'kecil redup'}, 'Pilih jenis klien dulu; isian berikutnya menyesuaikan.');
  const rinci = h('div', {class: 'form'},
    h('div', {class: 'form-grid'}, h('div', {class: 'medan medan-lebar'}, h('label', {for: 'k-nama'}, labelNama, h('span', {class: 'wajib'}, ' *')), nama), mirip),
    wadahKontak,
    h('div', null, tombolTambah),
    h('div', {class: 'form-grid'},
      medan('Alamat penagihan', alamat), h('div', {class: 'medan'}, labelNpwp, kotakNpwp),
      medan('Sumber klien', sumber), medanReferensi, medanSumberLain,
      medan('Catatan', catatan, null, 'medan-lebar')),
    lama && h('p', {class: 'kecil redup'}, 'Dihitung otomatis: ' + lama.jml_proyek + ' proyek, ' + lama.jml_kontrak + ' kontrak, total ' + rpRingkas(lama.total_kontrak) + ', terakhir aktif ' + tgl(lama.terakhir_aktif) + ', status ' + lama.status_klien + '.'));
  function terapkanJenis() {
    const p = perorangan();
    rinci.hidden = !jenis.value; petunjukJenis.hidden = !!jenis.value;
    labelNama.textContent = p ? 'Nama lengkap' : 'Nama badan usaha';
    labelNpwp.textContent = p ? 'NPWP / NIK' : 'NPWP';
    tombolTambah.textContent = p ? '+ Tambah kontak lain (istri, suami, …)' : '+ Tambah PIC';
    const kartu = [...wadahKontak.children];
    if (!kartu.length) { tambahKontak({utama: true}); return terapkanJenis(); }
    kartu.forEach((k, i) => k.atur(i === 0));
    if (p || !wadahKontak.querySelector('[data-k=utama]:checked')) kartu[0].querySelector('[data-k=utama]').checked = true;
  }
  jenis.addEventListener('change', () => { terapkanJenis(); kotakNpwp.periksa(); });
  // Mengubah isian setelah peringatan muncul membatalkan "Tetap simpan".
  const form = h('form', {class: 'form', novalidate: true, onsubmit: kirim, oninput: () => { lanjut = false; }},
    h('div', {class: 'form-grid'}, h('div', {class: 'medan'}, h('label', {for: 'k-jenis'}, 'Jenis klien', h('span', {class: 'wajib'}, ' *')), jenis, petunjukJenis)),
    rinci, galat, peringatan,
    h('div', {class: 'form-kaki'}, h('span', {class: 'pegas'}), h('button', {class: 'btn', type: 'button', onclick: () => dlg.close()}, 'Batal'), simpan));
  terapkanJenis();
  dlg = dialog(lama ? 'Ubah klien' : 'Tambah klien', form);
  if (!lama && opsi.namaAwal) { nama.value = opsi.namaAwal; cekMirip(); }
}

// ---------- gabung klien ----------
function bukaGabung() {
  const semua = S.d.klien.slice().sort((a, b) => a.nama.localeCompare(b.nama, 'id'));
  if (semua.length < 2) return pesan('Perlu minimal dua klien untuk digabung.', 'galat');
  const pilih = (idEl, label) => h('select', {id: idEl, 'aria-label': label}, h('option', {value: ''}, 'Pilih klien…'), semua.map((k) => h('option', {value: k.id}, ringkasKlien(k))));
  const a = pilih('g-a', 'Klien pertama'), b = pilih('g-b', 'Klien kedua');
  const ringkasan = h('div', {class: 'kotak-info', hidden: true});
  const galat = h('p', {class: 'form-galat', role: 'alert'});
  let dlg, yakin = false;
  const tombol = h('button', {class: 'btn btn-utama', type: 'button', disabled: true}, 'Gabungkan');
  const rencana = () => {
    const ka = S.d.klien.find((k) => k.id === a.value), kb = S.d.klien.find((k) => k.id === b.value);
    if (!ka || !kb || ka.id === kb.id) return null;
    const utama = ringkasan.querySelector('[name=g-utama]:checked')?.value === kb.id ? kb : ka, lain = utama === ka ? kb : ka;
    const proyek = S.d.proyek.filter((p) => p.klien_ref === lain.id), kontrak = S.d.kontrak.filter((c) => c.klien_ref === lain.id);
    const kontak = gabungKontak(utama.kontak, lain.kontak);
    return {ka, kb, utama, lain, proyek, kontrak, kontak, kontakPindah: kontak.length - utama.kontak.length};
  };
  const gambar = (aturUlang) => {
    yakin = false; tombol.textContent = 'Gabungkan'; galat.textContent = '';
    if (aturUlang) ringkasan.replaceChildren();
    const r = rencana();
    tombol.disabled = !r; ringkasan.hidden = !r;
    if (!r) { if (a.value && a.value === b.value) galat.textContent = 'Pilih dua klien yang berbeda.'; return; }
    ringkasan.replaceChildren(
      h('b', null, 'Klien utama (yang dipertahankan):'),
      ...[r.ka, r.kb].map((k) => h('label', {class: 'centang'}, h('input', {type: 'radio', name: 'g-utama', value: k.id, checked: k.id === r.utama.id, onchange: () => gambar()}), ringkasKlien(k))),
      h('p', null, 'Yang dipindahkan ke "' + r.utama.nama + '": ' + r.proyek.length + ' proyek, ' + r.kontrak.length + ' kontrak, ' + r.kontakPindah + ' kontak. Kolom yang masih kosong pada klien utama diisi dari klien lain.'),
      h('p', null, 'Setelah itu klien "' + r.lain.nama + '" dihapus. Tindakan ini tidak bisa dibatalkan.'));
  };
  a.addEventListener('change', () => gambar(true)); b.addEventListener('change', () => gambar(true));
  tombol.addEventListener('click', aman(async () => {
    const r = rencana();
    if (!r) return;
    if (!yakin) { yakin = true; tombol.textContent = 'Klik lagi untuk menggabungkan'; return; }
    tombol.disabled = true; tombol.textContent = 'Menggabungkan…';
    const pindah = (tabel, baris) => store.simpan(tabel, baris.id, bersih({...S.db[tabel].find((x) => x.id === baris.id), klien: null, klien_id: r.utama.id}));
    for (const p of r.proyek) await pindah('proyek', p);
    for (const c of r.kontrak) await pindah('kontrak', c);
    const gabungan = isiYangKosong(dataKlien(r.utama.id), dataKlien(r.lain.id));
    delete gabungan.pic; delete gabungan.hp; delete gabungan.email;
    await store.simpan('klien', r.utama.id, {...gabungan, kontak: r.kontak});
    await store.hapus(r.lain.id);
    await segarkan(); dlg.close(); pesan('Klien digabung ke "' + r.utama.nama + '".');
  }));
  dlg = dialog('Gabung klien', h('div', {class: 'form'},
    h('p', {class: 'redup'}, 'Pilih dua klien yang ternyata sama. Semua proyek, kontrak, dan kontak dipindahkan ke klien utama, lalu klien satunya dihapus.'),
    h('div', {class: 'form-grid'}, h('div', {class: 'medan'}, h('label', {for: 'g-a'}, 'Klien pertama'), a), h('div', {class: 'medan'}, h('label', {for: 'g-b'}, 'Klien kedua'), b)),
    ringkasan, galat,
    h('div', {class: 'form-kaki'}, h('span', {class: 'pegas'}), h('button', {class: 'btn', type: 'button', onclick: () => dlg.close()}, 'Batal'), tombol)));
}

// ---------- pratinjau impor ----------
function bukaPratinjauImpor(baris) {
  const hasil = evaluasiImpor(baris, S.d.klien);
  let dlg, yakin = false;
  const error = hasil.filter((r) => r.status === 'error'), dup = hasil.filter((r) => r.status === 'duplikat'), siap = hasil.filter((r) => r.status === 'siap');
  const akanSimpan = () => siap.length + dup.filter((r) => r.aksi !== 'lewati').length;
  const tombol = h('button', {class: 'btn btn-utama', type: 'button'});
  const segarTombol = () => { yakin = false; tombol.textContent = 'Simpan ' + akanSimpan() + ' klien'; tombol.disabled = !akanSimpan(); };
  tombol.addEventListener('click', aman(async () => {
    if (!yakin) { yakin = true; tombol.textContent = 'Klik lagi untuk menyimpan ' + akanSimpan() + ' klien'; return; }
    tombol.disabled = true; tombol.textContent = 'Menyimpan…';
    const baru = siap.concat(dup.filter((r) => r.aksi === 'baru')).map((r) => ({tabel: 'klien', data: r.data}));
    if (baru.length) await store.tambahBanyak(baru);
    for (const r of dup.filter((x) => x.aksi === 'timpa' || x.aksi === 'isi')) {
      const lama = dataKlien(r.cocok.id);
      const data = r.aksi === 'timpa' ? r.data : isiYangKosong({...lama, kontak: kontakDari(lama)}, r.data);
      delete data.pic; delete data.hp; delete data.email;
      await store.simpan('klien', r.cocok.id, data);
    }
    await segarkan(); dlg.close(); pesan('Impor selesai: ' + (baru.length + dup.filter((x) => x.aksi === 'timpa' || x.aksi === 'isi').length) + ' klien disimpan.');
  }));
  const pilihAksi = (r) => h('select', {'aria-label': 'Tindakan untuk baris ' + r.no, onchange: (ev) => { r.aksi = ev.target.value; segarTombol(); }},
    (r.jenisDup === 'ada' ? [['lewati', 'Lewati'], ['timpa', 'Timpa'], ['isi', 'Isi yang kosong saja']] : [['lewati', 'Lewati'], ['baru', 'Simpan sebagai klien baru']]).map(([v, label]) => h('option', {value: v}, label)));
  const tabel = (judul, kepala, rows) => rows.length ? [h('h3', null, judul), h('div', {class: 'gulir gulir-pendek'}, h('table', {class: 'tabel'}, h('thead', null, h('tr', null, kepala.map((x) => h('th', null, x)))), h('tbody', null, rows)))] : null;
  segarTombol();
  dlg = dialog('Pratinjau impor klien', h('div', {class: 'form'},
    h('p', null, h('b', null, siap.length + ' baris siap, ' + error.length + ' baris error, ' + dup.length + ' baris duplikat.'), ' Belum ada yang disimpan.'),
    !hasil.length && h('p', {class: 'redup'}, 'File tidak berisi baris data.'),
    tabel('Baris error (tidak ikut disimpan)', ['Baris', 'Nama klien', 'Masalah'], error.map((r) => h('tr', null, h('td', null, String(r.no)), h('td', null, isi(r.nilai.nama)), h('td', null, r.galat.map((g) => h('div', null, 'Baris ' + r.no + ' – ' + g.kolom + ': ' + g.pesan)))))),
    error.length > 0 && h('div', null, h('button', {class: 'btn btn-kecil', type: 'button', onclick: aman(async () => {
      await unduhWorkbook(buatWorkbook(await muatExcelJS(), error.map((r) => r.nilai), {galat: error.map((r) => r.galat.map((g) => g.kolom + ': ' + g.pesan).join('; '))}), 'alinea5-klien-baris-error.xlsx');
    })}, 'Unduh baris yang error')),
    tabel('Baris duplikat', ['Baris', 'Nama klien', 'Duplikat karena', 'Tindakan'], dup.map((r) => h('tr', null, h('td', null, String(r.no)), h('td', null, r.data.nama), h('td', null, r.alasan), h('td', null, pilihAksi(r))))),
    tabel('Baris siap disimpan', ['Baris', 'Nama klien', 'Jenis', 'Kontak utama', 'HP/WA', 'NPWP'], siap.map((r) => { const u = (r.data.kontak || []).find((c) => c.utama); return h('tr', null, h('td', null, String(r.no)), h('td', null, r.data.nama), h('td', null, r.data.jenis), h('td', null, isi(u?.nama)), h('td', null, isi(u?.hp)), h('td', null, isi(r.data.npwp))); })),
    h('div', {class: 'form-kaki'}, h('span', {class: 'pegas'}), h('button', {class: 'btn', type: 'button', onclick: () => dlg.close()}, 'Batal'), tombol)));
}

// ---------- pemilih klien untuk formulir Proyek dan Kontrak ----------
// Nilai (id klien) ada di input tersembunyi ber-id `id`; teks yang diketik hanya untuk mencari.
export function pilihKlien(id, nilai, bolehTambah, wajib) {
  const namaDari = (kid) => S.db.klien.find((k) => k.id === kid)?.nama || '';
  const nilaiEl = h('input', {type: 'hidden', id, value: nilai || ''});
  const cari = h('input', {id: id + '-cari', type: 'text', placeholder: 'Ketik untuk mencari, lalu pilih dari daftar', autocomplete: 'off', role: 'combobox', 'aria-expanded': 'false', 'aria-controls': id + '-daftar', 'aria-label': 'Cari klien'});
  const daftar = h('div', {class: 'kombo-daftar', id: id + '-daftar', role: 'listbox', hidden: true});
  const wadah = h('div', {class: 'kombo'}, nilaiEl, cari, daftar);
  const tutup = () => { daftar.hidden = true; cari.setAttribute('aria-expanded', 'false'); };
  const pilih = (kid) => { nilaiEl.value = kid || ''; cari.value = namaDari(kid); tutup(); };
  const tahan = (ev) => ev.preventDefault(); // agar kolom cari tidak kehilangan fokus saat pilihan diklik
  const buka = () => {
    const q = cari.value.trim().toLowerCase(), terpilih = namaDari(nilaiEl.value).toLowerCase();
    const cocok = S.d.klien.filter((k) => !q || q === terpilih || ringkasKlien(k).toLowerCase().includes(q)).sort((a, b) => a.nama.localeCompare(b.nama, 'id')).slice(0, 50);
    daftar.replaceChildren(...[
      ...cocok.map((k) => h('button', {class: 'kombo-opsi', type: 'button', role: 'option', 'aria-selected': String(k.id === nilaiEl.value), onmousedown: tahan, onclick: () => pilih(k.id)}, h('span', null, k.nama), k.kontak_utama && h('span', {class: 'kecil redup'}, ' · ' + k.kontak_utama))),
      !cocok.length && h('div', {class: 'kombo-kosong redup'}, 'Tidak ada klien yang cocok.'),
      !wajib && nilaiEl.value && h('button', {class: 'kombo-opsi redup', type: 'button', onmousedown: tahan, onclick: () => pilih('')}, 'Kosongkan pilihan'),
      !bolehTambah && h('div', {class: 'kombo-kosong redup kecil'}, 'Klien belum ada di daftar? Minta admin menambahkannya di menu Klien.'),
      bolehTambah && h('button', {class: 'kombo-opsi kombo-tambah', type: 'button', onmousedown: tahan, onclick: () => { const teks = cari.value.trim(); tutup(); bukaFormKlien(null, {namaAwal: teks && teks.toLowerCase() !== terpilih ? teks : '', setelahSimpan: (rec) => pilih(rec.id)}); }}, '+ Tambah klien baru')].filter(Boolean));
    daftar.hidden = false; cari.setAttribute('aria-expanded', 'true');
  };
  nilaiEl.pilih = pilih;
  cari.value = namaDari(nilai);
  cari.addEventListener('focus', buka);
  cari.addEventListener('input', buka);
  cari.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !daftar.hidden) { ev.preventDefault(); ev.stopPropagation(); tutup(); } });
  // Teks yang tidak dipilih dari daftar tidak pernah tersimpan: kembali ke pilihan terakhir.
  cari.addEventListener('blur', () => setTimeout(() => { if (!wadah.contains(document.activeElement)) { if (!cari.value.trim() && !wajib) nilaiEl.value = ''; cari.value = namaDari(nilaiEl.value); tutup(); } }, 120));
  return wadah;
}
