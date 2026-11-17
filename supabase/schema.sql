-- Alinea 5 — skema database Supabase.
-- Jalankan SELURUH file ini sekali di Supabase: SQL Editor > New query > Run.
-- Aman dijalankan ulang.

-- 1. Profil pengguna: peran dan status aktif ---------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  role text not null default 'arsitek' check (role in ('admin', 'arsitek')),
  aktif boolean not null default false,
  created_at timestamptz not null default now()
);

-- Setiap akun baru otomatis mendapat profil.
-- Pendaftar PERTAMA langsung menjadi admin dan aktif. Pendaftar berikutnya menjadi
-- arsitek yang BELUM aktif: tidak bisa membaca data apa pun sampai admin mengaktifkannya
-- di menu Pengaturan > Pengguna.
create or replace function public.buat_profil()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  pertama boolean;
begin
  select not exists (select 1 from public.profiles) into pertama;
  insert into public.profiles (id, email, role, aktif)
  values (new.id, new.email, case when pertama then 'admin' else 'arsitek' end, pertama)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.buat_profil();

-- Peran pengguna yang sedang login; null bila belum aktif atau belum login.
create or replace function public.peran()
returns text language sql stable security definer set search_path = ''
as $$
  select role from public.profiles where id = auth.uid() and aktif
$$;

-- 2. Data aplikasi: satu baris per catatan, isi sebagai JSON ------------------
create table if not exists public.records (
  id uuid primary key default gen_random_uuid(),
  tabel text not null check (tabel in (
    'proyek', 'tahap', 'masalah', 'klien', 'tim',
    'kontrak', 'termin', 'vendor', 'hutang_lain', 'sdm', 'aset', 'legal')),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
create index if not exists records_tabel_idx on public.records (tabel);

create or replace function public.catat_perubahan()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

drop trigger if exists records_catat_perubahan on public.records;
create trigger records_catat_perubahan
  before insert or update on public.records
  for each row execute function public.catat_perubahan();

-- 3. Row Level Security -------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.records enable row level security;

-- Profil: tiap orang melihat profilnya sendiri; admin melihat dan mengubah semua.
drop policy if exists profiles_baca on public.profiles;
create policy profiles_baca on public.profiles for select to authenticated
  using (id = auth.uid() or public.peran() = 'admin');

drop policy if exists profiles_ubah on public.profiles;
create policy profiles_ubah on public.profiles for update to authenticated
  using (public.peran() = 'admin')
  with check (public.peran() = 'admin');

-- Data: admin mengakses semua tabel; arsitek hanya tabel proyek (tanpa keuangan, SDM, aset, legal).
drop policy if exists records_akses on public.records;
create policy records_akses on public.records for all to authenticated
  using (
    public.peran() = 'admin'
    or (public.peran() = 'arsitek' and tabel in ('proyek', 'tahap', 'masalah', 'klien', 'tim'))
  )
  with check (
    public.peran() = 'admin'
    or (public.peran() = 'arsitek' and tabel in ('proyek', 'tahap', 'masalah', 'klien', 'tim'))
  );

-- Tamu yang belum login tidak mendapat akses apa pun.
revoke all on public.profiles, public.records from anon;
grant usage on schema public to authenticated;
grant execute on function public.peran() to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.records to authenticated;

-- 4. Admin pertama ----------------------------------------------------------
-- Bila sudah ada yang mendaftar sebelum aturan di atas dipasang dan belum ada admin,
-- pendaftar paling awal dijadikan admin.
update public.profiles set role = 'admin', aktif = true
where id = (select id from public.profiles order by created_at limit 1)
  and not exists (select 1 from public.profiles where role = 'admin' and aktif);
