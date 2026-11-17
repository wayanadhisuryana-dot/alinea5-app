# Alinea 5 — Back Office & Proyek

Aplikasi web pengganti dua file Excel Alinea 5 (Back Office Admin dan Data Proyek Tim Arsitek).
Admin dan tim arsitek mengisi data di browser; dashboard, status, umur piutang, dan peringatan dihitung otomatis.

- **Tampilan:** situs statis (HTML + JavaScript tanpa proses build), ditayangkan lewat GitHub Pages.
- **Data dan login:** Supabase (PostgreSQL + Auth). Repo ini **tidak berisi data** apa pun.
- **Peran:** `admin` melihat semua tabel; `arsitek` hanya Proyek, Progres Tahap, Masalah, Klien, dan Tim.

Selama Supabase belum disambungkan, aplikasi berjalan dalam **mode demo**: data hanya tersimpan di browser yang sedang dipakai.

## Isi aplikasi

| Kelompok | Tabel | Akses |
| --- | --- | --- |
| Proyek | Proyek, Progres Tahap, Masalah & Risiko | admin, arsitek |
| Master | Klien, Tim | admin, arsitek |
| Keuangan | Kontrak, Termin & Piutang, Vendor & Tukang, Hutang Lain | admin |
| Administrasi | SDM, Aset, Legal & Izin | admin |

Rumus mengikuti kolom abu-abu di Excel: nilai tagihan dari % kontrak, status dan umur piutang, hak dan hutang vendor,
retensi, progres berbobot per tahap, status jadwal (toleransi −5% dan −15%), penyusutan garis lurus, serta peringatan
kontrak kerja (60 hari), sertifikat dan dokumen legal (90 hari), lisensi aset (60 hari), dan hutang (14 hari).

## Menyiapkan Supabase (sekali saja)

1. Buat akun dan proyek baru di <https://supabase.com> (paket gratis cukup). Pilih region Singapore.
2. Buka **SQL Editor > New query**, tempel seluruh isi [`supabase/schema.sql`](supabase/schema.sql), lalu **Run**.
3. Buka **Project Settings > API**. Salin **Project URL** dan kunci **anon / publishable** ke [`js/config.js`](js/config.js):

   ```js
   export const SUPABASE_URL = 'https://xxxx.supabase.co';
   export const SUPABASE_ANON_KEY = 'eyJ...';
   ```

   Kunci anon memang boleh terbuka; data dilindungi login dan Row Level Security.
   **Jangan pernah** menaruh kunci `service_role` / `secret` di repo ini.
4. Simpan (commit) perubahan `js/config.js` dan unggah (push) ke GitHub.
5. Buka aplikasinya dan klik **Daftar akun baru** dengan email Anda, lalu klik tautan konfirmasi di email dari Supabase.
   **Pendaftar pertama otomatis menjadi admin**, jadi daftarkan akun Anda segera setelah langkah 2.
6. Anggota tim lain mendaftar sendiri dari halaman masuk. Admin mengaktifkan dan mengatur perannya di
   **Pengaturan > Pengguna**. Akun yang belum diaktifkan tidak bisa membaca data apa pun.

Saran: di **Authentication > URL Configuration**, isi *Site URL* dengan alamat GitHub Pages aplikasi ini
agar tautan konfirmasi email kembali ke aplikasi.

## Memindahkan data dari Excel

Menu **Pengaturan > Impor dari Excel**. Pilih file Data Proyek (Tim Arsitek) lebih dulu, lalu file Back Office (Admin).
Hanya kolom isian yang dibaca; isi tabel yang bersangkutan diganti seluruhnya. Unduh cadangan JSON dari menu yang sama
sebelum mengimpor ulang.

## Menayangkan di GitHub Pages

**Settings > Pages > Build and deployment**: Source `Deploy from a branch`, Branch `main`, folder `/ (root)`.
Situs tersedia di `https://<nama-akun>.github.io/<nama-repo>/` beberapa menit kemudian.

## Menjalankan di komputer sendiri

```bash
python3 -m http.server 5175
```

Lalu buka <http://localhost:5175>.

## Struktur

```
index.html            halaman tunggal
assets/style.css      tampilan (terang dan gelap)
js/schema.js          definisi tabel, kolom isian, daftar pilihan
js/calc.js            semua rumus (fungsi murni)
js/store.js           penyimpanan: browser (demo) atau Supabase
js/import-excel.js    pembaca dua file Excel Alinea 5
js/app.js             antarmuka: dashboard, tabel, formulir, pengaturan
js/config.js          alamat dan kunci anon Supabase
supabase/schema.sql   tabel, pemicu, dan Row Level Security
```

Menambah kolom isian cukup di `js/schema.js`; tiap baris disimpan sebagai JSON sehingga database tidak perlu diubah.
