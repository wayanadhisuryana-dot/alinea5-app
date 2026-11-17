// Aturan data klien: normalisasi, validasi, dan pengecekan duplikat. Fungsi murni,
// dipakai bersama oleh formulir, impor Excel, dan perhitungan.

export const JENIS_KLIEN = ['Perorangan', 'Badan usaha (PT/CV/dll)'];
export const SUMBER_KLIEN = ['Referensi', 'Instagram', 'Website', 'Pameran / event', 'Lainnya'];

const BADAN = ['pt', 'cv', 'ud', 'tbk'];
const rapi = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

// "PT. ABC", "pt abc", "ABC, PT" -> "abc". Hanya untuk membandingkan; data asli tidak diubah.
export const normNama = (s) => rapi(s).toLowerCase().replace(/[.,]/g, ' ').split(/\s+/).filter((t) => t && !BADAN.includes(t)).join(' ');

// 08…, 8…, +62…, 62… (boleh berspasi / bertanda hubung) -> 628…, sebagai teks.
export function normHp(v) {
  const s = rapi(v);
  if (!s) return {nilai: null};
  let d = s.replace(/[\s\-().]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  if (!/^\d+$/.test(d)) return {galat: 'No. HP hanya boleh berisi angka, spasi, tanda hubung, atau awalan +62'};
  if (d.startsWith('0')) d = '62' + d.slice(1);
  else if (d.startsWith('8')) d = '62' + d;
  else if (!d.startsWith('62')) return {galat: 'No. HP harus diawali 08, 8, 62, atau +62'};
  if (d.length < 10 || d.length > 15) return {galat: 'No. HP harus 10 sampai 15 digit (termasuk 62)'};
  return {nilai: d};
}

// Titik, strip, dan spasi diabaikan. 16 digit (baru) atau 15 digit (format lama), sebagai teks.
export function normNpwp(v) {
  const d = rapi(v).replace(/[.\-\s]/g, '');
  if (!d) return {nilai: null};
  if (!/^\d+$/.test(d)) return {galat: 'NPWP hanya boleh berisi angka'};
  if (d.length !== 15 && d.length !== 16) return {galat: 'NPWP harus 15 atau 16 digit'};
  return {nilai: d, lama: d.length === 15};
}

export const emailSah = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);

const cocokPilihan = (v, daftar) => {
  const s = rapi(v).toLowerCase();
  if (!s) return null;
  return daftar.find((o) => o.toLowerCase() === s) || daftar.find((o) => o.toLowerCase().startsWith(s) || s.startsWith(o.toLowerCase().split(' (')[0])) || undefined;
};

// Kontak sebuah klien sebagai daftar rapi. Data lama (satu PIC di kolom pic/hp/email) ikut dibaca.
export function kontakDari(k) {
  let daftar = Array.isArray(k?.kontak) ? k.kontak : [];
  if (!daftar.length && (k?.pic || k?.hp || k?.email)) daftar = [{nama: k.pic, hp: normHp(k.hp).nilai ?? k.hp, email: k.email, utama: true}];
  daftar = daftar.filter((c) => c && (c.nama || c.jabatan || c.hp || c.email)).map((c) => ({nama: c.nama || '', jabatan: c.jabatan || '', hp: c.hp || '', email: c.email || '', utama: !!c.utama}));
  if (daftar.length && !daftar.some((c) => c.utama)) daftar[0].utama = true;
  return daftar;
}
export const kontakUtama = (k) => kontakDari(k).find((c) => c.utama) || null;

// Memeriksa dan merapikan satu klien. Mengembalikan {data, galat: [{kolom, pesan}]}.
export function validasiKlien(masuk) {
  const galat = [];
  const salah = (kolom, pesan) => galat.push({kolom, pesan});
  const data = {};
  const nama = rapi(masuk.nama);
  if (!nama) salah('Nama klien', 'Nama klien wajib diisi'); else data.nama = nama;

  const jenis = cocokPilihan(masuk.jenis, JENIS_KLIEN);
  if (jenis === null) salah('Jenis klien', 'Jenis klien wajib dipilih');
  else if (jenis === undefined) salah('Jenis klien', 'Jenis klien harus "Perorangan" atau "Badan usaha (PT/CV/dll)"');
  else data.jenis = jenis;

  const kontak = [];
  (masuk.kontak || []).forEach((c, i) => {
    const label = 'Kontak ' + (i + 1);
    const hp = normHp(c.hp), email = rapi(c.email);
    if (hp.galat) salah(label + ' – No. HP', hp.galat);
    if (email && !emailSah(email)) salah(label + ' – Email', 'Format email tidak benar');
    const satu = {nama: rapi(c.nama), jabatan: rapi(c.jabatan), hp: hp.nilai || '', email: email.toLowerCase(), utama: !!c.utama};
    if (satu.nama || satu.jabatan || satu.hp || satu.email) kontak.push(satu);
  });
  if (kontak.length) {
    const utama = kontak.findIndex((c) => c.utama);
    kontak.forEach((c, i) => { c.utama = i === Math.max(0, utama); });
    data.kontak = kontak;
  }

  const npwp = normNpwp(masuk.npwp);
  if (npwp.galat) salah('NPWP', npwp.galat); else if (npwp.nilai) data.npwp = npwp.nilai;

  const alamat = String(masuk.alamat ?? '').trim();
  if (alamat) data.alamat = alamat;

  const sumber = cocokPilihan(masuk.sumber, SUMBER_KLIEN);
  if (sumber === undefined) salah('Sumber klien', 'Sumber klien harus salah satu dari: ' + SUMBER_KLIEN.join(', '));
  else if (sumber) {
    data.sumber = sumber;
    if (sumber === 'Referensi' && rapi(masuk.referensi_oleh)) data.referensi_oleh = rapi(masuk.referensi_oleh);
    if (sumber === 'Lainnya' && rapi(masuk.sumber_lain)) data.sumber_lain = rapi(masuk.sumber_lain);
  }
  const catatan = String(masuk.catatan ?? '').trim();
  if (catatan) data.catatan = catatan;
  return {data, galat};
}

// Klien lain yang bentrok dengan calon. npwp = harus diblokir; sisanya peringatan.
export function cariDuplikat(calon, semua, kecualiId) {
  const lain = semua.filter((k) => k.id !== kecualiId);
  const hp = new Set(kontakDari(calon).map((c) => c.hp).filter(Boolean));
  const email = new Set(kontakDari(calon).map((c) => c.email.toLowerCase()).filter(Boolean));
  const nama = normNama(calon.nama);
  return {
    npwp: calon.npwp ? lain.filter((k) => normNpwp(k.npwp).nilai === calon.npwp) : [],
    hp: lain.filter((k) => kontakDari(k).some((c) => c.hp && hp.has(c.hp))),
    email: lain.filter((k) => kontakDari(k).some((c) => c.email && email.has(c.email.toLowerCase()))),
    nama: nama ? lain.filter((k) => normNama(k.nama) === nama) : [],
  };
}

// Klien yang namanya mirip dengan teks yang sedang diketik.
export function namaMirip(teks, semua, kecualiId) {
  const n = normNama(teks);
  if (n.length < 3) return [];
  return semua.filter((k) => {
    if (k.id === kecualiId) return false;
    const m = normNama(k.nama);
    return m && (m === n || (m.length >= 3 && (m.includes(n) || n.includes(m))));
  }).slice(0, 5);
}

// Menggabungkan dua daftar kontak tanpa menggandakan orang yang sama.
export function gabungKontak(utama, tambahan) {
  const hasil = utama.map((c) => ({...c}));
  for (const c of tambahan) {
    const sama = hasil.some((x) => (c.hp && x.hp === c.hp) || (c.email && x.email.toLowerCase() === c.email.toLowerCase()) || (!c.hp && !c.email && x.nama.toLowerCase() === c.nama.toLowerCase()));
    if (!sama) hasil.push({...c, utama: false});
  }
  if (hasil.length && !hasil.some((c) => c.utama)) hasil[0].utama = true;
  return hasil;
}

// Mengisi kolom yang masih kosong pada `lama` dengan isi dari `baru`; kontak digabung.
export function isiYangKosong(lama, baru) {
  const hasil = {...lama};
  for (const [k, v] of Object.entries(baru)) if (k !== 'kontak' && (hasil[k] == null || hasil[k] === '')) hasil[k] = v;
  const kontak = gabungKontak(kontakDari(lama), kontakDari(baru));
  if (kontak.length) hasil.kontak = kontak;
  return hasil;
}
