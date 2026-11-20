-- Alinea 5 — Migrasi Tahap 5: Aset + Penyusutan Fiskal.
-- Jalankan SETELAH 4-proyek.sql. Aman dijalankan ulang. Pembatalan: 5-batal.sql. Uji: 5-uji.sql.
-- Uang: rupiah utuh (bigint). Persen dalam basis poin (1250 = 12,50%). Umur ekonomis disimpan dalam bulan.
-- Data Aset bentuk lama (tabel records, tabel 'aset') DIARSIPKAN ke arsip_tahap5.records, tidak dihapus.
-- Jurnal:
--  - Perolehan: D Aset (akun kategori) + D PPN Masukan 1-4 (bila dikreditkan) / K Kas-Bank atau K Hutang Bank/Leasing 2-8.
--  - Penyusutan (dibukukan per bulan, per kategori): D Beban Penyusutan 6-4 / K Akumulasi Penyusutan (akun kategori).
--  - Pelepasan: D Akumulasi + D Kas (nilai jual) + D Rugi Pelepasan 7-2 / K Aset + K Laba Pelepasan 4-4.
--  - Servis biasa: D Perawatan & Servis 6-5 / K Kas. Servis dikapitalisasi: D Aset / K Kas.
-- Penyusutan fiskal (buku pajak) TIDAK dijurnal; dihitung aplikasi untuk Laporan Pajak.

-- Pemeriksaan awal: Tahap 4 (4-proyek.sql) harus sudah terpasang.
do $$
begin
  if to_regclass('public.pembelian') is null or to_regprocedure('public.simpan_pembelian(uuid, jsonb, jsonb)') is null then
    raise exception 'Database Tahap 4 belum terpasang. Jalankan dulu supabase/migrasi/4-proyek.sql (lalu 4-uji.sql), baru 5-aset.sql.';
  end if;
end $$;

-- =====================================================================
-- 1. ARSIP DATA ASET BENTUK LAMA
-- =====================================================================
create schema if not exists arsip_tahap5;
create table if not exists arsip_tahap5.records as select * from public.records where false;
alter table arsip_tahap5.records enable row level security;
revoke all on schema arsip_tahap5 from anon, authenticated;
insert into arsip_tahap5.records
  select * from public.records r
  where r.tabel = 'aset' and not exists (select 1 from arsip_tahap5.records a where a.id = r.id);
delete from public.records where tabel = 'aset';

-- =====================================================================
-- 2. AKUN, PENGATURAN, DAN TANDA BARANG MODAL
-- =====================================================================
insert into public.akun (kode, nama, golongan, standar, induk_id)
select '4-4', 'Laba Pelepasan Aset', 4, true, public.akun_kode('4')
on conflict (kode) do nothing;

alter table public.akuntansi add column if not exists metode_fiskal text not null default 'garis_lurus'
  check (metode_fiskal in ('garis_lurus', 'saldo_menurun'));
-- Barang modal di bawah batas kapitalisasi yang dibebankan langsung (Laporan Pajak bagian c).
alter table public.kas_transaksi add column if not exists barang_modal boolean not null default false;
alter table public.pembelian add column if not exists barang_modal boolean not null default false;

-- =====================================================================
-- 3. TABEL
-- =====================================================================
-- Kelompok fiskal: tarif_sm_bp kosong = bangunan (selalu garis lurus).
create table if not exists public.kelompok_fiskal (
  id uuid primary key default gen_random_uuid(),
  perusahaan_id uuid not null default public.perusahaan_tunggal() references public.perusahaan (id),
  nama text not null unique check (btrim(nama) <> ''),
  masa_tahun integer not null check (masa_tahun between 1 and 100),
  tarif_gl_bp integer not null check (tarif_gl_bp between 1 and 10000),
  tarif_sm_bp integer check (tarif_sm_bp between 1 and 10000),
  urut integer not null default 0,
  aktif boolean not null default true,
  dibuat timestamptz not null default now()
);

create table if not exists public.aset_kategori (
  id uuid primary key default gen_random_uuid(),
  perusahaan_id uuid not null default public.perusahaan_tunggal() references public.perusahaan (id),
  nama text not null unique check (btrim(nama) <> ''),
  prefix text not null unique check (prefix ~ '^[A-Z0-9]{1,6}$'),
  jenis text not null default 'berwujud' check (jenis in ('berwujud', 'tak_berwujud')),
  disusutkan boolean not null default true,
  umur_bulan integer check (umur_bulan between 1 and 1200),
  kelompok_id uuid references public.kelompok_fiskal (id),
  akun_aset_id uuid not null references public.akun (id),
  akun_akumulasi_id uuid references public.akun (id),
  akun_beban_id uuid references public.akun (id),
  urut integer not null default 0,
  aktif boolean not null default true,
  dibuat timestamptz not null default now(),
  check (not disusutkan or (akun_akumulasi_id is not null and akun_beban_id is not null))
);

create table if not exists public.aset_lokasi (
  id uuid primary key default gen_random_uuid(),
  perusahaan_id uuid not null default public.perusahaan_tunggal() references public.perusahaan (id),
  nama text not null unique check (btrim(nama) <> ''),
  aktif boolean not null default true,
  dibuat timestamptz not null default now()
);

create table if not exists public.aset (
  id uuid primary key default gen_random_uuid(),
  perusahaan_id uuid not null default public.perusahaan_tunggal() references public.perusahaan (id),
  kode text not null unique,
  nama text not null check (btrim(nama) <> ''),
  kategori_id uuid not null references public.aset_kategori (id),
  no_seri text,
  supplier_id uuid,
  supplier_nama text,
  faktur jsonb not null default '[]'::jsonb,
  foto jsonb not null default '[]'::jsonb,
  tgl_perolehan date not null,
  harga bigint not null check (harga >= 0),
  ppn bigint not null default 0 check (ppn >= 0),
  ppn_kredit boolean not null default false,
  biaya_tambahan bigint not null default 0 check (biaya_tambahan >= 0),
  diskon bigint not null default 0 check (diskon >= 0),
  nilai_perolehan bigint not null check (nilai_perolehan > 0),
  di_bawah_batas boolean not null default false,
  cara text not null check (cara in ('tunai', 'kredit', 'leasing', 'saldo_awal')),
  rekening_id uuid references public.rekening (id),
  hutang_id uuid, -- diisi di Tahap 6 (Hutang Lain); kosong = menunggu tautan hutang
  tgl_mulai date,
  umur_bulan integer check (umur_bulan between 1 and 1200),
  residu bigint not null default 0 check (residu >= 0),
  kelompok_id uuid references public.kelompok_fiskal (id),
  bulan_fiskal date,
  pemegang_id uuid,
  pemegang_nama text,
  lokasi_id uuid references public.aset_lokasi (id),
  kondisi text not null default 'Baik' check (kondisi in ('Baik', 'Perlu servis', 'Rusak')),
  status text not null default 'Aktif' check (status in ('Aktif', 'Dijual', 'Dihapuskan', 'Hilang')),
  tgl_pelepasan date,
  nilai_jual bigint not null default 0 check (nilai_jual >= 0),
  rekening_jual_id uuid references public.rekening (id),
  alasan_pelepasan text,
  akumulasi_lepas bigint,
  nilai_buku_lepas bigint,
  laba_lepas bigint,
  catatan text,
  dibuat timestamptz not null default now(),
  dibuat_oleh uuid default auth.uid(),
  check (nilai_perolehan = harga + biaya_tambahan - diskon + case when ppn_kredit then 0 else ppn end),
  check (cara <> 'tunai' or rekening_id is not null),
  check (not ppn_kredit or ppn > 0),
  check ((status = 'Aktif') = (tgl_pelepasan is null)),
  check (status in ('Aktif', 'Dijual') or nilai_jual = 0),
  check (nilai_jual = 0 or rekening_jual_id is not null),
  check (tgl_mulai is null or tgl_mulai >= tgl_perolehan),
  check (tgl_pelepasan is null or tgl_pelepasan >= tgl_perolehan)
);
create index if not exists aset_kategori_idx on public.aset (kategori_id);
-- Saldo awal (aset yang dimiliki sebelum memakai aplikasi) dan PPN keluaran atas penjualan aset.
-- Ditulis dengan "if not exists" / drop-add supaya file ini aman dijalankan ulang.
alter table public.aset add column if not exists tgl_saldo_awal date;
alter table public.aset add column if not exists akumulasi_awal bigint not null default 0;
alter table public.aset add column if not exists ppn_jual bigint not null default 0;
alter table public.aset drop constraint if exists aset_cara_check;
alter table public.aset add constraint aset_cara_check check (cara in ('tunai', 'kredit', 'leasing', 'saldo_awal'));
alter table public.aset drop constraint if exists aset_saldo_awal_cek;
alter table public.aset add constraint aset_saldo_awal_cek check ((cara = 'saldo_awal') = (tgl_saldo_awal is not null)
  and (tgl_saldo_awal is null or tgl_saldo_awal >= tgl_perolehan) and akumulasi_awal >= 0 and (cara = 'saldo_awal' or akumulasi_awal = 0));
alter table public.aset drop constraint if exists aset_ppn_jual_cek;
alter table public.aset add constraint aset_ppn_jual_cek check (ppn_jual >= 0 and (ppn_jual = 0 or (status = 'Dijual' and nilai_jual > 0)));

-- Riwayat mutasi penempatan (pemegang / lokasi). Tidak ditimpa: setiap perubahan baris baru.
create table if not exists public.aset_mutasi (
  id uuid primary key default gen_random_uuid(),
  perusahaan_id uuid not null default public.perusahaan_tunggal() references public.perusahaan (id),
  aset_id uuid not null references public.aset (id) on delete cascade,
  tanggal date not null,
  dari_pemegang text,
  ke_pemegang text,
  dari_lokasi text,
  ke_lokasi text,
  catatan text,
  dibuat timestamptz not null default now(),
  dibuat_oleh uuid default auth.uid()
);
create index if not exists aset_mutasi_idx on public.aset_mutasi (aset_id);

create table if not exists public.aset_servis (
  id uuid primary key default gen_random_uuid(),
  perusahaan_id uuid not null default public.perusahaan_tunggal() references public.perusahaan (id),
  aset_id uuid not null references public.aset (id),
  tanggal date not null,
  uraian text not null check (btrim(uraian) <> ''),
  biaya bigint not null default 0 check (biaya >= 0),
  vendor_id uuid,
  vendor_nama text,
  nota jsonb,
  rekening_id uuid references public.rekening (id),
  kapitalisasi boolean not null default false,
  sisa_umur_bulan integer check (sisa_umur_bulan between 1 and 1200),
  dibuat timestamptz not null default now(),
  dibuat_oleh uuid default auth.uid(),
  check (biaya = 0 or rekening_id is not null)
);
create index if not exists aset_servis_idx on public.aset_servis (aset_id);

create table if not exists public.aset_dokumen (
  id uuid primary key default gen_random_uuid(),
  perusahaan_id uuid not null default public.perusahaan_tunggal() references public.perusahaan (id),
  aset_id uuid not null references public.aset (id) on delete cascade,
  jenis text not null check (jenis in ('Pajak tahunan', 'STNK 5 tahunan', 'Lisensi', 'Garansi', 'Asuransi', 'Lainnya')),
  berlaku_sd date,
  file jsonb,
  catatan text,
  dibuat timestamptz not null default now(),
  dibuat_oleh uuid default auth.uid()
);
create index if not exists aset_dokumen_idx on public.aset_dokumen (aset_id);

-- Penyusutan yang sudah dibukukan: satu baris per bulan (satu jurnal), rinciannya per aset.
create table if not exists public.penyusutan_bulan (
  id uuid primary key default gen_random_uuid(),
  perusahaan_id uuid not null default public.perusahaan_tunggal() references public.perusahaan (id),
  bulan date not null unique check (extract(day from bulan) = 1),
  total bigint not null default 0,
  dibuat timestamptz not null default now(),
  dibuat_oleh uuid default auth.uid()
);
create table if not exists public.penyusutan_aset (
  bulan_id uuid not null references public.penyusutan_bulan (id) on delete cascade,
  aset_id uuid not null references public.aset (id),
  jumlah bigint not null,
  primary key (bulan_id, aset_id)
);
create index if not exists penyusutan_aset_idx on public.penyusutan_aset (aset_id);

-- =====================================================================
-- 4. ISI AWAL: KELOMPOK FISKAL DAN KATEGORI ASET (umur & kelompok kategori dikosongkan)
-- =====================================================================
insert into public.kelompok_fiskal (nama, masa_tahun, tarif_gl_bp, tarif_sm_bp, urut) values
  ('Kelompok 1', 4, 2500, 5000, 1), ('Kelompok 2', 8, 1250, 2500, 2), ('Kelompok 3', 16, 625, 1250, 3), ('Kelompok 4', 20, 500, 1000, 4),
  ('Bangunan permanen', 20, 500, null, 5), ('Bangunan tidak permanen', 10, 1000, null, 6)
on conflict (nama) do nothing;

-- Umur dan kelompok bawaan hanya isian awal formulir; bisa diubah di Pengaturan → Aset dan per aset.
insert into public.aset_kategori (nama, prefix, jenis, disusutkan, umur_bulan, kelompok_id, akun_aset_id, akun_akumulasi_id, akun_beban_id, urut)
select v.nama, v.prefix, v.jenis, v.susut, v.umur, (select k.id from public.kelompok_fiskal k where k.nama = v.kel), public.akun_kode(v.aset),
  case when v.susut then public.akun_kode(v.akum) end, case when v.susut then public.akun_kode('6-4') end, v.urut
from (values
  ('Tanah', 'TNH', 'berwujud', false, null::integer, null, '1-7', null, 1),
  ('Bangunan', 'BGN', 'berwujud', true, 240, 'Bangunan permanen', '1-7', '1-8', 2),
  ('Renovasi kantor / bangunan sewa', 'RNV', 'berwujud', true, 60, null, '1-7', '1-8', 3),
  ('Kendaraan', 'KND', 'berwujud', true, 96, 'Kelompok 2', '1-7', '1-8', 4),
  ('Komputer & elektronik', 'KMP', 'berwujud', true, 48, 'Kelompok 1', '1-7', '1-8', 5),
  ('Peralatan kantor', 'PKT', 'berwujud', true, 48, 'Kelompok 1', '1-7', '1-8', 6),
  ('Furnitur', 'FRN', 'berwujud', true, 48, 'Kelompok 1', '1-7', '1-8', 7),
  ('Peralatan proyek / lapangan', 'PPL', 'berwujud', true, 96, 'Kelompok 2', '1-7', '1-8', 8),
  ('Software / lisensi permanen', 'SWL', 'tak_berwujud', true, 48, 'Kelompok 1', '1-9', '1-9', 9)
) as v (nama, prefix, jenis, susut, umur, kel, aset, akum, urut)
on conflict (nama) do nothing;

-- =====================================================================
-- 5. JURNAL: SUMBER BARU, PEMETAAN, DAN AKUN PER BARIS
-- =====================================================================
alter table public.jurnal drop constraint if exists jurnal_sumber_check;
alter table public.jurnal add constraint jurnal_sumber_check check (sumber in ('manual', 'saldo_awal', 'kas', 'transfer', 'penerimaan', 'invoice',
  'opname', 'bayar_vendor', 'pembelian', 'bayar_supplier', 'aset', 'pelepasan_aset', 'servis_aset', 'penyusutan'));

insert into public.pemetaan_jurnal (jenis, urut, nama, sisi, akun, keterangan) values
  ('aset_perolehan', 1, 'Perolehan aset – nilai perolehan', 'D', 'AKUN_ASET', 'Akun aset kategori (mis. 1-7 Aset Tetap, 1-9 Aset Tak Berwujud)'),
  ('aset_ppn', 1, 'Perolehan aset – PPN masukan', 'D', '1-4', 'PPN Masukan (bila PKP dan PPN dapat dikreditkan)'),
  ('aset_kas', 1, 'Perolehan aset – dibayar tunai / transfer', 'K', 'REKENING', 'Rekening pembayar'),
  ('aset_hutang', 1, 'Perolehan aset – kredit / leasing', 'K', '2-8', 'Hutang Bank / Leasing (ditautkan ke Hutang Lain di Tahap 6)'),
  ('aset_saldo_akumulasi', 1, 'Saldo awal aset – akumulasi penyusutan sebelumnya', 'K', 'AKUN_AKUMULASI', 'Akumulasi s.d. bulan sebelum tanggal saldo awal'),
  ('aset_saldo_ekuitas', 1, 'Saldo awal aset – nilai buku', 'K', '3-2-01', 'Ekuitas saldo awal (tanpa uang keluar)'),
  ('susut_beban', 1, 'Penyusutan / amortisasi bulanan – beban', 'D', 'AKUN_BEBAN', 'Akun beban kategori (mis. 6-4 Beban Penyusutan & Amortisasi)'),
  ('susut_akumulasi', 1, 'Penyusutan / amortisasi bulanan – akumulasi', 'K', 'AKUN_AKUMULASI', 'Akun akumulasi kategori (mis. 1-8 Akumulasi Penyusutan)'),
  ('lepas_akumulasi', 1, 'Pelepasan aset – akumulasi dihapus', 'D', 'AKUN_AKUMULASI', 'Akumulasi penyusutan sampai bulan sebelum pelepasan'),
  ('lepas_kas', 1, 'Pelepasan aset – uang hasil penjualan', 'D', 'REKENING', 'Rekening penerima nilai jual + PPN keluaran'),
  ('lepas_ppn', 1, 'Pelepasan aset – PPN keluaran', 'K', '2-5', 'PPN Keluaran atas penjualan aset (bila PKP)'),
  ('lepas_rugi', 1, 'Pelepasan aset – rugi', 'D', '7-2', 'Rugi Pelepasan Aset'),
  ('lepas_laba', 1, 'Pelepasan aset – laba', 'K', '4-4', 'Laba Pelepasan Aset'),
  ('lepas_aset', 1, 'Pelepasan aset – nilai perolehan dihapus', 'K', 'AKUN_ASET', 'Akun aset kategori (nilai perolehan + servis dikapitalisasi)'),
  ('servis_beban', 1, 'Servis aset – biaya biasa', 'D', '6-5', 'Perawatan & Servis'),
  ('servis_aset', 1, 'Servis aset – dikapitalisasi', 'D', 'AKUN_ASET', 'Menambah nilai aset (akun aset kategori)'),
  ('servis_kas', 1, 'Servis aset – uang keluar', 'K', 'REKENING', 'Rekening pembayar')
on conflict (jenis, urut) do nothing;

-- Sama dengan Tahap 1, ditambah: setiap baris p_baris boleh membawa "isi" sendiri (akun per kategori dalam satu jurnal).
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
      akun_id := case when m.akun ~ '^[0-9]' then public.akun_kode(m.akun) else coalesce(b -> 'isi' ->> m.akun, p_isi ->> m.akun)::uuid end;
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

-- =====================================================================
-- 6. RUMUS PENYUSUTAN KOMERSIAL (sama dengan js/aset-util.js)
-- =====================================================================
-- Indeks bulan: tahun × 12 + (bulan − 1).
create or replace function public.idx_bulan(d date)
returns integer language sql immutable set search_path = ''
as $$ select (extract(year from d)::int * 12 + extract(month from d)::int - 1) $$;
create or replace function public.bulan_idx(i integer)
returns date language sql immutable set search_path = ''
as $$ select make_date(i / 12, i % 12 + 1, 1) $$;

-- Akumulasi penyusutan komersial satu aset sampai akhir bulan berindeks p_x.
-- Garis lurus mulai bulan "tanggal mulai digunakan" (1 bulan penuh), berhenti saat habis atau sebelum bulan pelepasan.
-- Servis dikapitalisasi di bulan T: nilai buku akhir T + biaya − residu disusutkan ulang mulai T+1 selama sisa umur baru.
create or replace function public.akumulasi_aset(p_aset uuid, p_x integer)
returns bigint language plpgsql stable security definer set search_path = ''
as $$
declare
  a public.aset;
  v_susut boolean;
  v_s int; v_l int; v_batas int; v_t int;
  v_a bigint := 0; v_n bigint; v_r bigint; v_b bigint; v_acc bigint;
  x record;
begin
  select * into a from public.aset where id = p_aset;
  if a.id is null then return 0; end if;
  select disusutkan into v_susut from public.aset_kategori where id = a.kategori_id;
  if not coalesce(v_susut, false) or coalesce(a.umur_bulan, 0) <= 0 or a.tgl_mulai is null then return 0; end if;
  v_batas := case when a.status <> 'Aktif' and a.tgl_pelepasan is not null then least(p_x, public.idx_bulan(a.tgl_pelepasan) - 1) else p_x end;
  v_s := public.idx_bulan(a.tgl_mulai); v_l := a.umur_bulan; v_n := a.nilai_perolehan; v_r := a.residu;
  v_b := greatest(0, v_n - v_r);
  for x in select tanggal, biaya, sisa_umur_bulan from public.aset_servis where aset_id = a.id and kapitalisasi and biaya > 0 order by tanggal, dibuat, id loop
    v_t := public.idx_bulan(x.tanggal);
    exit when v_t >= v_batas;
    v_acc := v_a + public.bagi(v_b, least(greatest(v_t - v_s + 1, 0), v_l), v_l);
    v_n := v_n + x.biaya;
    v_a := v_acc;
    v_b := greatest(0, v_n - v_acc - v_r);
    v_s := v_t + 1;
    v_l := greatest(1, coalesce(x.sisa_umur_bulan, 1));
  end loop;
  return v_a + public.bagi(v_b, least(greatest(v_batas - v_s + 1, 0), v_l), v_l);
end $$;

-- Nilai perolehan pada tanggal: nilai awal + servis dikapitalisasi sampai tanggal itu.
create or replace function public.perolehan_aset_pada(p_aset uuid, p_tgl date)
returns bigint language sql stable security definer set search_path = ''
as $$
  select a.nilai_perolehan + coalesce((select sum(s.biaya) from public.aset_servis s where s.aset_id = a.id and s.kapitalisasi and s.tanggal <= p_tgl), 0)
  from public.aset a where a.id = p_aset
$$;

-- =====================================================================
-- 7. JURNAL ASET
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
      jsonb_build_object('jenis', case when a.cara = 'tunai' then 'aset_kas' else 'aset_hutang' end, 'jumlah', a.harga + a.biaya_tambahan - a.diskon + a.ppn)),
    jsonb_build_object('AKUN_ASET', k.akun_aset_id, 'REKENING', public.akun_rekening(a.rekening_id)));
end $$;

create or replace function public.jurnal_pelepasan_aset(p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare a public.aset; k public.aset_kategori;
begin
  select * into a from public.aset where id = p_id;
  if a.id is null or a.status = 'Aktif' then perform public.jurnal_otomatis('pelepasan_aset', p_id, null, null, null, null); return; end if;
  select * into k from public.aset_kategori where id = a.kategori_id;
  perform public.jurnal_otomatis('pelepasan_aset', a.id, a.tgl_pelepasan, 'Pelepasan aset ' || a.kode || ' ' || a.nama || ' (' || lower(a.status) || ')',
    jsonb_build_array(jsonb_build_object('jenis', 'lepas_akumulasi', 'jumlah', a.akumulasi_lepas),
      jsonb_build_object('jenis', 'lepas_kas', 'jumlah', a.nilai_jual + a.ppn_jual),
      jsonb_build_object('jenis', 'lepas_ppn', 'jumlah', a.ppn_jual),
      jsonb_build_object('jenis', 'lepas_rugi', 'jumlah', greatest(-a.laba_lepas, 0)),
      jsonb_build_object('jenis', 'lepas_laba', 'jumlah', greatest(a.laba_lepas, 0)),
      jsonb_build_object('jenis', 'lepas_aset', 'jumlah', a.akumulasi_lepas + a.nilai_buku_lepas)),
    jsonb_build_object('AKUN_ASET', k.akun_aset_id, 'AKUN_AKUMULASI', k.akun_akumulasi_id, 'REKENING', public.akun_rekening(a.rekening_jual_id)));
end $$;

create or replace function public.jurnal_servis_aset(p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare s public.aset_servis; a public.aset; k public.aset_kategori;
begin
  select * into s from public.aset_servis where id = p_id;
  if s.id is null then perform public.jurnal_otomatis('servis_aset', p_id, null, null, null, null); return; end if;
  select * into a from public.aset where id = s.aset_id;
  select * into k from public.aset_kategori where id = a.kategori_id;
  perform public.jurnal_otomatis('servis_aset', s.id, s.tanggal, 'Servis ' || a.kode || ' ' || a.nama || ' · ' || s.uraian,
    jsonb_build_array(jsonb_build_object('jenis', case when s.kapitalisasi then 'servis_aset' else 'servis_beban' end, 'jumlah', s.biaya),
      jsonb_build_object('jenis', 'servis_kas', 'jumlah', s.biaya)),
    jsonb_build_object('AKUN_ASET', k.akun_aset_id, 'REKENING', public.akun_rekening(s.rekening_id)));
end $$;

-- Satu jurnal per bulan, baris per kategori (pasangan akun beban & akumulasi).
create or replace function public.jurnal_penyusutan(p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare b public.penyusutan_bulan;
begin
  select * into b from public.penyusutan_bulan where id = p_id;
  if b.id is null then perform public.jurnal_otomatis('penyusutan', p_id, null, null, null, null); return; end if;
  perform public.jurnal_otomatis('penyusutan', b.id, (b.bulan + interval '1 month' - interval '1 day')::date, 'Penyusutan & amortisasi ' || public.nama_bulan(b.bulan),
    (select coalesce(jsonb_agg(v.e order by g.beban, g.akum, v.u), '[]'::jsonb)
     from (select k.akun_beban_id as beban, k.akun_akumulasi_id as akum, sum(pa.jumlah) as jml
           from public.penyusutan_aset pa join public.aset a on a.id = pa.aset_id join public.aset_kategori k on k.id = a.kategori_id
           where pa.bulan_id = b.id group by 1, 2) g,
     lateral (values (1, jsonb_build_object('jenis', 'susut_beban', 'jumlah', g.jml, 'isi', jsonb_build_object('AKUN_BEBAN', g.beban))),
                     (2, jsonb_build_object('jenis', 'susut_akumulasi', 'jumlah', g.jml, 'isi', jsonb_build_object('AKUN_AKUMULASI', g.akum)))) v (u, e)),
    '{}'::jsonb);
end $$;

-- =====================================================================
-- 8. SIMPAN / HAPUS ASET
-- =====================================================================
-- p: isi formulir aset. Kode, nilai perolehan, nilai buku & laba/rugi pelepasan dihitung di sini.
-- Jurnal perolehan / pelepasan dibuat ulang hanya bila isian keuangannya berubah (data lain boleh diubah walau bulannya sudah ditutup).
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

-- Hapus aset (koreksi salah input): hanya bila belum ada penyusutan di bulan yang sudah ditutup dan belum ada servis.
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

-- =====================================================================
-- 9. SERVIS ASET
-- =====================================================================
-- Biasa = beban (OPEX). Dikapitalisasi (centang + biaya ≥ batas kapitalisasi) = menambah nilai aset; sisa umur dapat diubah.
create or replace function public.simpan_servis_aset(p_id uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  lama public.aset_servis;
  a public.aset;
  v_susut boolean;
  v_id uuid := p_id;
  v_tgl date := nullif(p ->> 'tanggal', '')::date;
  v_biaya bigint := coalesce(nullif(p ->> 'biaya', '')::bigint, 0);
  v_kap boolean := coalesce((p ->> 'kapitalisasi')::boolean, false);
  v_sisa int := nullif(p ->> 'sisa_umur_bulan', '')::int;
  v_batas bigint;
  v_ven_id uuid; v_ven_nama text;
begin
  if public.hak('aset') is distinct from 'ubah' then raise exception 'Anda tidak punya hak mencatat servis aset.'; end if;
  if v_id is not null then
    select * into lama from public.aset_servis where id = v_id for update;
    if lama.id is null then raise exception 'Servis tidak ditemukan.'; end if;
  end if;
  select * into a from public.aset where id = coalesce(lama.aset_id, nullif(p ->> 'aset_id', '')::uuid) for update;
  if a.id is null then raise exception 'Aset tidak ditemukan.'; end if;
  select disusutkan into v_susut from public.aset_kategori where id = a.kategori_id;
  if v_tgl is null then raise exception 'Tanggal servis wajib diisi.'; end if;
  if v_tgl < a.tgl_perolehan then raise exception 'Tanggal servis tidak boleh sebelum tanggal perolehan aset.'; end if;
  if v_tgl < a.tgl_saldo_awal then raise exception 'Servis sebelum tanggal saldo awal tidak dicatat (sudah termasuk dalam nilai saldo awal aset).'; end if;
  if a.status <> 'Aktif' and v_tgl > a.tgl_pelepasan then raise exception 'Aset sudah dilepas; servis setelah tanggal pelepasan tidak bisa dicatat.'; end if;
  if btrim(coalesce(p ->> 'uraian', '')) = '' then raise exception 'Uraian servis wajib diisi.'; end if;
  if v_biaya < 0 then raise exception 'Biaya tidak boleh minus.'; end if;
  if v_biaya > 0 and not exists (select 1 from public.rekening where id = nullif(p ->> 'rekening_id', '')::uuid and (aktif or id = lama.rekening_id)) then
    raise exception 'Rekening pembayar wajib dipilih (rekening aktif).';
  end if;
  if v_kap then
    select batas_kapitalisasi into v_batas from public.akuntansi limit 1;
    if v_biaya < coalesce(v_batas, 0) then raise exception 'Servis hanya bisa dikapitalisasi bila biayanya mencapai batas kapitalisasi (Rp %).', to_char(v_batas, 'FM999G999G999G999'); end if;
    if a.status <> 'Aktif' then raise exception 'Aset sudah dilepas; servis tidak bisa dikapitalisasi.'; end if;
    if coalesce(v_susut, false) and a.umur_bulan is not null then
      if v_tgl < a.tgl_mulai then raise exception 'Servis yang dikapitalisasi harus bertanggal sejak aset mulai digunakan.'; end if;
      if coalesce(v_sisa, 0) <= 0 then raise exception 'Isi sisa umur (bulan) setelah servis, lebih dari 0.'; end if;
    else
      v_sisa := null;
    end if;
  else
    v_sisa := null;
  end if;
  if nullif(p ->> 'vendor_id', '') is not null then
    select id, data ->> 'nama' into v_ven_id, v_ven_nama from public.records where tabel = 'supplier' and id = (p ->> 'vendor_id')::uuid;
    if v_ven_id is null then raise exception 'Vendor / bengkel wajib dipilih dari master Supplier.'; end if;
  end if;
  if v_id is null then
    insert into public.aset_servis (aset_id, tanggal, uraian, biaya, vendor_id, vendor_nama, nota, rekening_id, kapitalisasi, sisa_umur_bulan)
    values (a.id, v_tgl, btrim(p ->> 'uraian'), v_biaya, v_ven_id, v_ven_nama, p -> 'nota', case when v_biaya > 0 then (p ->> 'rekening_id')::uuid end, v_kap, v_sisa)
    returning id into v_id;
  else
    update public.aset_servis set tanggal = v_tgl, uraian = btrim(p ->> 'uraian'), biaya = v_biaya, vendor_id = v_ven_id, vendor_nama = v_ven_nama, nota = p -> 'nota',
      rekening_id = case when v_biaya > 0 then (p ->> 'rekening_id')::uuid end, kapitalisasi = v_kap, sisa_umur_bulan = v_sisa
    where id = v_id;
  end if;
  perform public.jurnal_servis_aset(v_id);
  return v_id;
end $$;

create or replace function public.hapus_servis_aset(p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if public.hak('aset') is distinct from 'ubah' then raise exception 'Anda tidak punya hak menghapus servis aset.'; end if;
  delete from public.aset_servis where id = p_id;
  perform public.jurnal_servis_aset(p_id);
end $$;

-- =====================================================================
-- 10. PEMBUKUAN PENYUSUTAN BULANAN
-- =====================================================================
-- Membukukan penyusutan setiap bulan yang belum ditutup, dari bulan aset pertama sampai bulan p_sampai.
-- Jumlah per aset per bulan = akumulasi s.d. bulan itu − yang sudah dibukukan di bulan-bulan sebelumnya,
-- sehingga penyusutan yang tertinggal (aset dicatat terlambat, bulan sudah ditutup) dibukukan sekaligus di bulan terbuka berikutnya.
-- Bulan yang isinya tidak berubah tidak disentuh. Hasil: jumlah bulan yang dibukukan ulang.
create or replace function public.bukukan_penyusutan(p_sampai date default null)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  v_sampai int := public.idx_bulan(coalesce(p_sampai, public.hari_ini()));
  v_awal int;
  v_x int;
  v_bulan date;
  v_ingin jsonb; v_ada jsonb;
  v_pb public.penyusutan_bulan;
  v_berubah int := 0;
begin
  if public.hak('aset') is distinct from 'ubah' then raise exception 'Anda tidak punya hak membukukan penyusutan.'; end if;
  perform pg_advisory_xact_lock(hashtext('bukukan_penyusutan'));
  select least((select min(greatest(public.idx_bulan(a.tgl_mulai), coalesce(public.idx_bulan(a.tgl_saldo_awal), 0))) from public.aset a join public.aset_kategori k on k.id = a.kategori_id
                where k.disusutkan and a.umur_bulan > 0 and a.tgl_mulai is not null),
               (select min(public.idx_bulan(bulan)) from public.penyusutan_bulan)) into v_awal;
  if v_awal is null then return 0; end if;
  for v_x in v_awal .. v_sampai loop
    v_bulan := public.bulan_idx(v_x);
    continue when public.bulan_terkunci(v_bulan);
    select coalesce(jsonb_object_agg(x.id, x.jumlah) filter (where x.jumlah <> 0), '{}'::jsonb) into v_ingin
    from (select a.id, public.akumulasi_aset(a.id, v_x)
            -- Aset saldo awal: penyusutan sebelum bulan saldo awal sudah masuk jurnal saldo awal (akumulasi_awal).
            - case when a.cara <> 'saldo_awal' then 0 when v_x < public.idx_bulan(a.tgl_saldo_awal) then public.akumulasi_aset(a.id, v_x) else a.akumulasi_awal end
            - coalesce((select sum(pa.jumlah) from public.penyusutan_aset pa join public.penyusutan_bulan b on b.id = pa.bulan_id
                        where pa.aset_id = a.id and b.bulan < v_bulan), 0) as jumlah
          from public.aset a) x;
    select * into v_pb from public.penyusutan_bulan where bulan = v_bulan;
    select coalesce(jsonb_object_agg(aset_id, jumlah), '{}'::jsonb) into v_ada from public.penyusutan_aset where bulan_id = v_pb.id;
    continue when v_ingin = v_ada;
    v_berubah := v_berubah + 1;
    if v_ingin = '{}'::jsonb then
      delete from public.penyusutan_bulan where id = v_pb.id;
      perform public.jurnal_penyusutan(v_pb.id);
      continue;
    end if;
    if v_pb.id is null then insert into public.penyusutan_bulan (bulan) values (v_bulan) returning * into v_pb; end if;
    delete from public.penyusutan_aset where bulan_id = v_pb.id;
    insert into public.penyusutan_aset (bulan_id, aset_id, jumlah) select v_pb.id, key::uuid, value::bigint from jsonb_each_text(v_ingin);
    update public.penyusutan_bulan set total = (select sum(jumlah) from public.penyusutan_aset where bulan_id = v_pb.id) where id = v_pb.id;
    perform public.jurnal_penyusutan(v_pb.id);
  end loop;
  return v_berubah;
end $$;

-- Tanda "barang modal di bawah batas kapitalisasi" pada pembelian stok kantor (Laporan Pajak bagian c).
create or replace function public.tandai_barang_modal(p_id uuid, p_nilai boolean)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if public.hak('pembelian') is distinct from 'ubah' then raise exception 'Anda tidak punya hak mengubah pembelian.'; end if;
  update public.pembelian set barang_modal = coalesce(p_nilai, false) and tujuan = 'stok'
  where id = p_id and barang_modal is distinct from (coalesce(p_nilai, false) and tujuan = 'stok');
end $$;

-- =====================================================================
-- 11. TUTUP BUKU DAN AUDIT
-- =====================================================================
do $$
declare t text;
begin
  execute 'drop trigger if exists aset_servis_tutup_buku on public.aset_servis';
  execute 'create trigger aset_servis_tutup_buku before insert or update or delete on public.aset_servis for each row execute function public.jaga_tutup_buku(''tanggal'')';
  execute 'drop trigger if exists penyusutan_bulan_tutup_buku on public.penyusutan_bulan';
  execute 'create trigger penyusutan_bulan_tutup_buku before insert or update or delete on public.penyusutan_bulan for each row execute function public.jaga_tutup_buku(''bulan'')';
  foreach t in array array['kelompok_fiskal', 'aset_kategori', 'aset_lokasi', 'aset', 'aset_mutasi', 'aset_servis', 'aset_dokumen', 'penyusutan_bulan'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.catat_audit()', t || '_audit', t);
  end loop;
end $$;

-- =====================================================================
-- 12. PULIHKAN CADANGAN: ikut memulihkan data Tahap 5
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

-- =====================================================================
-- 13. AKSES (RLS) DAN IZIN
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array['aset', 'aset_mutasi', 'aset_servis', 'aset_dokumen', 'penyusutan_bulan', 'penyusutan_aset'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_baca', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.hak(''aset'') is not null)', t || '_baca', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
  -- Pengaturan aset: dibaca semua pengguna aktif; diubah pemegang hak Aset atau Pengaturan.
  foreach t in array array['kelompok_fiskal', 'aset_kategori', 'aset_lokasi'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_baca', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.pengguna_aktif())', t || '_baca', t);
    execute format('drop policy if exists %I on public.%I', t || '_tambah', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.hak(''aset'') = ''ubah'' or public.hak(''pengaturan'') = ''ubah'')', t || '_tambah', t);
    execute format('drop policy if exists %I on public.%I', t || '_ubah', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.hak(''aset'') = ''ubah'' or public.hak(''pengaturan'') = ''ubah'') with check (public.hak(''aset'') = ''ubah'' or public.hak(''pengaturan'') = ''ubah'')', t || '_ubah', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke delete on public.%I from authenticated', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);
  end loop;
end $$;
-- Dokumen & pengingat aset ditulis langsung (bukan data keuangan).
drop policy if exists aset_dokumen_tulis on public.aset_dokumen;
create policy aset_dokumen_tulis on public.aset_dokumen for all to authenticated using (public.hak('aset') = 'ubah') with check (public.hak('aset') = 'ubah');
grant insert, update, delete on public.aset_dokumen to authenticated;

-- Rekening dibaca untuk menampilkan nama rekening pembayar aset.
drop policy if exists rekening_baca on public.rekening;
create policy rekening_baca on public.rekening for select to authenticated
  using (public.hak('kas') is not null or public.hak('jurnal') is not null or public.hak('pengaturan') is not null or public.baca_keuangan_proyek()
         or public.hak('aset') is not null);

grant execute on function public.simpan_aset(uuid, jsonb), public.hapus_aset(uuid), public.simpan_servis_aset(uuid, jsonb), public.hapus_servis_aset(uuid),
  public.bukukan_penyusutan(date), public.tandai_barang_modal(uuid, boolean) to authenticated;
revoke execute on function public.jurnal_aset(uuid), public.jurnal_pelepasan_aset(uuid), public.jurnal_servis_aset(uuid), public.jurnal_penyusutan(uuid),
  public.akumulasi_aset(uuid, integer), public.perolehan_aset_pada(uuid, date) from public, anon, authenticated;

-- Faktur, foto, nota servis, dokumen aset (folder aset/).
drop policy if exists bukti_aset_baca on storage.objects;
create policy bukti_aset_baca on storage.objects for select to authenticated using (
  bucket_id = 'bukti-keuangan' and (storage.foldername(name))[1] = 'aset' and public.hak('aset') is not null);
drop policy if exists bukti_aset_tambah on storage.objects;
create policy bukti_aset_tambah on storage.objects for insert to authenticated with check (
  bucket_id = 'bukti-keuangan' and (storage.foldername(name))[1] = 'aset' and public.hak('aset') = 'ubah');
drop policy if exists bukti_aset_hapus on storage.objects;
create policy bukti_aset_hapus on storage.objects for delete to authenticated using (
  bucket_id = 'bukti-keuangan' and (storage.foldername(name))[1] = 'aset' and public.hak('aset') = 'ubah');

-- =====================================================================
-- 14. PEMERIKSAAN
-- =====================================================================
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('kelompok_fiskal', 'aset_kategori', 'aset_lokasi', 'aset',
     'aset_mutasi', 'aset_servis', 'aset_dokumen', 'penyusutan_bulan', 'penyusutan_aset')) as tabel_baru,                    -- 9
  (select count(*) from public.kelompok_fiskal) as kelompok_fiskal,                                                       -- 6
  (select count(*) from public.aset_kategori) as kategori_aset,                                                           -- 9
  (select count(*) from public.pemetaan_jurnal where jenis like 'aset_%' or jenis like 'susut_%' or jenis like 'lepas_%' or jenis like 'servis_%') as pemetaan_baru, -- 14
  (select count(*) from public.akun where kode = '4-4') as akun_laba_pelepasan,                                           -- 1
  (select count(*) from arsip_tahap5.records) as data_lama_diarsipkan,
  (select count(*) from public.records where tabel = 'aset') as data_lama_tersisa;                                        -- 0
