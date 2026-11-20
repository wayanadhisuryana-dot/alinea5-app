-- Alinea 5 — Pembatalan migrasi Tahap 6 (6-hutang.sql).
-- Mengembalikan database seperti setelah Tahap 5. Tidak ada data yang hilang:
--  - isi tabel kreditur, hutang, jadwal angsuran, pembayaran, jurnal hutang, dan uang muka aset disalin ke skema arsip_tahap6 lebih dulu,
--    baru tabel / kolomnya dilepas;
--  - data Hutang Lain bentuk lama yang diarsipkan saat migrasi dikembalikan ke public.records.
-- Aset kredit / leasing yang punya uang muka dijurnal ulang seperti Tahap 5 (seluruh nilai ke 2-8). File di folder hutang/ tidak disentuh.

create schema if not exists arsip_tahap6;
revoke all on schema arsip_tahap6 from anon, authenticated;
do $$
declare t text;
begin
  foreach t in array array['kreditur', 'hutang', 'hutang_angsuran', 'hutang_bayar', 'jurnal', 'jurnal_baris'] loop
    if to_regclass('public.' || t) is not null then
      execute format('create table if not exists arsip_tahap6.%I as select * from public.%I where false', t, t);
      execute format('alter table arsip_tahap6.%I enable row level security', t);
    end if;
  end loop;
  foreach t in array array['kreditur', 'hutang', 'hutang_angsuran', 'hutang_bayar'] loop
    if to_regclass('public.' || t) is not null then
      execute format('insert into arsip_tahap6.%I select * from public.%I x where not exists (select 1 from arsip_tahap6.%I a where a.id = x.id)', t, t, t);
    end if;
  end loop;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'aset' and column_name = 'uang_muka') then
    create table if not exists arsip_tahap6.aset_uang_muka (id uuid primary key, uang_muka bigint, rekening_id uuid, hutang_id uuid);
    alter table arsip_tahap6.aset_uang_muka enable row level security;
    insert into arsip_tahap6.aset_uang_muka select id, uang_muka, rekening_id, hutang_id from public.aset where uang_muka > 0 or hutang_id is not null on conflict (id) do nothing;
  end if;
end $$;
insert into arsip_tahap6.jurnal select * from public.jurnal x
  where x.sumber in ('hutang', 'bayar_hutang') and not exists (select 1 from arsip_tahap6.jurnal a where a.id = x.id);
insert into arsip_tahap6.jurnal_baris select b.* from public.jurnal_baris b join public.jurnal j on j.id = b.jurnal_id
  where j.sumber in ('hutang', 'bayar_hutang') and not exists (select 1 from arsip_tahap6.jurnal_baris a where a.id = b.id);

-- Jurnal Tahap 6 dilepas tanpa pemeriksaan tutup buku (sudah diarsipkan di atas).
select set_config('alinea.pulihkan', 'ya', true);
delete from public.jurnal where sumber in ('hutang', 'bayar_hutang');
drop function if exists public.simpan_kreditur(uuid, jsonb);
drop function if exists public.simpan_hutang(uuid, jsonb, jsonb);
drop function if exists public.hapus_hutang(uuid);
drop function if exists public.simpan_jadwal_hutang(uuid, jsonb, text);
drop function if exists public.isi_jadwal_hutang(uuid, jsonb, text);
drop function if exists public.simpan_bayar_hutang(uuid, jsonb);
drop function if exists public.hapus_bayar_hutang(uuid);
drop function if exists public.jurnal_hutang(uuid);
drop function if exists public.jurnal_bayar_hutang(uuid);
drop function if exists public.sisa_pokok_hutang(uuid, uuid);
drop function if exists public.tgl_jurnal_hutang(public.hutang);
drop function if exists public.akun_hutang(text, boolean);
drop table if exists public.hutang_bayar;
drop table if exists public.hutang_angsuran;
drop table if exists public.hutang;
drop table if exists public.kreditur;

-- Aset: tautan hutang dikosongkan, uang muka dilepas (rekening hanya untuk cara Tunai seperti Tahap 5).
update public.aset set hutang_id = null where hutang_id is not null;
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'aset' and column_name = 'uang_muka') then
    update public.aset set rekening_id = null where cara in ('kredit', 'leasing') and rekening_id is not null;
    alter table public.aset drop constraint if exists aset_uang_muka_cek;
    alter table public.aset drop column uang_muka;
  end if;
end $$;

-- Fungsi aset dan pulihkan cadangan seperti di Tahap 5.
create or replace function public.jurnal_aset(p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare a public.aset; k public.aset_kategori;
begin
  select * into a from public.aset where id = p_id;
  if a.id is null then perform public.jurnal_otomatis('aset', p_id, null, null, null, null); return; end if;
  select * into k from public.aset_kategori where id = a.kategori_id;
  if a.cara = 'saldo_awal' then
    -- Aset lama: tidak ada uang keluar. D aset / K akumulasi sebelumnya / K 3-2-01 Ekuitas saldo awal (nilai buku).
    perform public.jurnal_otomatis('aset', a.id, a.tgl_saldo_awal, 'Saldo awal aset ' || a.kode || ' ' || a.nama,
      jsonb_build_array(jsonb_build_object('jenis', 'aset_perolehan', 'jumlah', a.nilai_perolehan),
        jsonb_build_object('jenis', 'aset_saldo_akumulasi', 'jumlah', a.akumulasi_awal),
        jsonb_build_object('jenis', 'aset_saldo_ekuitas', 'jumlah', a.nilai_perolehan - a.akumulasi_awal)),
      jsonb_build_object('AKUN_ASET', k.akun_aset_id, 'AKUN_AKUMULASI', k.akun_akumulasi_id));
    return;
  end if;
  perform public.jurnal_otomatis('aset', a.id, a.tgl_perolehan, 'Perolehan aset ' || a.kode || ' ' || a.nama,
    jsonb_build_array(jsonb_build_object('jenis', 'aset_perolehan', 'jumlah', a.nilai_perolehan),
      jsonb_build_object('jenis', 'aset_ppn', 'jumlah', case when a.ppn_kredit then a.ppn else 0 end),
      jsonb_build_object('jenis', case when a.cara = 'tunai' then 'aset_kas' else 'aset_hutang' end, 'jumlah', a.harga + a.biaya_tambahan - a.diskon + a.ppn)),
    jsonb_build_object('AKUN_ASET', k.akun_aset_id, 'REKENING', public.akun_rekening(a.rekening_id)));
end $$;

create or replace function public.simpan_aset(p_id uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  lama public.aset;
  baru public.aset;
  kat public.aset_kategori;
  v_id uuid := p_id;
  v_tgl date := nullif(p ->> 'tgl_perolehan', '')::date;
  v_harga bigint := coalesce(nullif(p ->> 'harga', '')::bigint, -1);
  v_ppn bigint := coalesce(nullif(p ->> 'ppn', '')::bigint, 0);
  v_bt bigint := coalesce(nullif(p ->> 'biaya_tambahan', '')::bigint, 0);
  v_diskon bigint := coalesce(nullif(p ->> 'diskon', '')::bigint, 0);
  v_kredit boolean := coalesce((p ->> 'ppn_kredit')::boolean, false);
  v_cara text := p ->> 'cara';
  v_status text := coalesce(nullif(p ->> 'status', ''), 'Aktif');
  v_kondisi text := coalesce(nullif(p ->> 'kondisi', ''), 'Baik');
  v_nilai bigint;
  v_mulai date; v_umur int; v_residu bigint;
  v_lepas date; v_jual bigint; v_rek_jual uuid; v_ppn_jual bigint := 0;
  v_saldo date;
  v_sup_id uuid; v_sup_nama text; v_pem_id uuid; v_pem_nama text; v_lok_id uuid;
  v_kode text;
  v_batas bigint;
  v_lokasi_lama text; v_lokasi_baru text;
  v_beli_berubah boolean; v_lepas_berubah boolean;
begin
  if public.hak('aset') is distinct from 'ubah' then raise exception 'Anda tidak punya hak mengubah data aset.'; end if;
  if v_id is not null then
    select * into lama from public.aset where id = v_id for update;
    if lama.id is null then raise exception 'Aset tidak ditemukan.'; end if;
  end if;
  if btrim(coalesce(p ->> 'nama', '')) = '' then raise exception 'Nama aset wajib diisi.'; end if;
  select * into kat from public.aset_kategori where id = nullif(p ->> 'kategori_id', '')::uuid;
  if kat.id is null or (not kat.aktif and kat.id is distinct from lama.kategori_id) then raise exception 'Kategori aset wajib dipilih (kategori aktif).'; end if;
  if lama.id is not null and kat.id <> lama.kategori_id
     and (exists (select 1 from public.penyusutan_aset where aset_id = lama.id) or exists (select 1 from public.aset_servis where aset_id = lama.id)) then
    raise exception 'Kategori tidak bisa diubah: aset ini sudah punya penyusutan atau servis yang dibukukan.';
  end if;
  if v_tgl is null then raise exception 'Tanggal perolehan wajib diisi.'; end if;
  if v_harga < 0 then raise exception 'Harga sebelum PPN wajib diisi (rupiah utuh, tidak minus).'; end if;
  if v_ppn < 0 or v_bt < 0 or v_diskon < 0 then raise exception 'PPN, biaya tambahan, dan diskon tidak boleh minus.'; end if;
  if v_ppn = 0 then v_kredit := false; end if;
  if v_kredit and coalesce(v_cara, '') <> 'saldo_awal' and not public.pkp_pada(v_tgl) then
    raise exception 'PPN hanya bisa dikreditkan bila perusahaan sudah PKP pada tanggal perolehan (lihat Pengaturan → Profil perusahaan).';
  end if;
  v_nilai := v_harga + v_bt - v_diskon + case when v_kredit then 0 else v_ppn end;
  if v_nilai <= 0 then raise exception 'Nilai perolehan harus lebih dari 0.'; end if;
  select batas_kapitalisasi into v_batas from public.akuntansi limit 1;
  if v_nilai < coalesce(v_batas, 0) and not coalesce((p ->> 'tetap_aset')::boolean, false) then
    raise exception 'Nilai perolehan di bawah batas kapitalisasi. Sebaiknya dicatat sebagai biaya (OPEX).';
  end if;
  if coalesce(v_cara, '') not in ('tunai', 'kredit', 'leasing', 'saldo_awal') then raise exception 'Cara perolehan wajib dipilih.'; end if;
  if v_cara = 'saldo_awal' then
    v_saldo := nullif(p ->> 'tgl_saldo_awal', '')::date;
    if v_saldo is null then raise exception 'Tanggal saldo awal wajib diisi (tanggal aset mulai dicatat di aplikasi).'; end if;
    if v_saldo < v_tgl then raise exception 'Tanggal saldo awal tidak boleh sebelum tanggal perolehan.'; end if;
    if v_saldo > public.hari_ini() then raise exception 'Tanggal saldo awal tidak boleh di masa depan.'; end if;
    if lama.id is not null and exists (select 1 from public.aset_servis where aset_id = lama.id and tanggal < v_saldo) then
      raise exception 'Ada servis sebelum tanggal saldo awal. Hapus atau ubah servis itu dulu.';
    end if;
  end if;
  if v_cara = 'tunai' and not exists (select 1 from public.rekening where id = nullif(p ->> 'rekening_id', '')::uuid and (aktif or id = lama.rekening_id)) then
    raise exception 'Rekening pembayar wajib dipilih (rekening aktif).';
  end if;
  if kat.disusutkan then
    v_mulai := coalesce(nullif(p ->> 'tgl_mulai', '')::date, v_tgl);
    v_umur := nullif(p ->> 'umur_bulan', '')::int;
    v_residu := coalesce(nullif(p ->> 'residu', '')::bigint, 0);
    if v_mulai < v_tgl then raise exception 'Tanggal mulai digunakan tidak boleh sebelum tanggal perolehan.'; end if;
    if coalesce(v_umur, 0) <= 0 then raise exception 'Umur ekonomis wajib diisi (lebih dari 0).'; end if;
    if v_residu < 0 or v_residu >= v_nilai then raise exception 'Nilai residu harus 0 atau lebih dan di bawah nilai perolehan.'; end if;
  else
    v_mulai := null; v_umur := null; v_residu := 0;
  end if;
  if nullif(p ->> 'kelompok_id', '') is not null and not exists (select 1 from public.kelompok_fiskal where id = (p ->> 'kelompok_id')::uuid) then
    raise exception 'Kelompok fiskal tidak ditemukan.';
  end if;
  if nullif(p ->> 'supplier_id', '') is not null then
    select id, data ->> 'nama' into v_sup_id, v_sup_nama from public.records where tabel = 'supplier' and id = (p ->> 'supplier_id')::uuid;
    if v_sup_id is null then raise exception 'Supplier wajib dipilih dari master Supplier.'; end if;
  end if;
  if nullif(p ->> 'pemegang_id', '') is not null then
    select id, data ->> 'nama' into v_pem_id, v_pem_nama from public.records where tabel = 'sdm' and id = (p ->> 'pemegang_id')::uuid;
    if v_pem_id is null then raise exception 'Pemegang wajib dipilih dari data SDM.'; end if;
  end if;
  if nullif(p ->> 'lokasi_id', '') is not null then
    select id, nama into v_lok_id, v_lokasi_baru from public.aset_lokasi where id = (p ->> 'lokasi_id')::uuid;
    if v_lok_id is null then raise exception 'Lokasi tidak ditemukan.'; end if;
  end if;
  if v_kondisi not in ('Baik', 'Perlu servis', 'Rusak') then raise exception 'Kondisi tidak dikenal.'; end if;
  if v_status not in ('Aktif', 'Dijual', 'Dihapuskan', 'Hilang') then raise exception 'Status tidak dikenal.'; end if;
  if v_status <> 'Aktif' then
    v_lepas := nullif(p ->> 'tgl_pelepasan', '')::date;
    v_jual := case when v_status = 'Dijual' then coalesce(nullif(p ->> 'nilai_jual', '')::bigint, -1) else 0 end;
    if v_lepas is null then raise exception 'Tanggal pelepasan wajib diisi.'; end if;
    if v_lepas < v_tgl then raise exception 'Tanggal pelepasan tidak boleh sebelum tanggal perolehan.'; end if;
    if v_lepas < v_saldo then raise exception 'Tanggal pelepasan tidak boleh sebelum tanggal saldo awal.'; end if;
    if v_lepas > public.hari_ini() then raise exception 'Tanggal pelepasan tidak boleh di masa depan.'; end if;
    if v_jual < 0 then raise exception 'Nilai jual wajib diisi (rupiah utuh, 0 atau lebih).'; end if;
    if btrim(coalesce(p ->> 'alasan_pelepasan', '')) = '' then raise exception 'Alasan pelepasan wajib diisi.'; end if;
    if v_jual > 0 then
      v_ppn_jual := coalesce(nullif(p ->> 'ppn_jual', '')::bigint, 0);
      if v_ppn_jual < 0 then raise exception 'PPN keluaran tidak boleh minus.'; end if;
      if v_ppn_jual > 0 and not public.pkp_pada(v_lepas) then
        raise exception 'PPN keluaran hanya bisa dipungut bila perusahaan sudah PKP pada tanggal penjualan (lihat Pengaturan → Profil perusahaan).';
      end if;
      v_rek_jual := nullif(p ->> 'rekening_jual_id', '')::uuid;
      if not exists (select 1 from public.rekening where id = v_rek_jual and (aktif or id = lama.rekening_jual_id)) then
        raise exception 'Rekening penerima hasil penjualan wajib dipilih (rekening aktif).';
      end if;
    end if;
    if lama.id is not null and exists (select 1 from public.aset_servis where aset_id = lama.id and tanggal > v_lepas) then
      raise exception 'Ada servis setelah tanggal pelepasan. Hapus atau ubah servis itu dulu.';
    end if;
  end if;

  v_beli_berubah := lama.id is null or (lama.tgl_perolehan, lama.harga, lama.ppn, lama.ppn_kredit, lama.biaya_tambahan, lama.diskon, lama.cara,
    coalesce(lama.rekening_id::text, ''), lama.kategori_id, lama.tgl_saldo_awal) is distinct from
    (v_tgl, v_harga, v_ppn, v_kredit, v_bt, v_diskon, v_cara, coalesce(case when v_cara = 'tunai' then p ->> 'rekening_id' end, ''), kat.id, v_saldo);
  if lama.id is not null and lama.status <> 'Aktif' and v_status <> 'Aktif'
     and (v_beli_berubah or (lama.tgl_mulai, lama.umur_bulan, lama.residu) is distinct from (v_mulai, v_umur, v_residu)) then
    raise exception 'Aset ini sudah dilepas: nilai perolehan dan penyusutannya tidak bisa diubah. Ubah status ke Aktif dulu bila perlu koreksi.';
  end if;
  if v_beli_berubah then
    if lama.id is not null then perform public.cek_bulan_terbuka(coalesce(lama.tgl_saldo_awal, lama.tgl_perolehan)); end if;
    perform public.cek_bulan_terbuka(coalesce(v_saldo, v_tgl));
  end if;

  if lama.id is null then
    perform pg_advisory_xact_lock(hashtext('kode_aset'));
    select kat.prefix || '-' || lpad((coalesce(max(substring(kode from '-([0-9]+)$')::int), 0) + 1)::text, 3, '0') into v_kode
    from public.aset where kode ~ ('^' || kat.prefix || '-[0-9]+$');
    insert into public.aset (kode, nama, kategori_id, tgl_perolehan, harga, nilai_perolehan, cara) values (v_kode, btrim(p ->> 'nama'), kat.id, v_tgl, 1, 1, 'kredit')
    returning id into v_id;
  end if;
  update public.aset set
    nama = btrim(p ->> 'nama'), kategori_id = kat.id, no_seri = nullif(btrim(p ->> 'no_seri'), ''),
    supplier_id = v_sup_id, supplier_nama = v_sup_nama,
    faktur = coalesce(p -> 'faktur', '[]'::jsonb), foto = coalesce(p -> 'foto', '[]'::jsonb),
    tgl_perolehan = v_tgl, harga = v_harga, ppn = v_ppn, ppn_kredit = v_kredit, biaya_tambahan = v_bt, diskon = v_diskon, nilai_perolehan = v_nilai,
    di_bawah_batas = v_nilai < coalesce(v_batas, 0),
    cara = v_cara, rekening_id = case when v_cara = 'tunai' then (p ->> 'rekening_id')::uuid end, tgl_saldo_awal = v_saldo,
    tgl_mulai = v_mulai, umur_bulan = v_umur, residu = v_residu,
    kelompok_id = nullif(p ->> 'kelompok_id', '')::uuid,
    bulan_fiskal = date_trunc('month', coalesce(nullif(p ->> 'bulan_fiskal', '')::date, v_tgl))::date,
    pemegang_id = v_pem_id, pemegang_nama = v_pem_nama, lokasi_id = v_lok_id,
    kondisi = v_kondisi, status = v_status, tgl_pelepasan = v_lepas, nilai_jual = coalesce(v_jual, 0), ppn_jual = v_ppn_jual, rekening_jual_id = v_rek_jual,
    alasan_pelepasan = case when v_status <> 'Aktif' then btrim(p ->> 'alasan_pelepasan') end,
    catatan = nullif(p ->> 'catatan', '')
  where id = v_id;
  -- Nilai pada saat pelepasan.
  update public.aset set akumulasi_lepas = x.akum, nilai_buku_lepas = x.perolehan - x.akum, laba_lepas = nilai_jual - (x.perolehan - x.akum)
  from (select public.akumulasi_aset(v_id, public.idx_bulan(v_lepas) - 1) as akum, public.perolehan_aset_pada(v_id, v_lepas) as perolehan) x
  where id = v_id and v_lepas is not null;
  update public.aset set akumulasi_lepas = null, nilai_buku_lepas = null, laba_lepas = null where id = v_id and v_lepas is null;
  -- Saldo awal: akumulasi penyusutan sampai bulan sebelum tanggal saldo awal (sudah terjadi sebelum memakai aplikasi).
  update public.aset set akumulasi_awal = case when v_saldo is null then 0 else public.akumulasi_aset(v_id, public.idx_bulan(v_saldo) - 1) end where id = v_id;
  select * into baru from public.aset where id = v_id;
  if lama.id is not null and not v_beli_berubah and lama.akumulasi_awal is distinct from baru.akumulasi_awal then
    v_beli_berubah := true;
    perform public.cek_bulan_terbuka(coalesce(baru.tgl_saldo_awal, baru.tgl_perolehan));
  end if;

  v_lepas_berubah := (lama.status, lama.tgl_pelepasan, lama.nilai_jual, lama.ppn_jual, lama.rekening_jual_id, lama.akumulasi_lepas, lama.nilai_buku_lepas)
    is distinct from (baru.status, baru.tgl_pelepasan, baru.nilai_jual, baru.ppn_jual, baru.rekening_jual_id, baru.akumulasi_lepas, baru.nilai_buku_lepas)
    or (v_beli_berubah and baru.status <> 'Aktif');
  if v_lepas_berubah then
    perform public.cek_bulan_terbuka(lama.tgl_pelepasan);
    perform public.cek_bulan_terbuka(baru.tgl_pelepasan);
  end if;
  if v_beli_berubah then perform public.jurnal_aset(v_id); end if;
  if v_lepas_berubah then perform public.jurnal_pelepasan_aset(v_id); end if;

  -- Riwayat mutasi penempatan.
  select nama into v_lokasi_lama from public.aset_lokasi where id = lama.lokasi_id;
  if lama.id is null and (v_pem_id is not null or v_lok_id is not null) then
    insert into public.aset_mutasi (aset_id, tanggal, ke_pemegang, ke_lokasi, catatan)
    values (v_id, coalesce(nullif(p ->> 'tgl_mutasi', '')::date, v_tgl), v_pem_nama, v_lokasi_baru, coalesce(nullif(p ->> 'catatan_mutasi', ''), 'Penempatan awal'));
  elsif lama.id is not null and (lama.pemegang_id, lama.lokasi_id) is distinct from (v_pem_id, v_lok_id) then
    insert into public.aset_mutasi (aset_id, tanggal, dari_pemegang, ke_pemegang, dari_lokasi, ke_lokasi, catatan)
    values (v_id, coalesce(nullif(p ->> 'tgl_mutasi', '')::date, public.hari_ini()), lama.pemegang_nama, v_pem_nama, v_lokasi_lama, v_lokasi_baru, nullif(p ->> 'catatan_mutasi', ''));
  end if;
  return v_id;
end $$;

create or replace function public.hapus_aset(p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare a public.aset; b record;
begin
  if public.hak('aset') is distinct from 'ubah' then raise exception 'Anda tidak punya hak menghapus aset.'; end if;
  select * into a from public.aset where id = p_id for update;
  if a.id is null then return; end if;
  if exists (select 1 from public.aset_servis where aset_id = p_id) then raise exception 'Aset ini punya riwayat servis. Hapus servisnya dulu, atau ubah status aset (dijual / dihapuskan).'; end if;
  if exists (select 1 from public.penyusutan_aset pa join public.penyusutan_bulan pb on pb.id = pa.bulan_id where pa.aset_id = p_id and public.bulan_terkunci(pb.bulan)) then
    raise exception 'Penyusutan aset ini sudah dibukukan di bulan yang ditutup. Aset tidak bisa dihapus; ubah statusnya (dihapuskan) bila perlu.';
  end if;
  perform public.cek_bulan_terbuka(coalesce(a.tgl_saldo_awal, a.tgl_perolehan));
  perform public.cek_bulan_terbuka(a.tgl_pelepasan);
  for b in select bulan_id from public.penyusutan_aset where aset_id = p_id loop
    delete from public.penyusutan_aset where bulan_id = b.bulan_id and aset_id = p_id;
    update public.penyusutan_bulan set total = (select coalesce(sum(jumlah), 0) from public.penyusutan_aset where bulan_id = b.bulan_id) where id = b.bulan_id;
    perform public.jurnal_penyusutan(b.bulan_id);
  end loop;
  delete from public.aset where id = p_id;
  perform public.jurnal_aset(p_id);
  perform public.jurnal_pelepasan_aset(p_id);
end $$;

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
  -- Tahap 5 (hanya bila cadangan berisi data aset; cadangan lama tidak menghapus data aset).
  if p ? 'aset' then
    delete from public.jurnal where sumber in ('aset', 'pelepasan_aset', 'servis_aset', 'penyusutan');
    delete from public.penyusutan_bulan;
    delete from public.aset_servis;
    delete from public.aset;
  end if;
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
  if p ? 'aset_kategori' then delete from public.aset_kategori; end if;
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
      batas_pinjam_titipan_persen = (p -> 'akuntansi' ->> 'batas_pinjam_titipan_persen')::int,
      metode_fiskal = coalesce(p -> 'akuntansi' ->> 'metode_fiskal', metode_fiskal);
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
  -- Tahap 5: pengaturan aset (akun kategori dipetakan), aset, mutasi, servis, dokumen, penyusutan yang sudah dibukukan; jurnalnya dibuat ulang.
  if p ? 'aset_kategori' then
    delete from public.kelompok_fiskal where not exists (select 1 from public.aset where kelompok_id = kelompok_fiskal.id);
    insert into public.kelompok_fiskal select * from jsonb_populate_recordset(null::public.kelompok_fiskal, coalesce(p -> 'kelompok_fiskal', '[]'::jsonb)) on conflict (id) do nothing;
    delete from public.aset_lokasi where not exists (select 1 from public.aset where lokasi_id = aset_lokasi.id);
    insert into public.aset_lokasi select * from jsonb_populate_recordset(null::public.aset_lokasi, coalesce(p -> 'aset_lokasi', '[]'::jsonb)) on conflict (id) do nothing;
    insert into public.aset_kategori
    select * from jsonb_populate_recordset(null::public.aset_kategori, (
      select coalesce(jsonb_agg(x || jsonb_build_object('akun_aset_id', public.peta_akun(p, x ->> 'akun_aset_id'),
        'akun_akumulasi_id', public.peta_akun(p, x ->> 'akun_akumulasi_id'), 'akun_beban_id', public.peta_akun(p, x ->> 'akun_beban_id'))), '[]'::jsonb)
      from jsonb_array_elements(p -> 'aset_kategori') x));
  end if;
  if p ? 'aset' then
    insert into public.aset select * from jsonb_populate_recordset(null::public.aset, coalesce(p -> 'aset', '[]'::jsonb));
    insert into public.aset_mutasi select * from jsonb_populate_recordset(null::public.aset_mutasi, coalesce(p -> 'aset_mutasi', '[]'::jsonb));
    insert into public.aset_servis select * from jsonb_populate_recordset(null::public.aset_servis, coalesce(p -> 'aset_servis', '[]'::jsonb));
    insert into public.aset_dokumen select * from jsonb_populate_recordset(null::public.aset_dokumen, coalesce(p -> 'aset_dokumen', '[]'::jsonb));
    insert into public.penyusutan_bulan select * from jsonb_populate_recordset(null::public.penyusutan_bulan, coalesce(p -> 'penyusutan_bulan', '[]'::jsonb));
    insert into public.penyusutan_aset select * from jsonb_populate_recordset(null::public.penyusutan_aset, coalesce(p -> 'penyusutan_aset', '[]'::jsonb));
    for a in select id from public.aset loop perform public.jurnal_aset(a.id); perform public.jurnal_pelepasan_aset(a.id); end loop;
    for a in select id from public.aset_servis loop perform public.jurnal_servis_aset(a.id); end loop;
    for a in select id from public.penyusutan_bulan loop perform public.jurnal_penyusutan(a.id); end loop;
  end if;
  insert into public.tutup_buku (bulan) select (x ->> 'bulan')::date from jsonb_array_elements(coalesce(p -> 'tutup_buku', '[]'::jsonb)) x;
  perform set_config('alinea.pulihkan', '', true);
end $$;

-- Jurnal perolehan aset kredit / leasing yang tadinya memakai uang muka dibuat ulang.
do $$
declare a record;
begin
  if to_regclass('arsip_tahap6.aset_uang_muka') is not null then
    for a in select x.id from arsip_tahap6.aset_uang_muka x join public.aset s on s.id = x.id where x.uang_muka > 0 loop perform public.jurnal_aset(a.id); end loop;
  end if;
end $$;
select set_config('alinea.pulihkan', '', true);

delete from public.pemetaan_jurnal where jenis in ('hutang_terima', 'hutang_pokok', 'hutang_saldo_ekuitas', 'bayar_hutang_pokok', 'bayar_hutang_bunga',
  'bayar_hutang_denda', 'bayar_hutang_kas');
alter table public.jurnal drop constraint if exists jurnal_sumber_check;
alter table public.jurnal add constraint jurnal_sumber_check check (sumber in ('manual', 'saldo_awal', 'kas', 'transfer', 'penerimaan', 'invoice',
  'opname', 'bayar_vendor', 'pembelian', 'bayar_supplier', 'aset', 'pelepasan_aset', 'servis_aset', 'penyusutan'));

-- Akses seperti di Tahap 5.
drop policy if exists rekening_baca on public.rekening;
create policy rekening_baca on public.rekening for select to authenticated
  using (public.hak('kas') is not null or public.hak('jurnal') is not null or public.hak('pengaturan') is not null or public.baca_keuangan_proyek()
         or public.hak('aset') is not null);
drop policy if exists aset_baca_hutang on public.aset;
drop policy if exists bukti_hutang_baca on storage.objects;
drop policy if exists bukti_hutang_tambah on storage.objects;
drop policy if exists bukti_hutang_hapus on storage.objects;

-- Data Hutang Lain bentuk lama kembali ke tempatnya.
insert into public.records select * from arsip_tahap6.records a where not exists (select 1 from public.records r where r.id = a.id);
