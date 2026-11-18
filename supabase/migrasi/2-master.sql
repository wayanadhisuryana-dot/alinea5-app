-- Alinea 5 — Migrasi Tahap 2: Master Vendor & Tukang, Supplier, Barang & Harga.
-- Jalankan SETELAH 1-fondasi.sql. Aman dijalankan ulang. Tidak menghapus atau mengubah data yang ada.
-- Pembatalan: 2-batal.sql.
--
-- Data master disimpan di tabel records (seperti Klien dan SDM) dengan nama tabel:
--   vendor_tukang  : master Vendor & Tukang (menu "Vendor & Tukang")
--   supplier       : master Supplier (menu "Supplier")
--   barang         : barang dan item harga pekerjaan (menu "Barang & Harga")
--   harga          : riwayat harga, satu baris per pembelian / penawaran / input (menu "Barang & Harga")
-- Tabel 'vendor' yang lama tetap = Pihak Proyek (per proyek, dibangun ulang di Tahap 4).

-- 1. Nama tabel baru diizinkan.
alter table public.records drop constraint if exists records_tabel_check;
alter table public.records add constraint records_tabel_check check (tabel in (
  'proyek', 'tahap', 'masalah', 'klien', 'tim',
  'kontrak', 'termin', 'vendor', 'hutang_lain', 'sdm', 'aset', 'legal', 'pengaturan',
  'vendor_tukang', 'supplier', 'barang', 'harga'));

-- 2. Nama tabel -> kunci menu (hak akses per menu).
create or replace function public.menu_tabel(t text)
returns text language sql immutable set search_path = ''
as $$ select case t when 'vendor' then 'pihak_proyek' when 'vendor_tukang' then 'vendor' when 'harga' then 'barang' else t end $$;

-- 3. Direktori Tim Proyek (tabel 'tim'): selain dari SDM, kini juga berisi Mandor / Tukang / Freelance
--    dari master Vendor & Tukang. Boleh ditulis oleh pemegang hak Ubah SDM atau Ubah Vendor & Tukang,
--    dan dibaca juga oleh pemegang hak Vendor & Tukang. Aturan tabel lain tidak berubah.
drop policy if exists records_baca on public.records;
drop policy if exists records_tambah on public.records;
drop policy if exists records_ubah on public.records;
drop policy if exists records_hapus on public.records;
create policy records_baca on public.records for select to authenticated using (
  public.hak(public.menu_tabel(tabel)) is not null
  or (tabel = 'klien' and (public.hak('proyek') is not null or public.hak('kontrak') is not null))
  or (tabel = 'tim' and (public.hak('proyek') is not null or public.hak('tahap') is not null
                         or public.hak('masalah') is not null or public.hak('sdm') is not null or public.hak('vendor') is not null))
  or (tabel = 'pengaturan' and public.pengguna_aktif()));
create policy records_tambah on public.records for insert to authenticated with check (
  public.hak(public.menu_tabel(tabel)) = 'ubah' or (tabel = 'tim' and (public.hak('sdm') = 'ubah' or public.hak('vendor') = 'ubah')));
create policy records_ubah on public.records for update to authenticated
  using (public.hak(public.menu_tabel(tabel)) = 'ubah' or (tabel = 'tim' and (public.hak('sdm') = 'ubah' or public.hak('vendor') = 'ubah')))
  with check (public.hak(public.menu_tabel(tabel)) = 'ubah' or (tabel = 'tim' and (public.hak('sdm') = 'ubah' or public.hak('vendor') = 'ubah')));
create policy records_hapus on public.records for delete to authenticated using (
  public.hak(public.menu_tabel(tabel)) = 'ubah' or (tabel = 'tim' and (public.hak('sdm') = 'ubah' or public.hak('vendor') = 'ubah')));

-- 4. Nomor identitas sama -> diblokir oleh database (aplikasi juga memeriksanya lebih dulu).
create unique index if not exists records_vendor_nik_unik on public.records (perusahaan_id, (data ->> 'nik'))
  where tabel = 'vendor_tukang' and coalesce(data ->> 'nik', '') <> '';
create unique index if not exists records_vendor_npwp_unik on public.records (perusahaan_id, (data ->> 'npwp'))
  where tabel = 'vendor_tukang' and coalesce(data ->> 'npwp', '') <> '';
create unique index if not exists records_supplier_npwp_unik on public.records (perusahaan_id, (data ->> 'npwp'))
  where tabel = 'supplier' and coalesce(data ->> 'npwp', '') <> '';
create unique index if not exists records_barang_kode_unik on public.records (perusahaan_id, (data ->> 'kode'))
  where tabel = 'barang' and coalesce(data ->> 'kode', '') <> '';
create index if not exists records_harga_barang_idx on public.records ((data ->> 'barang_id')) where tabel = 'harga';

-- 5. File master: dokumen vendor (KTP dll., PDF/JPG/PNG) di folder vendor/, foto barang (JPG/PNG) di folder barang/.
--    Batas ukuran per file diatur di Pengaturan aplikasi; batas keras di sini 50 MB.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dokumen-master', 'dokumen-master', false, 52428800, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists dokumen_master_baca on storage.objects;
create policy dokumen_master_baca on storage.objects for select to authenticated using (bucket_id = 'dokumen-master' and (
  ((storage.foldername(name))[1] = 'vendor' and public.hak('vendor') is not null)
  or ((storage.foldername(name))[1] = 'barang' and public.hak('barang') is not null)));
drop policy if exists dokumen_master_tambah on storage.objects;
create policy dokumen_master_tambah on storage.objects for insert to authenticated with check (bucket_id = 'dokumen-master' and (
  ((storage.foldername(name))[1] = 'vendor' and public.hak('vendor') = 'ubah')
  or ((storage.foldername(name))[1] = 'barang' and public.hak('barang') = 'ubah')));
drop policy if exists dokumen_master_hapus on storage.objects;
create policy dokumen_master_hapus on storage.objects for delete to authenticated using (bucket_id = 'dokumen-master' and (
  ((storage.foldername(name))[1] = 'vendor' and public.hak('vendor') = 'ubah')
  or ((storage.foldername(name))[1] = 'barang' and public.hak('barang') = 'ubah')));

-- (Peran bawaan "Admin" sudah punya hak Ubah atas menu vendor, supplier, dan barang sejak Tahap 1.)

-- 6. PEMERIKSAAN
select
  public.menu_tabel('vendor_tukang') as vendor_tukang,   -- vendor
  public.menu_tabel('harga') as harga,                   -- barang
  public.menu_tabel('vendor') as vendor_lama,            -- pihak_proyek
  (select count(*) from pg_indexes where indexname like 'records_%_unik') as indeks_unik,   -- 4
  (select count(*) from storage.buckets where id = 'dokumen-master') as tempat_file;      -- 1
