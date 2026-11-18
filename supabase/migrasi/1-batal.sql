-- Alinea 5 — Pembatalan migrasi Tahap 1 (1-fondasi.sql).
-- Mengembalikan aturan akses seperti Tahap 0B. Data keuangan TIDAK dihapus: tabelnya dipindah ke
-- skema arsip_tahap1 (hapus manual bila sudah yakin). Data operasional (records) tidak disentuh.

create schema if not exists arsip_tahap1;

-- Lepas pemicu dan fungsi Tahap 1 (pemicu ikut terlepas lewat cascade).
drop function if exists public.catat_audit() cascade;
drop function if exists public.jaga_tutup_buku() cascade;
drop function if exists public.jaga_akun() cascade;
drop function if exists public.jaga_baris_jurnal() cascade;
drop function if exists public.cek_jurnal_seimbang() cascade;
drop function if exists public.rekening_setelah() cascade;
drop function if exists public.rekening_sebelum_hapus() cascade;
drop function if exists public.kas_setelah() cascade;
drop function if exists public.transfer_setelah() cascade;
drop function if exists public.jaga_akuntansi() cascade;
drop function if exists public.jaga_super_admin() cascade;
drop function if exists public.jurnal_otomatis(text, uuid, date, text, jsonb, jsonb, text);
drop function if exists public.simpan_jurnal_manual(uuid, date, text, jsonb, jsonb);
drop function if exists public.hapus_jurnal_manual(uuid);
drop function if exists public.tutup_bulan(date);
drop function if exists public.buka_bulan(date, text);
drop function if exists public.pulihkan_keuangan(jsonb);
drop function if exists public.peta_akun(jsonb, text);
drop function if exists public.cek_bulan_terbuka(date);
drop function if exists public.bulan_terkunci(date);
drop function if exists public.nama_bulan(date);
drop function if exists public.hari_ini();
drop function if exists public.akun_rekening(uuid);
drop function if exists public.akun_kode(text);
drop function if exists public.identitas_aplikasi();

-- Pindahkan tabel Tahap 1 (beserta isinya) ke arsip.
do $$
declare t text;
begin
  foreach t in array array['notifikasi_status', 'audit_log', 'akuntansi', 'tutup_buku_riwayat', 'tutup_buku', 'pemetaan_jurnal',
    'jurnal_baris', 'jurnal', 'transfer', 'kas_transaksi', 'rekening', 'akun'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop table if exists arsip_tahap1.%I', t);
      execute format('alter table public.%I set schema arsip_tahap1', t);
    end if;
  end loop;
end $$;
revoke all on all tables in schema arsip_tahap1 from anon, authenticated;

-- Aturan akses lama (Tahap 0B).
drop policy if exists records_baca on public.records;
drop policy if exists records_tambah on public.records;
drop policy if exists records_ubah on public.records;
drop policy if exists records_hapus on public.records;
create policy records_admin on public.records for all to authenticated
  using (public.peran() = 'admin') with check (public.peran() = 'admin');
create policy records_arsitek on public.records for all to authenticated
  using (public.peran() = 'arsitek' and tabel in ('proyek', 'tahap', 'masalah', 'tim'))
  with check (public.peran() = 'arsitek' and tabel in ('proyek', 'tahap', 'masalah', 'tim'));
create policy records_arsitek_baca_klien on public.records for select to authenticated
  using (public.peran() = 'arsitek' and tabel = 'klien');
create policy records_baca_pengaturan on public.records for select to authenticated
  using (public.peran() is not null and tabel = 'pengaturan');

drop policy if exists profiles_baca on public.profiles;
create policy profiles_baca on public.profiles for select to authenticated
  using (id = auth.uid() or public.peran() = 'admin');
drop policy if exists profiles_ubah on public.profiles;
create policy profiles_ubah on public.profiles for update to authenticated
  using (public.peran() = 'admin') with check (public.peran() = 'admin');

drop policy if exists perusahaan_ubah on public.perusahaan;
drop policy if exists perusahaan_baca on public.perusahaan;
create policy perusahaan_baca on public.perusahaan for select to authenticated using (public.peran() is not null);

drop policy if exists dokumen_sdm_baca on storage.objects;
drop policy if exists dokumen_sdm_ubah on storage.objects;
drop policy if exists bukti_keuangan_baca on storage.objects;
drop policy if exists bukti_keuangan_tambah on storage.objects;
drop policy if exists bukti_keuangan_hapus on storage.objects;
-- File bukti di bucket bukti-keuangan dibiarkan (tidak dihapus).
create policy dokumen_sdm_admin on storage.objects for all to authenticated
  using (bucket_id = 'dokumen-sdm' and public.peran() = 'admin')
  with check (bucket_id = 'dokumen-sdm' and public.peran() = 'admin');

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

-- Super admin kembali menjadi admin biasa; kolom peran dilepas (tabel peran ikut ke arsip).
update public.profiles set role = 'admin' where super_admin;
alter table public.profiles drop column if exists peran_id;
alter table public.profiles drop column if exists super_admin;
drop function if exists public.hak(text);
drop function if exists public.khusus(text);
drop function if exists public.super_admin();
drop function if exists public.pengguna_aktif();
drop function if exists public.menu_tabel(text);
do $$
begin
  if to_regclass('public.peran') is not null then
    drop table if exists arsip_tahap1.peran;
    alter table public.peran set schema arsip_tahap1;
  end if;
end $$;
-- Kolom profil perusahaan dibiarkan (tidak dipakai versi lama, tidak mengganggu).

select (select count(*) from public.records) as jumlah_data,
  (select count(*) from information_schema.tables where table_schema = 'arsip_tahap1') as tabel_diarsip;
