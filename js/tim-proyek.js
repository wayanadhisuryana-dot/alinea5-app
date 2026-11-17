// Tim Proyek: anggota tiap proyek beserta perannya, dipilih dari orang internal (SDM) yang aktif
// dan dicentang "Dapat dipilih sebagai Tim Proyek". Kelompok "Mandor, Tukang & Freelance" menyusul
// setelah Master Vendor/Tukang dibuat.
import {OPSI} from './schema.js';
import {S} from './state.js';
import {h, tgl} from './ui.js';

let nomor = 0;

// Orang yang boleh dipilih: [{ref, nama, ket, kelompok}].
export function orangTersedia() {
  const internal = S.db.tim.filter((r) => r.sdm_id && r.aktif && r.tim_proyek)
    .map((r) => ({ref: 'sdm:' + r.sdm_id, nama: r.nama, ket: r.jabatan, kelompok: 'Internal (SDM)'}));
  return internal.sort((a, b) => a.nama.localeCompare(b.nama, 'id'));
}
// Nama orang internal untuk isian PIC di Progres Tahap dan Masalah.
export const namaTimInternal = () => orangTersedia().map((o) => o.nama);

// Kotak pilihan orang dengan pencarian, dikelompokkan. onPilih(orang) dipanggil saat dipilih.
function pilihOrang(id, onPilih) {
  const cari = h('input', {id, type: 'text', placeholder: 'Ketik nama untuk mencari', autocomplete: 'off', role: 'combobox', 'aria-expanded': 'false', 'aria-controls': id + '-daftar'});
  const daftar = h('div', {class: 'kombo-daftar', id: id + '-daftar', role: 'listbox', hidden: true});
  const wadah = h('div', {class: 'kombo'}, cari, daftar);
  let terpilih = null;
  const tutup = () => { daftar.hidden = true; cari.setAttribute('aria-expanded', 'false'); };
  const tahan = (ev) => ev.preventDefault();
  const buka = () => {
    const q = cari.value.trim().toLowerCase();
    const cocok = orangTersedia().filter((o) => !q || (terpilih && q === terpilih.nama.toLowerCase()) || (o.nama + ' ' + (o.ket || '')).toLowerCase().includes(q));
    const grup = [...new Set(cocok.map((o) => o.kelompok))];
    daftar.replaceChildren(...grup.flatMap((g) => [h('div', {class: 'kombo-grup'}, g),
      ...cocok.filter((o) => o.kelompok === g).map((o) => h('button', {class: 'kombo-opsi', type: 'button', role: 'option', onmousedown: tahan, onclick: () => { terpilih = o; cari.value = o.nama; tutup(); onPilih?.(o); }},
        h('span', null, o.nama), o.ket && h('span', {class: 'kecil redup'}, ' · ' + o.ket)))]),
    ...(cocok.length ? [] : [h('div', {class: 'kombo-kosong redup'}, orangTersedia().length ? 'Tidak ada nama yang cocok.' : 'Belum ada pegawai aktif yang dicentang "Dapat dipilih sebagai Tim Proyek" di menu SDM.')]));
    daftar.hidden = false; cari.setAttribute('aria-expanded', 'true');
  };
  cari.addEventListener('focus', buka);
  cari.addEventListener('input', () => { terpilih = null; buka(); });
  cari.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !daftar.hidden) { ev.preventDefault(); ev.stopPropagation(); tutup(); } });
  cari.addEventListener('blur', () => setTimeout(() => { if (!wadah.contains(document.activeElement)) { if (!terpilih) cari.value = ''; tutup(); } }, 120));
  wadah.terpilih = () => terpilih;
  wadah.kosongkan = () => { terpilih = null; cari.value = ''; };
  return wadah;
}

const pilihanPeran = (id, nilai) => {
  const daftar = OPSI.peranTim.includes(nilai) || !nilai ? OPSI.peranTim : OPSI.peranTim.concat(nilai);
  return h('select', {id, 'aria-label': 'Peran di proyek'}, h('option', {value: ''}, 'Pilih peran…'), daftar.map((p) => h('option', {value: p, selected: p === nilai}, p)));
};

// Penyunting Tim Proyek di formulir Proyek. Elemen hasilnya punya .nilaiTim() dan .anggota(),
// dan memancarkan event 'ubah' setiap kali susunan anggota berubah.
export function editorTimProyek(id, awal, catatanLama) {
  const tersedia = new Set(orangTersedia().map((o) => o.ref));
  const badan = h('tbody');
  const galat = h('p', {class: 'form-galat', role: 'alert'});
  const wadah = h('div', {class: 'tim-proyek', id});
  const kabari = () => wadah.dispatchEvent(new Event('ubah'));
  const baris = [];
  const kosongkanTeks = h('tr', {class: 'tim-kosong'}, h('td', {colspan: '6', class: 'redup'}, 'Belum ada anggota. Pilih orang dan perannya di bawah, lalu klik Tambah.'));

  const tambahBaris = (a) => {
    const i = ++nomor;
    const peran = pilihanPeran('tp-peran-' + i, a.peran);
    const mulai = h('input', {type: 'date', value: a.mulai || '', 'aria-label': 'Mulai'});
    const selesai = h('input', {type: 'date', value: a.selesai || '', 'aria-label': 'Selesai'});
    const catatan = h('input', {type: 'text', value: a.catatan || '', 'aria-label': 'Catatan', autocomplete: 'off'});
    const item = {a, peran, mulai, selesai, catatan};
    const tr = h('tr', null,
      h('td', null, h('span', null, a.nama), !tersedia.has(a.ref) && h('span', {class: 'kecil redup blok'}, 'Tidak aktif / tidak dapat dipilih lagi')),
      h('td', null, peran), h('td', null, mulai), h('td', null, selesai), h('td', null, catatan),
      h('td', null, h('button', {class: 'btn btn-kecil', type: 'button', onclick: () => { baris.splice(baris.indexOf(item), 1); tr.remove(); gambarKosong(); kabari(); }}, 'Hapus')));
    item.tr = tr;
    peran.addEventListener('change', kabari);
    baris.push(item);
    badan.append(tr);
  };
  const gambarKosong = () => { if (!baris.length) badan.append(kosongkanTeks); else kosongkanTeks.remove(); };
  (Array.isArray(awal) ? awal : []).forEach(tambahBaris);
  gambarKosong();

  const orang = pilihOrang(id + '-orang');
  const peranBaru = pilihanPeran(id + '-peran');
  const tambah = h('button', {class: 'btn', type: 'button', onclick: () => {
    galat.textContent = '';
    const o = orang.terpilih();
    if (!o) { galat.textContent = 'Pilih orang dari daftar dulu.'; orang.querySelector('input').focus(); return; }
    if (!peranBaru.value) { galat.textContent = 'Pilih peran di proyek.'; peranBaru.focus(); return; }
    if (baris.some((b) => b.a.ref === o.ref && b.peran.value === peranBaru.value)) { galat.textContent = o.nama + ' sudah ada di tim ini sebagai ' + peranBaru.value + '.'; return; }
    tambahBaris({ref: o.ref, nama: o.nama, peran: peranBaru.value});
    gambarKosong();
    orang.kosongkan(); peranBaru.value = '';
    kabari();
  }}, 'Tambah');

  wadah.append(
    h('div', {class: 'gulir'}, h('table', {class: 'tabel tabel-isian'},
      h('thead', null, h('tr', null, ['Orang', 'Peran di proyek', 'Mulai', 'Selesai', 'Catatan', ''].map((x) => h('th', null, x)))), badan)),
    h('div', {class: 'tim-tambah'},
      h('div', {class: 'medan'}, h('label', {for: id + '-orang'}, 'Orang'), orang),
      h('div', {class: 'medan'}, h('label', {for: id + '-peran'}, 'Peran'), peranBaru),
      h('div', {class: 'medan'}, h('span', {class: 'label-kosong', 'aria-hidden': 'true'}, ' '), tambah)),
    galat,
    catatanLama && h('p', {class: 'kecil redup'}, 'Tim pendukung (data lama): ' + catatanLama));

  wadah.nilaiTim = () => {
    const hasil = baris.map((b) => Object.fromEntries(Object.entries({ref: b.a.ref, nama: b.a.nama, peran: b.peran.value, mulai: b.mulai.value, selesai: b.selesai.value, catatan: b.catatan.value.trim()}).filter(([, v]) => v)));
    return hasil;
  };
  // Galat isian Tim Proyek, atau '' bila benar.
  wadah.periksa = () => {
    const kunci = new Set();
    for (const b of baris) {
      if (!b.peran.value) return 'Tim Proyek: peran ' + b.a.nama + ' belum dipilih.';
      const k = b.a.ref + '|' + b.peran.value;
      if (kunci.has(k)) return 'Tim Proyek: ' + b.a.nama + ' tercatat dua kali sebagai ' + b.peran.value + '.';
      kunci.add(k);
      if (b.mulai.value && b.selesai.value && b.selesai.value < b.mulai.value) return 'Tim Proyek: tanggal selesai ' + b.a.nama + ' lebih awal dari tanggal mulai (' + tgl(b.mulai.value) + ').';
    }
    return '';
  };
  wadah.anggota = () => [...new Set(baris.map((b) => b.a.nama))];
  return wadah;
}

// Pilihan PIC / pengawas dari anggota Tim Proyek di formulir yang sama; ikut berubah saat tim berubah.
export function pilihAnggota(id, nilai, wajib, editor) {
  let sekarang = nilai || '';
  const sel = h('select', {id, required: wajib, onchange: () => { sekarang = sel.value; }});
  const isi = () => {
    const nama = editor ? editor.anggota() : [];
    const semua = !sekarang || nama.includes(sekarang) ? nama : nama.concat(sekarang);
    sel.replaceChildren(h('option', {value: ''}, wajib ? 'Pilih…' : '—'), ...semua.map((x) => h('option', {value: x, selected: x === sekarang}, nama.includes(x) ? x : x + ' (bukan anggota Tim Proyek)')));
  };
  isi();
  editor?.addEventListener('ubah', isi);
  return sel;
}
