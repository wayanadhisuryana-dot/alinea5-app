// Penyimpanan data. Dua pilihan dengan antarmuka yang sama:
//  - lokal    : localStorage di browser ini (mode demo, tanpa login)
//  - supabase : database bersama dengan login dan peran (admin / arsitek)
import {SUPABASE_URL, SUPABASE_ANON_KEY} from './config.js';
import {NAMA_TABEL} from './schema.js';

const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
const KUNCI_LOKAL = 'alinea5:records';
export const idBaru = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2));
const cek = ({data, error}) => { if (error) throw new Error(error.message); return data; };

// File PDF (kontrak kerja, sertifikat). Mode demo menyimpannya di IndexedDB browser ini.
const BUCKET = 'dokumen-sdm';
function bukaIdb() {
  return new Promise((ok, gagal) => {
    const r = indexedDB.open('alinea5-berkas', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('berkas');
    r.onsuccess = () => ok(r.result);
    r.onerror = () => gagal(r.error);
  });
}
async function idb(mode, fn) {
  const db = await bukaIdb();
  return new Promise((ok, gagal) => {
    const tx = db.transaction('berkas', mode);
    const req = fn(tx.objectStore('berkas'));
    tx.oncomplete = () => ok(req?.result);
    tx.onerror = () => gagal(tx.error);
  });
}
const galatBerkas = (e) => new Error(/bucket not found/i.test(e.message) ? 'Tempat penyimpanan file belum dibuat. Jalankan SQL pembaruan terbaru di Supabase, lalu coba lagi.' : 'File gagal diproses: ' + e.message);

function storeLokal() {
  let records = [];
  const tulis = () => localStorage.setItem(KUNCI_LOKAL, JSON.stringify(records));
  return {
    mode: 'lokal',
    user: {email: 'Mode demo', role: 'admin', aktif: true},
    async init() {
      try { records = JSON.parse(localStorage.getItem(KUNCI_LOKAL) || '[]'); } catch { records = []; }
      return this.user;
    },
    async muat() { return records.map((r) => ({...r})); },
    async simpan(tabel, id, data) {
      const rec = {id: id || idBaru(), tabel, data, updated_at: new Date().toISOString()};
      records = records.filter((r) => r.id !== rec.id).concat(rec);
      tulis();
      return rec;
    },
    async hapus(id) { records = records.filter((r) => r.id !== id); tulis(); },
    async gantiTabel(tabel, rows) {
      records = records.filter((r) => !tabel.includes(r.tabel)).concat(rows.map((r) => ({id: idBaru(), tabel: r.tabel, data: r.data, updated_at: new Date().toISOString()})));
      tulis();
    },
    async tambahBanyak(rows) { return this.gantiTabel([], rows); },
    async unggah(path, file) { await idb('readwrite', (st) => st.put(file, path)); },
    async urlBerkas(path) {
      const b = await idb('readonly', (st) => st.get(path));
      if (!b) throw new Error('File tidak ditemukan di browser ini.');
      return URL.createObjectURL(b);
    },
    async hapusBerkas(paths) { if (paths.length) await idb('readwrite', (st) => { paths.forEach((x) => st.delete(x)); }); },
  };
}

function storeSupabase() {
  let sb = null;
  const profil = async (user) => {
    const p = cek(await sb.from('profiles').select('*').eq('id', user.id).maybeSingle());
    return {id: user.id, email: user.email, role: p?.role || 'arsitek', aktif: !!p?.aktif};
  };
  return {
    mode: 'supabase',
    user: null,
    async init() {
      const {createClient} = await import(SUPABASE_JS);
      sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      const {data} = await sb.auth.getSession();
      this.user = data.session ? await profil(data.session.user) : null;
      return this.user;
    },
    async masuk(email, password) {
      const data = cek(await sb.auth.signInWithPassword({email, password}));
      this.user = await profil(data.user);
      return this.user;
    },
    async daftar(email, password) {
      const data = cek(await sb.auth.signUp({email, password}));
      this.user = data.session ? await profil(data.user) : null;
      return {perluKonfirmasiEmail: !data.session};
    },
    async keluar() { await sb.auth.signOut(); this.user = null; },
    async muat() {
      const semua = [];
      for (let dari = 0; ; dari += 1000) {
        const bagian = cek(await sb.from('records').select('id,tabel,data,updated_at').order('id').range(dari, dari + 999));
        semua.push(...bagian);
        if (bagian.length < 1000) return semua;
      }
    },
    async simpan(tabel, id, data) {
      return cek(await sb.from('records').upsert({id: id || idBaru(), tabel, data}).select('id,tabel,data,updated_at').single());
    },
    async hapus(id) { cek(await sb.from('records').delete().eq('id', id)); },
    async gantiTabel(tabel, rows) {
      if (tabel.length) cek(await sb.from('records').delete().in('tabel', tabel));
      for (let i = 0; i < rows.length; i += 500) {
        cek(await sb.from('records').insert(rows.slice(i, i + 500).map((r) => ({id: idBaru(), tabel: r.tabel, data: r.data}))));
      }
    },
    async tambahBanyak(rows) { return this.gantiTabel([], rows); },
    async unggah(path, file) {
      const {error} = await sb.storage.from(BUCKET).upload(path, file, {contentType: 'application/pdf', upsert: false});
      if (error) throw galatBerkas(error);
    },
    async urlBerkas(path) {
      const {data, error} = await sb.storage.from(BUCKET).createSignedUrl(path, 300);
      if (error) throw galatBerkas(error);
      return data.signedUrl;
    },
    async hapusBerkas(paths) { if (paths.length) await sb.storage.from(BUCKET).remove(paths); },
    async pengguna() { return cek(await sb.from('profiles').select('id,email,role,aktif,created_at').order('email')); },
    async aturPengguna(id, perubahan) { cek(await sb.from('profiles').update(perubahan).eq('id', id)); },
  };
}

// Untuk pengujian di komputer sendiri: localStorage 'alinea5:demo' = '1' di localhost memaksa mode demo.
const paksaDemo = typeof location !== 'undefined' && ['localhost', '127.0.0.1'].includes(location.hostname) && localStorage.getItem('alinea5:demo') === '1';
export const pakaiSupabase = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY) && !paksaDemo;
export const store = pakaiSupabase ? storeSupabase() : storeLokal();
export const semuaTabel = NAMA_TABEL;
