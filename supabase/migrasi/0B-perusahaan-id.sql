-- Alinea 5 — Migrasi Tahap 0B: kolom perusahaan_id (satu aplikasi per perusahaan).
-- Tidak menghapus atau mengubah isi data. Aman dijalankan ulang.
-- Pembatalan: 0B-batal.sql.

-- 1. Cadangan di dalam database: salinan utuh tabel records sebelum migrasi.
--    Hanya dibuat sekali; bila sudah ada, tidak ditimpa.
do $$
begin
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'records_cadangan_0b') then
    create table public.records_cadangan_0b as select * from public.records;
    alter table public.records_cadangan_0b enable row level security; -- tidak bisa dibaca dari aplikasi
  end if;
end $$;

-- 2. Tabel perusahaan: berisi SATU baris (perusahaan pemilik instalasi ini).
create table if not exists public.perusahaan (
  id uuid primary key default gen_random_uuid(),
  nama text not null default 'Perusahaan',
  dibuat timestamptz not null default now()
);
insert into public.perusahaan (nama)
select 'Perusahaan' where not exists (select 1 from public.perusahaan);

-- ID perusahaan tunggal; dipakai sebagai isi otomatis perusahaan_id.
create or replace function public.perusahaan_tunggal()
returns uuid language sql stable security definer set search_path = ''
as $$
  select id from public.perusahaan order by dibuat, id limit 1
$$;

-- 3. Kolom perusahaan_id di records: data lama diisi, data baru terisi otomatis.
alter table public.records add column if not exists perusahaan_id uuid references public.perusahaan (id);
update public.records set perusahaan_id = public.perusahaan_tunggal() where perusahaan_id is null;
alter table public.records alter column perusahaan_id set default public.perusahaan_tunggal();
alter table public.records alter column perusahaan_id set not null;
create index if not exists records_perusahaan_idx on public.records (perusahaan_id);

-- 4. Akses: pengguna aktif boleh membaca data perusahaan; perubahan menyusul di Tahap 1 (Profil).
alter table public.perusahaan enable row level security;
drop policy if exists perusahaan_baca on public.perusahaan;
create policy perusahaan_baca on public.perusahaan for select to authenticated
  using (public.peran() is not null);
revoke all on public.perusahaan from anon;
grant select on public.perusahaan to authenticated;
grant execute on function public.perusahaan_tunggal() to authenticated;

-- 5. Pemeriksaan: harus menampilkan 0 data tanpa perusahaan dan 1 perusahaan.
select
  (select count(*) from public.records where perusahaan_id is null) as data_tanpa_perusahaan,
  (select count(*) from public.perusahaan) as jumlah_perusahaan,
  (select count(*) from public.records) as jumlah_data,
  (select count(*) from public.records_cadangan_0b) as jumlah_di_cadangan;
