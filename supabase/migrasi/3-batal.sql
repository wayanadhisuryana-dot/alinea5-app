-- Alinea 5 — Pembatalan migrasi Tahap 3 (3-kontrak.sql).
-- Mengembalikan database seperti setelah Tahap 2. Tidak ada data yang hilang:
--  - isi tabel kontrak_klien, kontrak_addendum, termin, penerimaan, dan jurnal penerimaan/invoice disalin ke
--    skema arsip_tahap3 lebih dulu, baru tabelnya dilepas;
--  - data kontrak/termin bentuk lama yang diarsipkan saat migrasi dikembalikan ke public.records.
-- File di tempat bukti keuangan (folder kontrak/ dan termin/) tidak disentuh.
-- Kolom pengaturan baru di tabel akuntansi (tarif PPN, format invoice, jatuh tempo) dibiarkan; tidak dipakai Tahap 2.

create schema if not exists arsip_tahap3;
create table if not exists arsip_tahap3.kontrak_klien as select * from public.kontrak_klien where false;
create table if not exists arsip_tahap3.kontrak_addendum as select * from public.kontrak_addendum where false;
create table if not exists arsip_tahap3.termin as select * from public.termin where false;
create table if not exists arsip_tahap3.penerimaan as select * from public.penerimaan where false;
create table if not exists arsip_tahap3.jurnal as select * from public.jurnal where false;
create table if not exists arsip_tahap3.jurnal_baris as select * from public.jurnal_baris where false;
do $$ declare t text; begin
  foreach t in array array['kontrak_klien', 'kontrak_addendum', 'termin', 'penerimaan', 'jurnal', 'jurnal_baris'] loop
    execute format('alter table arsip_tahap3.%I enable row level security', t);
  end loop;
end $$;
revoke all on schema arsip_tahap3 from anon, authenticated;
insert into arsip_tahap3.kontrak_klien select * from public.kontrak_klien x where not exists (select 1 from arsip_tahap3.kontrak_klien a where a.id = x.id);
insert into arsip_tahap3.kontrak_addendum select * from public.kontrak_addendum x where not exists (select 1 from arsip_tahap3.kontrak_addendum a where a.id = x.id);
insert into arsip_tahap3.termin select * from public.termin x where not exists (select 1 from arsip_tahap3.termin a where a.id = x.id);
insert into arsip_tahap3.penerimaan select * from public.penerimaan x where not exists (select 1 from arsip_tahap3.penerimaan a where a.id = x.id);
insert into arsip_tahap3.jurnal select * from public.jurnal x where x.sumber in ('penerimaan', 'invoice') and not exists (select 1 from arsip_tahap3.jurnal a where a.id = x.id);
insert into arsip_tahap3.jurnal_baris select b.* from public.jurnal_baris b join public.jurnal j on j.id = b.jurnal_id
  where j.sumber in ('penerimaan', 'invoice') and not exists (select 1 from arsip_tahap3.jurnal_baris a where a.id = b.id);

-- Jurnal penerimaan/invoice dilepas tanpa pemeriksaan tutup buku (sudah diarsipkan di atas).
select set_config('alinea.pulihkan', 'ya', true);
delete from public.jurnal where sumber in ('penerimaan', 'invoice');
select set_config('alinea.pulihkan', '', true);

drop table if exists public.penerimaan;
drop table if exists public.termin;
drop table if exists public.kontrak_addendum;
drop table if exists public.kontrak_klien;

drop function if exists public.simpan_kontrak(uuid, jsonb, jsonb);
drop function if exists public.hapus_kontrak(uuid);
drop function if exists public.simpan_addendum(uuid, uuid, jsonb, jsonb);
drop function if exists public.hapus_addendum(uuid);
drop function if exists public.terbitkan_invoice(uuid, date, date, uuid);
drop function if exists public.batal_invoice(uuid);
drop function if exists public.simpan_penerimaan(uuid, jsonb);
drop function if exists public.hapus_penerimaan(uuid);
drop function if exists public.nomor_invoice_berikut(date);
drop function if exists public.jurnal_invoice(uuid);
drop function if exists public.penerimaan_setelah();
drop function if exists public.susun_retensi(uuid);
drop function if exists public.nomori_termin(uuid);
drop function if exists public.cek_total_termin(uuid);
drop function if exists public.hitung_termin();
drop function if exists public.bagi(bigint, bigint, bigint);
drop function if exists public.uji_tahap3();

delete from public.pemetaan_jurnal where jenis like 'terima\_%' or jenis like 'invoice\_%';
alter table public.jurnal drop constraint if exists jurnal_sumber_check;
alter table public.jurnal add constraint jurnal_sumber_check check (sumber in ('manual', 'saldo_awal', 'kas', 'transfer'));

drop policy if exists bukti_kontrak_baca on storage.objects;
drop policy if exists bukti_kontrak_tambah on storage.objects;
drop policy if exists bukti_kontrak_hapus on storage.objects;

-- Data kontrak/termin bentuk lama kembali ke tempatnya.
insert into public.records select * from arsip_tahap3.records a where not exists (select 1 from public.records r where r.id = a.id);

-- Fungsi pulihkan cadangan seperti di Tahap 1.
create or replace function public.pulihkan_keuangan(p jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  r jsonb;
  a record;
begin
  if not public.super_admin() then raise exception 'Hanya super admin yang bisa memulihkan cadangan.'; end if;
  perform set_config('alinea.pulihkan', 'ya', true);
  delete from public.tutup_buku;
  delete from public.jurnal where sumber = 'manual';
  delete from public.kas_transaksi;
  delete from public.transfer;
  delete from public.rekening;
  for a in select id from public.akun where not standar and not sistem and rekening_id is null order by length(kode) desc, kode desc loop
    delete from public.akun where id = a.id;
  end loop;
  insert into public.rekening select * from jsonb_populate_recordset(null::public.rekening, coalesce(p -> 'rekening', '[]'::jsonb));
  for r in select value from jsonb_array_elements(coalesce(p -> 'akun', '[]'::jsonb))
           where not coalesce((value ->> 'standar')::boolean, false) and not coalesce((value ->> 'sistem')::boolean, false)
             and value ->> 'rekening_id' is null
           order by length(value ->> 'kode'), value ->> 'kode' loop
    insert into public.akun (id, kode, nama, induk_id, golongan, aktif)
    values ((r ->> 'id')::uuid, r ->> 'kode', r ->> 'nama', public.peta_akun(p, r ->> 'induk_id'), (r ->> 'golongan')::smallint,
      coalesce((r ->> 'aktif')::boolean, true));
  end loop;
  insert into public.kas_transaksi
  select * from jsonb_populate_recordset(null::public.kas_transaksi, (
    select coalesce(jsonb_agg(jsonb_set(x, '{akun_id}', to_jsonb(public.peta_akun(p, x ->> 'akun_id')))), '[]'::jsonb)
    from jsonb_array_elements(coalesce(p -> 'kas_transaksi', '[]'::jsonb)) x));
  insert into public.transfer select * from jsonb_populate_recordset(null::public.transfer, coalesce(p -> 'transfer', '[]'::jsonb));
  for r in select value from jsonb_array_elements(coalesce(p -> 'jurnal_manual', '[]'::jsonb)) loop
    insert into public.jurnal (id, tanggal, uraian, sumber, bukti) values ((r ->> 'id')::uuid, (r ->> 'tanggal')::date, r ->> 'uraian', 'manual', r -> 'bukti');
    insert into public.jurnal_baris (jurnal_id, akun_id, debit, kredit, proyek_kode, keterangan)
    select (r ->> 'id')::uuid, public.peta_akun(p, b ->> 'akun_id'), coalesce((b ->> 'debit')::bigint, 0), coalesce((b ->> 'kredit')::bigint, 0),
      b ->> 'proyek_kode', b ->> 'keterangan'
    from jsonb_array_elements(r -> 'baris') b;
  end loop;
  insert into public.tutup_buku (bulan) select (x ->> 'bulan')::date from jsonb_array_elements(coalesce(p -> 'tutup_buku', '[]'::jsonb)) x;
  if p ? 'akuntansi' then
    update public.akuntansi set basis = coalesce(p -> 'akuntansi' ->> 'basis', basis),
      bulan_awal_buku = coalesce((p -> 'akuntansi' ->> 'bulan_awal_buku')::smallint, bulan_awal_buku),
      batas_kapitalisasi = coalesce((p -> 'akuntansi' ->> 'batas_kapitalisasi')::bigint, batas_kapitalisasi);
  end if;
  perform set_config('alinea.pulihkan', '', true);
end $$;

select
  (select count(*) from information_schema.tables where table_schema = 'public'
     and table_name in ('kontrak_klien', 'kontrak_addendum', 'termin', 'penerimaan')) as tabel_tahap3_tersisa,   -- 0
  (select count(*) from arsip_tahap3.termin) as termin_diarsipkan,
  (select count(*) from public.records where tabel in ('kontrak', 'termin')) as data_lama_kembali;
