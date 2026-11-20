-- Alinea 5 — Migrasi Tahap 6: Hutang Lain (bank, leasing, pemilik, pihak luar).
-- Jalankan SETELAH 5-aset.sql. Aman dijalankan ulang. Pembatalan: 6-batal.sql. Uji: 6-uji.sql.
-- Uang: rupiah utuh (bigint). Suku bunga dalam basis poin per tahun (1000 = 10,00%).
-- Data Hutang Lain bentuk lama (tabel records, tabel 'hutang_lain') DIARSIPKAN ke arsip_tahap6.records, tidak dihapus.
-- Akun hutang menurut jenis: Kredit bank & Leasing 2-8; Pinjaman pemilik atau kreditur pihak afiliasi 2-9; lainnya 2-10.
-- Jurnal:
--  - Pinjaman tunai diterima: D Kas-Bank / K Hutang.
--  - Kredit / leasing aset: tidak ada jurnal baru; hutangnya sudah dikredit di jurnal perolehan aset (K 2-8), hutang hanya ditautkan.
--    Aset kredit / leasing kini bisa punya uang muka (DP): D Aset / K Kas-Bank (DP) / K 2-8 (sisa).
--  - Saldo awal (pinjaman lama): D 3-2-01 Ekuitas saldo awal / K Hutang sebesar sisa pokok.
--  - Pembayaran: D Hutang (pokok) + D 7-1 Beban Bunga + D 7-3 Denda / K Kas-Bank.
-- Jangka pendek (≤ 12 bulan) / jangka panjang dihitung aplikasi dari jadwal angsuran (tanpa jurnal pindahan).
-- Jadwal angsuran dibuat aplikasi (otomatis atau impor Excel) lalu diperiksa di sini: total pokok harus sama.

-- Pemeriksaan awal: Tahap 5 (5-aset.sql) harus sudah terpasang, termasuk tambahan saldo awal aset.
do $$
begin
  if to_regprocedure('public.simpan_aset(uuid, jsonb)') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'aset' and column_name = 'tgl_saldo_awal') then
    raise exception 'Database Tahap 5 belum terpasang lengkap. Jalankan dulu supabase/migrasi/5-aset.sql (lalu 5-uji.sql), baru 6-hutang.sql.';
  end if;
end $$;

-- =====================================================================
-- 1. ARSIP DATA HUTANG LAIN BENTUK LAMA
-- =====================================================================
create schema if not exists arsip_tahap6;
create table if not exists arsip_tahap6.records as select * from public.records where false;
alter table arsip_tahap6.records enable row level security;
revoke all on schema arsip_tahap6 from anon, authenticated;
insert into arsip_tahap6.records
  select * from public.records r
  where r.tabel = 'hutang_lain' and not exists (select 1 from arsip_tahap6.records a where a.id = r.id);
delete from public.records where tabel = 'hutang_lain';

-- =====================================================================
-- 2. TABEL
-- =====================================================================
-- Daftar kreditur untuk dipakai ulang. Nama tidak boleh dobel (huruf besar/kecil diabaikan).
create table if not exists public.kreditur (
  id uuid primary key default gen_random_uuid(),
  perusahaan_id uuid not null default public.perusahaan_tunggal() references public.perusahaan (id),
  nama text not null check (btrim(nama) <> ''),
  afiliasi boolean not null default false,
  kontak text,
  catatan text,
  aktif boolean not null default true,
  dibuat timestamptz not null default now()
);
create unique index if not exists kreditur_nama_key on public.kreditur (lower(btrim(nama)));

create table if not exists public.hutang (
  id uuid primary key default gen_random_uuid(),
  perusahaan_id uuid not null default public.perusahaan_tunggal() references public.perusahaan (id),
  kreditur_id uuid not null references public.kreditur (id),
  jenis text not null check (jenis in ('kredit_bank', 'leasing', 'pinjaman_pemilik', 'pinjaman_lain', 'sewa', 'lainnya')),
  uraian text,
  no_perjanjian text,
  tgl_perjanjian date,
  file jsonb,
  pokok bigint not null check (pokok > 0),
  bunga_bp integer not null default 0 check (bunga_bp between 0 and 10000),
  metode_bunga text not null default 'flat' check (metode_bunga in ('flat', 'anuitas', 'efektif', 'tanpa')),
  tenor_bulan integer check (tenor_bulan between 1 and 600),
  tgl_mulai date not null,
  hari_angsuran integer not null check (hari_angsuran between 1 and 31),
  denda_ket text,
  cara text not null check (cara in ('tunai', 'aset', 'saldo_awal')),
  rekening_id uuid references public.rekening (id),
  aset_id uuid references public.aset (id),
  tgl_saldo_awal date,
  sisa_pokok_awal bigint,
  akun_kode text not null check (akun_kode in ('2-8', '2-9', '2-10')),
  jaminan text,
  jaminan_aset_id uuid references public.aset (id),
  jadwal_sumber text not null default 'otomatis' check (jadwal_sumber in ('otomatis', 'impor')),
  catatan text,
  dibuat timestamptz not null default now(),
  dibuat_oleh uuid default auth.uid(),
  check ((cara = 'tunai') = (rekening_id is not null)),
  check ((cara = 'aset') = (aset_id is not null)),
  check ((cara = 'saldo_awal') = (tgl_saldo_awal is not null and sisa_pokok_awal is not null)),
  check (sisa_pokok_awal is null or sisa_pokok_awal between 1 and pokok),
  check (tgl_saldo_awal is null or tgl_saldo_awal >= tgl_mulai),
  check (metode_bunga <> 'tanpa' or bunga_bp = 0)
);
create unique index if not exists hutang_aset_key on public.hutang (aset_id) where aset_id is not null;

create table if not exists public.hutang_angsuran (
  id uuid primary key default gen_random_uuid(),
  hutang_id uuid not null references public.hutang (id) on delete cascade,
  ke integer not null check (ke >= 1),
  tanggal date not null,
  pokok bigint not null check (pokok >= 0),
  bunga bigint not null default 0 check (bunga >= 0),
  unique (hutang_id, ke)
);

-- Riwayat pembayaran (tidak ditimpa). angsuran_ke kosong = pembayaran pokok di luar jadwal (pelunasan dipercepat).
create table if not exists public.hutang_bayar (
  id uuid primary key default gen_random_uuid(),
  perusahaan_id uuid not null default public.perusahaan_tunggal() references public.perusahaan (id),
  hutang_id uuid not null references public.hutang (id),
  angsuran_ke integer,
  tanggal date not null,
  pokok bigint not null default 0 check (pokok >= 0),
  bunga bigint not null default 0 check (bunga >= 0),
  denda bigint not null default 0 check (denda >= 0),
  rekening_id uuid not null references public.rekening (id),
  bukti jsonb,
  catatan text,
  dibuat timestamptz not null default now(),
  dibuat_oleh uuid default auth.uid(),
  check (pokok + bunga + denda > 0)
);
create index if not exists hutang_bayar_idx on public.hutang_bayar (hutang_id);

-- Uang muka (DP) aset kredit / leasing, dibayar dari rekening_id.
alter table public.aset add column if not exists uang_muka bigint not null default 0;
alter table public.aset drop constraint if exists aset_uang_muka_cek;
alter table public.aset add constraint aset_uang_muka_cek check (uang_muka >= 0 and (uang_muka = 0 or (cara in ('kredit', 'leasing') and rekening_id is not null))
  and uang_muka < greatest(harga + biaya_tambahan - diskon + ppn, 1));

-- =====================================================================
-- 3. JURNAL: SUMBER BARU DAN PEMETAAN
-- =====================================================================
alter table public.jurnal drop constraint if exists jurnal_sumber_check;
alter table public.jurnal add constraint jurnal_sumber_check check (sumber in ('manual', 'saldo_awal', 'kas', 'transfer', 'penerimaan', 'invoice',
  'opname', 'bayar_vendor', 'pembelian', 'bayar_supplier', 'aset', 'pelepasan_aset', 'servis_aset', 'penyusutan', 'hutang', 'bayar_hutang'));

insert into public.pemetaan_jurnal (jenis, urut, nama, sisi, akun, keterangan) values
  ('hutang_terima', 1, 'Pinjaman diterima – uang masuk', 'D', 'REKENING', 'Rekening penerima dana'),
  ('hutang_pokok', 1, 'Pinjaman diterima / saldo awal – hutang', 'K', 'AKUN_HUTANG', 'Akun hutang sesuai jenis (2-8 / 2-9 / 2-10)'),
  ('hutang_saldo_ekuitas', 1, 'Saldo awal hutang – ekuitas', 'D', '3-2-01', 'Ekuitas saldo awal (sisa pokok pinjaman lama)'),
  ('bayar_hutang_pokok', 1, 'Angsuran hutang – pokok', 'D', 'AKUN_HUTANG', 'Mengurangi hutang'),
  ('bayar_hutang_bunga', 1, 'Angsuran hutang – bunga', 'D', '7-1', 'Beban Bunga'),
  ('bayar_hutang_denda', 1, 'Angsuran hutang – denda', 'D', '7-3', 'Denda'),
  ('bayar_hutang_kas', 1, 'Angsuran hutang – uang keluar', 'K', 'REKENING', 'Rekening pembayar')
on conflict (jenis, urut) do nothing;

-- =====================================================================
-- 4. FUNGSI HUTANG
-- =====================================================================
create or replace function public.akun_hutang(p_jenis text, p_afiliasi boolean)
returns text language sql immutable set search_path = ''
as $$ select case when p_jenis in ('kredit_bank', 'leasing') then '2-8' when p_jenis = 'pinjaman_pemilik' or coalesce(p_afiliasi, false) then '2-9' else '2-10' end $$;

create or replace function public.sisa_pokok_hutang(p_id uuid, p_kecuali uuid default null)
returns bigint language sql stable security definer set search_path = ''
as $$
  select case when h.cara = 'saldo_awal' then h.sisa_pokok_awal else h.pokok end
    - coalesce((select sum(b.pokok) from public.hutang_bayar b where b.hutang_id = h.id and b.id is distinct from p_kecuali), 0)
  from public.hutang h where h.id = p_id
$$;

create or replace function public.jurnal_hutang(p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare h public.hutang; v_nama text;
begin
  select * into h from public.hutang where id = p_id;
  if h.id is null or h.cara = 'aset' then perform public.jurnal_otomatis('hutang', p_id, null, null, null, null); return; end if;
  select nama into v_nama from public.kreditur where id = h.kreditur_id;
  if h.cara = 'saldo_awal' then
    perform public.jurnal_otomatis('hutang', h.id, h.tgl_saldo_awal, 'Saldo awal hutang ' || v_nama || coalesce(' · ' || h.uraian, ''),
      jsonb_build_array(jsonb_build_object('jenis', 'hutang_saldo_ekuitas', 'jumlah', h.sisa_pokok_awal), jsonb_build_object('jenis', 'hutang_pokok', 'jumlah', h.sisa_pokok_awal)),
      jsonb_build_object('AKUN_HUTANG', public.akun_kode(h.akun_kode)));
  else
    perform public.jurnal_otomatis('hutang', h.id, h.tgl_mulai, 'Pinjaman diterima dari ' || v_nama || coalesce(' · ' || h.uraian, ''),
      jsonb_build_array(jsonb_build_object('jenis', 'hutang_terima', 'jumlah', h.pokok), jsonb_build_object('jenis', 'hutang_pokok', 'jumlah', h.pokok)),
      jsonb_build_object('AKUN_HUTANG', public.akun_kode(h.akun_kode), 'REKENING', public.akun_rekening(h.rekening_id)));
  end if;
end $$;

create or replace function public.jurnal_bayar_hutang(p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare b public.hutang_bayar; h public.hutang; v_nama text;
begin
  select * into b from public.hutang_bayar where id = p_id;
  if b.id is null then perform public.jurnal_otomatis('bayar_hutang', p_id, null, null, null, null); return; end if;
  select * into h from public.hutang where id = b.hutang_id;
  select nama into v_nama from public.kreditur where id = h.kreditur_id;
  perform public.jurnal_otomatis('bayar_hutang', b.id, b.tanggal,
    case when b.angsuran_ke is not null then 'Angsuran ke-' || b.angsuran_ke else 'Pembayaran pokok' end || ' ' || v_nama || coalesce(' · ' || h.uraian, ''),
    jsonb_build_array(jsonb_build_object('jenis', 'bayar_hutang_pokok', 'jumlah', b.pokok), jsonb_build_object('jenis', 'bayar_hutang_bunga', 'jumlah', b.bunga),
      jsonb_build_object('jenis', 'bayar_hutang_denda', 'jumlah', b.denda), jsonb_build_object('jenis', 'bayar_hutang_kas', 'jumlah', b.pokok + b.bunga + b.denda)),
    jsonb_build_object('AKUN_HUTANG', public.akun_kode(h.akun_kode), 'REKENING', public.akun_rekening(b.rekening_id)));
end $$;

create or replace function public.tgl_jurnal_hutang(h public.hutang)
returns date language sql immutable set search_path = ''
as $$ select case when h.cara = 'tunai' then h.tgl_mulai when h.cara = 'saldo_awal' then h.tgl_saldo_awal end $$;

-- Kreditur: tanda afiliasi menentukan akun hutang (hanya untuk hutang yang belum punya pembayaran).
create or replace function public.simpan_kreditur(p_id uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid := p_id;
  v_nama text := btrim(coalesce(p ->> 'nama', ''));
  h public.hutang;
  v_akun text;
begin
  if public.hak('hutang_lain') is distinct from 'ubah' then raise exception 'Anda tidak punya hak mengubah daftar kreditur.'; end if;
  if v_nama = '' then raise exception 'Nama kreditur wajib diisi.'; end if;
  if exists (select 1 from public.kreditur where lower(btrim(nama)) = lower(v_nama) and id is distinct from v_id) then
    raise exception 'Kreditur "%" sudah ada. Pilih dari daftar.', v_nama;
  end if;
  if v_id is null then
    insert into public.kreditur (nama, afiliasi, kontak, catatan, aktif)
    values (v_nama, coalesce((p ->> 'afiliasi')::boolean, false), nullif(btrim(p ->> 'kontak'), ''), nullif(btrim(p ->> 'catatan'), ''), coalesce((p ->> 'aktif')::boolean, true))
    returning id into v_id;
  else
    update public.kreditur set nama = v_nama, afiliasi = coalesce((p ->> 'afiliasi')::boolean, afiliasi), kontak = nullif(btrim(p ->> 'kontak'), ''),
      catatan = nullif(btrim(p ->> 'catatan'), ''), aktif = coalesce((p ->> 'aktif')::boolean, aktif)
    where id = v_id;
    if not found then raise exception 'Kreditur tidak ditemukan.'; end if;
  end if;
  for h in select * from public.hutang where kreditur_id = v_id loop
    v_akun := public.akun_hutang(h.jenis, (select afiliasi from public.kreditur where id = v_id));
    continue when v_akun = h.akun_kode;
    if exists (select 1 from public.hutang_bayar where hutang_id = h.id) then
      raise exception 'Tanda afiliasi tidak bisa diubah: hutang % sudah punya pembayaran di akun %.', coalesce(h.uraian, v_nama), h.akun_kode;
    end if;
    perform public.cek_bulan_terbuka(public.tgl_jurnal_hutang(h));
    update public.hutang set akun_kode = v_akun where id = h.id;
    perform public.jurnal_hutang(h.id);
  end loop;
  return v_id;
end $$;

-- Mengganti jadwal angsuran. Angsuran sampai nomor terakhir yang sudah dibayar dipertahankan; jadwal baru mulai sesudahnya.
-- Total pokok jadwal baru = pokok pinjaman (belum ada pembayaran) atau sisa pokok − sisa angsuran yang dipertahankan.
create or replace function public.isi_jadwal_hutang(p_hutang uuid, p_baris jsonb, p_sumber text)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  h public.hutang;
  v_k int;
  v_target bigint;
  v_total bigint;
  v_n int;
  r jsonb;
begin
  select * into h from public.hutang where id = p_hutang for update;
  if h.id is null then raise exception 'Hutang tidak ditemukan.'; end if;
  if p_baris is null or jsonb_typeof(p_baris) <> 'array' or jsonb_array_length(p_baris) = 0 then raise exception 'Jadwal kosong.'; end if;
  select coalesce(max(angsuran_ke), 0) into v_k from public.hutang_bayar where hutang_id = h.id;
  if v_k = 0 then
    v_target := h.pokok;
  else
    v_target := public.sisa_pokok_hutang(h.id) - coalesce((
      select sum(greatest(0, a.pokok - coalesce((select sum(b.pokok) from public.hutang_bayar b where b.hutang_id = h.id and b.angsuran_ke = a.ke), 0)))
      from public.hutang_angsuran a where a.hutang_id = h.id and a.ke <= v_k and not (h.cara = 'saldo_awal' and a.tanggal < h.tgl_saldo_awal)), 0);
  end if;
  for r in select value from jsonb_array_elements(p_baris) loop
    if (r ->> 'ke') !~ '^[0-9]+$' or (r ->> 'ke')::int < 1 then raise exception 'Nomor angsuran harus bilangan bulat ≥ 1.'; end if;
    if (r ->> 'ke')::int <= v_k then raise exception 'Angsuran ke-% sudah ada pembayarannya; jadwal baru harus mulai dari angsuran ke-%.', r ->> 'ke', v_k + 1; end if;
    if (r ->> 'pokok') !~ '^[0-9]+$' or coalesce(r ->> 'bunga', '0') !~ '^[0-9]+$' then raise exception 'Pokok dan bunga angsuran ke-% harus rupiah utuh, tidak minus.', r ->> 'ke'; end if;
    if nullif(r ->> 'tanggal', '') is null then raise exception 'Tanggal angsuran ke-% wajib diisi.', r ->> 'ke'; end if;
  end loop;
  if (select count(distinct (x ->> 'ke')::int) from jsonb_array_elements(p_baris) x) <> jsonb_array_length(p_baris) then raise exception 'Nomor angsuran ada yang dobel.'; end if;
  select coalesce(sum((x ->> 'pokok')::bigint), 0), count(*) into v_total, v_n from jsonb_array_elements(p_baris) x;
  if v_total <> v_target then
    raise exception 'Total pokok jadwal Rp % tidak sama dengan % Rp %.', to_char(v_total, 'FM999G999G999G999'),
      case when v_k = 0 then 'pokok pinjaman' else 'sisa pokok yang dijadwalkan ulang' end, to_char(v_target, 'FM999G999G999G999');
  end if;
  delete from public.hutang_angsuran where hutang_id = h.id and ke > v_k;
  insert into public.hutang_angsuran (hutang_id, ke, tanggal, pokok, bunga)
  select h.id, (x ->> 'ke')::int, (x ->> 'tanggal')::date, (x ->> 'pokok')::bigint, coalesce((x ->> 'bunga')::bigint, 0) from jsonb_array_elements(p_baris) x;
  update public.hutang set jadwal_sumber = case when p_sumber = 'impor' then 'impor' else 'otomatis' end where id = h.id;
  return v_n;
end $$;
revoke execute on function public.isi_jadwal_hutang(uuid, jsonb, text) from public, anon, authenticated;

create or replace function public.simpan_jadwal_hutang(p_hutang uuid, p_baris jsonb, p_sumber text default 'impor')
returns integer language plpgsql security definer set search_path = ''
as $$
begin
  if public.hak('hutang_lain') is distinct from 'ubah' then raise exception 'Anda tidak punya hak mengubah jadwal angsuran.'; end if;
  return public.isi_jadwal_hutang(p_hutang, p_baris, p_sumber);
end $$;

-- p: isi formulir hutang. p_jadwal: jadwal otomatis dari aplikasi (kosong = jadwal tidak diubah).
create or replace function public.simpan_hutang(p_id uuid, p jsonb, p_jadwal jsonb default null)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  lama public.hutang;
  baru public.hutang;
  k public.kreditur;
  a public.aset;
  v_id uuid := p_id;
  v_jenis text := p ->> 'jenis';
  v_pokok bigint := coalesce(nullif(p ->> 'pokok', '')::bigint, -1);
  v_metode text := coalesce(nullif(p ->> 'metode_bunga', ''), 'flat');
  v_bunga int := coalesce(nullif(p ->> 'bunga_bp', '')::int, 0);
  v_tenor int := nullif(p ->> 'tenor_bulan', '')::int;
  v_mulai date := nullif(p ->> 'tgl_mulai', '')::date;
  v_hari int := nullif(p ->> 'hari_angsuran', '')::int;
  v_cara text := p ->> 'cara';
  v_rek uuid; v_aset uuid; v_saldo date; v_sisa bigint;
  v_akun text;
  v_ada boolean := false;
  v_jurnal boolean;
begin
  if public.hak('hutang_lain') is distinct from 'ubah' then raise exception 'Anda tidak punya hak mengubah data hutang.'; end if;
  if v_id is not null then
    select * into lama from public.hutang where id = v_id for update;
    if lama.id is null then raise exception 'Hutang tidak ditemukan.'; end if;
    v_ada := exists (select 1 from public.hutang_bayar where hutang_id = v_id);
  end if;
  select * into k from public.kreditur where id = nullif(p ->> 'kreditur_id', '')::uuid;
  if k.id is null or (not k.aktif and k.id is distinct from lama.kreditur_id) then raise exception 'Kreditur wajib dipilih dari daftar kreditur.'; end if;
  if coalesce(v_jenis, '') not in ('kredit_bank', 'leasing', 'pinjaman_pemilik', 'pinjaman_lain', 'sewa', 'lainnya') then raise exception 'Jenis hutang wajib dipilih.'; end if;
  if v_pokok <= 0 then raise exception 'Pokok pinjaman wajib diisi (rupiah utuh, lebih dari 0).'; end if;
  if v_metode not in ('flat', 'anuitas', 'efektif', 'tanpa') then raise exception 'Jenis bunga tidak dikenal.'; end if;
  if v_metode = 'tanpa' then v_bunga := 0; end if;
  if v_bunga < 0 or v_bunga > 10000 then raise exception 'Suku bunga harus 0 sampai 100%% per tahun.'; end if;
  if v_tenor is not null and (v_tenor < 1 or v_tenor > 600) then raise exception 'Tenor harus 1 sampai 600 bulan.'; end if;
  if v_mulai is null then raise exception 'Tanggal mulai wajib diisi.'; end if;
  v_hari := coalesce(v_hari, extract(day from v_mulai)::int);
  if v_hari < 1 or v_hari > 31 then raise exception 'Tanggal angsuran tiap bulan harus 1 sampai 31.'; end if;
  if v_cara = 'tunai' then
    v_rek := nullif(p ->> 'rekening_id', '')::uuid;
    if not exists (select 1 from public.rekening where id = v_rek and (aktif or id = lama.rekening_id)) then raise exception 'Rekening penerima dana wajib dipilih (rekening aktif).'; end if;
  elsif v_cara = 'aset' then
    if v_jenis not in ('kredit_bank', 'leasing') then raise exception 'Tautan ke aset hanya untuk jenis Kredit bank atau Leasing.'; end if;
    select * into a from public.aset where id = nullif(p ->> 'aset_id', '')::uuid for update;
    if a.id is null or a.cara not in ('kredit', 'leasing') then raise exception 'Pilih aset yang dibeli dengan cara Kredit / Leasing.'; end if;
    if a.hutang_id is not null and a.hutang_id is distinct from v_id then raise exception 'Aset % sudah tertaut ke hutang lain.', a.kode; end if;
    if v_pokok <> a.harga + a.biaya_tambahan - a.diskon + a.ppn - a.uang_muka then
      raise exception 'Pokok hutang harus sama dengan hutang aset % di modul Aset: Rp % (nilai dibayar − uang muka).', a.kode,
        to_char(a.harga + a.biaya_tambahan - a.diskon + a.ppn - a.uang_muka, 'FM999G999G999G999');
    end if;
    v_aset := a.id;
  elsif v_cara = 'saldo_awal' then
    v_saldo := nullif(p ->> 'tgl_saldo_awal', '')::date;
    v_sisa := coalesce(nullif(p ->> 'sisa_pokok_awal', '')::bigint, -1);
    if v_saldo is null then raise exception 'Tanggal saldo awal wajib diisi.'; end if;
    if v_saldo < v_mulai then raise exception 'Tanggal saldo awal tidak boleh sebelum tanggal mulai pinjaman.'; end if;
    if v_saldo > public.hari_ini() then raise exception 'Tanggal saldo awal tidak boleh di masa depan.'; end if;
    if v_sisa <= 0 or v_sisa > v_pokok then raise exception 'Sisa pokok per tanggal saldo awal harus lebih dari 0 dan tidak melebihi pokok.'; end if;
  else
    raise exception 'Pilih asal hutang: dana diterima ke rekening, kredit/leasing aset, atau saldo awal.';
  end if;
  if nullif(p ->> 'jaminan_aset_id', '') is not null and not exists (select 1 from public.aset where id = (p ->> 'jaminan_aset_id')::uuid) then
    raise exception 'Aset jaminan tidak ditemukan.';
  end if;
  v_akun := public.akun_hutang(v_jenis, k.afiliasi);
  if v_ada and (lama.pokok, lama.cara, lama.akun_kode, lama.tgl_saldo_awal, lama.sisa_pokok_awal, lama.aset_id)
               is distinct from (v_pokok, v_cara, v_akun, v_saldo, v_sisa, v_aset) then
    raise exception 'Hutang ini sudah punya pembayaran: pokok, asal hutang, jenis / kreditur, aset, dan saldo awal tidak bisa diubah.';
  end if;
  if v_id is not null and exists (select 1 from public.hutang_bayar where hutang_id = v_id and (tanggal < v_mulai or tanggal < v_saldo)) then
    raise exception 'Ada pembayaran sebelum tanggal mulai / tanggal saldo awal.';
  end if;

  if v_id is null then
    insert into public.hutang (kreditur_id, jenis, pokok, tgl_mulai, hari_angsuran, cara, rekening_id, aset_id, tgl_saldo_awal, sisa_pokok_awal, akun_kode, metode_bunga, bunga_bp)
    values (k.id, v_jenis, v_pokok, v_mulai, v_hari, v_cara, v_rek, v_aset, v_saldo, v_sisa, v_akun, v_metode, v_bunga) returning id into v_id;
  end if;
  update public.hutang set kreditur_id = k.id, jenis = v_jenis, uraian = nullif(btrim(p ->> 'uraian'), ''), no_perjanjian = nullif(btrim(p ->> 'no_perjanjian'), ''),
    tgl_perjanjian = nullif(p ->> 'tgl_perjanjian', '')::date, file = p -> 'file', pokok = v_pokok, bunga_bp = v_bunga, metode_bunga = v_metode, tenor_bulan = v_tenor,
    tgl_mulai = v_mulai, hari_angsuran = v_hari, denda_ket = nullif(btrim(p ->> 'denda_ket'), ''), cara = v_cara, rekening_id = v_rek, aset_id = v_aset,
    tgl_saldo_awal = v_saldo, sisa_pokok_awal = v_sisa, akun_kode = v_akun, jaminan = nullif(btrim(p ->> 'jaminan'), ''),
    jaminan_aset_id = nullif(p ->> 'jaminan_aset_id', '')::uuid, catatan = nullif(btrim(p ->> 'catatan'), '')
  where id = v_id;
  select * into baru from public.hutang where id = v_id;
  v_jurnal := lama.id is null or (lama.tgl_mulai, lama.pokok, lama.cara, lama.rekening_id, lama.akun_kode, lama.tgl_saldo_awal, lama.sisa_pokok_awal, lama.kreditur_id, lama.uraian)
    is distinct from (baru.tgl_mulai, baru.pokok, baru.cara, baru.rekening_id, baru.akun_kode, baru.tgl_saldo_awal, baru.sisa_pokok_awal, baru.kreditur_id, baru.uraian);
  if v_jurnal then
    if lama.id is not null then perform public.cek_bulan_terbuka(public.tgl_jurnal_hutang(lama)); end if;
    perform public.cek_bulan_terbuka(public.tgl_jurnal_hutang(baru));
    perform public.jurnal_hutang(v_id);
  end if;
  -- Tautan aset dua arah.
  if lama.aset_id is not null and lama.aset_id is distinct from v_aset then update public.aset set hutang_id = null where id = lama.aset_id; end if;
  if v_aset is not null then update public.aset set hutang_id = v_id where id = v_aset and hutang_id is distinct from v_id; end if;
  if p_jadwal is not null and jsonb_typeof(p_jadwal) = 'array' and jsonb_array_length(p_jadwal) > 0 then perform public.isi_jadwal_hutang(v_id, p_jadwal, 'otomatis'); end if;
  return v_id;
end $$;

create or replace function public.hapus_hutang(p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare h public.hutang;
begin
  if public.hak('hutang_lain') is distinct from 'ubah' then raise exception 'Anda tidak punya hak menghapus hutang.'; end if;
  select * into h from public.hutang where id = p_id for update;
  if h.id is null then return; end if;
  if exists (select 1 from public.hutang_bayar where hutang_id = p_id) then raise exception 'Hutang ini sudah punya pembayaran dan tidak bisa dihapus.'; end if;
  perform public.cek_bulan_terbuka(public.tgl_jurnal_hutang(h));
  update public.aset set hutang_id = null where hutang_id = p_id;
  delete from public.hutang where id = p_id;
  perform public.jurnal_hutang(p_id);
end $$;

create or replace function public.simpan_bayar_hutang(p_id uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  lama public.hutang_bayar;
  h public.hutang;
  v_id uuid := p_id;
  v_tgl date := nullif(p ->> 'tanggal', '')::date;
  v_pokok bigint := coalesce(nullif(p ->> 'pokok', '')::bigint, 0);
  v_bunga bigint := coalesce(nullif(p ->> 'bunga', '')::bigint, 0);
  v_denda bigint := coalesce(nullif(p ->> 'denda', '')::bigint, 0);
  v_ke int := nullif(p ->> 'angsuran_ke', '')::int;
  v_tgl_ang date;
  v_sisa bigint;
begin
  if public.hak('hutang_lain') is distinct from 'ubah' then raise exception 'Anda tidak punya hak mencatat pembayaran hutang.'; end if;
  if v_id is not null then
    select * into lama from public.hutang_bayar where id = v_id for update;
    if lama.id is null then raise exception 'Pembayaran tidak ditemukan.'; end if;
  end if;
  select * into h from public.hutang where id = coalesce(lama.hutang_id, nullif(p ->> 'hutang_id', '')::uuid) for update;
  if h.id is null then raise exception 'Hutang tidak ditemukan.'; end if;
  if v_tgl is null then raise exception 'Tanggal bayar wajib diisi.'; end if;
  if v_tgl < h.tgl_mulai then raise exception 'Tanggal bayar tidak boleh sebelum tanggal mulai pinjaman.'; end if;
  if v_tgl < h.tgl_saldo_awal then raise exception 'Tanggal bayar tidak boleh sebelum tanggal saldo awal (pembayaran lama sudah termasuk di sisa pokok awal).'; end if;
  if v_pokok < 0 or v_bunga < 0 or v_denda < 0 then raise exception 'Pokok, bunga, dan denda harus rupiah utuh, tidak minus.'; end if;
  if v_pokok + v_bunga + v_denda <= 0 then raise exception 'Isi jumlah yang dibayar (pokok, bunga, atau denda).'; end if;
  v_sisa := public.sisa_pokok_hutang(h.id, v_id);
  if v_pokok > v_sisa then
    raise exception 'Porsi pokok Rp % melebihi sisa pokok Rp %.', to_char(v_pokok, 'FM999G999G999G999'), to_char(v_sisa, 'FM999G999G999G999');
  end if;
  if v_ke is not null then
    select tanggal into v_tgl_ang from public.hutang_angsuran where hutang_id = h.id and ke = v_ke;
    if v_tgl_ang is null then raise exception 'Angsuran ke-% tidak ada di jadwal.', v_ke; end if;
    if v_tgl_ang < h.tgl_saldo_awal then raise exception 'Angsuran ke-% sudah dibayar sebelum memakai aplikasi (termasuk saldo awal).', v_ke; end if;
  end if;
  if not exists (select 1 from public.rekening where id = nullif(p ->> 'rekening_id', '')::uuid and (aktif or id = lama.rekening_id)) then
    raise exception 'Rekening pembayar wajib dipilih (rekening aktif).';
  end if;
  if v_id is null then
    insert into public.hutang_bayar (hutang_id, angsuran_ke, tanggal, pokok, bunga, denda, rekening_id, bukti, catatan)
    values (h.id, v_ke, v_tgl, v_pokok, v_bunga, v_denda, (p ->> 'rekening_id')::uuid, p -> 'bukti', nullif(btrim(p ->> 'catatan'), '')) returning id into v_id;
  else
    update public.hutang_bayar set angsuran_ke = v_ke, tanggal = v_tgl, pokok = v_pokok, bunga = v_bunga, denda = v_denda, rekening_id = (p ->> 'rekening_id')::uuid,
      bukti = p -> 'bukti', catatan = nullif(btrim(p ->> 'catatan'), '') where id = v_id;
  end if;
  perform public.jurnal_bayar_hutang(v_id);
  return v_id;
end $$;

create or replace function public.hapus_bayar_hutang(p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if public.hak('hutang_lain') is distinct from 'ubah' then raise exception 'Anda tidak punya hak menghapus pembayaran hutang.'; end if;
  delete from public.hutang_bayar where id = p_id;
  perform public.jurnal_bayar_hutang(p_id);
end $$;

-- =====================================================================
-- 5. ASET KREDIT / LEASING DENGAN UANG MUKA (versi baru fungsi Tahap 5)
-- =====================================================================
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
      jsonb_build_object('jenis', 'aset_kas', 'jumlah', case when a.cara = 'tunai' then a.harga + a.biaya_tambahan - a.diskon + a.ppn else a.uang_muka end),
      jsonb_build_object('jenis', 'aset_hutang', 'jumlah', case when a.cara = 'tunai' then 0 else a.harga + a.biaya_tambahan - a.diskon + a.ppn - a.uang_muka end)),
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
  v_dp bigint := 0; v_hu_pokok bigint;
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
  -- Tahap 6: uang muka (DP) kredit / leasing dibayar dari rekening; sisanya hutang 2-8.
  if v_cara in ('kredit', 'leasing') then v_dp := coalesce(nullif(p ->> 'uang_muka', '')::bigint, 0); end if;
  if v_dp < 0 then raise exception 'Uang muka harus rupiah utuh, tidak minus.'; end if;
  if v_dp > 0 and v_dp >= v_harga + v_bt - v_diskon + v_ppn then raise exception 'Uang muka harus lebih kecil dari nilai yang dibayar. Bila lunas, pilih cara Tunai.'; end if;
  if v_dp > 0 and not exists (select 1 from public.rekening where id = nullif(p ->> 'rekening_id', '')::uuid and (aktif or id = lama.rekening_id)) then
    raise exception 'Rekening pembayar uang muka wajib dipilih (rekening aktif).';
  end if;
  if lama.hutang_id is not null then
    select pokok into v_hu_pokok from public.hutang where id = lama.hutang_id;
    if v_hu_pokok is not null and (v_cara not in ('kredit', 'leasing') or v_harga + v_bt - v_diskon + v_ppn - v_dp <> v_hu_pokok) then
      raise exception 'Aset ini tertaut ke hutang (pokok Rp %). Cara perolehan dan nilai hutang (nilai dibayar − uang muka) harus tetap sama; ubah atau lepaskan tautan di menu Hutang Lain dulu.',
        to_char(v_hu_pokok, 'FM999G999G999G999');
    end if;
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
    coalesce(lama.rekening_id::text, ''), lama.kategori_id, lama.tgl_saldo_awal, lama.uang_muka) is distinct from
    (v_tgl, v_harga, v_ppn, v_kredit, v_bt, v_diskon, v_cara, coalesce(case when v_cara = 'tunai' or v_dp > 0 then p ->> 'rekening_id' end, ''), kat.id, v_saldo, v_dp);
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
    cara = v_cara, rekening_id = case when v_cara = 'tunai' or v_dp > 0 then (p ->> 'rekening_id')::uuid end, tgl_saldo_awal = v_saldo, uang_muka = v_dp,
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
  if exists (select 1 from public.hutang where aset_id = p_id or jaminan_aset_id = p_id) then
    raise exception 'Aset ini tertaut ke hutang di menu Hutang Lain (kredit / leasing atau jaminan). Hapus atau ubah hutangnya dulu.';
  end if;
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

-- =====================================================================
-- 6. TUTUP BUKU DAN AUDIT
-- =====================================================================
do $$
declare t text;
begin
  execute 'drop trigger if exists hutang_bayar_tutup_buku on public.hutang_bayar';
  execute 'create trigger hutang_bayar_tutup_buku before insert or update or delete on public.hutang_bayar for each row execute function public.jaga_tutup_buku(''tanggal'')';
  foreach t in array array['kreditur', 'hutang', 'hutang_angsuran', 'hutang_bayar'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.catat_audit()', t || '_audit', t);
  end loop;
end $$;

-- =====================================================================
-- 7. PULIHKAN CADANGAN: ikut memulihkan data Tahap 6
-- =====================================================================
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
  -- Tahap 6 (hanya bila cadangan berisi data hutang).
  if p ? 'hutang' then
    delete from public.jurnal where sumber in ('hutang', 'bayar_hutang');
    delete from public.hutang_bayar;
    delete from public.hutang;
    delete from public.kreditur;
  end if;
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
  -- Tahap 6: kreditur, hutang, jadwal, pembayaran; jurnalnya dibuat ulang.
  if p ? 'hutang' then
    insert into public.kreditur select * from jsonb_populate_recordset(null::public.kreditur, coalesce(p -> 'kreditur', '[]'::jsonb));
    insert into public.hutang select * from jsonb_populate_recordset(null::public.hutang, coalesce(p -> 'hutang', '[]'::jsonb));
    insert into public.hutang_angsuran select * from jsonb_populate_recordset(null::public.hutang_angsuran, coalesce(p -> 'hutang_angsuran', '[]'::jsonb));
    insert into public.hutang_bayar select * from jsonb_populate_recordset(null::public.hutang_bayar, coalesce(p -> 'hutang_bayar', '[]'::jsonb));
    for a in select id from public.hutang loop perform public.jurnal_hutang(a.id); end loop;
    for a in select id from public.hutang_bayar loop perform public.jurnal_bayar_hutang(a.id); end loop;
  end if;
  insert into public.tutup_buku (bulan) select (x ->> 'bulan')::date from jsonb_array_elements(coalesce(p -> 'tutup_buku', '[]'::jsonb)) x;
  perform set_config('alinea.pulihkan', '', true);
end $$;

-- =====================================================================
-- 8. AKSES (RLS) DAN IZIN
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array['kreditur', 'hutang', 'hutang_angsuran', 'hutang_bayar'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_baca', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.hak(''hutang_lain'') is not null)', t || '_baca', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- Rekening dibaca untuk nama rekening penerima / pembayar hutang; aset dibaca untuk tautan kredit / jaminan.
drop policy if exists rekening_baca on public.rekening;
create policy rekening_baca on public.rekening for select to authenticated
  using (public.hak('kas') is not null or public.hak('jurnal') is not null or public.hak('pengaturan') is not null or public.baca_keuangan_proyek()
         or public.hak('aset') is not null or public.hak('hutang_lain') is not null);
drop policy if exists aset_baca_hutang on public.aset;
create policy aset_baca_hutang on public.aset for select to authenticated using (public.hak('hutang_lain') is not null);

grant execute on function public.simpan_kreditur(uuid, jsonb), public.simpan_hutang(uuid, jsonb, jsonb), public.hapus_hutang(uuid),
  public.simpan_jadwal_hutang(uuid, jsonb, text), public.simpan_bayar_hutang(uuid, jsonb), public.hapus_bayar_hutang(uuid) to authenticated;
revoke execute on function public.jurnal_hutang(uuid), public.jurnal_bayar_hutang(uuid), public.sisa_pokok_hutang(uuid, uuid) from public, anon, authenticated;

-- Perjanjian (PDF) dan bukti transfer angsuran (folder hutang/).
drop policy if exists bukti_hutang_baca on storage.objects;
create policy bukti_hutang_baca on storage.objects for select to authenticated using (
  bucket_id = 'bukti-keuangan' and (storage.foldername(name))[1] = 'hutang' and public.hak('hutang_lain') is not null);
drop policy if exists bukti_hutang_tambah on storage.objects;
create policy bukti_hutang_tambah on storage.objects for insert to authenticated with check (
  bucket_id = 'bukti-keuangan' and (storage.foldername(name))[1] = 'hutang' and public.hak('hutang_lain') = 'ubah');
drop policy if exists bukti_hutang_hapus on storage.objects;
create policy bukti_hutang_hapus on storage.objects for delete to authenticated using (
  bucket_id = 'bukti-keuangan' and (storage.foldername(name))[1] = 'hutang' and public.hak('hutang_lain') = 'ubah');

-- =====================================================================
-- 9. PEMERIKSAAN
-- =====================================================================
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('kreditur', 'hutang', 'hutang_angsuran', 'hutang_bayar')) as tabel_baru, -- 4
  (select count(*) from public.pemetaan_jurnal where jenis like 'hutang_%' or jenis like 'bayar_hutang_%') as pemetaan_baru,                         -- 7
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'aset' and column_name = 'uang_muka') as kolom_uang_muka, -- 1
  (select count(*) from arsip_tahap6.records) as data_lama_diarsipkan,
  (select count(*) from public.records where tabel = 'hutang_lain') as data_lama_tersisa;                                                          -- 0
