-- Alinea 5 — Pembatalan migrasi Tahap 5 (5-aset.sql).
-- Mengembalikan database seperti setelah Tahap 4. Tidak ada data yang hilang:
--  - isi semua tabel Tahap 5 dan jurnal perolehan / penyusutan / pelepasan / servis aset disalin ke skema arsip_tahap5 lebih dulu,
--    baru tabelnya dilepas;
--  - data Aset bentuk lama yang diarsipkan saat migrasi dikembalikan ke public.records.
-- Dibiarkan (tidak dipakai Tahap 4, tidak mengganggu): akun 4-4 Laba Pelepasan Aset, kolom akuntansi.metode_fiskal,
-- kolom barang_modal di kas_transaksi dan pembelian. File di folder aset/ tidak disentuh.

create schema if not exists arsip_tahap5;
revoke all on schema arsip_tahap5 from anon, authenticated;
do $$
declare t text;
begin
  foreach t in array array['kelompok_fiskal', 'aset_kategori', 'aset_lokasi', 'aset', 'aset_mutasi', 'aset_servis', 'aset_dokumen', 'penyusutan_bulan', 'penyusutan_aset', 'jurnal', 'jurnal_baris'] loop
    if to_regclass('public.' || t) is not null then
      execute format('create table if not exists arsip_tahap5.%I as select * from public.%I where false', t, t);
      execute format('alter table arsip_tahap5.%I enable row level security', t);
    end if;
  end loop;
  foreach t in array array['kelompok_fiskal', 'aset_kategori', 'aset_lokasi', 'aset', 'aset_mutasi', 'aset_servis', 'aset_dokumen', 'penyusutan_bulan'] loop
    if to_regclass('public.' || t) is not null then
      execute format('insert into arsip_tahap5.%I select * from public.%I x where not exists (select 1 from arsip_tahap5.%I a where a.id = x.id)', t, t, t);
    end if;
  end loop;
  if to_regclass('public.penyusutan_aset') is not null then
    insert into arsip_tahap5.penyusutan_aset select * from public.penyusutan_aset x
      where not exists (select 1 from arsip_tahap5.penyusutan_aset a where a.bulan_id = x.bulan_id and a.aset_id = x.aset_id);
  end if;
end $$;
insert into arsip_tahap5.jurnal select * from public.jurnal x
  where x.sumber in ('aset', 'pelepasan_aset', 'servis_aset', 'penyusutan') and not exists (select 1 from arsip_tahap5.jurnal a where a.id = x.id);
insert into arsip_tahap5.jurnal_baris select b.* from public.jurnal_baris b join public.jurnal j on j.id = b.jurnal_id
  where j.sumber in ('aset', 'pelepasan_aset', 'servis_aset', 'penyusutan') and not exists (select 1 from arsip_tahap5.jurnal_baris a where a.id = b.id);

-- Jurnal Tahap 5 dilepas tanpa pemeriksaan tutup buku (sudah diarsipkan di atas).
select set_config('alinea.pulihkan', 'ya', true);
delete from public.jurnal where sumber in ('aset', 'pelepasan_aset', 'servis_aset', 'penyusutan');
drop table if exists public.penyusutan_aset;
drop table if exists public.penyusutan_bulan;
drop table if exists public.aset_dokumen;
drop table if exists public.aset_servis;
drop table if exists public.aset_mutasi;
drop table if exists public.aset;
drop table if exists public.aset_lokasi;
drop table if exists public.aset_kategori;
drop table if exists public.kelompok_fiskal;
select set_config('alinea.pulihkan', '', true);

drop function if exists public.simpan_aset(uuid, jsonb);
drop function if exists public.hapus_aset(uuid);
drop function if exists public.simpan_servis_aset(uuid, jsonb);
drop function if exists public.hapus_servis_aset(uuid);
drop function if exists public.bukukan_penyusutan(date);
drop function if exists public.tandai_barang_modal(uuid, boolean);
drop function if exists public.jurnal_aset(uuid);
drop function if exists public.jurnal_pelepasan_aset(uuid);
drop function if exists public.jurnal_servis_aset(uuid);
drop function if exists public.jurnal_penyusutan(uuid);
drop function if exists public.akumulasi_aset(uuid, integer);
drop function if exists public.perolehan_aset_pada(uuid, date);
drop function if exists public.idx_bulan(date);
drop function if exists public.bulan_idx(integer);

delete from public.pemetaan_jurnal where jenis in ('aset_perolehan', 'aset_ppn', 'aset_kas', 'aset_hutang', 'susut_beban', 'susut_akumulasi',
  'lepas_akumulasi', 'lepas_kas', 'lepas_rugi', 'lepas_laba', 'lepas_aset', 'servis_beban', 'servis_aset', 'servis_kas');
alter table public.jurnal drop constraint if exists jurnal_sumber_check;
alter table public.jurnal add constraint jurnal_sumber_check check (sumber in ('manual', 'saldo_awal', 'kas', 'transfer', 'penerimaan', 'invoice',
  'opname', 'bayar_vendor', 'pembelian', 'bayar_supplier'));

-- Jurnal otomatis seperti di Tahap 1 (tanpa akun per baris).
create or replace function public.jurnal_otomatis(p_sumber text, p_sumber_id uuid, p_tanggal date, p_uraian text,
  p_baris jsonb, p_isi jsonb, p_proyek text default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  jid uuid;
  b jsonb;
  m public.pemetaan_jurnal;
  jml bigint;
  akun_id uuid;
begin
  delete from public.jurnal where sumber = p_sumber and sumber_id = p_sumber_id;
  if p_tanggal is null or p_baris is null then return; end if;
  if not exists (select 1 from jsonb_array_elements(p_baris) x where (x ->> 'jumlah')::bigint <> 0) then return; end if;
  insert into public.jurnal (tanggal, uraian, sumber, sumber_id) values (p_tanggal, p_uraian, p_sumber, p_sumber_id) returning id into jid;
  for b in select * from jsonb_array_elements(p_baris) loop
    jml := (b ->> 'jumlah')::bigint;
    continue when jml = 0;
    for m in select * from public.pemetaan_jurnal where jenis = b ->> 'jenis' order by urut loop
      akun_id := case when m.akun ~ '^[0-9]' then public.akun_kode(m.akun) else (p_isi ->> m.akun)::uuid end;
      if akun_id is null then raise exception 'Pemetaan jurnal % (%): akun % tidak ditemukan.', m.jenis, m.sisi, m.akun; end if;
      -- Jumlah minus membalik sisi (mis. saldo awal rekening yang minus).
      insert into public.jurnal_baris (jurnal_id, akun_id, debit, kredit, proyek_kode)
      values (jid, akun_id,
        case when (m.sisi = 'D') = (jml > 0) then abs(jml) else 0 end,
        case when (m.sisi = 'K') = (jml > 0) then abs(jml) else 0 end,
        p_proyek);
    end loop;
  end loop;
end $$;
revoke execute on function public.jurnal_otomatis(text, uuid, date, text, jsonb, jsonb, text) from public, anon, authenticated;

-- Akses baca rekening seperti di Tahap 4.
drop policy if exists rekening_baca on public.rekening;
create policy rekening_baca on public.rekening for select to authenticated
  using (public.hak('kas') is not null or public.hak('jurnal') is not null or public.hak('pengaturan') is not null or public.baca_keuangan_proyek());

drop policy if exists bukti_aset_baca on storage.objects;
drop policy if exists bukti_aset_tambah on storage.objects;
drop policy if exists bukti_aset_hapus on storage.objects;

-- Data Aset bentuk lama kembali ke tempatnya.
insert into public.records select * from arsip_tahap5.records a where not exists (select 1 from public.records r where r.id = a.id);

-- Fungsi pulihkan cadangan seperti di Tahap 4.
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
  delete from public.pengembalian_pinjaman;
  delete from public.pinjaman_proyek;
  delete from public.pembayaran_supplier;
  delete from public.pembelian;
  delete from public.pembayaran_vendor;
  delete from public.opname;
  delete from public.kontrak_vendor;
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
      jatuh_tempo_hari = coalesce((p -> 'akuntansi' ->> 'jatuh_tempo_hari')::int, jatuh_tempo_hari),
      batas_pinjam_titipan_persen = (p -> 'akuntansi' ->> 'batas_pinjam_titipan_persen')::int;
  end if;
  insert into public.kontrak_klien select * from jsonb_populate_recordset(null::public.kontrak_klien, coalesce(p -> 'kontrak_klien', '[]'::jsonb));
  insert into public.kontrak_addendum select * from jsonb_populate_recordset(null::public.kontrak_addendum, coalesce(p -> 'kontrak_addendum', '[]'::jsonb));
  insert into public.termin select * from jsonb_populate_recordset(null::public.termin, coalesce(p -> 'termin', '[]'::jsonb));
  for a in select id from public.termin where no_invoice is not null loop
    perform public.jurnal_invoice(a.id);
  end loop;
  insert into public.penerimaan
  select * from jsonb_populate_recordset(null::public.penerimaan, coalesce(p -> 'penerimaan', '[]'::jsonb)) x order by x.dibuat, x.id;
  -- Tahap 4 (jurnal opname / pembayaran / pembelian dibuat ulang oleh pemicu).
  insert into public.kontrak_vendor select * from jsonb_populate_recordset(null::public.kontrak_vendor, coalesce(p -> 'kontrak_vendor', '[]'::jsonb));
  insert into public.kontrak_vendor_item select * from jsonb_populate_recordset(null::public.kontrak_vendor_item, coalesce(p -> 'kontrak_vendor_item', '[]'::jsonb));
  insert into public.kontrak_vendor_termin select * from jsonb_populate_recordset(null::public.kontrak_vendor_termin, coalesce(p -> 'kontrak_vendor_termin', '[]'::jsonb));
  insert into public.opname select * from jsonb_populate_recordset(null::public.opname, coalesce(p -> 'opname', '[]'::jsonb)) x order by x.dibuat, x.id;
  insert into public.pembayaran_vendor select * from jsonb_populate_recordset(null::public.pembayaran_vendor, coalesce(p -> 'pembayaran_vendor', '[]'::jsonb));
  insert into public.pembelian select * from jsonb_populate_recordset(null::public.pembelian, coalesce(p -> 'pembelian', '[]'::jsonb));
  insert into public.pembelian_baris select * from jsonb_populate_recordset(null::public.pembelian_baris, coalesce(p -> 'pembelian_baris', '[]'::jsonb));
  insert into public.pembayaran_supplier select * from jsonb_populate_recordset(null::public.pembayaran_supplier, coalesce(p -> 'pembayaran_supplier', '[]'::jsonb));
  insert into public.pinjaman_proyek select * from jsonb_populate_recordset(null::public.pinjaman_proyek, coalesce(p -> 'pinjaman_proyek', '[]'::jsonb));
  insert into public.pengembalian_pinjaman select * from jsonb_populate_recordset(null::public.pengembalian_pinjaman, coalesce(p -> 'pengembalian_pinjaman', '[]'::jsonb));
  insert into public.tutup_buku (bulan) select (x ->> 'bulan')::date from jsonb_array_elements(coalesce(p -> 'tutup_buku', '[]'::jsonb)) x;
  perform set_config('alinea.pulihkan', '', true);
end $$;

select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('kelompok_fiskal', 'aset_kategori', 'aset_lokasi', 'aset', 'aset_mutasi', 'aset_servis', 'aset_dokumen', 'penyusutan_bulan', 'penyusutan_aset')) as tabel_tahap5_tersisa,  -- 0
  (select count(*) from arsip_tahap5.aset) as aset_diarsipkan,
  (select count(*) from public.records where tabel = 'aset') as data_aset_lama_kembali;
