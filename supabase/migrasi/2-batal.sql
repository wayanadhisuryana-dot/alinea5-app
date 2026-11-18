-- Alinea 5 — Pembatalan migrasi Tahap 2 (2-master.sql).
-- Mengembalikan aturan seperti setelah Tahap 1. Data master Tahap 2 TIDAK dihapus: barisnya disalin ke
-- tabel arsip_tahap2.records lebih dulu, baru dikeluarkan dari public.records (agar aturan nama tabel lama
-- bisa dipasang kembali). Entri direktori Tim Proyek dari vendor ikut diarsipkan. File di dokumen-master
-- tidak disentuh.

create schema if not exists arsip_tahap2;
create table if not exists arsip_tahap2.records as select * from public.records where false;
insert into arsip_tahap2.records
  select * from public.records r
  where (r.tabel in ('vendor_tukang', 'supplier', 'barang', 'harga') or (r.tabel = 'tim' and r.data ? 'vendor_id'))
    and not exists (select 1 from arsip_tahap2.records a where a.id = r.id);
delete from public.records where tabel in ('vendor_tukang', 'supplier', 'barang', 'harga') or (tabel = 'tim' and data ? 'vendor_id');

drop index if exists public.records_vendor_nik_unik;
drop index if exists public.records_vendor_npwp_unik;
drop index if exists public.records_supplier_npwp_unik;
drop index if exists public.records_barang_kode_unik;
drop index if exists public.records_harga_barang_idx;

alter table public.records drop constraint if exists records_tabel_check;
alter table public.records add constraint records_tabel_check check (tabel in (
  'proyek', 'tahap', 'masalah', 'klien', 'tim',
  'kontrak', 'termin', 'vendor', 'hutang_lain', 'sdm', 'aset', 'legal', 'pengaturan'));

create or replace function public.menu_tabel(t text)
returns text language sql immutable set search_path = ''
as $$ select case t when 'vendor' then 'pihak_proyek' else t end $$;

drop policy if exists records_baca on public.records;
drop policy if exists records_tambah on public.records;
drop policy if exists records_ubah on public.records;
drop policy if exists records_hapus on public.records;
create policy records_baca on public.records for select to authenticated using (
  public.hak(public.menu_tabel(tabel)) is not null
  or (tabel = 'klien' and (public.hak('proyek') is not null or public.hak('kontrak') is not null))
  or (tabel = 'tim' and (public.hak('proyek') is not null or public.hak('tahap') is not null
                         or public.hak('masalah') is not null or public.hak('sdm') is not null))
  or (tabel = 'pengaturan' and public.pengguna_aktif()));
create policy records_tambah on public.records for insert to authenticated with check (
  public.hak(public.menu_tabel(tabel)) = 'ubah' or (tabel = 'tim' and public.hak('sdm') = 'ubah'));
create policy records_ubah on public.records for update to authenticated
  using (public.hak(public.menu_tabel(tabel)) = 'ubah' or (tabel = 'tim' and public.hak('sdm') = 'ubah'))
  with check (public.hak(public.menu_tabel(tabel)) = 'ubah' or (tabel = 'tim' and public.hak('sdm') = 'ubah'));
create policy records_hapus on public.records for delete to authenticated using (
  public.hak(public.menu_tabel(tabel)) = 'ubah' or (tabel = 'tim' and public.hak('sdm') = 'ubah'));

drop policy if exists dokumen_master_baca on storage.objects;
drop policy if exists dokumen_master_tambah on storage.objects;
drop policy if exists dokumen_master_hapus on storage.objects;

select (select count(*) from arsip_tahap2.records) as baris_diarsipkan;
