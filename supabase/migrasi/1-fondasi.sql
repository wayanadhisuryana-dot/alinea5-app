-- Alinea 5 — Migrasi Tahap 1: Fondasi.
-- Peran & hak akses per menu, profil perusahaan, Bagan Akun, Kas & Bank, mesin jurnal,
-- tutup buku, audit log, pengaturan akuntansi, dan status notifikasi.
-- Uang disimpan sebagai rupiah utuh (bigint). Tidak menghapus data lama. Aman dijalankan ulang.
-- Pembatalan: 1-batal.sql. Uji: 1-uji.sql.

-- =====================================================================
-- 1. PERAN DAN HAK AKSES
-- =====================================================================
-- hak: {"proyek": "ubah", "klien": "lihat", ...}; menu yang tidak disebut = tidak ada akses.
-- khusus: {"tutup_buku": true, "jurnal_manual": true}.
create table if not exists public.peran (
  id uuid primary key default gen_random_uuid(),
  nama text not null unique,
  hak jsonb not null default '{}'::jsonb,
  khusus jsonb not null default '{}'::jsonb,
  dibuat timestamptz not null default now()
);

alter table public.profiles add column if not exists super_admin boolean not null default false;
alter table public.profiles add column if not exists peran_id uuid references public.peran (id) on delete set null;

insert into public.peran (nama, hak, khusus)
select 'Admin',
  '{"proyek":"ubah","tahap":"ubah","masalah":"ubah","rab":"ubah","klien":"ubah","vendor":"ubah","supplier":"ubah","barang":"ubah",
    "kontrak":"ubah","termin":"ubah","pihak_proyek":"ubah","pembelian":"ubah","hutang_lain":"ubah","kas":"ubah","jurnal":"ubah",
    "laporan":"ubah","sdm":"ubah","aset":"ubah","legal":"ubah","pengaturan":"ubah"}'::jsonb,
  '{"tutup_buku":true,"jurnal_manual":true}'::jsonb
where not exists (select 1 from public.peran where nama = 'Admin');
insert into public.peran (nama, hak, khusus)
select 'Akuntan',
  '{"proyek":"lihat","klien":"lihat","kontrak":"ubah","termin":"ubah","pihak_proyek":"ubah","pembelian":"ubah","hutang_lain":"ubah",
    "kas":"ubah","jurnal":"ubah","laporan":"ubah","aset":"lihat"}'::jsonb,
  '{"tutup_buku":true,"jurnal_manual":true}'::jsonb
where not exists (select 1 from public.peran where nama = 'Akuntan');
insert into public.peran (nama, hak, khusus)
select 'Staf proyek', '{"proyek":"ubah","tahap":"ubah","masalah":"ubah","klien":"lihat"}'::jsonb, '{}'::jsonb
where not exists (select 1 from public.peran where nama = 'Staf proyek');

-- Pengguna lama: admin aktif paling awal menjadi super admin; admin lain -> peran Admin; arsitek -> Staf proyek.
update public.profiles set super_admin = true, aktif = true, role = 'admin'
where id = (select id from public.profiles order by (role = 'admin' and aktif) desc, created_at limit 1)
  and not exists (select 1 from public.profiles where super_admin and aktif);
update public.profiles set peran_id = (select id from public.peran where nama = 'Admin')
where peran_id is null and not super_admin and role = 'admin';
update public.profiles set peran_id = (select id from public.peran where nama = 'Staf proyek')
where peran_id is null and not super_admin and role = 'arsitek';

create or replace function public.pengguna_aktif()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.profiles where id = auth.uid() and aktif) $$;

create or replace function public.super_admin()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.profiles where id = auth.uid() and aktif and super_admin) $$;

-- Hak pengguna yang login atas satu menu: 'ubah', 'lihat', atau null.
create or replace function public.hak(menu text)
returns text language sql stable security definer set search_path = ''
as $$
  select case when p.super_admin then 'ubah' else nullif(r.hak ->> menu, '') end
  from public.profiles p left join public.peran r on r.id = p.peran_id
  where p.id = auth.uid() and p.aktif
$$;

create or replace function public.khusus(nama text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select coalesce(bool_or(p.super_admin or coalesce((r.khusus ->> nama)::boolean, false)), false)
  from public.profiles p left join public.peran r on r.id = p.peran_id
  where p.id = auth.uid() and p.aktif
$$;

-- Nama tabel data (records.tabel) -> kunci menu.
create or replace function public.menu_tabel(t text)
returns text language sql immutable set search_path = ''
as $$ select case t when 'vendor' then 'pihak_proyek' else t end $$;

-- Pendaftar pertama: super admin aktif. Berikutnya: belum aktif, tanpa peran.
create or replace function public.buat_profil()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  pertama boolean;
begin
  select not exists (select 1 from public.profiles) into pertama;
  insert into public.profiles (id, email, role, aktif, super_admin)
  values (new.id, new.email, case when pertama then 'admin' else 'arsitek' end, pertama, pertama)
  on conflict (id) do nothing;
  return new;
end $$;

-- Selalu harus ada minimal satu super admin aktif.
create or replace function public.jaga_super_admin()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles where super_admin and aktif) then
    raise exception 'Harus ada minimal satu super admin yang aktif.';
  end if;
  return null;
end $$;
drop trigger if exists profiles_jaga_super on public.profiles;
create trigger profiles_jaga_super after update or delete on public.profiles
  for each statement execute function public.jaga_super_admin();

-- =====================================================================
-- 2. PROFIL PERUSAHAAN DAN IDENTITAS APLIKASI
-- =====================================================================
alter table public.perusahaan add column if not exists data jsonb not null default '{}'::jsonb;

-- Untuk halaman masuk (sebelum login): hanya nama aplikasi, nama badan hukum, logo, dan warna.
create or replace function public.identitas_aplikasi()
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('nama_aplikasi', data ->> 'nama_aplikasi', 'badan_hukum', data ->> 'badan_hukum',
    'bentuk', data ->> 'bentuk', 'logo', data ->> 'logo', 'warna', data ->> 'warna')
  from public.perusahaan where id = public.perusahaan_tunggal()
$$;

-- =====================================================================
-- 3. AKSES DATA OPERASIONAL (records) PER MENU
-- =====================================================================
drop policy if exists records_admin on public.records;
drop policy if exists records_arsitek on public.records;
drop policy if exists records_arsitek_baca_klien on public.records;
drop policy if exists records_baca_pengaturan on public.records;
drop policy if exists records_baca on public.records;
drop policy if exists records_tambah on public.records;
drop policy if exists records_ubah on public.records;
drop policy if exists records_hapus on public.records;

-- Baca: menu dengan hak lihat/ubah. Klien juga terbaca oleh Proyek & Kontrak (pemilih klien);
-- direktori tim terbaca oleh Proyek & SDM; pengaturan terbaca semua pengguna aktif.
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

-- Profil pengguna: diri sendiri; super admin melihat dan mengubah semua.
drop policy if exists profiles_baca on public.profiles;
create policy profiles_baca on public.profiles for select to authenticated
  using (id = auth.uid() or public.super_admin());
drop policy if exists profiles_ubah on public.profiles;
create policy profiles_ubah on public.profiles for update to authenticated
  using (public.super_admin()) with check (public.super_admin());

alter table public.peran enable row level security;
drop policy if exists peran_baca on public.peran;
create policy peran_baca on public.peran for select to authenticated using (public.pengguna_aktif());
drop policy if exists peran_kelola on public.peran;
create policy peran_kelola on public.peran for all to authenticated using (public.super_admin()) with check (public.super_admin());

drop policy if exists perusahaan_baca on public.perusahaan;
create policy perusahaan_baca on public.perusahaan for select to authenticated using (public.pengguna_aktif());
drop policy if exists perusahaan_ubah on public.perusahaan;
create policy perusahaan_ubah on public.perusahaan for update to authenticated
  using (public.hak('pengaturan') = 'ubah') with check (public.hak('pengaturan') = 'ubah');

-- File SDM: mengikuti hak menu SDM.
drop policy if exists dokumen_sdm_admin on storage.objects;
drop policy if exists dokumen_sdm_baca on storage.objects;
drop policy if exists dokumen_sdm_ubah on storage.objects;
create policy dokumen_sdm_baca on storage.objects for select to authenticated
  using (bucket_id = 'dokumen-sdm' and public.hak('sdm') is not null);
create policy dokumen_sdm_ubah on storage.objects for all to authenticated
  using (bucket_id = 'dokumen-sdm' and public.hak('sdm') = 'ubah')
  with check (bucket_id = 'dokumen-sdm' and public.hak('sdm') = 'ubah');

-- =====================================================================
-- 4. BAGAN AKUN
-- =====================================================================
-- golongan: 1 Aset, 2 Kewajiban, 3 Ekuitas, 4 Pendapatan, 5 Beban proyek, 6 Beban operasional, 7 Beban lain.
-- standar: akun bawaan (sama di setiap instalasi), kode tidak bisa diubah, tidak bisa dihapus.
-- sistem: sub-akun yang dipakai pemetaan jurnal (mis. 3-2-01), juga dilindungi.
create table if not exists public.akun (
  id uuid primary key default gen_random_uuid(),
  perusahaan_id uuid not null default public.perusahaan_tunggal() references public.perusahaan (id),
  kode text not null unique,
  nama text not null,
  induk_id uuid references public.akun (id),
  golongan smallint not null check (golongan between 1 and 7),
  standar boolean not null default false,
  sistem boolean not null default false,
  rekening_id uuid unique,
  aktif boolean not null default true,
  dibuat timestamptz not null default now()
);

insert into public.akun (kode, nama, golongan, standar)
select v.kode, v.nama, left(v.kode, 1)::smallint, true
from (values
  ('1', 'ASET'), ('1-1', 'Kas dan Setara Kas'), ('1-2', 'Piutang Usaha'), ('1-3', 'Pajak Dibayar di Muka'),
  ('1-4', 'PPN Masukan'), ('1-5', 'Biaya Dibayar di Muka'), ('1-6', 'Persediaan'), ('1-7', 'Aset Tetap'),
  ('1-8', 'Akumulasi Penyusutan'), ('1-9', 'Aset Tak Berwujud & Akumulasi Amortisasi'),
  ('2', 'KEWAJIBAN'), ('2-1', 'Hutang Vendor / Tukang / Pihak Proyek'), ('2-2', 'Hutang Retensi Vendor'),
  ('2-3', 'Hutang Supplier'), ('2-4', 'Hutang Dana Titipan Klien'), ('2-5', 'PPN Keluaran'), ('2-6', 'Hutang Pajak Lainnya'),
  ('2-7', 'Hutang Bank – Jangka Pendek'), ('2-8', 'Hutang Bank / Leasing – Jangka Panjang'),
  ('2-9', 'Hutang kepada Pemilik / Pihak Afiliasi'), ('2-10', 'Hutang Gaji & Lainnya'),
  ('3', 'EKUITAS'), ('3-1', 'Modal Disetor'), ('3-2', 'Laba Ditahan'), ('3-3', 'Laba Tahun Berjalan'),
  ('4', 'PENDAPATAN'), ('4-1', 'Pendapatan Jasa Desain'), ('4-2', 'Pendapatan Jasa Pelaksanaan / Turn-key'),
  ('4-3', 'Pendapatan Lain-lain'),
  ('5', 'BEBAN PROYEK'), ('5-1', 'Material Proyek'), ('5-2', 'Upah / Vendor / Tukang'), ('5-3', 'Sewa Alat Proyek'),
  ('5-4', 'Beban Proyek Lainnya'),
  ('6', 'BEBAN OPERASIONAL'), ('6-1', 'Gaji & Tunjangan'), ('6-2', 'Sewa Kantor'), ('6-3', 'Listrik, Air, Internet, Telepon'),
  ('6-4', 'Beban Penyusutan & Amortisasi'), ('6-5', 'Perawatan & Servis'), ('6-6', 'Software & Langganan'),
  ('6-7', 'Pemasaran'), ('6-8', 'Administrasi & Umum'),
  ('7', 'BEBAN LAIN-LAIN'), ('7-1', 'Beban Bunga'), ('7-2', 'Rugi Pelepasan Aset'), ('7-3', 'Denda'),
  ('7-4', 'Biaya Administrasi Bank')
) as v (kode, nama)
on conflict (kode) do nothing;
update public.akun a set induk_id = i.id from public.akun i
where a.standar and a.induk_id is null and a.kode like '%-%' and i.kode = split_part(a.kode, '-', 1);

insert into public.akun (kode, nama, golongan, induk_id, sistem)
select '3-2-01', 'Ekuitas saldo awal', 3, (select id from public.akun where kode = '3-2'), true
on conflict (kode) do nothing;

create or replace function public.akun_kode(k text)
returns uuid language sql stable security definer set search_path = ''
as $$ select id from public.akun where kode = k $$;

-- Kode sub-akun: <kode induk>-NN (otomatis bila kosong). Akun standar/sistem: kode tetap, tidak bisa dihapus.
create or replace function public.jaga_akun()
returns trigger language plpgsql set search_path = ''
as $$
declare
  induk public.akun;
  nomor int;
begin
  if tg_op = 'DELETE' then
    if old.standar or old.sistem then raise exception 'Akun standar % tidak bisa dihapus.', old.kode; end if;
    if old.rekening_id is not null and exists (select 1 from public.rekening where id = old.rekening_id) then
      raise exception 'Akun % milik rekening; hapus atau nonaktifkan rekeningnya di Kas & Bank.', old.kode;
    end if;
    if exists (select 1 from public.akun where induk_id = old.id) then
      raise exception 'Akun % masih punya sub-akun.', old.kode;
    end if;
    if exists (select 1 from public.jurnal_baris where akun_id = old.id) then
      raise exception 'Akun % sudah dipakai di jurnal; nonaktifkan saja.', old.kode;
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and (old.standar or old.sistem) then
    if new.kode <> old.kode or new.induk_id is distinct from old.induk_id or new.standar <> old.standar or new.sistem <> old.sistem then
      raise exception 'Kode dan induk akun standar % tidak bisa diubah.', old.kode;
    end if;
    return new;
  end if;
  if tg_op = 'INSERT' and new.standar then return new; end if;
  if tg_op = 'UPDATE' and new.kode <> old.kode and exists (select 1 from public.jurnal_baris where akun_id = old.id) then
    raise exception 'Kode akun % sudah dipakai di jurnal dan tidak bisa diubah.', old.kode;
  end if;
  if new.induk_id is null then raise exception 'Sub-akun wajib menginduk ke akun lain.'; end if;
  select * into induk from public.akun where id = new.induk_id;
  if induk.kode !~ '-' then raise exception 'Sub-akun harus menginduk ke akun level 2 atau di bawahnya (mis. 6-3), bukan ke %.', induk.kode; end if;
  if (induk.kode = '1-1' or induk.kode like '1-1-%') and new.rekening_id is null then
    raise exception 'Sub-akun Kas dan Setara Kas dibuat otomatis lewat menu Kas & Bank (tambah rekening).';
  end if;
  new.golongan := induk.golongan;
  new.standar := false;
  if tg_op = 'INSERT' then new.sistem := false; end if;
  if coalesce(new.kode, '') = '' then
    select coalesce(max(nullif(regexp_replace(kode, '^.*-', ''), '')::int), 0) + 1 into nomor
    from public.akun where induk_id = new.induk_id and kode ~ ('^' || replace(induk.kode, '-', '\-') || '-[0-9]+$');
    new.kode := induk.kode || '-' || lpad(nomor::text, 2, '0');
  end if;
  if left(new.kode, length(induk.kode) + 1) <> induk.kode || '-' then
    raise exception 'Kode sub-akun harus diawali % (kode induknya).', induk.kode || '-';
  end if;
  return new;
end $$;

-- =====================================================================
-- 5. KAS & BANK, JURNAL, TUTUP BUKU, AKUNTANSI, AUDIT, NOTIFIKASI
-- =====================================================================
create table if not exists public.rekening (
  id uuid primary key default gen_random_uuid(),
  perusahaan_id uuid not null default public.perusahaan_tunggal() references public.perusahaan (id),
  nama text not null unique,
  bank text,
  cabang text,
  no_rekening text,
  atas_nama text,
  jenis text not null check (jenis in ('Giro', 'Tabungan', 'Deposito', 'Kas tunai')),
  mata_uang text not null default 'IDR' check (mata_uang = 'IDR'),
  saldo_awal bigint not null default 0,
  tgl_saldo_awal date not null,
  di_invoice boolean not null default false,
  utama_invoice boolean not null default false,
  aktif boolean not null default true,
  catatan text,
  dibuat timestamptz not null default now(),
  check (not utama_invoice or (di_invoice and aktif))
);
create unique index if not exists rekening_satu_utama on public.rekening (perusahaan_id) where utama_invoice;

create table if not exists public.kas_transaksi (
  id uuid primary key default gen_random_uuid(),
  perusahaan_id uuid not null default public.perusahaan_tunggal() references public.perusahaan (id),
  tanggal date not null,
  jenis text not null check (jenis in ('masuk', 'keluar')),
  rekening_id uuid not null references public.rekening (id),
  akun_id uuid not null references public.akun (id),
  proyek_kode text,
  pihak text,
  jumlah bigint not null check (jumlah > 0),
  uraian text not null check (btrim(uraian) <> ''),
  bukti jsonb,
  dibuat timestamptz not null default now(),
  dibuat_oleh uuid default auth.uid()
);

create table if not exists public.transfer (
  id uuid primary key default gen_random_uuid(),
  perusahaan_id uuid not null default public.perusahaan_tunggal() references public.perusahaan (id),
  tanggal date not null,
  dari_rekening uuid not null references public.rekening (id),
  ke_rekening uuid not null references public.rekening (id),
  jumlah bigint not null check (jumlah > 0),
  biaya_admin bigint not null default 0 check (biaya_admin >= 0),
  uraian text,
  bukti jsonb,
  dibuat timestamptz not null default now(),
  dibuat_oleh uuid default auth.uid(),
  check (dari_rekening <> ke_rekening)
);

create table if not exists public.jurnal (
  id uuid primary key default gen_random_uuid(),
  perusahaan_id uuid not null default public.perusahaan_tunggal() references public.perusahaan (id),
  no bigint generated always as identity,
  tanggal date not null,
  uraian text not null check (btrim(uraian) <> ''),
  sumber text not null check (sumber in ('manual', 'saldo_awal', 'kas', 'transfer')),
  sumber_id uuid,
  bukti jsonb,
  dibuat timestamptz not null default now(),
  dibuat_oleh uuid default auth.uid()
);
create unique index if not exists jurnal_satu_per_sumber on public.jurnal (sumber, sumber_id) where sumber <> 'manual';
create index if not exists jurnal_tanggal_idx on public.jurnal (tanggal);

create table if not exists public.jurnal_baris (
  id bigint generated always as identity primary key,
  jurnal_id uuid not null references public.jurnal (id) on delete cascade,
  akun_id uuid not null references public.akun (id),
  debit bigint not null default 0 check (debit >= 0),
  kredit bigint not null default 0 check (kredit >= 0),
  proyek_kode text,
  keterangan text,
  check ((debit > 0) <> (kredit > 0))
);
create index if not exists jurnal_baris_jurnal_idx on public.jurnal_baris (jurnal_id);
create index if not exists jurnal_baris_akun_idx on public.jurnal_baris (akun_id);

-- Tabel pemetaan jurnal: jenis transaksi -> akun debit/kredit. Kata BESAR = diisi dari transaksinya.
create table if not exists public.pemetaan_jurnal (
  jenis text not null,
  urut smallint not null,
  nama text not null,
  sisi text not null check (sisi in ('D', 'K')),
  akun text not null,
  keterangan text,
  primary key (jenis, urut)
);
insert into public.pemetaan_jurnal (jenis, urut, nama, sisi, akun, keterangan) values
  ('saldo_awal', 1, 'Saldo awal rekening', 'D', 'REKENING', 'Sub-akun Kas dan Setara Kas milik rekening (kredit bila saldo awal minus)'),
  ('saldo_awal', 2, 'Saldo awal rekening', 'K', '3-2-01', 'Ekuitas saldo awal'),
  ('kas_masuk', 1, 'Transaksi kas umum – pemasukan', 'D', 'REKENING', 'Rekening penerima'),
  ('kas_masuk', 2, 'Transaksi kas umum – pemasukan', 'K', 'AKUN_DIPILIH', 'Akun yang dipilih di transaksi (mis. 4-3 Pendapatan Lain-lain, 3-1 Modal Disetor)'),
  ('kas_keluar', 1, 'Transaksi kas umum – pengeluaran', 'D', 'AKUN_DIPILIH', 'Akun yang dipilih di transaksi (mis. 6-3 Listrik, 6-1 Gaji)'),
  ('kas_keluar', 2, 'Transaksi kas umum – pengeluaran', 'K', 'REKENING', 'Rekening pembayar'),
  ('transfer', 1, 'Transfer antar rekening', 'D', 'REKENING_TUJUAN', 'Rekening tujuan'),
  ('transfer', 2, 'Transfer antar rekening', 'K', 'REKENING_ASAL', 'Rekening asal'),
  ('transfer_biaya', 1, 'Biaya admin transfer', 'D', '7-4', 'Biaya Administrasi Bank'),
  ('transfer_biaya', 2, 'Biaya admin transfer', 'K', 'REKENING_ASAL', 'Rekening asal')
on conflict (jenis, urut) do nothing;

create table if not exists public.tutup_buku (
  bulan date primary key check (extract(day from bulan) = 1),
  perusahaan_id uuid not null default public.perusahaan_tunggal() references public.perusahaan (id),
  ditutup_oleh uuid default auth.uid(),
  ditutup_pada timestamptz not null default now()
);
create table if not exists public.tutup_buku_riwayat (
  id bigint generated always as identity primary key,
  bulan date not null,
  aksi text not null check (aksi in ('tutup', 'buka')),
  oleh uuid default auth.uid(),
  email text,
  alasan text,
  pada timestamptz not null default now()
);

create table if not exists public.akuntansi (
  perusahaan_id uuid primary key default public.perusahaan_tunggal() references public.perusahaan (id),
  basis text not null default 'kas' check (basis in ('kas', 'akrual')),
  bulan_awal_buku smallint not null default 1 check (bulan_awal_buku between 1 and 12),
  batas_kapitalisasi bigint not null default 10000000 check (batas_kapitalisasi >= 0)
);
insert into public.akuntansi (perusahaan_id) select public.perusahaan_tunggal()
where not exists (select 1 from public.akuntansi);

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  waktu timestamptz not null default now(),
  user_id uuid default auth.uid(),
  email text,
  tabel text not null,
  baris_id text,
  aksi text not null,
  lama jsonb,
  baru jsonb
);
create index if not exists audit_log_waktu_idx on public.audit_log (waktu desc);

-- Status notifikasi per pengguna (dibaca / ditunda). Notifikasinya dihitung aplikasi dari data.
create table if not exists public.notifikasi_status (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kunci text not null,
  dibaca timestamptz,
  tunda_sampai date,
  primary key (user_id, kunci)
);

-- =====================================================================
-- 6. FUNGSI DAN PEMICU
-- =====================================================================
create or replace function public.nama_bulan(d date)
returns text language sql immutable set search_path = ''
as $$
  select (array['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'])[extract(month from d)::int]
    || ' ' || extract(year from d)::int
$$;

create or replace function public.bulan_terkunci(d date)
returns boolean language sql stable security definer set search_path = ''
as $$ select d is not null and exists (select 1 from public.tutup_buku where bulan = date_trunc('month', d)::date) $$;

-- Hari ini menurut zona waktu di Pengaturan (bawaan WITA).
create or replace function public.hari_ini()
returns date language sql stable security definer set search_path = ''
as $$
  select (now() at time zone coalesce(
    (select data ->> 'zona_waktu' from public.records where tabel = 'pengaturan' order by updated_at desc limit 1),
    'Asia/Makassar'))::date
$$;

create or replace function public.cek_bulan_terbuka(d date)
returns void language plpgsql stable security definer set search_path = ''
as $$
begin
  if current_setting('alinea.pulihkan', true) = 'ya' then return; end if;
  if public.bulan_terkunci(d) then
    raise exception 'Bulan % sudah ditutup. Transaksi bertanggal di bulan itu tidak bisa ditambah, diubah, atau dihapus.', public.nama_bulan(d);
  end if;
end $$;

-- Penjaga tutup buku untuk tabel bertanggal.
create or replace function public.jaga_tutup_buku()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  kolom text := tg_argv[0];
  d_lama date; d_baru date;
begin
  if tg_op <> 'INSERT' then d_lama := (to_jsonb(old) ->> kolom)::date; end if;
  if tg_op <> 'DELETE' then d_baru := (to_jsonb(new) ->> kolom)::date; end if;
  if tg_op = 'UPDATE' and tg_table_name = 'rekening'
     and new.saldo_awal = old.saldo_awal and new.tgl_saldo_awal = old.tgl_saldo_awal then
    return new; -- perubahan nama/keterangan rekening tidak menyentuh pembukuan
  end if;
  perform public.cek_bulan_terbuka(d_lama);
  perform public.cek_bulan_terbuka(d_baru);
  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists kas_tutup_buku on public.kas_transaksi;
create trigger kas_tutup_buku before insert or update or delete on public.kas_transaksi
  for each row execute function public.jaga_tutup_buku('tanggal');
drop trigger if exists transfer_tutup_buku on public.transfer;
create trigger transfer_tutup_buku before insert or update or delete on public.transfer
  for each row execute function public.jaga_tutup_buku('tanggal');
drop trigger if exists rekening_tutup_buku on public.rekening;
create trigger rekening_tutup_buku before insert or update or delete on public.rekening
  for each row execute function public.jaga_tutup_buku('tgl_saldo_awal');
drop trigger if exists jurnal_tutup_buku on public.jurnal;
create trigger jurnal_tutup_buku before insert or update or delete on public.jurnal
  for each row execute function public.jaga_tutup_buku('tanggal');

drop trigger if exists akun_jaga on public.akun;
create trigger akun_jaga before insert or update or delete on public.akun
  for each row execute function public.jaga_akun();

-- Baris jurnal: akun harus aktif, bukan akun level 1, bukan induk kas 1-1.
create or replace function public.jaga_baris_jurnal()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare a public.akun;
begin
  select * into a from public.akun where id = new.akun_id;
  if a.kode !~ '-' then raise exception 'Akun % adalah akun kelompok; pilih akun di bawahnya.', a.kode; end if;
  if a.kode = '1-1' then raise exception 'Pilih rekening (sub-akun 1-1), bukan akun induk Kas dan Setara Kas.'; end if;
  if not a.aktif and current_setting('alinea.pulihkan', true) is distinct from 'ya' then
    raise exception 'Akun % sudah nonaktif.', a.kode;
  end if;
  return new;
end $$;
drop trigger if exists jurnal_baris_jaga on public.jurnal_baris;
create trigger jurnal_baris_jaga before insert or update on public.jurnal_baris
  for each row execute function public.jaga_baris_jurnal();

-- Jurnal wajib seimbang (debit = kredit, minimal 2 baris), diperiksa di akhir transaksi.
create or replace function public.cek_jurnal_seimbang()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  jid uuid;
  d bigint; k bigint; n int;
begin
  if tg_table_name = 'jurnal' then jid := new.id;
  elsif tg_op = 'DELETE' then jid := old.jurnal_id;
  else jid := new.jurnal_id;
  end if;
  if not exists (select 1 from public.jurnal where id = jid) then return null; end if;
  select coalesce(sum(debit), 0), coalesce(sum(kredit), 0), count(*) into d, k, n from public.jurnal_baris where jurnal_id = jid;
  if n < 2 or d <> k or d = 0 then
    raise exception 'Jurnal tidak seimbang: debit Rp % dan kredit Rp % (minimal 2 baris, debit harus sama dengan kredit).',
      to_char(d, 'FM999G999G999G999'), to_char(k, 'FM999G999G999G999');
  end if;
  return null;
end $$;
drop trigger if exists jurnal_baris_seimbang on public.jurnal_baris;
create constraint trigger jurnal_baris_seimbang after insert or update or delete on public.jurnal_baris
  deferrable initially deferred for each row execute function public.cek_jurnal_seimbang();
drop trigger if exists jurnal_seimbang on public.jurnal;
create constraint trigger jurnal_seimbang after insert on public.jurnal
  deferrable initially deferred for each row execute function public.cek_jurnal_seimbang();

-- Membuat ulang jurnal otomatis untuk satu transaksi sumber.
-- p_baris: [{jenis, jumlah}] -> diterjemahkan lewat pemetaan_jurnal; p_isi: nilai kata BESAR (id akun).
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

create or replace function public.akun_rekening(rid uuid)
returns uuid language sql stable security definer set search_path = ''
as $$ select id from public.akun where rekening_id = rid $$;

-- Rekening -> sub-akun 1-1 otomatis + jurnal saldo awal.
create or replace function public.rekening_setelah()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform public.jurnal_otomatis('saldo_awal', old.id, null, null, null, null);
    delete from public.akun where rekening_id = old.id;
    return old;
  end if;
  if not exists (select 1 from public.akun where rekening_id = new.id) then
    insert into public.akun (kode, nama, induk_id, rekening_id, aktif)
    values ('', new.nama, public.akun_kode('1-1'), new.id, new.aktif);
  else
    update public.akun set nama = new.nama, aktif = new.aktif where rekening_id = new.id and (nama <> new.nama or aktif <> new.aktif);
  end if;
  if tg_op = 'INSERT' or new.saldo_awal <> old.saldo_awal or new.tgl_saldo_awal <> old.tgl_saldo_awal then
    perform public.jurnal_otomatis('saldo_awal', new.id, new.tgl_saldo_awal, 'Saldo awal ' || new.nama,
      jsonb_build_array(jsonb_build_object('jenis', 'saldo_awal', 'jumlah', new.saldo_awal)),
      jsonb_build_object('REKENING', public.akun_rekening(new.id)));
  end if;
  return new;
end $$;
drop trigger if exists rekening_akun on public.rekening;
create trigger rekening_akun after insert or update or delete on public.rekening
  for each row execute function public.rekening_setelah();

create or replace function public.rekening_sebelum_hapus()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from public.kas_transaksi where rekening_id = old.id)
     or exists (select 1 from public.transfer where old.id in (dari_rekening, ke_rekening))
     or exists (select 1 from public.jurnal_baris b join public.jurnal j on j.id = b.jurnal_id
                where b.akun_id = public.akun_rekening(old.id) and j.sumber <> 'saldo_awal') then
    raise exception 'Rekening "%" sudah dipakai transaksi, jadi tidak bisa dihapus. Nonaktifkan saja.', old.nama;
  end if;
  return old;
end $$;
drop trigger if exists rekening_hapus on public.rekening;
create trigger rekening_hapus before delete on public.rekening
  for each row execute function public.rekening_sebelum_hapus();

-- Transaksi kas umum -> jurnal.
create or replace function public.kas_setelah()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare a public.akun;
begin
  if tg_op = 'DELETE' then
    perform public.jurnal_otomatis('kas', old.id, null, null, null, null);
    return old;
  end if;
  select * into a from public.akun where id = new.akun_id;
  if a.kode = '1-1' or a.kode like '1-1-%' then
    raise exception 'Perpindahan uang antar rekening dicatat lewat Transfer antar rekening, bukan transaksi kas umum.';
  end if;
  perform public.jurnal_otomatis('kas', new.id, new.tanggal, new.uraian,
    jsonb_build_array(jsonb_build_object('jenis', case new.jenis when 'masuk' then 'kas_masuk' else 'kas_keluar' end, 'jumlah', new.jumlah)),
    jsonb_build_object('REKENING', public.akun_rekening(new.rekening_id), 'AKUN_DIPILIH', new.akun_id), new.proyek_kode);
  return new;
end $$;
drop trigger if exists kas_jurnal on public.kas_transaksi;
create trigger kas_jurnal after insert or update or delete on public.kas_transaksi
  for each row execute function public.kas_setelah();

-- Transfer antar rekening -> jurnal (tanpa pendapatan/beban, kecuali biaya admin).
create or replace function public.transfer_setelah()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform public.jurnal_otomatis('transfer', old.id, null, null, null, null);
    return old;
  end if;
  perform public.jurnal_otomatis('transfer', new.id, new.tanggal,
    coalesce(nullif(btrim(new.uraian), ''), 'Transfer antar rekening'),
    jsonb_build_array(jsonb_build_object('jenis', 'transfer', 'jumlah', new.jumlah),
                      jsonb_build_object('jenis', 'transfer_biaya', 'jumlah', new.biaya_admin)),
    jsonb_build_object('REKENING_ASAL', public.akun_rekening(new.dari_rekening), 'REKENING_TUJUAN', public.akun_rekening(new.ke_rekening)));
  return new;
end $$;
drop trigger if exists transfer_jurnal on public.transfer;
create trigger transfer_jurnal after insert or update or delete on public.transfer
  for each row execute function public.transfer_setelah();

-- Jurnal umum manual (penyesuaian). p_baris: [{akun_id, debit, kredit, proyek_kode, keterangan}].
create or replace function public.simpan_jurnal_manual(p_id uuid, p_tanggal date, p_uraian text, p_baris jsonb, p_bukti jsonb default null)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare jid uuid := p_id;
begin
  if public.hak('jurnal') is distinct from 'ubah' or not public.khusus('jurnal_manual') then
    raise exception 'Anda tidak punya hak membuat jurnal manual.';
  end if;
  if coalesce(btrim(p_uraian), '') = '' then raise exception 'Uraian jurnal wajib diisi.'; end if;
  if jid is not null then
    if not exists (select 1 from public.jurnal where id = jid and sumber = 'manual') then
      raise exception 'Jurnal otomatis tidak bisa diubah langsung; ubah transaksi sumbernya.';
    end if;
    update public.jurnal set tanggal = p_tanggal, uraian = p_uraian, bukti = p_bukti where id = jid;
    delete from public.jurnal_baris where jurnal_id = jid;
  else
    insert into public.jurnal (tanggal, uraian, sumber, bukti) values (p_tanggal, p_uraian, 'manual', p_bukti) returning id into jid;
  end if;
  insert into public.jurnal_baris (jurnal_id, akun_id, debit, kredit, proyek_kode, keterangan)
  select jid, (b ->> 'akun_id')::uuid, coalesce((b ->> 'debit')::bigint, 0), coalesce((b ->> 'kredit')::bigint, 0),
    nullif(b ->> 'proyek_kode', ''), nullif(b ->> 'keterangan', '')
  from jsonb_array_elements(p_baris) b;
  return jid;
end $$;

create or replace function public.hapus_jurnal_manual(p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if public.hak('jurnal') is distinct from 'ubah' or not public.khusus('jurnal_manual') then
    raise exception 'Anda tidak punya hak menghapus jurnal manual.';
  end if;
  if not exists (select 1 from public.jurnal where id = p_id and sumber = 'manual') then
    raise exception 'Jurnal otomatis tidak bisa dihapus langsung; hapus transaksi sumbernya.';
  end if;
  delete from public.jurnal where id = p_id;
end $$;

-- Tutup buku: hanya bulan yang sudah lewat. Membuka kembali: hanya super admin, dengan alasan.
create or replace function public.tutup_bulan(p_bulan date)
returns void language plpgsql security definer set search_path = ''
as $$
declare b date := date_trunc('month', p_bulan)::date;
begin
  if not public.khusus('tutup_buku') then raise exception 'Anda tidak punya hak menutup buku.'; end if;
  if b >= date_trunc('month', public.hari_ini())::date then
    raise exception 'Bulan % belum berakhir, jadi belum bisa ditutup.', public.nama_bulan(b);
  end if;
  if exists (select 1 from public.tutup_buku where bulan = b) then raise exception 'Bulan % sudah ditutup.', public.nama_bulan(b); end if;
  insert into public.tutup_buku (bulan) values (b);
  insert into public.tutup_buku_riwayat (bulan, aksi, email) values (b, 'tutup', (select email from public.profiles where id = auth.uid()));
end $$;

create or replace function public.buka_bulan(p_bulan date, p_alasan text)
returns void language plpgsql security definer set search_path = ''
as $$
declare b date := date_trunc('month', p_bulan)::date;
begin
  if not public.super_admin() then raise exception 'Hanya super admin yang bisa membuka kembali buku yang sudah ditutup.'; end if;
  if coalesce(btrim(p_alasan), '') = '' then raise exception 'Alasan membuka kembali wajib diisi.'; end if;
  if not exists (select 1 from public.tutup_buku where bulan = b) then raise exception 'Bulan % belum ditutup.', public.nama_bulan(b); end if;
  delete from public.tutup_buku where bulan = b;
  insert into public.tutup_buku_riwayat (bulan, aksi, email, alasan) values (b, 'buka', (select email from public.profiles where id = auth.uid()), p_alasan);
end $$;

-- Basis pengakuan pendapatan hanya bisa diubah di bulan pertama tahun buku, atau sebelum ada jurnal sama sekali.
create or replace function public.jaga_akuntansi()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.basis <> old.basis
     and extract(month from public.hari_ini())::int <> old.bulan_awal_buku
     and exists (select 1 from public.jurnal) then
    raise exception 'Basis pengakuan pendapatan hanya bisa diubah di awal periode buku (bulan pertama tahun buku).';
  end if;
  return new;
end $$;
drop trigger if exists akuntansi_jaga on public.akuntansi;
create trigger akuntansi_jaga before update on public.akuntansi
  for each row execute function public.jaga_akuntansi();

-- Audit log: siapa, kapan, nilai lama -> baru.
create or replace function public.catat_audit()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  lama jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  baru jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
begin
  if tg_op = 'UPDATE' and lama = baru then return null; end if;
  insert into public.audit_log (tabel, baris_id, aksi, lama, baru, email)
  values (tg_table_name, coalesce(baru ->> 'id', lama ->> 'id', baru ->> 'bulan', lama ->> 'bulan', baru ->> 'perusahaan_id'),
    lower(tg_op), lama, baru, (select email from public.profiles where id = auth.uid()));
  return null;
end $$;
do $$
declare t text;
begin
  foreach t in array array['rekening', 'kas_transaksi', 'transfer', 'jurnal', 'jurnal_baris', 'akun', 'tutup_buku', 'akuntansi', 'peran', 'perusahaan'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.catat_audit()', t || '_audit', t);
  end loop;
end $$;
drop trigger if exists profiles_audit on public.profiles;
create trigger profiles_audit after update on public.profiles for each row execute function public.catat_audit();

-- =====================================================================
-- 7. PULIHKAN DATA KEUANGAN DARI CADANGAN (super admin)
-- =====================================================================
-- Mengganti seluruh data keuangan dengan isi cadangan. Penjaga tutup buku dilewati selama proses ini saja.
-- Akun di file cadangan -> akun di database ini (akun rekening dipetakan lewat rekeningnya, akun standar lewat kodenya).
create or replace function public.peta_akun(p jsonb, lama text)
returns uuid language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select case when x ->> 'rekening_id' is not null then public.akun_rekening((x ->> 'rekening_id')::uuid)
                when coalesce((x ->> 'standar')::boolean, false) or coalesce((x ->> 'sistem')::boolean, false) then public.akun_kode(x ->> 'kode')
                else (x ->> 'id')::uuid end
    from jsonb_array_elements(coalesce(p -> 'akun', '[]'::jsonb)) x where x ->> 'id' = lama limit 1), lama::uuid)
$$;

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

-- =====================================================================
-- 8. AKSES (RLS) DAN IZIN
-- =====================================================================
alter table public.akun enable row level security;
alter table public.rekening enable row level security;
alter table public.kas_transaksi enable row level security;
alter table public.transfer enable row level security;
alter table public.jurnal enable row level security;
alter table public.jurnal_baris enable row level security;
alter table public.pemetaan_jurnal enable row level security;
alter table public.tutup_buku enable row level security;
alter table public.tutup_buku_riwayat enable row level security;
alter table public.akuntansi enable row level security;
alter table public.audit_log enable row level security;
alter table public.notifikasi_status enable row level security;

drop policy if exists akun_baca on public.akun;
create policy akun_baca on public.akun for select to authenticated using (public.pengguna_aktif());
drop policy if exists akun_ubah on public.akun;
create policy akun_ubah on public.akun for all to authenticated
  using (public.hak('pengaturan') = 'ubah' or public.hak('jurnal') = 'ubah')
  with check (public.hak('pengaturan') = 'ubah' or public.hak('jurnal') = 'ubah');

drop policy if exists rekening_baca on public.rekening;
create policy rekening_baca on public.rekening for select to authenticated
  using (public.hak('kas') is not null or public.hak('jurnal') is not null or public.hak('pengaturan') is not null or public.hak('termin') is not null);
drop policy if exists rekening_ubah on public.rekening;
create policy rekening_ubah on public.rekening for all to authenticated
  using (public.hak('kas') = 'ubah' or public.hak('pengaturan') = 'ubah')
  with check (public.hak('kas') = 'ubah' or public.hak('pengaturan') = 'ubah');

drop policy if exists kas_baca on public.kas_transaksi;
create policy kas_baca on public.kas_transaksi for select to authenticated using (public.hak('kas') is not null or public.hak('jurnal') is not null);
drop policy if exists kas_ubah on public.kas_transaksi;
create policy kas_ubah on public.kas_transaksi for all to authenticated using (public.hak('kas') = 'ubah') with check (public.hak('kas') = 'ubah');

drop policy if exists transfer_baca on public.transfer;
create policy transfer_baca on public.transfer for select to authenticated using (public.hak('kas') is not null or public.hak('jurnal') is not null);
drop policy if exists transfer_ubah on public.transfer;
create policy transfer_ubah on public.transfer for all to authenticated using (public.hak('kas') = 'ubah') with check (public.hak('kas') = 'ubah');

-- Jurnal hanya dibaca langsung; ditulis lewat pemicu dan fungsi di atas.
drop policy if exists jurnal_baca on public.jurnal;
create policy jurnal_baca on public.jurnal for select to authenticated using (public.hak('jurnal') is not null or public.hak('kas') is not null);
drop policy if exists jurnal_baris_baca on public.jurnal_baris;
create policy jurnal_baris_baca on public.jurnal_baris for select to authenticated using (public.hak('jurnal') is not null or public.hak('kas') is not null);
drop policy if exists pemetaan_baca on public.pemetaan_jurnal;
create policy pemetaan_baca on public.pemetaan_jurnal for select to authenticated using (public.pengguna_aktif());
drop policy if exists tutup_buku_baca on public.tutup_buku;
create policy tutup_buku_baca on public.tutup_buku for select to authenticated using (public.pengguna_aktif());
drop policy if exists tutup_riwayat_baca on public.tutup_buku_riwayat;
create policy tutup_riwayat_baca on public.tutup_buku_riwayat for select to authenticated using (public.hak('jurnal') is not null);
drop policy if exists akuntansi_baca on public.akuntansi;
create policy akuntansi_baca on public.akuntansi for select to authenticated using (public.pengguna_aktif());
drop policy if exists akuntansi_ubah on public.akuntansi;
create policy akuntansi_ubah on public.akuntansi for update to authenticated
  using (public.hak('pengaturan') = 'ubah') with check (public.hak('pengaturan') = 'ubah');
drop policy if exists audit_baca on public.audit_log;
create policy audit_baca on public.audit_log for select to authenticated using (public.super_admin() or public.hak('jurnal') is not null);
drop policy if exists notifikasi_milik on public.notifikasi_status;
create policy notifikasi_milik on public.notifikasi_status for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke all on public.peran, public.akun, public.rekening, public.kas_transaksi, public.transfer, public.jurnal, public.jurnal_baris,
  public.pemetaan_jurnal, public.tutup_buku, public.tutup_buku_riwayat, public.akuntansi, public.audit_log, public.notifikasi_status from anon;
grant select, insert, update, delete on public.peran, public.akun, public.rekening, public.kas_transaksi, public.transfer to authenticated;
grant select on public.jurnal, public.jurnal_baris, public.pemetaan_jurnal, public.tutup_buku, public.tutup_buku_riwayat, public.audit_log to authenticated;
grant select, update on public.akuntansi, public.perusahaan to authenticated;
grant select, insert, update, delete on public.notifikasi_status to authenticated;
grant select, update on public.profiles to authenticated;
grant execute on function public.pengguna_aktif(), public.super_admin(), public.hak(text), public.khusus(text),
  public.simpan_jurnal_manual(uuid, date, text, jsonb, jsonb), public.hapus_jurnal_manual(uuid),
  public.tutup_bulan(date), public.buka_bulan(date, text), public.pulihkan_keuangan(jsonb), public.hari_ini() to authenticated;
grant execute on function public.identitas_aplikasi() to anon, authenticated;
-- Fungsi internal pemicu tidak dipanggil langsung dari aplikasi.
revoke execute on function public.jurnal_otomatis(text, uuid, date, text, jsonb, jsonb, text) from public, anon, authenticated;

-- Bukti transaksi keuangan (PDF, JPG, PNG). Batas ukuran per file diatur di Pengaturan aplikasi;
-- batas keras di sini 50 MB.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bukti-keuangan', 'bukti-keuangan', false, 52428800, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists bukti_keuangan_baca on storage.objects;
create policy bukti_keuangan_baca on storage.objects for select to authenticated
  using (bucket_id = 'bukti-keuangan' and (public.hak('kas') is not null or public.hak('jurnal') is not null));
drop policy if exists bukti_keuangan_tambah on storage.objects;
create policy bukti_keuangan_tambah on storage.objects for insert to authenticated
  with check (bucket_id = 'bukti-keuangan' and (public.hak('kas') = 'ubah' or public.hak('jurnal') = 'ubah'));
drop policy if exists bukti_keuangan_hapus on storage.objects;
create policy bukti_keuangan_hapus on storage.objects for delete to authenticated
  using (bucket_id = 'bukti-keuangan' and (public.hak('kas') = 'ubah' or public.hak('jurnal') = 'ubah'));

-- =====================================================================
-- 9. PEMERIKSAAN
-- =====================================================================
select
  (select count(*) from public.akun where standar) as akun_standar,           -- 48
  (select count(*) from public.peran) as jumlah_peran,                        -- 3
  (select count(*) from public.profiles where super_admin) as super_admin,    -- 1
  (select count(*) from public.pemetaan_jurnal) as baris_pemetaan;            -- 10
