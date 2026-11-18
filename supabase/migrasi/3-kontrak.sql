-- Alinea 5 — Migrasi Tahap 3: Kontrak Klien + Termin & Piutang.
-- Kontrak, addendum, jadwal termin (baris tagihan), dan penerimaan disimpan di tabel relasional.
-- Penerimaan termin otomatis membuat jurnal (basis kas); invoice membuat jurnal hanya bila basis akrual.
-- Uang: rupiah utuh (bigint). Tarif PPN dan retensi dalam basis poin (1100 = 11,00%).
-- Data kontrak/termin bentuk lama (tabel records) DIARSIPKAN ke arsip_tahap3.records, tidak dihapus.
-- Aman dijalankan ulang. Pembatalan: 3-batal.sql. Uji: 3-uji.sql.

-- =====================================================================
-- 1. ARSIP DATA KONTRAK & TERMIN BENTUK LAMA
-- =====================================================================
create schema if not exists arsip_tahap3;
create table if not exists arsip_tahap3.records as select * from public.records where false;
-- Arsip hanya untuk pemulihan lewat SQL Editor: dikunci dari aplikasi (RLS tanpa policy).
alter table arsip_tahap3.records enable row level security;
revoke all on schema arsip_tahap3 from anon, authenticated;
insert into arsip_tahap3.records
  select * from public.records r
  where r.tabel in ('kontrak', 'termin') and not exists (select 1 from arsip_tahap3.records a where a.id = r.id);
delete from public.records where tabel in ('kontrak', 'termin');

-- =====================================================================
-- 2. PENGATURAN: TARIF PPN, FORMAT NOMOR INVOICE, JATUH TEMPO BAWAAN
-- =====================================================================
alter table public.akuntansi add column if not exists tarif_ppn_bp integer not null default 1100 check (tarif_ppn_bp between 0 and 9999);
alter table public.akuntansi add column if not exists format_invoice text not null default 'INV/{YYYY}/{MM}/{NNN}';
alter table public.akuntansi add column if not exists jatuh_tempo_hari integer not null default 14 check (jatuh_tempo_hari between 0 and 365);

-- =====================================================================
-- 3. TABEL
-- =====================================================================
create table if not exists public.kontrak_klien (
  id uuid primary key default gen_random_uuid(),
  perusahaan_id uuid not null default public.perusahaan_tunggal() references public.perusahaan (id),
  proyek_kode text not null,
  no_kontrak text not null check (btrim(no_kontrak) <> ''),
  tanggal date not null,
  jenis_perjanjian text,
  bentuk_dokumen text,
  file jsonb,
  nilai_jasa bigint not null check (nilai_jasa > 0),
  nilai_titipan bigint not null default 0 check (nilai_titipan >= 0),
  ppn text not null default 'tidak' check (ppn in ('tidak', 'belum', 'termasuk')),
  tarif_ppn_bp integer not null default 0 check (tarif_ppn_bp between 0 and 9999),
  akun_pendapatan text not null check (akun_pendapatan in ('4-1', '4-2')),
  mulai date,
  selesai date,
  denda_alinea_persen numeric check (denda_alinea_persen >= 0),
  denda_alinea_maks numeric check (denda_alinea_maks >= 0),
  denda_alinea_maks_jenis text check (denda_alinea_maks_jenis in ('persen', 'rp')),
  denda_klien_persen numeric check (denda_klien_persen >= 0),
  denda_klien_satuan text check (denda_klien_satuan in ('hari', 'bulan')),
  denda_klien_maks numeric check (denda_klien_maks >= 0),
  denda_klien_maks_jenis text check (denda_klien_maks_jenis in ('persen', 'rp')),
  retensi_bp integer not null default 0 check (retensi_bp between 0 and 9999),
  masa_pemeliharaan_hari integer check (masa_pemeliharaan_hari >= 0),
  tgl_serah_terima date,
  garansi_bulan integer check (garansi_bulan >= 0),
  garansi_mulai date,
  klausul text,
  dibuat timestamptz not null default now(),
  dibuat_oleh uuid default auth.uid(),
  check (selesai is null or mulai is null or selesai >= mulai)
);
create unique index if not exists kontrak_klien_no_unik on public.kontrak_klien (perusahaan_id, lower(btrim(no_kontrak)));
create index if not exists kontrak_klien_proyek_idx on public.kontrak_klien (proyek_kode);

create table if not exists public.kontrak_addendum (
  id uuid primary key default gen_random_uuid(),
  perusahaan_id uuid not null default public.perusahaan_tunggal() references public.perusahaan (id),
  kontrak_id uuid not null references public.kontrak_klien (id) on delete cascade,
  no text not null check (btrim(no) <> ''),
  tanggal date not null,
  tambah_jasa bigint not null default 0,
  tambah_titipan bigint not null default 0,
  selesai_baru date,
  uraian text,
  file jsonb,
  cara_termin text not null check (cara_termin in ('tambah', 'sesuaikan')),
  penyesuaian jsonb,
  dibuat timestamptz not null default now(),
  dibuat_oleh uuid default auth.uid()
);
create unique index if not exists kontrak_addendum_no_unik on public.kontrak_addendum (kontrak_id, lower(btrim(no)));

-- Satu baris = satu tagihan (termin, atau retensi yang dikumpulkan). dpp..tagihan dihitung pemicu, tidak diketik.
create table if not exists public.termin (
  id uuid primary key default gen_random_uuid(),
  perusahaan_id uuid not null default public.perusahaan_tunggal() references public.perusahaan (id),
  kontrak_id uuid not null references public.kontrak_klien (id) on delete cascade,
  addendum_id uuid references public.kontrak_addendum (id) on delete set null,
  jenis text not null default 'termin' check (jenis in ('termin', 'retensi')),
  ke integer,
  milestone text,
  jasa bigint not null default 0 check (jasa >= 0),
  titipan bigint not null default 0 check (titipan >= 0),
  perkiraan_tagih date,
  dpp bigint not null default 0,
  ppn bigint not null default 0,
  ret_jasa bigint not null default 0,
  ret_titipan bigint not null default 0,
  tagihan bigint not null default 0,
  no_invoice text,
  tgl_invoice date,
  jatuh_tempo date,
  rekening_id uuid references public.rekening (id),
  dibuat timestamptz not null default now(),
  dibuat_oleh uuid default auth.uid(),
  check ((no_invoice is null) = (tgl_invoice is null)),
  check (jatuh_tempo is null or tgl_invoice is null or jatuh_tempo >= tgl_invoice)
);
create unique index if not exists termin_invoice_unik on public.termin (perusahaan_id, no_invoice) where no_invoice is not null;
create unique index if not exists termin_satu_retensi on public.termin (kontrak_id) where jenis = 'retensi';
create index if not exists termin_kontrak_idx on public.termin (kontrak_id);

-- Penerimaan (riwayat, boleh berkali-kali per tagihan). alok_* = pembagian ke pendapatan / titipan / PPN, dihitung saat disimpan.
create table if not exists public.penerimaan (
  id uuid primary key default gen_random_uuid(),
  perusahaan_id uuid not null default public.perusahaan_tunggal() references public.perusahaan (id),
  termin_id uuid not null references public.termin (id),
  tanggal date not null,
  jumlah bigint not null default 0 check (jumlah >= 0),
  potongan_pajak bigint not null default 0 check (potongan_pajak >= 0),
  rekening_id uuid references public.rekening (id),
  bukti_potong jsonb,
  bukti_transfer jsonb,
  catatan text,
  alok_pendapatan bigint not null default 0,
  alok_titipan bigint not null default 0,
  alok_ppn bigint not null default 0,
  dibuat timestamptz not null default now(),
  dibuat_oleh uuid default auth.uid(),
  check (jumlah + potongan_pajak > 0),
  check (jumlah = 0 or rekening_id is not null),
  check (alok_pendapatan + alok_titipan + alok_ppn = jumlah + potongan_pajak)
);
create index if not exists penerimaan_termin_idx on public.penerimaan (termin_id);

-- =====================================================================
-- 4. JURNAL: SUMBER BARU DAN PEMETAAN
-- =====================================================================
alter table public.jurnal drop constraint if exists jurnal_sumber_check;
alter table public.jurnal add constraint jurnal_sumber_check check (sumber in ('manual', 'saldo_awal', 'kas', 'transfer', 'penerimaan', 'invoice'));

-- Pemetaan satu sisi: setiap jenis memuat satu baris (debit ATAU kredit); jurnal tetap wajib seimbang.
insert into public.pemetaan_jurnal (jenis, urut, nama, sisi, akun, keterangan) values
  ('terima_rekening', 1, 'Penerimaan termin – uang masuk', 'D', 'REKENING', 'Rekening penerima (jumlah yang diterima)'),
  ('terima_potongan', 1, 'Penerimaan termin – pajak dipotong klien', 'D', '1-3', 'Pajak Dibayar di Muka (potongan pajak oleh klien)'),
  ('terima_pendapatan', 1, 'Penerimaan termin – porsi jasa (basis kas)', 'K', 'AKUN_PENDAPATAN', '4-1 atau 4-2 sesuai pilihan di kontrak, di luar PPN'),
  ('terima_titipan', 1, 'Penerimaan termin – porsi titipan (basis kas)', 'K', '2-4', 'Hutang Dana Titipan Klien (material/tukang turn-key)'),
  ('terima_ppn', 1, 'Penerimaan termin – PPN (basis kas)', 'K', '2-5', 'PPN Keluaran (bila PKP dan ada PPN)'),
  ('terima_piutang', 1, 'Penerimaan termin – pelunasan piutang (basis akrual)', 'K', '1-2', 'Piutang Usaha'),
  ('invoice_piutang', 1, 'Invoice termin (basis akrual)', 'D', '1-2', 'Piutang Usaha sebesar nilai tagihan'),
  ('invoice_pendapatan', 1, 'Invoice termin – porsi jasa (basis akrual)', 'K', 'AKUN_PENDAPATAN', '4-1 atau 4-2 sesuai kontrak, di luar PPN dan retensi'),
  ('invoice_titipan', 1, 'Invoice termin – porsi titipan (basis akrual)', 'K', '2-4', 'Hutang Dana Titipan Klien'),
  ('invoice_ppn', 1, 'Invoice termin – PPN (basis akrual)', 'K', '2-5', 'PPN Keluaran')
on conflict (jenis, urut) do nothing;

-- =====================================================================
-- 5. FUNGSI HITUNG
-- =====================================================================
-- round(a * b / c), setengah menjauhi nol. Sama dengan bagi() di js/kontrak-util.js.
create or replace function public.bagi(a bigint, b bigint, c bigint)
returns bigint language sql immutable set search_path = ''
as $$ select case when c = 0 then 0 else round(a::numeric * b / c)::bigint end $$;

-- Nilai baris termin dihitung dari kontraknya. Baris yang sudah ditagih tidak boleh berubah nilainya.
create or replace function public.hitung_termin()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  k public.kontrak_klien;
  bp int;
begin
  select * into k from public.kontrak_klien where id = new.kontrak_id;
  if new.jenis = 'retensi' then
    new.dpp := new.jasa; new.ppn := 0; new.ret_jasa := 0; new.ret_titipan := 0;
  else
    bp := case when k.ppn = 'tidak' then 0 else k.tarif_ppn_bp end;
    if k.ppn = 'termasuk' then
      new.dpp := public.bagi(new.jasa, 10000, 10000 + bp); new.ppn := new.jasa - new.dpp;
    else
      new.dpp := new.jasa; new.ppn := case when k.ppn = 'belum' then public.bagi(new.jasa, bp, 10000) else 0 end;
    end if;
    new.ret_jasa := public.bagi(new.dpp, k.retensi_bp, 10000);
    new.ret_titipan := public.bagi(new.titipan, k.retensi_bp, 10000);
  end if;
  new.tagihan := new.dpp + new.ppn + new.titipan - new.ret_jasa - new.ret_titipan;
  if tg_op = 'UPDATE' and old.no_invoice is not null and current_setting('alinea.pulihkan', true) is distinct from 'ya'
     and (new.tagihan <> old.tagihan or new.dpp <> old.dpp or new.ppn <> old.ppn or new.titipan <> old.titipan
          or new.ret_jasa <> old.ret_jasa or new.ret_titipan <> old.ret_titipan) then
    raise exception '% sudah ditagih (invoice %), jadi nilainya tidak bisa diubah lagi.',
      case when old.jenis = 'retensi' then 'Retensi' else 'Termin ke-' || old.ke end, old.no_invoice;
  end if;
  return new;
end $$;
drop trigger if exists termin_hitung on public.termin;
create trigger termin_hitung before insert or update on public.termin for each row execute function public.hitung_termin();

-- Baris retensi = kumpulan potongan retensi semua termin; perkiraan tagih = tanggal pencairan.
create or replace function public.susun_retensi(p_kontrak uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  k public.kontrak_klien;
  sj bigint; st bigint;
  r public.termin;
  cair date;
begin
  select * into k from public.kontrak_klien where id = p_kontrak;
  update public.termin set jasa = jasa where kontrak_id = p_kontrak and jenis = 'termin'; -- hitung ulang bila PPN/retensi berubah
  select coalesce(sum(ret_jasa), 0), coalesce(sum(ret_titipan), 0) into sj, st from public.termin where kontrak_id = p_kontrak and jenis = 'termin';
  select * into r from public.termin where kontrak_id = p_kontrak and jenis = 'retensi';
  cair := case when k.tgl_serah_terima is not null and k.masa_pemeliharaan_hari is not null then k.tgl_serah_terima + k.masa_pemeliharaan_hari end;
  if sj + st = 0 then
    if r.id is not null then
      if r.no_invoice is not null then raise exception 'Retensi sudah ditagih (invoice %), jadi retensi tidak bisa dihapus.', r.no_invoice; end if;
      delete from public.termin where id = r.id;
    end if;
  elsif r.id is null then
    insert into public.termin (kontrak_id, jenis, milestone, jasa, titipan, perkiraan_tagih) values (p_kontrak, 'retensi', 'Retensi', sj, st, cair);
  else
    update public.termin set jasa = sj, titipan = st, perkiraan_tagih = cair where id = r.id;
  end if;
end $$;

create or replace function public.nomori_termin(p_kontrak uuid)
returns void language sql security definer set search_path = ''
as $$
  update public.termin t set ke = x.n
  from (select id, row_number() over (order by ke nulls last, dibuat, id) as n from public.termin where kontrak_id = p_kontrak and jenis = 'termin') x
  where t.id = x.id and t.ke is distinct from x.n
$$;

-- Jumlah termin wajib = nilai kontrak (awal + semua addendum), porsi jasa dan titipan masing-masing.
create or replace function public.cek_total_termin(p_kontrak uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  k public.kontrak_klien;
  tj bigint; tt bigint; sj bigint; st bigint; n int;
begin
  select * into k from public.kontrak_klien where id = p_kontrak;
  select k.nilai_jasa + coalesce(sum(tambah_jasa), 0), k.nilai_titipan + coalesce(sum(tambah_titipan), 0) into tj, tt
  from public.kontrak_addendum where kontrak_id = p_kontrak;
  if tj <= 0 then raise exception 'Nilai jasa setelah addendum harus lebih dari 0.'; end if;
  if tt < 0 then raise exception 'Nilai titipan setelah addendum tidak boleh minus.'; end if;
  select count(*), coalesce(sum(jasa), 0), coalesce(sum(titipan), 0) into n, sj, st from public.termin where kontrak_id = p_kontrak and jenis = 'termin';
  if n = 0 then raise exception 'Jadwal termin wajib diisi (minimal 1 termin).'; end if;
  if exists (select 1 from public.termin where kontrak_id = p_kontrak and jenis = 'termin' and jasa + titipan <= 0) then
    raise exception 'Setiap termin harus bernilai lebih dari 0.';
  end if;
  if sj <> tj or st <> tt then
    raise exception 'Total termin harus 100%% dari nilai kontrak. Porsi jasa Rp % dari Rp %, porsi titipan Rp % dari Rp %.',
      to_char(sj, 'FM999G999G999G999'), to_char(tj, 'FM999G999G999G999'), to_char(st, 'FM999G999G999G999'), to_char(tt, 'FM999G999G999G999');
  end if;
end $$;

-- =====================================================================
-- 6. KONTRAK DAN ADDENDUM (lewat fungsi agar kontrak + jadwal termin tersimpan bersama)
-- =====================================================================
-- p: isi kontrak; p_termin: [{id?, milestone, jasa, titipan, perkiraan_tagih}] berurutan (termin biasa saja).
create or replace function public.simpan_kontrak(p_id uuid, p jsonb, p_termin jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  kid uuid := p_id;
  lama public.kontrak_klien;
  prof jsonb;
  tarif int;
  tgl date := nullif(p ->> 'tanggal', '')::date;
  mode text := coalesce(p ->> 'ppn', 'tidak');
  ada_tagih boolean := false;
  t jsonb;
  i int := 0;
  ids uuid[] := '{}';
  tid uuid;
begin
  if public.hak('kontrak') is distinct from 'ubah' then raise exception 'Anda tidak punya hak mengubah kontrak.'; end if;
  if not exists (select 1 from public.records where tabel = 'proyek' and data ->> 'kode' = p ->> 'proyek_kode') then
    raise exception 'Proyek wajib dipilih.';
  end if;
  if tgl is null then raise exception 'Tanggal kontrak wajib diisi.'; end if;
  select data into prof from public.perusahaan where id = public.perusahaan_tunggal();
  if mode <> 'tidak' and not (coalesce((prof ->> 'pkp')::boolean, false) and nullif(prof ->> 'tgl_pkp', '') is not null and (prof ->> 'tgl_pkp')::date <= tgl) then
    raise exception 'PPN hanya bisa dipilih bila perusahaan sudah PKP pada tanggal kontrak (lihat Pengaturan → Profil perusahaan).';
  end if;
  if kid is not null then
    select * into lama from public.kontrak_klien where id = kid for update;
    if lama.id is null then raise exception 'Kontrak tidak ditemukan.'; end if;
    ada_tagih := exists (select 1 from public.termin where kontrak_id = kid and no_invoice is not null);
    if ada_tagih and (lama.ppn <> mode or lama.retensi_bp <> coalesce((p ->> 'retensi_bp')::int, 0) or lama.proyek_kode <> p ->> 'proyek_kode') then
      raise exception 'Sudah ada tagihan yang terbit: proyek, perlakuan PPN, dan retensi tidak bisa diubah lagi.';
    end if;
  end if;
  -- Tarif PPN disalin dari Pengaturan saat kontrak dibuat / perlakuan PPN diubah, lalu tetap.
  tarif := case when mode = 'tidak' then 0
                when lama.id is not null and lama.ppn = mode and lama.tarif_ppn_bp > 0 then lama.tarif_ppn_bp
                else (select tarif_ppn_bp from public.akuntansi limit 1) end;
  if mode <> 'tidak' and coalesce(tarif, 0) <= 0 then raise exception 'Tarif PPN belum diatur di Pengaturan → Akuntansi.'; end if;

  if kid is null then
    insert into public.kontrak_klien (proyek_kode, no_kontrak, tanggal, nilai_jasa, nilai_titipan, ppn, tarif_ppn_bp, akun_pendapatan)
    values (p ->> 'proyek_kode', btrim(p ->> 'no_kontrak'), tgl, (p ->> 'nilai_jasa')::bigint, coalesce((p ->> 'nilai_titipan')::bigint, 0), mode, tarif, p ->> 'akun_pendapatan')
    returning id into kid;
  end if;
  update public.kontrak_klien set
    proyek_kode = p ->> 'proyek_kode', no_kontrak = btrim(p ->> 'no_kontrak'), tanggal = tgl,
    jenis_perjanjian = nullif(p ->> 'jenis_perjanjian', ''), bentuk_dokumen = nullif(p ->> 'bentuk_dokumen', ''), file = p -> 'file',
    nilai_jasa = (p ->> 'nilai_jasa')::bigint, nilai_titipan = coalesce((p ->> 'nilai_titipan')::bigint, 0),
    ppn = mode, tarif_ppn_bp = tarif, akun_pendapatan = p ->> 'akun_pendapatan',
    mulai = nullif(p ->> 'mulai', '')::date, selesai = nullif(p ->> 'selesai', '')::date,
    denda_alinea_persen = nullif(p ->> 'denda_alinea_persen', '')::numeric, denda_alinea_maks = nullif(p ->> 'denda_alinea_maks', '')::numeric,
    denda_alinea_maks_jenis = nullif(p ->> 'denda_alinea_maks_jenis', ''),
    denda_klien_persen = nullif(p ->> 'denda_klien_persen', '')::numeric, denda_klien_satuan = nullif(p ->> 'denda_klien_satuan', ''),
    denda_klien_maks = nullif(p ->> 'denda_klien_maks', '')::numeric, denda_klien_maks_jenis = nullif(p ->> 'denda_klien_maks_jenis', ''),
    retensi_bp = coalesce((p ->> 'retensi_bp')::int, 0), masa_pemeliharaan_hari = nullif(p ->> 'masa_pemeliharaan_hari', '')::int,
    tgl_serah_terima = nullif(p ->> 'tgl_serah_terima', '')::date,
    garansi_bulan = nullif(p ->> 'garansi_bulan', '')::int, garansi_mulai = nullif(p ->> 'garansi_mulai', '')::date,
    klausul = nullif(p ->> 'klausul', '')
  where id = kid;
  if (select retensi_bp from public.kontrak_klien where id = kid) > 0 and (select masa_pemeliharaan_hari from public.kontrak_klien where id = kid) is null then
    raise exception 'Masa pemeliharaan (hari) wajib diisi bila ada retensi.';
  end if;

  for t in select value from jsonb_array_elements(coalesce(p_termin, '[]'::jsonb)) loop
    i := i + 1;
    tid := nullif(t ->> 'id', '')::uuid;
    if tid is not null and exists (select 1 from public.termin where id = tid and kontrak_id = kid and jenis = 'termin') then
      update public.termin set ke = i, milestone = nullif(t ->> 'milestone', ''), jasa = (t ->> 'jasa')::bigint, titipan = (t ->> 'titipan')::bigint,
        perkiraan_tagih = nullif(t ->> 'perkiraan_tagih', '')::date
      where id = tid;
    else
      insert into public.termin (kontrak_id, jenis, ke, milestone, jasa, titipan, perkiraan_tagih)
      values (kid, 'termin', i, nullif(t ->> 'milestone', ''), (t ->> 'jasa')::bigint, (t ->> 'titipan')::bigint, nullif(t ->> 'perkiraan_tagih', '')::date)
      returning id into tid;
    end if;
    ids := ids || tid;
  end loop;
  if exists (select 1 from public.termin where kontrak_id = kid and jenis = 'termin' and not (id = any (ids)) and no_invoice is not null) then
    raise exception 'Termin yang sudah ditagih tidak bisa dihapus dari jadwal.';
  end if;
  delete from public.termin where kontrak_id = kid and jenis = 'termin' and not (id = any (ids));
  perform public.susun_retensi(kid);
  perform public.cek_total_termin(kid);
  return kid;
end $$;

create or replace function public.hapus_kontrak(p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if public.hak('kontrak') is distinct from 'ubah' then raise exception 'Anda tidak punya hak menghapus kontrak.'; end if;
  if exists (select 1 from public.termin where kontrak_id = p_id and no_invoice is not null) then
    raise exception 'Kontrak yang sudah punya invoice tidak bisa dihapus.';
  end if;
  delete from public.kontrak_klien where id = p_id;
end $$;

-- Addendum baru: p_termin = termin tambahan [{milestone, jasa, titipan, perkiraan_tagih}] (cara 'tambah'),
-- atau nilai baru termin yang belum ditagih [{id, jasa, titipan}] (cara 'sesuaikan').
-- Addendum yang sudah ada: hanya nomor, tanggal, tanggal selesai baru, uraian, dan file yang bisa diubah.
create or replace function public.simpan_addendum(p_kontrak uuid, p_id uuid, p jsonb, p_termin jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  aid uuid := p_id;
  cara text := p ->> 'cara_termin';
  tj bigint := coalesce((p ->> 'tambah_jasa')::bigint, 0);
  tt bigint := coalesce((p ->> 'tambah_titipan')::bigint, 0);
  t jsonb;
  r public.termin;
  sesuai jsonb := '[]'::jsonb;
  sj bigint := 0; st bigint := 0;
  urut int;
begin
  if public.hak('kontrak') is distinct from 'ubah' then raise exception 'Anda tidak punya hak mengubah kontrak.'; end if;
  if not exists (select 1 from public.kontrak_klien where id = p_kontrak) then raise exception 'Kontrak tidak ditemukan.'; end if;
  if coalesce(btrim(p ->> 'no'), '') = '' then raise exception 'No. addendum wajib diisi.'; end if;
  if nullif(p ->> 'tanggal', '') is null then raise exception 'Tanggal addendum wajib diisi.'; end if;
  if aid is not null then
    update public.kontrak_addendum set no = btrim(p ->> 'no'), tanggal = (p ->> 'tanggal')::date, selesai_baru = nullif(p ->> 'selesai_baru', '')::date,
      uraian = nullif(p ->> 'uraian', ''), file = p -> 'file'
    where id = aid and kontrak_id = p_kontrak;
    if not found then raise exception 'Addendum tidak ditemukan.'; end if;
    return aid;
  end if;
  if cara not in ('tambah', 'sesuaikan') then raise exception 'Pilih cara menyesuaikan termin.'; end if;
  insert into public.kontrak_addendum (kontrak_id, no, tanggal, tambah_jasa, tambah_titipan, selesai_baru, uraian, file, cara_termin)
  values (p_kontrak, btrim(p ->> 'no'), (p ->> 'tanggal')::date, tj, tt, nullif(p ->> 'selesai_baru', '')::date, nullif(p ->> 'uraian', ''), p -> 'file', cara)
  returning id into aid;
  if cara = 'tambah' then
    if tj < 0 or tt < 0 then raise exception 'Pengurangan nilai kontrak memakai pilihan "sesuaikan termin yang belum ditagih".'; end if;
    select coalesce(max(ke), 0) into urut from public.termin where kontrak_id = p_kontrak and jenis = 'termin';
    for t in select value from jsonb_array_elements(coalesce(p_termin, '[]'::jsonb)) loop
      urut := urut + 1;
      insert into public.termin (kontrak_id, addendum_id, jenis, ke, milestone, jasa, titipan, perkiraan_tagih)
      values (p_kontrak, aid, 'termin', urut, nullif(t ->> 'milestone', ''), (t ->> 'jasa')::bigint, (t ->> 'titipan')::bigint, nullif(t ->> 'perkiraan_tagih', '')::date);
      sj := sj + (t ->> 'jasa')::bigint; st := st + (t ->> 'titipan')::bigint;
    end loop;
    if (tj <> 0 or tt <> 0) and (sj <> tj or st <> tt) then
      raise exception 'Termin tambahan harus sama dengan perubahan nilai addendum (jasa Rp %, titipan Rp %).', to_char(tj, 'FM999G999G999G999'), to_char(tt, 'FM999G999G999G999');
    end if;
  else
    for t in select value from jsonb_array_elements(coalesce(p_termin, '[]'::jsonb)) loop
      select * into r from public.termin where id = (t ->> 'id')::uuid and kontrak_id = p_kontrak and jenis = 'termin';
      if r.id is null then raise exception 'Termin yang disesuaikan tidak ditemukan.'; end if;
      if r.no_invoice is not null then raise exception 'Termin ke-% sudah ditagih dan tidak bisa disesuaikan.', r.ke; end if;
      sesuai := sesuai || jsonb_build_object('id', r.id, 'delta_jasa', (t ->> 'jasa')::bigint - r.jasa, 'delta_titipan', (t ->> 'titipan')::bigint - r.titipan);
      update public.termin set jasa = (t ->> 'jasa')::bigint, titipan = (t ->> 'titipan')::bigint where id = r.id;
    end loop;
    update public.kontrak_addendum set penyesuaian = sesuai where id = aid;
  end if;
  perform public.susun_retensi(p_kontrak);
  perform public.cek_total_termin(p_kontrak);
  return aid;
end $$;

-- Hanya addendum terakhir yang bisa dihapus; perubahan terminnya dikembalikan.
create or replace function public.hapus_addendum(p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  a public.kontrak_addendum;
  x jsonb;
begin
  if public.hak('kontrak') is distinct from 'ubah' then raise exception 'Anda tidak punya hak mengubah kontrak.'; end if;
  select * into a from public.kontrak_addendum where id = p_id;
  if a.id is null then raise exception 'Addendum tidak ditemukan.'; end if;
  if exists (select 1 from public.kontrak_addendum where kontrak_id = a.kontrak_id and (dibuat, id) > (a.dibuat, a.id)) then
    raise exception 'Hanya addendum terakhir yang bisa dihapus.';
  end if;
  if a.cara_termin = 'tambah' then
    if exists (select 1 from public.termin where addendum_id = a.id and no_invoice is not null) then
      raise exception 'Termin dari addendum ini sudah ditagih, jadi addendum tidak bisa dihapus.';
    end if;
    delete from public.termin where addendum_id = a.id;
  else
    for x in select value from jsonb_array_elements(coalesce(a.penyesuaian, '[]'::jsonb)) loop
      if exists (select 1 from public.termin where id = (x ->> 'id')::uuid and no_invoice is not null) then
        raise exception 'Termin yang disesuaikan addendum ini sudah ditagih, jadi addendum tidak bisa dihapus.';
      end if;
      update public.termin set jasa = jasa - (x ->> 'delta_jasa')::bigint, titipan = titipan - (x ->> 'delta_titipan')::bigint where id = (x ->> 'id')::uuid;
    end loop;
  end if;
  delete from public.kontrak_addendum where id = a.id;
  perform public.nomori_termin(a.kontrak_id);
  perform public.susun_retensi(a.kontrak_id);
  perform public.cek_total_termin(a.kontrak_id);
end $$;

-- =====================================================================
-- 7. INVOICE DAN PENERIMAAN
-- =====================================================================
-- Nomor invoice berikutnya menurut format di Pengaturan → Akuntansi. Sama dengan nomorInvoice() di js/kontrak-util.js.
create or replace function public.nomor_invoice_berikut(p_tanggal date)
returns text language plpgsql stable security definer set search_path = ''
as $$
declare
  f text := (select format_invoice from public.akuntansi limit 1);
  pola text; n text; depan text; belakang text; pos int; maks int;
begin
  pola := replace(replace(replace(f, '{YYYY}', to_char(p_tanggal, 'YYYY')), '{YY}', to_char(p_tanggal, 'YY')), '{MM}', to_char(p_tanggal, 'MM'));
  n := substring(pola from '\{N+\}');
  if n is null then raise exception 'Format nomor invoice di Pengaturan → Akuntansi belum memuat nomor urut, mis. {NNN}.'; end if;
  pos := strpos(pola, n);
  depan := left(pola, pos - 1);
  belakang := substr(pola, pos + length(n));
  select coalesce(max(substring(no_invoice from length(depan) + 1 for length(no_invoice) - length(depan) - length(belakang))::int), 0) into maks
  from public.termin
  where no_invoice is not null and left(no_invoice, length(depan)) = depan and right(no_invoice, length(belakang)) = belakang
    and length(no_invoice) > length(depan) + length(belakang)
    and substring(no_invoice from length(depan) + 1 for length(no_invoice) - length(depan) - length(belakang)) ~ '^[0-9]+$';
  return depan || lpad((maks + 1)::text, greatest(length(n) - 2, length((maks + 1)::text)), '0') || belakang;
end $$;

-- Jurnal invoice: hanya bila basis akrual (D Piutang / K Pendapatan, Titipan, PPN). Basis kas: tidak ada jurnal.
create or replace function public.jurnal_invoice(p_termin uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  t public.termin;
  k public.kontrak_klien;
begin
  select * into t from public.termin where id = p_termin;
  select * into k from public.kontrak_klien where id = t.kontrak_id;
  if t.no_invoice is null or (select basis from public.akuntansi limit 1) <> 'akrual' then
    perform public.jurnal_otomatis('invoice', p_termin, null, null, null, null);
    return;
  end if;
  perform public.jurnal_otomatis('invoice', t.id, t.tgl_invoice, 'Invoice ' || t.no_invoice || ' · ' || k.proyek_kode,
    jsonb_build_array(
      jsonb_build_object('jenis', 'invoice_piutang', 'jumlah', t.tagihan),
      jsonb_build_object('jenis', 'invoice_pendapatan', 'jumlah', t.dpp - t.ret_jasa),
      jsonb_build_object('jenis', 'invoice_titipan', 'jumlah', t.titipan - t.ret_titipan),
      jsonb_build_object('jenis', 'invoice_ppn', 'jumlah', t.ppn)),
    jsonb_build_object('AKUN_PENDAPATAN', public.akun_kode(k.akun_pendapatan)), k.proyek_kode);
end $$;

-- Terbitkan invoice (nomor otomatis), atau ubah tanggal / jatuh tempo / rekening invoice yang belum dibayar.
create or replace function public.terbitkan_invoice(p_termin uuid, p_tanggal date, p_jatuh_tempo date, p_rekening uuid)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  t public.termin;
  k public.kontrak_klien;
  cair date;
  nomor text;
begin
  if public.hak('termin') is distinct from 'ubah' then raise exception 'Anda tidak punya hak menerbitkan invoice.'; end if;
  select * into t from public.termin where id = p_termin for update;
  if t.id is null then raise exception 'Tagihan tidak ditemukan.'; end if;
  select * into k from public.kontrak_klien where id = t.kontrak_id;
  if p_tanggal is null then raise exception 'Tanggal invoice wajib diisi.'; end if;
  if p_jatuh_tempo is null or p_jatuh_tempo < p_tanggal then raise exception 'Jatuh tempo wajib diisi dan tidak boleh sebelum tanggal invoice.'; end if;
  if p_rekening is null or not exists (select 1 from public.rekening where id = p_rekening and aktif) then raise exception 'Rekening tujuan wajib dipilih (rekening aktif).'; end if;
  if t.tagihan <= 0 then raise exception 'Nilai tagihan 0; tidak ada yang bisa ditagih.'; end if;
  if t.jenis = 'retensi' then
    cair := case when k.tgl_serah_terima is not null and k.masa_pemeliharaan_hari is not null then k.tgl_serah_terima + k.masa_pemeliharaan_hari end;
    if cair is null then raise exception 'Isi tanggal serah terima di kontrak dulu; retensi bisa ditagih setelah masa pemeliharaan selesai.'; end if;
    if p_tanggal < cair then raise exception 'Retensi baru bisa ditagih mulai %.', to_char(cair, 'DD-MM-YYYY'); end if;
  end if;
  perform public.cek_bulan_terbuka(p_tanggal);
  if t.no_invoice is not null then
    if exists (select 1 from public.penerimaan where termin_id = t.id) then raise exception 'Invoice yang sudah ada penerimaannya tidak bisa diubah.'; end if;
    perform public.cek_bulan_terbuka(t.tgl_invoice);
    update public.termin set tgl_invoice = p_tanggal, jatuh_tempo = p_jatuh_tempo, rekening_id = p_rekening where id = t.id;
    nomor := t.no_invoice;
  else
    lock table public.termin in share row exclusive mode;
    nomor := public.nomor_invoice_berikut(p_tanggal);
    update public.termin set no_invoice = nomor, tgl_invoice = p_tanggal, jatuh_tempo = p_jatuh_tempo, rekening_id = p_rekening where id = t.id;
  end if;
  perform public.jurnal_invoice(t.id);
  return nomor;
end $$;

create or replace function public.batal_invoice(p_termin uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare t public.termin;
begin
  if public.hak('termin') is distinct from 'ubah' then raise exception 'Anda tidak punya hak membatalkan invoice.'; end if;
  select * into t from public.termin where id = p_termin for update;
  if t.no_invoice is null then raise exception 'Tagihan ini belum punya invoice.'; end if;
  if exists (select 1 from public.penerimaan where termin_id = t.id) then raise exception 'Invoice yang sudah ada penerimaannya tidak bisa dibatalkan.'; end if;
  perform public.cek_bulan_terbuka(t.tgl_invoice);
  update public.termin set no_invoice = null, tgl_invoice = null, jatuh_tempo = null, rekening_id = null where id = t.id;
  perform public.jurnal_invoice(t.id);
end $$;

-- Penerimaan: jumlah + potongan pajak dibagi ke pendapatan / titipan / PPN sebanding komposisi tagihan
-- (kumulatif, sehingga penerimaan yang melunasi tepat menghabiskan setiap komponen).
-- Hanya penerimaan terakhir sebuah tagihan yang bisa diubah atau dihapus.
create or replace function public.simpan_penerimaan(p_id uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  t public.termin;
  r public.penerimaan;
  pid uuid := p_id;
  jml bigint := coalesce((p ->> 'jumlah')::bigint, 0);
  pot bigint := coalesce((p ->> 'potongan_pajak')::bigint, 0);
  rek uuid := nullif(p ->> 'rekening_id', '')::uuid;
  sebelum bigint;
  kp bigint; kv bigint;
  a_p bigint; a_v bigint; b_p bigint; b_v bigint;
begin
  if public.hak('termin') is distinct from 'ubah' then raise exception 'Anda tidak punya hak mencatat penerimaan.'; end if;
  select * into t from public.termin where id = coalesce(nullif(p ->> 'termin_id', '')::uuid, (select termin_id from public.penerimaan where id = p_id)) for update;
  if t.id is null then raise exception 'Tagihan tidak ditemukan.'; end if;
  if t.no_invoice is null then raise exception 'Terbitkan invoice dulu sebelum mencatat penerimaan.'; end if;
  if nullif(p ->> 'tanggal', '') is null then raise exception 'Tanggal penerimaan wajib diisi.'; end if;
  if jml < 0 or pot < 0 or jml + pot <= 0 then raise exception 'Isi jumlah diterima dan/atau potongan pajak (lebih dari 0).'; end if;
  if jml > 0 and (rek is null or not exists (select 1 from public.rekening where id = rek and aktif)) then raise exception 'Rekening penerima wajib dipilih (rekening aktif).'; end if;
  if pid is not null then
    select * into r from public.penerimaan where id = pid and termin_id = t.id;
    if r.id is null then raise exception 'Penerimaan tidak ditemukan.'; end if;
    if exists (select 1 from public.penerimaan where termin_id = t.id and (dibuat, id) > (r.dibuat, r.id)) then
      raise exception 'Hanya penerimaan terakhir yang bisa diubah. Hapus dulu penerimaan sesudahnya.';
    end if;
  end if;
  select coalesce(sum(jumlah + potongan_pajak), 0) into sebelum from public.penerimaan where termin_id = t.id and id is distinct from pid;
  if sebelum + jml + pot > t.tagihan then
    raise exception 'Jumlah diterima + potongan pajak melebihi sisa tagihan (sisa Rp %).', to_char(t.tagihan - sebelum, 'FM999G999G999G999');
  end if;
  kp := t.dpp - t.ret_jasa; kv := t.ppn;
  a_p := public.bagi(kp, sebelum, t.tagihan); a_v := public.bagi(kv, sebelum, t.tagihan);
  b_p := public.bagi(kp, sebelum + jml + pot, t.tagihan); b_v := public.bagi(kv, sebelum + jml + pot, t.tagihan);
  if pid is null then
    insert into public.penerimaan (termin_id, tanggal, jumlah, potongan_pajak, rekening_id, bukti_potong, bukti_transfer, catatan, alok_pendapatan, alok_titipan, alok_ppn)
    values (t.id, (p ->> 'tanggal')::date, jml, pot, case when jml > 0 then rek end, p -> 'bukti_potong', p -> 'bukti_transfer', nullif(p ->> 'catatan', ''),
      b_p - a_p, (jml + pot) - (b_p - a_p) - (b_v - a_v), b_v - a_v)
    returning id into pid;
  else
    update public.penerimaan set tanggal = (p ->> 'tanggal')::date, jumlah = jml, potongan_pajak = pot, rekening_id = case when jml > 0 then rek end,
      bukti_potong = p -> 'bukti_potong', bukti_transfer = p -> 'bukti_transfer', catatan = nullif(p ->> 'catatan', ''),
      alok_pendapatan = b_p - a_p, alok_titipan = (jml + pot) - (b_p - a_p) - (b_v - a_v), alok_ppn = b_v - a_v
    where id = pid;
  end if;
  return pid;
end $$;

create or replace function public.hapus_penerimaan(p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare r public.penerimaan;
begin
  if public.hak('termin') is distinct from 'ubah' then raise exception 'Anda tidak punya hak menghapus penerimaan.'; end if;
  select * into r from public.penerimaan where id = p_id;
  if r.id is null then return; end if;
  if exists (select 1 from public.penerimaan where termin_id = r.termin_id and (dibuat, id) > (r.dibuat, r.id)) then
    raise exception 'Hanya penerimaan terakhir yang bisa dihapus. Hapus dulu penerimaan sesudahnya.';
  end if;
  delete from public.penerimaan where id = p_id;
end $$;

-- Penerimaan -> jurnal. Basis kas: D Rekening, D Pajak Dibayar di Muka / K Pendapatan, Titipan, PPN.
-- Basis akrual: D Rekening, D Pajak Dibayar di Muka / K Piutang Usaha.
create or replace function public.penerimaan_setelah()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  t public.termin;
  k public.kontrak_klien;
  rincian jsonb;
begin
  if tg_op = 'DELETE' then
    perform public.jurnal_otomatis('penerimaan', old.id, null, null, null, null);
    return old;
  end if;
  select * into t from public.termin where id = new.termin_id;
  select * into k from public.kontrak_klien where id = t.kontrak_id;
  rincian := jsonb_build_array(jsonb_build_object('jenis', 'terima_rekening', 'jumlah', new.jumlah),
                               jsonb_build_object('jenis', 'terima_potongan', 'jumlah', new.potongan_pajak));
  if (select basis from public.akuntansi limit 1) = 'akrual' then
    rincian := rincian || jsonb_build_array(jsonb_build_object('jenis', 'terima_piutang', 'jumlah', new.jumlah + new.potongan_pajak));
  else
    rincian := rincian || jsonb_build_array(jsonb_build_object('jenis', 'terima_pendapatan', 'jumlah', new.alok_pendapatan),
      jsonb_build_object('jenis', 'terima_titipan', 'jumlah', new.alok_titipan), jsonb_build_object('jenis', 'terima_ppn', 'jumlah', new.alok_ppn));
  end if;
  perform public.jurnal_otomatis('penerimaan', new.id, new.tanggal,
    'Penerimaan ' || t.no_invoice || ' · ' || k.proyek_kode || case when t.jenis = 'retensi' then ' retensi' else ' termin ' || t.ke end,
    rincian, jsonb_build_object('REKENING', public.akun_rekening(new.rekening_id), 'AKUN_PENDAPATAN', public.akun_kode(k.akun_pendapatan)), k.proyek_kode);
  return new;
end $$;
drop trigger if exists penerimaan_jurnal on public.penerimaan;
create trigger penerimaan_jurnal after insert or update or delete on public.penerimaan
  for each row execute function public.penerimaan_setelah();
drop trigger if exists penerimaan_tutup_buku on public.penerimaan;
create trigger penerimaan_tutup_buku before insert or update or delete on public.penerimaan
  for each row execute function public.jaga_tutup_buku('tanggal');

do $$
declare t text;
begin
  foreach t in array array['kontrak_klien', 'kontrak_addendum', 'termin', 'penerimaan'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.catat_audit()', t || '_audit', t);
  end loop;
end $$;

-- =====================================================================
-- 8. PULIHKAN CADANGAN: ikut memulihkan kontrak, termin, dan penerimaan
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

-- =====================================================================
-- 9. AKSES (RLS) DAN IZIN
-- =====================================================================
alter table public.kontrak_klien enable row level security;
alter table public.kontrak_addendum enable row level security;
alter table public.termin enable row level security;
alter table public.penerimaan enable row level security;

do $$
declare t text;
begin
  foreach t in array array['kontrak_klien', 'kontrak_addendum', 'termin', 'penerimaan'] loop
    execute format('drop policy if exists %I on public.%I', t || '_baca', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.hak(''kontrak'') is not null or public.hak(''termin'') is not null or public.hak(''kas'') is not null or public.hak(''jurnal'') is not null)', t || '_baca', t);
  end loop;
end $$;

-- Tabel hanya dibaca langsung; ditulis lewat fungsi di atas (yang memeriksa hak dan aturan).
revoke all on public.kontrak_klien, public.kontrak_addendum, public.termin, public.penerimaan from anon;
revoke insert, update, delete on public.kontrak_klien, public.kontrak_addendum, public.termin, public.penerimaan from authenticated;
grant select on public.kontrak_klien, public.kontrak_addendum, public.termin, public.penerimaan to authenticated;
grant execute on function public.simpan_kontrak(uuid, jsonb, jsonb), public.hapus_kontrak(uuid), public.simpan_addendum(uuid, uuid, jsonb, jsonb),
  public.hapus_addendum(uuid), public.terbitkan_invoice(uuid, date, date, uuid), public.batal_invoice(uuid),
  public.simpan_penerimaan(uuid, jsonb), public.hapus_penerimaan(uuid), public.nomor_invoice_berikut(date) to authenticated;
revoke execute on function public.susun_retensi(uuid), public.nomori_termin(uuid), public.cek_total_termin(uuid), public.jurnal_invoice(uuid)
  from public, anon, authenticated;

-- File kontrak / addendum (folder kontrak/) dan bukti potong / transfer (folder termin/) di tempat bukti keuangan.
drop policy if exists bukti_kontrak_baca on storage.objects;
create policy bukti_kontrak_baca on storage.objects for select to authenticated using (
  bucket_id = 'bukti-keuangan' and (storage.foldername(name))[1] in ('kontrak', 'termin')
  and (public.hak('kontrak') is not null or public.hak('termin') is not null));
drop policy if exists bukti_kontrak_tambah on storage.objects;
create policy bukti_kontrak_tambah on storage.objects for insert to authenticated with check (
  bucket_id = 'bukti-keuangan' and (((storage.foldername(name))[1] = 'kontrak' and public.hak('kontrak') = 'ubah')
                                    or ((storage.foldername(name))[1] = 'termin' and public.hak('termin') = 'ubah')));
drop policy if exists bukti_kontrak_hapus on storage.objects;
create policy bukti_kontrak_hapus on storage.objects for delete to authenticated using (
  bucket_id = 'bukti-keuangan' and (((storage.foldername(name))[1] = 'kontrak' and public.hak('kontrak') = 'ubah')
                                    or ((storage.foldername(name))[1] = 'termin' and public.hak('termin') = 'ubah')));

-- =====================================================================
-- 10. PEMERIKSAAN
-- =====================================================================
select
  (select count(*) from information_schema.tables where table_schema = 'public'
     and table_name in ('kontrak_klien', 'kontrak_addendum', 'termin', 'penerimaan')) as tabel_baru,          -- 4
  (select count(*) from public.pemetaan_jurnal where jenis like 'terima_%' or jenis like 'invoice_%') as pemetaan_baru, -- 10
  (select tarif_ppn_bp from public.akuntansi limit 1) as tarif_ppn_bp,                                       -- 1100
  (select count(*) from arsip_tahap3.records) as data_lama_diarsipkan,
  (select count(*) from public.records where tabel in ('kontrak', 'termin')) as data_lama_tersisa;           -- 0
