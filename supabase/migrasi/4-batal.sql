-- Alinea 5 — Pembatalan migrasi Tahap 4 (4-proyek.sql).
-- Mengembalikan database seperti setelah Tahap 3. Tidak ada data yang hilang:
--  - isi semua tabel Tahap 4 dan jurnal opname / pembayaran vendor / pembelian / pembayaran supplier disalin ke
--    skema arsip_tahap4 lebih dulu, baru tabelnya dilepas;
--  - riwayat harga otomatis dari pembelian / kontrak vendor juga disalin ke arsip_tahap4.records_harga sebelum dilepas;
--  - data Pihak Proyek bentuk lama yang diarsipkan saat migrasi dikembalikan ke public.records.
-- File di tempat bukti keuangan (folder pihak-proyek/ dan pembelian/) tidak disentuh.
-- Kolom batas pinjaman di tabel akuntansi dibiarkan; tidak dipakai Tahap 3.

create schema if not exists arsip_tahap4;
revoke all on schema arsip_tahap4 from anon, authenticated;
do $$
declare t text;
begin
  foreach t in array array['kontrak_vendor', 'kontrak_vendor_item', 'kontrak_vendor_termin', 'opname', 'pembayaran_vendor', 'pembelian', 'pembelian_baris', 'pembayaran_supplier', 'pinjaman_proyek', 'pengembalian_pinjaman', 'jurnal', 'jurnal_baris'] loop
    execute format('create table if not exists arsip_tahap4.%I as select * from public.%I where false', t, t);
    execute format('alter table arsip_tahap4.%I enable row level security', t);
  end loop;
  foreach t in array array['kontrak_vendor', 'kontrak_vendor_item', 'kontrak_vendor_termin', 'opname', 'pembayaran_vendor', 'pembelian', 'pembelian_baris', 'pembayaran_supplier', 'pinjaman_proyek', 'pengembalian_pinjaman'] loop
    execute format('insert into arsip_tahap4.%I select * from public.%I x where not exists (select 1 from arsip_tahap4.%I a where a.id = x.id)', t, t, t);
  end loop;
end $$;
insert into arsip_tahap4.jurnal select * from public.jurnal x
  where x.sumber in ('opname', 'bayar_vendor', 'pembelian', 'bayar_supplier') and not exists (select 1 from arsip_tahap4.jurnal a where a.id = x.id);
insert into arsip_tahap4.jurnal_baris select b.* from public.jurnal_baris b join public.jurnal j on j.id = b.jurnal_id
  where j.sumber in ('opname', 'bayar_vendor', 'pembelian', 'bayar_supplier') and not exists (select 1 from arsip_tahap4.jurnal_baris a where a.id = b.id);
create table if not exists arsip_tahap4.records_harga as select * from public.records where false;
alter table arsip_tahap4.records_harga enable row level security;
insert into arsip_tahap4.records_harga select * from public.records r
  where r.tabel = 'harga' and r.data ->> 'sumber' in ('Pembelian', 'Kontrak vendor') and r.data ? 'sumber_id'
    and not exists (select 1 from arsip_tahap4.records_harga a where a.id = r.id);

-- Jurnal Tahap 4 dilepas tanpa pemeriksaan tutup buku (sudah diarsipkan di atas).
select set_config('alinea.pulihkan', 'ya', true);
delete from public.jurnal where sumber in ('opname', 'bayar_vendor', 'pembelian', 'bayar_supplier');
delete from public.records where tabel = 'harga' and data ->> 'sumber' in ('Pembelian', 'Kontrak vendor') and data ? 'sumber_id';
drop table if exists public.pengembalian_pinjaman;
drop table if exists public.pinjaman_proyek;
drop table if exists public.pembayaran_supplier;
drop table if exists public.pembelian_baris;
drop table if exists public.pembelian;
drop table if exists public.pembayaran_vendor;
drop table if exists public.opname;
drop table if exists public.kontrak_vendor_termin;
drop table if exists public.kontrak_vendor_item;
drop table if exists public.kontrak_vendor;
select set_config('alinea.pulihkan', '', true);

drop function if exists public.simpan_kontrak_vendor(uuid, jsonb, jsonb, jsonb);
drop function if exists public.hapus_kontrak_vendor(uuid);
drop function if exists public.simpan_opname(uuid, jsonb);
drop function if exists public.hapus_opname(uuid);
drop function if exists public.opname_setelah();
drop function if exists public.simpan_bayar_vendor(uuid, jsonb);
drop function if exists public.hapus_bayar_vendor(uuid);
drop function if exists public.bayar_vendor_setelah();
drop function if exists public.simpan_pembelian(uuid, jsonb, jsonb);
drop function if exists public.hapus_pembelian(uuid);
drop function if exists public.jurnal_pembelian(uuid);
drop function if exists public.pembelian_setelah();
drop function if exists public.simpan_bayar_supplier(uuid, jsonb);
drop function if exists public.hapus_bayar_supplier(uuid);
drop function if exists public.bayar_supplier_setelah();
drop function if exists public.simpan_pinjaman(uuid, jsonb);
drop function if exists public.hapus_pinjaman(uuid);
drop function if exists public.simpan_pengembalian(uuid, jsonb);
drop function if exists public.hapus_pengembalian(uuid);
drop function if exists public.saldo_titipan_proyek(text, uuid);
drop function if exists public.nilai_opname(uuid, jsonb, uuid);
drop function if exists public.nilai_termin_vendor(uuid);
drop function if exists public.nilai_kontrak_vendor(uuid);
drop function if exists public.harga_otomatis(uuid, jsonb);
drop function if exists public.faktor_satuan(uuid, text);
drop function if exists public.pkp_pada(date);
drop function if exists public.uji_tahap4();

delete from public.pemetaan_jurnal where jenis like 'opname\_%' or jenis like 'bayar\_vendor\_%' or jenis like 'beli\_%' or jenis like 'bayar\_supplier\_%';
alter table public.jurnal drop constraint if exists jurnal_sumber_check;
alter table public.jurnal add constraint jurnal_sumber_check check (sumber in ('manual', 'saldo_awal', 'kas', 'transfer', 'penerimaan', 'invoice'));

-- Akses baca tabel kontrak dan rekening seperti di Tahap 3.
do $$
declare t text;
begin
  foreach t in array array['kontrak_klien', 'kontrak_addendum', 'termin', 'penerimaan'] loop
    execute format('drop policy if exists %I on public.%I', t || '_baca', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.hak(''kontrak'') is not null or public.hak(''termin'') is not null or public.hak(''kas'') is not null or public.hak(''jurnal'') is not null)', t || '_baca', t);
  end loop;
end $$;
drop policy if exists rekening_baca on public.rekening;
create policy rekening_baca on public.rekening for select to authenticated
  using (public.hak('kas') is not null or public.hak('jurnal') is not null or public.hak('pengaturan') is not null or public.hak('termin') is not null);
drop function if exists public.baca_keuangan_proyek();

drop policy if exists bukti_proyek_baca on storage.objects;
drop policy if exists bukti_proyek_tambah on storage.objects;
drop policy if exists bukti_proyek_hapus on storage.objects;

-- Data Pihak Proyek bentuk lama kembali ke tempatnya.
insert into public.records select * from arsip_tahap4.records a where not exists (select 1 from public.records r where r.id = a.id);

-- Fungsi pulihkan cadangan seperti di Tahap 3.
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
  delete from public.penerimaan;
  delete from public.jurnal where sumber = 'invoice';
  delete from public.kontrak_klien;
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
  if p ? 'akuntansi' then
    update public.akuntansi set basis = coalesce(p -> 'akuntansi' ->> 'basis', basis),
      bulan_awal_buku = coalesce((p -> 'akuntansi' ->> 'bulan_awal_buku')::smallint, bulan_awal_buku),
      batas_kapitalisasi = coalesce((p -> 'akuntansi' ->> 'batas_kapitalisasi')::bigint, batas_kapitalisasi),
      tarif_ppn_bp = coalesce((p -> 'akuntansi' ->> 'tarif_ppn_bp')::int, tarif_ppn_bp),
      format_invoice = coalesce(p -> 'akuntansi' ->> 'format_invoice', format_invoice),
      jatuh_tempo_hari = coalesce((p -> 'akuntansi' ->> 'jatuh_tempo_hari')::int, jatuh_tempo_hari);
  end if;
  insert into public.kontrak_klien select * from jsonb_populate_recordset(null::public.kontrak_klien, coalesce(p -> 'kontrak_klien', '[]'::jsonb));
  insert into public.kontrak_addendum select * from jsonb_populate_recordset(null::public.kontrak_addendum, coalesce(p -> 'kontrak_addendum', '[]'::jsonb));
  insert into public.termin select * from jsonb_populate_recordset(null::public.termin, coalesce(p -> 'termin', '[]'::jsonb));
  for a in select id from public.termin where no_invoice is not null loop
    perform public.jurnal_invoice(a.id);
  end loop;
  insert into public.penerimaan
  select * from jsonb_populate_recordset(null::public.penerimaan, coalesce(p -> 'penerimaan', '[]'::jsonb)) x order by x.dibuat, x.id;
  insert into public.tutup_buku (bulan) select (x ->> 'bulan')::date from jsonb_array_elements(coalesce(p -> 'tutup_buku', '[]'::jsonb)) x;
  perform set_config('alinea.pulihkan', '', true);
end $$;

select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('kontrak_vendor', 'opname', 'pembelian', 'pinjaman_proyek')) as tabel_tahap4_tersisa, -- 0
  (select count(*) from arsip_tahap4.opname) as opname_diarsipkan,
  (select count(*) from public.records where tabel = 'vendor') as data_lama_kembali;
