-- Alinea 5 — Migrasi Tahap 4: Pihak Proyek (kontrak vendor, opname, pembayaran), Pembelian Material,
-- Dompet Proyek, dan Pinjaman Antar Proyek.
-- Jalankan SETELAH 3-kontrak.sql. Aman dijalankan ulang. Pembatalan: 4-batal.sql. Uji: 4-uji.sql.
-- Uang: rupiah utuh (bigint). Persen dalam basis poin (500 = 5,00%). Volume / qty sampai 3 desimal.
-- Data Pihak Proyek bentuk lama (tabel records, tabel 'vendor') DIARSIPKAN ke arsip_tahap4.records, tidak dihapus.
-- Opname disetujui -> jurnal (D Beban Upah 5-2 atau D Hutang Dana Titipan 2-4 / K Hutang Vendor 2-1, K Hutang Retensi 2-2).
-- Pembayaran vendor -> jurnal (D Hutang Vendor 2-1 atau Hutang Retensi 2-2 / K Kas, K Hutang Pajak 2-6).
-- Pembelian -> jurnal (D Material 5-1 / Persediaan 1-6 / PPN Masukan 1-4, atau D Hutang Dana Titipan 2-4 / K Kas atau Hutang Supplier 2-3).
-- Pinjaman antar proyek TIDAK membuat jurnal: hanya memindahkan saldo dompet antar proyek.

-- =====================================================================
-- 1. ARSIP DATA PIHAK PROYEK BENTUK LAMA
-- =====================================================================
create schema if not exists arsip_tahap4;
create table if not exists arsip_tahap4.records as select * from public.records where false;
alter table arsip_tahap4.records enable row level security;
revoke all on schema arsip_tahap4 from anon, authenticated;
insert into arsip_tahap4.records
  select * from public.records r
  where r.tabel = 'vendor' and not exists (select 1 from arsip_tahap4.records a where a.id = r.id);
delete from public.records where tabel = 'vendor';
create index if not exists records_harga_sumber_idx on public.records ((data ->> 'sumber_id')) where tabel = 'harga';

-- =====================================================================
-- 2. PENGATURAN: BATAS PINJAMAN DARI DANA TITIPAN (opsional)
-- =====================================================================
alter table public.akuntansi add column if not exists batas_pinjam_titipan_persen integer check (batas_pinjam_titipan_persen between 0 and 100);

-- =====================================================================
-- 3. TABEL
-- =====================================================================
create table if not exists public.kontrak_vendor (
  id uuid primary key default gen_random_uuid(),
  perusahaan_id uuid not null default public.perusahaan_tunggal() references public.perusahaan (id),
  proyek_kode text not null,
  vendor_id uuid not null,
  vendor_nama text not null,
  lingkup text,
  no_spk text,
  tanggal date not null,
  file jsonb,
  sumber_dana text not null check (sumber_dana in ('perusahaan', 'titipan')),
  skema text not null check (skema in ('termin', 'volume', 'persen', 'harian')),
  nilai bigint not null default 0 check (nilai >= 0),
  upah_harian bigint check (upah_harian > 0),
  perkiraan_hari integer check (perkiraan_hari >= 0),
  retensi_bp integer not null default 0 check (retensi_bp between 0 and 9999),
  masa_retensi_hari integer check (masa_retensi_hari >= 0),
  tgl_selesai date,
  catatan text,
  dibuat timestamptz not null default now(),
  dibuat_oleh uuid default auth.uid()
);
create index if not exists kontrak_vendor_proyek_idx on public.kontrak_vendor (proyek_kode);

create table if not exists public.kontrak_vendor_item (
  id uuid primary key default gen_random_uuid(),
  perusahaan_id uuid not null default public.perusahaan_tunggal() references public.perusahaan (id),
  kontrak_id uuid not null references public.kontrak_vendor (id) on delete cascade,
  urut integer not null,
  barang_id uuid not null,
  uraian text not null,
  satuan text not null,
  volume numeric(14, 3) not null check (volume > 0),
  harga bigint not null check (harga > 0)
);
create index if not exists kontrak_vendor_item_idx on public.kontrak_vendor_item (kontrak_id);

create table if not exists public.kontrak_vendor_termin (
  id uuid primary key default gen_random_uuid(),
  perusahaan_id uuid not null default public.perusahaan_tunggal() references public.perusahaan (id),
  kontrak_id uuid not null references public.kontrak_vendor (id) on delete cascade,
  ke integer not null,
  milestone text,
  persen_bp integer not null check (persen_bp > 0 and persen_bp <= 10000)
);
create index if not exists kontrak_vendor_termin_idx on public.kontrak_vendor_termin (kontrak_id);

-- Opname: detail = {"volume": {"<id item>": 1.5}} | {"persen_bp": 4000} (kumulatif) | {"hari": 6} | {"termin": ["<id termin>"]}.
-- nilai dan retensi dihitung database. Hanya opname Disetujui yang menambah hak vendor dan membuat jurnal.
create table if not exists public.opname (
  id uuid primary key default gen_random_uuid(),
  perusahaan_id uuid not null default public.perusahaan_tunggal() references public.perusahaan (id),
  kontrak_id uuid not null references public.kontrak_vendor (id),
  tanggal date not null,
  status text not null default 'draft' check (status in ('draft', 'disetujui')),
  detail jsonb not null default '{}'::jsonb,
  nilai bigint not null default 0,
  retensi bigint not null default 0,
  diperiksa_oleh text,
  diperiksa_nama text,
  foto jsonb,
  catatan text,
  dibuat timestamptz not null default now(),
  dibuat_oleh uuid default auth.uid()
);
create index if not exists opname_kontrak_idx on public.opname (kontrak_id);

create table if not exists public.pembayaran_vendor (
  id uuid primary key default gen_random_uuid(),
  perusahaan_id uuid not null default public.perusahaan_tunggal() references public.perusahaan (id),
  kontrak_id uuid not null references public.kontrak_vendor (id),
  jenis text not null default 'bayar' check (jenis in ('bayar', 'retensi')),
  tanggal date not null,
  jumlah bigint not null default 0 check (jumlah >= 0),
  potongan_pajak bigint not null default 0 check (potongan_pajak >= 0),
  rekening_id uuid references public.rekening (id),
  bukti_potong jsonb,
  bukti_transfer jsonb,
  catatan text,
  dibuat timestamptz not null default now(),
  dibuat_oleh uuid default auth.uid(),
  check (jumlah + potongan_pajak > 0),
  check (jumlah = 0 or rekening_id is not null)
);
create index if not exists pembayaran_vendor_kontrak_idx on public.pembayaran_vendor (kontrak_id);

create table if not exists public.pembelian (
  id uuid primary key default gen_random_uuid(),
  perusahaan_id uuid not null default public.perusahaan_tunggal() references public.perusahaan (id),
  tanggal date not null,
  supplier_id uuid not null,
  supplier_nama text not null,
  no_nota text,
  tujuan text not null check (tujuan in ('proyek', 'stok')),
  proyek_kode text,
  sumber_dana text not null check (sumber_dana in ('perusahaan', 'titipan')),
  cara_bayar text not null check (cara_bayar in ('tunai', 'tempo')),
  rekening_id uuid references public.rekening (id),
  jatuh_tempo date,
  ppn bigint not null default 0 check (ppn >= 0),
  ongkir bigint not null default 0 check (ongkir >= 0),
  ppn_kredit boolean not null default false,
  subtotal bigint not null default 0,
  total bigint not null default 0 check (total > 0),
  ppn_kredit_nilai bigint not null default 0,
  biaya bigint not null default 0,
  file jsonb,
  catatan text,
  dibuat timestamptz not null default now(),
  dibuat_oleh uuid default auth.uid(),
  check ((tujuan = 'proyek') = (proyek_kode is not null)),
  check (tujuan = 'proyek' or sumber_dana = 'perusahaan'),
  check (cara_bayar <> 'tunai' or rekening_id is not null),
  check (cara_bayar <> 'tempo' or (jatuh_tempo is not null and jatuh_tempo >= tanggal)),
  check (total = subtotal + ppn + ongkir and biaya = total - ppn_kredit_nilai)
);
create index if not exists pembelian_proyek_idx on public.pembelian (proyek_kode);

create table if not exists public.pembelian_baris (
  id uuid primary key default gen_random_uuid(),
  perusahaan_id uuid not null default public.perusahaan_tunggal() references public.perusahaan (id),
  pembelian_id uuid not null references public.pembelian (id) on delete cascade,
  urut integer not null,
  barang_id uuid not null,
  barang_nama text not null,
  qty numeric(14, 3) not null check (qty > 0),
  satuan text not null,
  faktor numeric not null default 1,
  harga bigint not null check (harga >= 0),
  diskon bigint not null default 0 check (diskon >= 0),
  subtotal bigint not null check (subtotal >= 0)
);
create index if not exists pembelian_baris_idx on public.pembelian_baris (pembelian_id);

create table if not exists public.pembayaran_supplier (
  id uuid primary key default gen_random_uuid(),
  perusahaan_id uuid not null default public.perusahaan_tunggal() references public.perusahaan (id),
  pembelian_id uuid not null references public.pembelian (id),
  tanggal date not null,
  jumlah bigint not null check (jumlah > 0),
  rekening_id uuid not null references public.rekening (id),
  bukti jsonb,
  catatan text,
  dibuat timestamptz not null default now(),
  dibuat_oleh uuid default auth.uid()
);
create index if not exists pembayaran_supplier_idx on public.pembayaran_supplier (pembelian_id);

-- dari_proyek kosong = dari kas perusahaan.
create table if not exists public.pinjaman_proyek (
  id uuid primary key default gen_random_uuid(),
  perusahaan_id uuid not null default public.perusahaan_tunggal() references public.perusahaan (id),
  tanggal date not null,
  dari_proyek text,
  ke_proyek text not null,
  jumlah bigint not null check (jumlah > 0),
  alasan text not null check (btrim(alasan) <> ''),
  rencana_kembali date not null,
  disetujui_oleh text not null check (btrim(disetujui_oleh) <> ''),
  konfirmasi_pemilik boolean not null default false,
  catatan text,
  dibuat timestamptz not null default now(),
  dibuat_oleh uuid default auth.uid(),
  check (dari_proyek is distinct from ke_proyek),
  check (rencana_kembali >= tanggal)
);

create table if not exists public.pengembalian_pinjaman (
  id uuid primary key default gen_random_uuid(),
  perusahaan_id uuid not null default public.perusahaan_tunggal() references public.perusahaan (id),
  pinjaman_id uuid not null references public.pinjaman_proyek (id),
  tanggal date not null,
  jumlah bigint not null check (jumlah > 0),
  catatan text,
  dibuat timestamptz not null default now(),
  dibuat_oleh uuid default auth.uid()
);
create index if not exists pengembalian_pinjaman_idx on public.pengembalian_pinjaman (pinjaman_id);

-- =====================================================================
-- 4. JURNAL: SUMBER BARU DAN PEMETAAN
-- =====================================================================
alter table public.jurnal drop constraint if exists jurnal_sumber_check;
alter table public.jurnal add constraint jurnal_sumber_check check (sumber in ('manual', 'saldo_awal', 'kas', 'transfer', 'penerimaan', 'invoice',
  'opname', 'bayar_vendor', 'pembelian', 'bayar_supplier'));

insert into public.pemetaan_jurnal (jenis, urut, nama, sisi, akun, keterangan) values
  ('opname_beban', 1, 'Opname vendor – dana perusahaan', 'D', '5-2', 'Beban Upah / Vendor / Tukang sebesar nilai opname'),
  ('opname_titipan', 1, 'Opname vendor – dana titipan klien', 'D', '2-4', 'Mengurangi Hutang Dana Titipan Klien (bukan beban)'),
  ('opname_hutang', 1, 'Opname vendor – hutang ke vendor', 'K', '2-1', 'Hutang Vendor / Tukang (nilai opname dikurangi retensi)'),
  ('opname_retensi', 1, 'Opname vendor – retensi ditahan', 'K', '2-2', 'Hutang Retensi Vendor'),
  ('bayar_vendor_hutang', 1, 'Pembayaran vendor – pelunasan hutang', 'D', '2-1', 'Hutang Vendor / Tukang (jumlah dibayar + potongan pajak)'),
  ('bayar_vendor_retensi', 1, 'Pencairan retensi vendor', 'D', '2-2', 'Hutang Retensi Vendor'),
  ('bayar_vendor_kas', 1, 'Pembayaran vendor – uang keluar', 'K', 'REKENING', 'Rekening pembayar'),
  ('bayar_vendor_pajak', 1, 'Pembayaran vendor – pajak dipotong', 'K', '2-6', 'Hutang Pajak Lainnya (PPh yang dipotong, disetor kemudian)'),
  ('beli_material', 1, 'Pembelian material proyek – dana perusahaan', 'D', '5-1', 'Material Proyek (termasuk PPN yang tidak dapat dikreditkan)'),
  ('beli_persediaan', 1, 'Pembelian stok kantor', 'D', '1-6', 'Persediaan'),
  ('beli_ppn', 1, 'Pembelian – PPN masukan', 'D', '1-4', 'PPN Masukan (bila perusahaan PKP dan supplier PKP)'),
  ('beli_titipan', 1, 'Pembelian material – dana titipan klien', 'D', '2-4', 'Mengurangi Hutang Dana Titipan Klien (bukan beban)'),
  ('beli_kas', 1, 'Pembelian – dibayar tunai / transfer', 'K', 'REKENING', 'Rekening pembayar'),
  ('beli_hutang', 1, 'Pembelian – tempo', 'K', '2-3', 'Hutang Supplier'),
  ('bayar_supplier_hutang', 1, 'Pembayaran hutang supplier', 'D', '2-3', 'Hutang Supplier'),
  ('bayar_supplier_kas', 1, 'Pembayaran hutang supplier – uang keluar', 'K', 'REKENING', 'Rekening pembayar')
on conflict (jenis, urut) do nothing;

-- =====================================================================
-- 5. FUNGSI BANTU
-- =====================================================================
-- Faktor konversi satuan barang master (records tabel 'barang'): 1 bila satuan baku; null bila belum ada konversi.
create or replace function public.faktor_satuan(p_barang uuid, p_satuan text)
returns numeric language sql stable security definer set search_path = ''
as $$
  select case when p_satuan is null or p_satuan = r.data ->> 'satuan' then 1::numeric
    else (select (c ->> 'faktor')::numeric from jsonb_array_elements(coalesce(r.data -> 'konversi', '[]'::jsonb)) c where c ->> 'satuan' = p_satuan limit 1) end
  from public.records r where r.id = p_barang and r.tabel = 'barang'
$$;

-- Riwayat harga otomatis (menu Barang & Harga): baris lama dari transaksi yang sama diganti.
create or replace function public.harga_otomatis(p_sumber_id uuid, p_rows jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.records where tabel = 'harga' and data ->> 'sumber_id' = p_sumber_id::text;
  insert into public.records (tabel, data)
  select 'harga', x || jsonb_build_object('sumber_id', p_sumber_id) from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) x;
end $$;

create or replace function public.pkp_pada(p_tanggal date)
returns boolean language sql stable security definer set search_path = ''
as $$
  select coalesce((data ->> 'pkp')::boolean, false) and nullif(data ->> 'tgl_pkp', '') is not null and (data ->> 'tgl_pkp')::date <= p_tanggal
  from public.perusahaan where id = public.perusahaan_tunggal()
$$;

-- Nilai kontrak vendor: volume = Σ volume × harga; harian = upah × perkiraan hari; lainnya = nilai yang diisi.
create or replace function public.nilai_kontrak_vendor(p_kontrak uuid)
returns bigint language sql stable security definer set search_path = ''
as $$
  select case k.skema
    when 'volume' then (select coalesce(sum(round(i.volume * i.harga)), 0)::bigint from public.kontrak_vendor_item i where i.kontrak_id = k.id)
    when 'harian' then coalesce(k.upah_harian, 0) * coalesce(k.perkiraan_hari, 0)
    else k.nilai end
  from public.kontrak_vendor k where k.id = p_kontrak
$$;

-- Nilai satu termin vendor: persen × nilai; termin terakhir menerima sisa pembulatan.
create or replace function public.nilai_termin_vendor(p_termin uuid)
returns bigint language sql stable security definer set search_path = ''
as $$
  select case when t.ke = (select max(ke) from public.kontrak_vendor_termin where kontrak_id = t.kontrak_id)
    then k.nilai - coalesce((select sum(public.bagi(k.nilai, x.persen_bp, 10000)) from public.kontrak_vendor_termin x where x.kontrak_id = t.kontrak_id and x.id <> t.id), 0)
    else public.bagi(k.nilai, t.persen_bp, 10000) end
  from public.kontrak_vendor_termin t join public.kontrak_vendor k on k.id = t.kontrak_id where t.id = p_termin
$$;

-- Hitung nilai opname dari detailnya. Skema persen: selisih dengan opname disetujui sebelumnya.
create or replace function public.nilai_opname(p_kontrak uuid, p_detail jsonb, p_kecuali uuid)
returns bigint language plpgsql stable security definer set search_path = ''
as $$
declare
  k public.kontrak_vendor;
  sebelum int;
begin
  select * into k from public.kontrak_vendor where id = p_kontrak;
  if k.skema = 'volume' then
    return (select coalesce(sum(round(coalesce((p_detail -> 'volume' ->> i.id::text)::numeric, 0) * i.harga)), 0)::bigint
            from public.kontrak_vendor_item i where i.kontrak_id = k.id);
  elsif k.skema = 'harian' then
    return coalesce((p_detail ->> 'hari')::int, 0) * coalesce(k.upah_harian, 0);
  elsif k.skema = 'persen' then
    select coalesce(max((detail ->> 'persen_bp')::int), 0) into sebelum from public.opname
    where kontrak_id = k.id and status = 'disetujui' and id is distinct from p_kecuali;
    return public.bagi(k.nilai, coalesce((p_detail ->> 'persen_bp')::int, 0), 10000) - public.bagi(k.nilai, sebelum, 10000);
  else
    return (select coalesce(sum(public.nilai_termin_vendor(t.id)), 0) from public.kontrak_vendor_termin t
            where t.kontrak_id = k.id and t.id::text in (select jsonb_array_elements_text(coalesce(p_detail -> 'termin', '[]'::jsonb))));
  end if;
end $$;

-- =====================================================================
-- 6. KONTRAK VENDOR (Pihak Proyek)
-- =====================================================================
-- p: isi kontrak; p_item: [{barang_id, uraian, satuan, volume, harga}] (skema volume); p_termin: [{milestone, persen_bp}] (skema termin).
-- Bila sudah ada opname disetujui: proyek, vendor, skema, sumber dana, nilai, upah, retensi, item, dan termin tidak bisa diubah.
create or replace function public.simpan_kontrak_vendor(p_id uuid, p jsonb, p_item jsonb, p_termin jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  kid uuid := p_id;
  lama public.kontrak_vendor;
  terkunci boolean := false;
  v record;
  v_skema text := p ->> 'skema';
  ret int := coalesce((p ->> 'retensi_bp')::int, 0);
  x jsonb;
  i int := 0;
  total int := 0;
  iid uuid;
  ids uuid[] := '{}';
begin
  if public.hak('pihak_proyek') is distinct from 'ubah' then raise exception 'Anda tidak punya hak mengubah data Pihak Proyek.'; end if;
  if not exists (select 1 from public.records where tabel = 'proyek' and data ->> 'kode' = p ->> 'proyek_kode') then raise exception 'Proyek wajib dipilih.'; end if;
  select id, data ->> 'nama' as nama into v from public.records where tabel = 'vendor_tukang' and id = nullif(p ->> 'vendor_id', '')::uuid;
  if v.id is null then raise exception 'Vendor wajib dipilih dari master Vendor & Tukang.'; end if;
  if nullif(p ->> 'tanggal', '') is null then raise exception 'Tanggal wajib diisi.'; end if;
  if coalesce(p ->> 'sumber_dana', '') not in ('perusahaan', 'titipan') then raise exception 'Sumber dana wajib dipilih.'; end if;
  if coalesce(v_skema, '') not in ('termin', 'volume', 'persen', 'harian') then raise exception 'Skema pembayaran wajib dipilih.'; end if;
  if ret < 0 or ret >= 10000 then raise exception 'Retensi harus 0 sampai di bawah 100%%.'; end if;
  if ret > 0 and nullif(p ->> 'masa_retensi_hari', '') is null then raise exception 'Masa retensi (hari) wajib diisi bila ada retensi.'; end if;
  if kid is not null then
    select * into lama from public.kontrak_vendor where id = kid for update;
    if lama.id is null then raise exception 'Kontrak vendor tidak ditemukan.'; end if;
    terkunci := exists (select 1 from public.opname where kontrak_id = kid and status = 'disetujui');
    if terkunci and (lama.proyek_kode <> p ->> 'proyek_kode' or lama.vendor_id <> v.id or lama.skema <> v_skema or lama.sumber_dana <> p ->> 'sumber_dana'
        or lama.retensi_bp <> ret or (v_skema in ('termin', 'persen') and lama.nilai <> (p ->> 'nilai')::bigint)
        or (v_skema = 'harian' and lama.upah_harian <> (p ->> 'upah_harian')::bigint)) then
      raise exception 'Sudah ada opname disetujui: proyek, vendor, skema, sumber dana, nilai, upah, dan retensi tidak bisa diubah lagi.';
    end if;
  else
    insert into public.kontrak_vendor (proyek_kode, vendor_id, vendor_nama, tanggal, sumber_dana, skema)
    values (p ->> 'proyek_kode', v.id, v.nama, (p ->> 'tanggal')::date, p ->> 'sumber_dana', v_skema) returning id into kid;
  end if;
  update public.kontrak_vendor set
    proyek_kode = p ->> 'proyek_kode', vendor_id = v.id, vendor_nama = coalesce(v.nama, ''), lingkup = nullif(p ->> 'lingkup', ''),
    no_spk = nullif(btrim(p ->> 'no_spk'), ''), tanggal = (p ->> 'tanggal')::date, file = p -> 'file', sumber_dana = p ->> 'sumber_dana', skema = v_skema,
    upah_harian = case when v_skema = 'harian' then (p ->> 'upah_harian')::bigint end,
    perkiraan_hari = case when v_skema = 'harian' then nullif(p ->> 'perkiraan_hari', '')::int end,
    retensi_bp = ret, masa_retensi_hari = nullif(p ->> 'masa_retensi_hari', '')::int, tgl_selesai = nullif(p ->> 'tgl_selesai', '')::date,
    catatan = nullif(p ->> 'catatan', ''),
    nilai = case when v_skema in ('termin', 'persen') then coalesce((p ->> 'nilai')::bigint, 0) else 0 end
  where id = kid;

  if not terkunci then
    -- ID item / termin lama dipertahankan (opname Draft merujuk ke ID item dan termin).
    if v_skema = 'volume' then
      for x in select value from jsonb_array_elements(coalesce(p_item, '[]'::jsonb)) loop
        i := i + 1;
        if not exists (select 1 from public.records where tabel = 'barang' and id = nullif(x ->> 'barang_id', '')::uuid and data ->> 'jenis' = 'pekerjaan') then
          raise exception 'Item %: pilih item pekerjaan dari master (Barang & Harga → Harga Pekerjaan).', i;
        end if;
        if public.faktor_satuan((x ->> 'barang_id')::uuid, x ->> 'satuan') is null then raise exception 'Item %: satuan "%" belum punya konversi di master.', i, x ->> 'satuan'; end if;
        if coalesce((x ->> 'volume')::numeric, 0) <= 0 then raise exception 'Item %: volume harus lebih dari 0.', i; end if;
        if coalesce((x ->> 'harga')::bigint, 0) <= 0 then raise exception 'Item %: harga satuan harus lebih dari 0.', i; end if;
        iid := nullif(x ->> 'id', '')::uuid;
        if iid is not null and exists (select 1 from public.kontrak_vendor_item where id = iid and kontrak_id = kid) then
          update public.kontrak_vendor_item set urut = i, barang_id = (x ->> 'barang_id')::uuid, uraian = coalesce(nullif(x ->> 'uraian', ''), '-'), satuan = x ->> 'satuan',
            volume = (x ->> 'volume')::numeric, harga = (x ->> 'harga')::bigint where id = iid;
        else
          insert into public.kontrak_vendor_item (kontrak_id, urut, barang_id, uraian, satuan, volume, harga)
          values (kid, i, (x ->> 'barang_id')::uuid, coalesce(nullif(x ->> 'uraian', ''), '-'), x ->> 'satuan', (x ->> 'volume')::numeric, (x ->> 'harga')::bigint)
          returning id into iid;
        end if;
        ids := ids || iid;
      end loop;
      if i = 0 then raise exception 'Daftar item pekerjaan wajib diisi.'; end if;
    elsif v_skema = 'termin' then
      for x in select value from jsonb_array_elements(coalesce(p_termin, '[]'::jsonb)) loop
        i := i + 1;
        if coalesce((x ->> 'persen_bp')::int, 0) <= 0 then raise exception 'Termin %: persen harus lebih dari 0.', i; end if;
        iid := nullif(x ->> 'id', '')::uuid;
        if iid is not null and exists (select 1 from public.kontrak_vendor_termin where id = iid and kontrak_id = kid) then
          update public.kontrak_vendor_termin set ke = i, milestone = nullif(x ->> 'milestone', ''), persen_bp = (x ->> 'persen_bp')::int where id = iid;
        else
          insert into public.kontrak_vendor_termin (kontrak_id, ke, milestone, persen_bp) values (kid, i, nullif(x ->> 'milestone', ''), (x ->> 'persen_bp')::int)
          returning id into iid;
        end if;
        ids := ids || iid;
        total := total + (x ->> 'persen_bp')::int;
      end loop;
      if i = 0 then raise exception 'Jadwal termin wajib diisi.'; end if;
      if total <> 10000 then raise exception 'Total termin harus tepat 100%% (sekarang % persen).', to_char(total / 100.0, 'FM990D99'); end if;
    end if;
    delete from public.kontrak_vendor_item where kontrak_id = kid and not (id = any (ids));
    delete from public.kontrak_vendor_termin where kontrak_id = kid and not (id = any (ids));
  end if;
  if v_skema in ('termin', 'persen') and (select nilai from public.kontrak_vendor where id = kid) <= 0 then raise exception 'Nilai kontrak wajib diisi (lebih dari 0).'; end if;
  if v_skema = 'harian' and coalesce((p ->> 'upah_harian')::bigint, 0) <= 0 then raise exception 'Upah per hari wajib diisi (lebih dari 0).'; end if;

  -- Skema volume: harga satuan pekerjaan masuk riwayat harga (tab Harga Pekerjaan di Barang & Harga).
  perform public.harga_otomatis(kid, (
    select coalesce(jsonb_agg(jsonb_build_object('barang_id', i.barang_id, 'tanggal', k.tanggal, 'pihak_id', k.vendor_id, 'pihak_nama', k.vendor_nama,
      'harga', i.harga, 'satuan', i.satuan, 'faktor', public.faktor_satuan(i.barang_id, i.satuan), 'ppn', false, 'sumber', 'Kontrak vendor',
      'proyek_kode', k.proyek_kode, 'ref', jsonb_build_object('id', k.id, 'nomor', coalesce(k.no_spk, k.vendor_nama), 'tanggal', k.tanggal)) order by i.urut), '[]'::jsonb)
    from public.kontrak_vendor_item i join public.kontrak_vendor k on k.id = i.kontrak_id where k.id = kid));
  return kid;
end $$;

create or replace function public.hapus_kontrak_vendor(p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if public.hak('pihak_proyek') is distinct from 'ubah' then raise exception 'Anda tidak punya hak mengubah data Pihak Proyek.'; end if;
  if exists (select 1 from public.opname where kontrak_id = p_id and status = 'disetujui') or exists (select 1 from public.pembayaran_vendor where kontrak_id = p_id) then
    raise exception 'Kontrak vendor yang sudah punya opname disetujui atau pembayaran tidak bisa dihapus.';
  end if;
  delete from public.opname where kontrak_id = p_id;
  delete from public.kontrak_vendor where id = p_id;
  perform public.harga_otomatis(p_id, '[]'::jsonb);
end $$;

-- =====================================================================
-- 7. OPNAME
-- =====================================================================
-- Opname disetujui harus berurutan tanggalnya; hanya opname disetujui terakhir yang bisa diubah atau dihapus.
create or replace function public.simpan_opname(p_id uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  k public.kontrak_vendor;
  lama public.opname;
  oid uuid := p_id;
  st text := coalesce(p ->> 'status', 'draft');
  tgl date := nullif(p ->> 'tanggal', '')::date;
  d jsonb := coalesce(p -> 'detail', '{}'::jsonb);
  akhir public.opname;
  v_nilai bigint;
  pct int;
  sebelum int;
  t text;
begin
  if public.hak('pihak_proyek') is distinct from 'ubah' then raise exception 'Anda tidak punya hak mencatat opname.'; end if;
  if oid is not null then
    select * into lama from public.opname where id = oid for update;
    if lama.id is null then raise exception 'Opname tidak ditemukan.'; end if;
  end if;
  select * into k from public.kontrak_vendor where id = coalesce(lama.kontrak_id, nullif(p ->> 'kontrak_id', '')::uuid);
  if k.id is null then raise exception 'Kontrak vendor tidak ditemukan.'; end if;
  if tgl is null then raise exception 'Tanggal opname wajib diisi.'; end if;
  if st not in ('draft', 'disetujui') then raise exception 'Status opname tidak dikenal.'; end if;
  if st = 'disetujui' and coalesce(btrim(p ->> 'diperiksa_oleh'), '') = '' then raise exception 'Isi siapa yang memeriksa (Tim Proyek: pengawas / PIC) sebelum menyetujui opname.'; end if;
  select * into akhir from public.opname where kontrak_id = k.id and status = 'disetujui' and id is distinct from oid order by tanggal desc, dibuat desc, id desc limit 1;
  if lama.status = 'disetujui' and akhir.id is not null and (akhir.tanggal, akhir.dibuat, akhir.id) > (lama.tanggal, lama.dibuat, lama.id) then
    raise exception 'Hanya opname disetujui terakhir yang bisa diubah. Batalkan dulu opname sesudahnya.';
  end if;
  if st = 'disetujui' and akhir.id is not null and tgl < akhir.tanggal then
    raise exception 'Tanggal opname yang disetujui tidak boleh sebelum opname disetujui terakhir (%).', to_char(akhir.tanggal, 'DD-MM-YYYY');
  end if;
  -- Periksa isi detail per skema.
  if k.skema = 'volume' then
    if exists (select 1 from jsonb_each_text(coalesce(d -> 'volume', '{}'::jsonb)) e where e.value !~ '^\d+(\.\d{1,3})?$') then
      raise exception 'Volume opname harus angka 0 atau lebih (maksimal 3 desimal).';
    end if;
  elsif k.skema = 'harian' then
    if coalesce(d ->> 'hari', '') !~ '^\d+$' or (d ->> 'hari')::int <= 0 then raise exception 'Jumlah hari kerja harus angka bulat lebih dari 0.'; end if;
  elsif k.skema = 'persen' then
    pct := coalesce((d ->> 'persen_bp')::int, 0);
    select coalesce(max((detail ->> 'persen_bp')::int), 0) into sebelum from public.opname where kontrak_id = k.id and status = 'disetujui' and id is distinct from oid;
    if pct <= 0 or pct > 10000 then raise exception 'Persen progres kumulatif harus di atas 0 sampai 100%%.'; end if;
    if st = 'disetujui' and pct <= sebelum then raise exception 'Persen progres kumulatif harus lebih besar dari opname disetujui sebelumnya (% persen).', to_char(sebelum / 100.0, 'FM990D99'); end if;
  else
    if jsonb_array_length(coalesce(d -> 'termin', '[]'::jsonb)) = 0 then raise exception 'Pilih milestone termin yang tercapai.'; end if;
    for t in select jsonb_array_elements_text(d -> 'termin') loop
      if not exists (select 1 from public.kontrak_vendor_termin where id = t::uuid and kontrak_id = k.id) then raise exception 'Milestone tidak ditemukan.'; end if;
      if st = 'disetujui' and exists (select 1 from public.opname where kontrak_id = k.id and status = 'disetujui' and id is distinct from oid and detail -> 'termin' ? t) then
        raise exception 'Milestone itu sudah tercatat di opname disetujui lain.';
      end if;
    end loop;
  end if;
  v_nilai := public.nilai_opname(k.id, d, oid);
  if st = 'disetujui' and v_nilai <= 0 then raise exception 'Nilai opname 0; tidak ada yang bisa disetujui.'; end if;
  if oid is null then
    insert into public.opname (kontrak_id, tanggal, status, detail, nilai, retensi, diperiksa_oleh, diperiksa_nama, foto, catatan)
    values (k.id, tgl, st, d, v_nilai, public.bagi(v_nilai, k.retensi_bp, 10000), nullif(p ->> 'diperiksa_oleh', ''), nullif(p ->> 'diperiksa_nama', ''), p -> 'foto', nullif(p ->> 'catatan', ''))
    returning id into oid;
  else
    update public.opname set tanggal = tgl, status = st, detail = d, nilai = v_nilai, retensi = public.bagi(v_nilai, k.retensi_bp, 10000),
      diperiksa_oleh = nullif(p ->> 'diperiksa_oleh', ''), diperiksa_nama = nullif(p ->> 'diperiksa_nama', ''), foto = p -> 'foto', catatan = nullif(p ->> 'catatan', '')
    where id = oid;
  end if;
  return oid;
end $$;

create or replace function public.hapus_opname(p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare o public.opname;
begin
  if public.hak('pihak_proyek') is distinct from 'ubah' then raise exception 'Anda tidak punya hak menghapus opname.'; end if;
  select * into o from public.opname where id = p_id;
  if o.id is null then return; end if;
  if o.status = 'disetujui' and exists (select 1 from public.opname where kontrak_id = o.kontrak_id and status = 'disetujui' and (tanggal, dibuat, id) > (o.tanggal, o.dibuat, o.id)) then
    raise exception 'Hanya opname disetujui terakhir yang bisa dihapus. Hapus dulu opname sesudahnya.';
  end if;
  delete from public.opname where id = p_id;
end $$;

-- Opname disetujui -> jurnal. Draft tidak membuat jurnal.
create or replace function public.opname_setelah()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare k public.kontrak_vendor;
begin
  if tg_op = 'DELETE' then
    perform public.jurnal_otomatis('opname', old.id, null, null, null, null);
    return old;
  end if;
  if new.status <> 'disetujui' then
    perform public.jurnal_otomatis('opname', new.id, null, null, null, null);
    return new;
  end if;
  select * into k from public.kontrak_vendor where id = new.kontrak_id;
  perform public.jurnal_otomatis('opname', new.id, new.tanggal, 'Opname ' || k.vendor_nama || ' · ' || k.proyek_kode,
    jsonb_build_array(jsonb_build_object('jenis', case when k.sumber_dana = 'titipan' then 'opname_titipan' else 'opname_beban' end, 'jumlah', new.nilai),
      jsonb_build_object('jenis', 'opname_hutang', 'jumlah', new.nilai - new.retensi), jsonb_build_object('jenis', 'opname_retensi', 'jumlah', new.retensi)),
    '{}'::jsonb, k.proyek_kode);
  return new;
end $$;
drop trigger if exists opname_jurnal on public.opname;
create trigger opname_jurnal after insert or update or delete on public.opname for each row execute function public.opname_setelah();

-- =====================================================================
-- 8. PEMBAYARAN VENDOR (dan pencairan retensi)
-- =====================================================================
-- Membayar melebihi hak boleh (aplikasi memberi peringatan). Pencairan retensi: setelah masa retensi, maksimal retensi yang ditahan.
create or replace function public.simpan_bayar_vendor(p_id uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  k public.kontrak_vendor;
  lama public.pembayaran_vendor;
  bid uuid := p_id;
  v_jenis text := coalesce(p ->> 'jenis', 'bayar');
  jml bigint := coalesce((p ->> 'jumlah')::bigint, 0);
  pot bigint := coalesce((p ->> 'potongan_pajak')::bigint, 0);
  rek uuid := nullif(p ->> 'rekening_id', '')::uuid;
  tgl date := nullif(p ->> 'tanggal', '')::date;
  ditahan bigint;
begin
  if public.hak('pihak_proyek') is distinct from 'ubah' then raise exception 'Anda tidak punya hak mencatat pembayaran vendor.'; end if;
  if bid is not null then
    select * into lama from public.pembayaran_vendor where id = bid for update;
    if lama.id is null then raise exception 'Pembayaran tidak ditemukan.'; end if;
  end if;
  select * into k from public.kontrak_vendor where id = coalesce(lama.kontrak_id, nullif(p ->> 'kontrak_id', '')::uuid);
  if k.id is null then raise exception 'Kontrak vendor tidak ditemukan.'; end if;
  if tgl is null then raise exception 'Tanggal pembayaran wajib diisi.'; end if;
  if v_jenis not in ('bayar', 'retensi') then raise exception 'Jenis pembayaran tidak dikenal.'; end if;
  if jml < 0 or pot < 0 or jml + pot <= 0 then raise exception 'Isi jumlah dibayar dan/atau potongan pajak (lebih dari 0).'; end if;
  if jml > 0 and (rek is null or not exists (select 1 from public.rekening where id = rek and aktif)) then raise exception 'Rekening pembayar wajib dipilih (rekening aktif).'; end if;
  if v_jenis = 'retensi' then
    if k.tgl_selesai is null or k.masa_retensi_hari is null then raise exception 'Isi tanggal selesai pekerjaan dan masa retensi di kontrak vendor dulu.'; end if;
    if tgl < k.tgl_selesai + k.masa_retensi_hari then raise exception 'Retensi baru bisa dicairkan mulai %.', to_char(k.tgl_selesai + k.masa_retensi_hari, 'DD-MM-YYYY'); end if;
    select coalesce((select sum(retensi) from public.opname where kontrak_id = k.id and status = 'disetujui'), 0)
         - coalesce((select sum(jumlah + potongan_pajak) from public.pembayaran_vendor where kontrak_id = k.id and jenis = 'retensi' and id is distinct from bid), 0)
      into ditahan;
    if jml + pot > ditahan then raise exception 'Pencairan melebihi retensi yang ditahan (Rp %).', to_char(ditahan, 'FM999G999G999G999'); end if;
  end if;
  if bid is null then
    insert into public.pembayaran_vendor (kontrak_id, jenis, tanggal, jumlah, potongan_pajak, rekening_id, bukti_potong, bukti_transfer, catatan)
    values (k.id, v_jenis, tgl, jml, pot, case when jml > 0 then rek end, p -> 'bukti_potong', p -> 'bukti_transfer', nullif(p ->> 'catatan', ''))
    returning id into bid;
  else
    update public.pembayaran_vendor set jenis = v_jenis, tanggal = tgl, jumlah = jml, potongan_pajak = pot, rekening_id = case when jml > 0 then rek end,
      bukti_potong = p -> 'bukti_potong', bukti_transfer = p -> 'bukti_transfer', catatan = nullif(p ->> 'catatan', '')
    where id = bid;
  end if;
  return bid;
end $$;

create or replace function public.hapus_bayar_vendor(p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if public.hak('pihak_proyek') is distinct from 'ubah' then raise exception 'Anda tidak punya hak menghapus pembayaran vendor.'; end if;
  delete from public.pembayaran_vendor where id = p_id;
end $$;

create or replace function public.bayar_vendor_setelah()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare k public.kontrak_vendor;
begin
  if tg_op = 'DELETE' then
    perform public.jurnal_otomatis('bayar_vendor', old.id, null, null, null, null);
    return old;
  end if;
  select * into k from public.kontrak_vendor where id = new.kontrak_id;
  perform public.jurnal_otomatis('bayar_vendor', new.id, new.tanggal,
    case when new.jenis = 'retensi' then 'Pencairan retensi ' else 'Pembayaran ' end || k.vendor_nama || ' · ' || k.proyek_kode,
    jsonb_build_array(jsonb_build_object('jenis', case when new.jenis = 'retensi' then 'bayar_vendor_retensi' else 'bayar_vendor_hutang' end, 'jumlah', new.jumlah + new.potongan_pajak),
      jsonb_build_object('jenis', 'bayar_vendor_kas', 'jumlah', new.jumlah), jsonb_build_object('jenis', 'bayar_vendor_pajak', 'jumlah', new.potongan_pajak)),
    jsonb_build_object('REKENING', public.akun_rekening(new.rekening_id)), k.proyek_kode);
  return new;
end $$;
drop trigger if exists bayar_vendor_jurnal on public.pembayaran_vendor;
create trigger bayar_vendor_jurnal after insert or update or delete on public.pembayaran_vendor for each row execute function public.bayar_vendor_setelah();

-- =====================================================================
-- 9. PEMBELIAN MATERIAL
-- =====================================================================
-- p_baris: [{barang_id, qty, satuan, harga, diskon}]. Subtotal, total, PPN dapat dikreditkan, dan biaya dihitung di sini.
-- PPN masukan hanya bisa dikreditkan bila dana perusahaan dan perusahaan PKP pada tanggal pembelian.
create or replace function public.simpan_pembelian(p_id uuid, p jsonb, p_baris jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  lama public.pembelian;
  pid uuid := p_id;
  sup record;
  tgl date := nullif(p ->> 'tanggal', '')::date;
  v_tujuan text := p ->> 'tujuan';
  dana text := p ->> 'sumber_dana';
  cara text := p ->> 'cara_bayar';
  v_ppn bigint := coalesce((p ->> 'ppn')::bigint, 0);
  v_ongkir bigint := coalesce((p ->> 'ongkir')::bigint, 0);
  kredit boolean := coalesce((p ->> 'ppn_kredit')::boolean, false);
  x jsonb;
  i int := 0;
  sub bigint := 0;
  baris bigint;
  v_total bigint;
  nk bigint;
  dibayar bigint;
begin
  if public.hak('pembelian') is distinct from 'ubah' then raise exception 'Anda tidak punya hak mencatat pembelian.'; end if;
  if tgl is null then raise exception 'Tanggal wajib diisi.'; end if;
  select id, data ->> 'nama' as nama into sup from public.records where tabel = 'supplier' and id = nullif(p ->> 'supplier_id', '')::uuid;
  if sup.id is null then raise exception 'Supplier wajib dipilih dari master Supplier.'; end if;
  if coalesce(v_tujuan, '') not in ('proyek', 'stok') then raise exception 'Pilih untuk proyek atau stok kantor.'; end if;
  if v_tujuan = 'proyek' and not exists (select 1 from public.records where tabel = 'proyek' and data ->> 'kode' = p ->> 'proyek_kode') then raise exception 'Proyek wajib dipilih.'; end if;
  if coalesce(dana, '') not in ('perusahaan', 'titipan') then raise exception 'Sumber dana wajib dipilih.'; end if;
  if v_tujuan = 'stok' and dana = 'titipan' then raise exception 'Stok kantor tidak bisa memakai dana titipan klien.'; end if;
  if coalesce(cara, '') not in ('tunai', 'tempo') then raise exception 'Cara bayar wajib dipilih.'; end if;
  if cara = 'tunai' and not exists (select 1 from public.rekening where id = nullif(p ->> 'rekening_id', '')::uuid and aktif) then raise exception 'Rekening pembayaran wajib dipilih (rekening aktif).'; end if;
  if cara = 'tempo' and (nullif(p ->> 'jatuh_tempo', '') is null or (p ->> 'jatuh_tempo')::date < tgl) then raise exception 'Jatuh tempo wajib diisi dan tidak boleh sebelum tanggal pembelian.'; end if;
  if v_ppn < 0 or v_ongkir < 0 then raise exception 'PPN dan ongkir tidak boleh minus.'; end if;
  if dana = 'titipan' or v_ppn = 0 then kredit := false; end if;
  if kredit and not public.pkp_pada(tgl) then raise exception 'PPN masukan hanya bisa dikreditkan bila perusahaan sudah PKP pada tanggal pembelian (lihat Pengaturan → Profil perusahaan).'; end if;
  for x in select value from jsonb_array_elements(coalesce(p_baris, '[]'::jsonb)) loop
    i := i + 1;
    if not exists (select 1 from public.records where tabel = 'barang' and id = nullif(x ->> 'barang_id', '')::uuid and coalesce(data ->> 'jenis', 'barang') = 'barang') then
      raise exception 'Baris %: barang wajib dipilih dari master Barang & Harga.', i;
    end if;
    if coalesce((x ->> 'qty')::numeric, 0) <= 0 or (x ->> 'qty') !~ '^\d+(\.\d{1,3})?$' then raise exception 'Baris %: qty harus lebih dari 0 (maksimal 3 desimal).', i; end if;
    if public.faktor_satuan((x ->> 'barang_id')::uuid, x ->> 'satuan') is null then raise exception 'Baris %: satuan "%" belum punya konversi di barang ini.', i, x ->> 'satuan'; end if;
    if coalesce((x ->> 'harga')::bigint, -1) < 0 or coalesce((x ->> 'diskon')::bigint, 0) < 0 then raise exception 'Baris %: harga dan diskon harus rupiah utuh, tidak minus.', i; end if;
    baris := round((x ->> 'qty')::numeric * (x ->> 'harga')::bigint)::bigint - coalesce((x ->> 'diskon')::bigint, 0);
    if baris < 0 then raise exception 'Baris %: diskon lebih besar dari nilai barang.', i; end if;
    sub := sub + baris;
  end loop;
  if i = 0 then raise exception 'Isi minimal satu baris barang.'; end if;
  v_total := sub + v_ppn + v_ongkir;
  if v_total <= 0 then raise exception 'Total pembelian harus lebih dari 0.'; end if;
  nk := case when kredit then v_ppn else 0 end;
  if pid is not null then
    select * into lama from public.pembelian where id = pid for update;
    if lama.id is null then raise exception 'Pembelian tidak ditemukan.'; end if;
    select coalesce(sum(jumlah), 0) into dibayar from public.pembayaran_supplier where pembelian_id = pid;
    if dibayar > 0 and (cara <> 'tempo' or v_total < dibayar) then
      raise exception 'Pembelian ini sudah punya pembayaran hutang Rp %: cara bayar harus tetap tempo dan total tidak boleh di bawah yang sudah dibayar.', to_char(dibayar, 'FM999G999G999G999');
    end if;
    update public.pembelian set tanggal = tgl, supplier_id = sup.id, supplier_nama = coalesce(sup.nama, ''), no_nota = nullif(btrim(p ->> 'no_nota'), ''), tujuan = v_tujuan,
      proyek_kode = case when v_tujuan = 'proyek' then p ->> 'proyek_kode' end, sumber_dana = dana, cara_bayar = cara,
      rekening_id = case when cara = 'tunai' then (p ->> 'rekening_id')::uuid end, jatuh_tempo = case when cara = 'tempo' then (p ->> 'jatuh_tempo')::date end,
      ppn = v_ppn, ongkir = v_ongkir, ppn_kredit = kredit, subtotal = sub, total = v_total, ppn_kredit_nilai = nk, biaya = v_total - nk,
      file = p -> 'file', catatan = nullif(p ->> 'catatan', '')
    where id = pid;
    delete from public.pembelian_baris where pembelian_id = pid;
  else
    insert into public.pembelian (tanggal, supplier_id, supplier_nama, no_nota, tujuan, proyek_kode, sumber_dana, cara_bayar, rekening_id, jatuh_tempo,
      ppn, ongkir, ppn_kredit, subtotal, total, ppn_kredit_nilai, biaya, file, catatan)
    values (tgl, sup.id, coalesce(sup.nama, ''), nullif(btrim(p ->> 'no_nota'), ''), v_tujuan, case when v_tujuan = 'proyek' then p ->> 'proyek_kode' end, dana, cara,
      case when cara = 'tunai' then (p ->> 'rekening_id')::uuid end, case when cara = 'tempo' then (p ->> 'jatuh_tempo')::date end,
      v_ppn, v_ongkir, kredit, sub, v_total, nk, v_total - nk, p -> 'file', nullif(p ->> 'catatan', ''))
    returning id into pid;
  end if;
  i := 0;
  for x in select value from jsonb_array_elements(p_baris) loop
    i := i + 1;
    insert into public.pembelian_baris (pembelian_id, urut, barang_id, barang_nama, qty, satuan, faktor, harga, diskon, subtotal)
    select pid, i, r.id, coalesce(r.data ->> 'nama', ''), (x ->> 'qty')::numeric, x ->> 'satuan', public.faktor_satuan(r.id, x ->> 'satuan'),
      (x ->> 'harga')::bigint, coalesce((x ->> 'diskon')::bigint, 0), round((x ->> 'qty')::numeric * (x ->> 'harga')::bigint)::bigint - coalesce((x ->> 'diskon')::bigint, 0)
    from public.records r where r.id = (x ->> 'barang_id')::uuid;
  end loop;
  -- Setiap baris menambah riwayat harga barang (harga bersih per satuan setelah diskon).
  perform public.harga_otomatis(pid, (
    select coalesce(jsonb_agg(jsonb_build_object('barang_id', b.barang_id, 'tanggal', h.tanggal, 'pihak_id', h.supplier_id, 'pihak_nama', h.supplier_nama,
      'harga', round(b.subtotal / b.qty)::bigint, 'satuan', b.satuan, 'faktor', b.faktor, 'ppn', h.ppn > 0, 'sumber', 'Pembelian', 'proyek_kode', h.proyek_kode,
      'ref', jsonb_build_object('id', h.id, 'nomor', coalesce(h.no_nota, h.supplier_nama), 'tanggal', h.tanggal)) order by b.urut), '[]'::jsonb)
    from public.pembelian_baris b join public.pembelian h on h.id = b.pembelian_id where h.id = pid and b.subtotal > 0));
  return pid; -- jurnal dibuat pemicu pembelian_jurnal
end $$;

create or replace function public.jurnal_pembelian(p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare b public.pembelian;
begin
  select * into b from public.pembelian where id = p_id;
  if b.id is null then perform public.jurnal_otomatis('pembelian', p_id, null, null, null, null); return; end if;
  perform public.jurnal_otomatis('pembelian', b.id, b.tanggal, 'Pembelian ' || b.supplier_nama || coalesce(' · ' || b.no_nota, '') || coalesce(' · ' || b.proyek_kode, ' · stok kantor'),
    case when b.sumber_dana = 'titipan' then jsonb_build_array(jsonb_build_object('jenis', 'beli_titipan', 'jumlah', b.total))
    else jsonb_build_array(jsonb_build_object('jenis', case when b.tujuan = 'stok' then 'beli_persediaan' else 'beli_material' end, 'jumlah', b.biaya),
      jsonb_build_object('jenis', 'beli_ppn', 'jumlah', b.ppn_kredit_nilai)) end
    || jsonb_build_array(jsonb_build_object('jenis', case when b.cara_bayar = 'tempo' then 'beli_hutang' else 'beli_kas' end, 'jumlah', b.total)),
    jsonb_build_object('REKENING', public.akun_rekening(b.rekening_id)), b.proyek_kode);
end $$;

create or replace function public.hapus_pembelian(p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if public.hak('pembelian') is distinct from 'ubah' then raise exception 'Anda tidak punya hak menghapus pembelian.'; end if;
  if exists (select 1 from public.pembayaran_supplier where pembelian_id = p_id) then raise exception 'Hapus dulu pembayaran hutang pembelian ini.'; end if;
  delete from public.pembelian where id = p_id;
  perform public.jurnal_pembelian(p_id);
  perform public.harga_otomatis(p_id, '[]'::jsonb);
end $$;

create or replace function public.simpan_bayar_supplier(p_id uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  b public.pembelian;
  lama public.pembayaran_supplier;
  bid uuid := p_id;
  jml bigint := coalesce((p ->> 'jumlah')::bigint, 0);
  sudah bigint;
begin
  if public.hak('pembelian') is distinct from 'ubah' then raise exception 'Anda tidak punya hak mencatat pembayaran supplier.'; end if;
  if bid is not null then
    select * into lama from public.pembayaran_supplier where id = bid for update;
    if lama.id is null then raise exception 'Pembayaran tidak ditemukan.'; end if;
  end if;
  select * into b from public.pembelian where id = coalesce(lama.pembelian_id, nullif(p ->> 'pembelian_id', '')::uuid) for update;
  if b.id is null then raise exception 'Pembelian tidak ditemukan.'; end if;
  if b.cara_bayar <> 'tempo' then raise exception 'Pembelian tunai sudah lunas saat dicatat.'; end if;
  if nullif(p ->> 'tanggal', '') is null then raise exception 'Tanggal pembayaran wajib diisi.'; end if;
  if (p ->> 'tanggal')::date < b.tanggal then raise exception 'Tanggal pembayaran tidak boleh sebelum tanggal pembelian.'; end if;
  if jml <= 0 then raise exception 'Jumlah dibayar harus lebih dari 0.'; end if;
  if not exists (select 1 from public.rekening where id = nullif(p ->> 'rekening_id', '')::uuid and aktif) then raise exception 'Rekening pembayar wajib dipilih (rekening aktif).'; end if;
  select coalesce(sum(jumlah), 0) into sudah from public.pembayaran_supplier where pembelian_id = b.id and id is distinct from bid;
  if sudah + jml > b.total then raise exception 'Pembayaran melebihi sisa hutang (sisa Rp %).', to_char(b.total - sudah, 'FM999G999G999G999'); end if;
  if bid is null then
    insert into public.pembayaran_supplier (pembelian_id, tanggal, jumlah, rekening_id, bukti, catatan)
    values (b.id, (p ->> 'tanggal')::date, jml, (p ->> 'rekening_id')::uuid, p -> 'bukti', nullif(p ->> 'catatan', '')) returning id into bid;
  else
    update public.pembayaran_supplier set tanggal = (p ->> 'tanggal')::date, jumlah = jml, rekening_id = (p ->> 'rekening_id')::uuid, bukti = p -> 'bukti', catatan = nullif(p ->> 'catatan', '')
    where id = bid;
  end if;
  return bid;
end $$;

create or replace function public.hapus_bayar_supplier(p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if public.hak('pembelian') is distinct from 'ubah' then raise exception 'Anda tidak punya hak menghapus pembayaran supplier.'; end if;
  delete from public.pembayaran_supplier where id = p_id;
end $$;

create or replace function public.pembelian_setelah()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then perform public.jurnal_otomatis('pembelian', old.id, null, null, null, null); return old; end if;
  perform public.jurnal_pembelian(new.id);
  return new;
end $$;
drop trigger if exists pembelian_jurnal on public.pembelian;
create trigger pembelian_jurnal after insert or update or delete on public.pembelian for each row execute function public.pembelian_setelah();

create or replace function public.bayar_supplier_setelah()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare b public.pembelian;
begin
  if tg_op = 'DELETE' then perform public.jurnal_otomatis('bayar_supplier', old.id, null, null, null, null); return old; end if;
  select * into b from public.pembelian where id = new.pembelian_id;
  perform public.jurnal_otomatis('bayar_supplier', new.id, new.tanggal, 'Bayar hutang ' || b.supplier_nama || coalesce(' · ' || b.no_nota, ''),
    jsonb_build_array(jsonb_build_object('jenis', 'bayar_supplier_hutang', 'jumlah', new.jumlah), jsonb_build_object('jenis', 'bayar_supplier_kas', 'jumlah', new.jumlah)),
    jsonb_build_object('REKENING', public.akun_rekening(new.rekening_id)), b.proyek_kode);
  return new;
end $$;
drop trigger if exists bayar_supplier_jurnal on public.pembayaran_supplier;
create trigger bayar_supplier_jurnal after insert or update or delete on public.pembayaran_supplier for each row execute function public.bayar_supplier_setelah();

-- =====================================================================
-- 10. DOMPET DAN PINJAMAN ANTAR PROYEK (tanpa jurnal)
-- =====================================================================
-- Saldo dana titipan proyek: titipan diterima − dipakai (vendor & pembelian dari titipan) − pinjaman yang belum kembali.
-- Sama dengan dompetProyek().saldo_titipan di js/proyek-util.js.
create or replace function public.saldo_titipan_proyek(p_kode text, p_kecuali uuid default null)
returns bigint language sql stable security definer set search_path = ''
as $$
  select
    coalesce((select sum(p.alok_titipan) from public.penerimaan p join public.termin t on t.id = p.termin_id join public.kontrak_klien k on k.id = t.kontrak_id where k.proyek_kode = p_kode), 0)
  - coalesce((select sum(b.jumlah + b.potongan_pajak) from public.pembayaran_vendor b join public.kontrak_vendor k on k.id = b.kontrak_id where k.proyek_kode = p_kode and k.sumber_dana = 'titipan'), 0)
  - coalesce((select sum(case when b.cara_bayar = 'tunai' then b.total else coalesce((select sum(s.jumlah) from public.pembayaran_supplier s where s.pembelian_id = b.id), 0) end)
              from public.pembelian b where b.proyek_kode = p_kode and b.sumber_dana = 'titipan'), 0)
  - coalesce((select sum(x.jumlah - coalesce((select sum(r.jumlah) from public.pengembalian_pinjaman r where r.pinjaman_id = x.id), 0))
              from public.pinjaman_proyek x where x.dari_proyek = p_kode and x.id is distinct from p_kecuali), 0)
$$;

-- Batas di Pengaturan → Akuntansi (opsional): pinjaman dari proyek maksimal X% saldo titipannya.
-- Melebihi batas hanya bisa disimpan oleh pemilik (super admin) dengan konfirmasi.
create or replace function public.simpan_pinjaman(p_id uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  pid uuid := p_id;
  dari text := nullif(p ->> 'dari_proyek', '');
  ke text := nullif(p ->> 'ke_proyek', '');
  jml bigint := coalesce((p ->> 'jumlah')::bigint, 0);
  batas_pct int := (select batas_pinjam_titipan_persen from public.akuntansi limit 1);
  batas bigint;
  konfirmasi boolean := coalesce((p ->> 'konfirmasi_pemilik')::boolean, false);
  kembali bigint;
begin
  if public.hak('kas') is distinct from 'ubah' then raise exception 'Anda tidak punya hak mencatat pinjaman antar proyek (perlu hak Ubah Kas & Bank).'; end if;
  if nullif(p ->> 'tanggal', '') is null then raise exception 'Tanggal wajib diisi.'; end if;
  if ke is null or not exists (select 1 from public.records where tabel = 'proyek' and data ->> 'kode' = ke) then raise exception 'Proyek penerima pinjaman wajib dipilih.'; end if;
  if dari is not null and not exists (select 1 from public.records where tabel = 'proyek' and data ->> 'kode' = dari) then raise exception 'Sumber pinjaman tidak ditemukan.'; end if;
  if dari is not distinct from ke then raise exception 'Proyek pemberi dan penerima pinjaman tidak boleh sama.'; end if;
  if jml <= 0 then raise exception 'Jumlah pinjaman harus lebih dari 0.'; end if;
  if coalesce(btrim(p ->> 'alasan'), '') = '' then raise exception 'Alasan wajib diisi.'; end if;
  if nullif(p ->> 'rencana_kembali', '') is null or (p ->> 'rencana_kembali')::date < (p ->> 'tanggal')::date then raise exception 'Rencana kembali wajib diisi dan tidak boleh sebelum tanggal pinjaman.'; end if;
  if coalesce(btrim(p ->> 'disetujui_oleh'), '') = '' then raise exception 'Isi siapa yang menyetujui pinjaman.'; end if;
  if pid is not null then
    select coalesce(sum(jumlah), 0) into kembali from public.pengembalian_pinjaman where pinjaman_id = pid;
    if jml < kembali then raise exception 'Jumlah pinjaman tidak boleh di bawah yang sudah dikembalikan (Rp %).', to_char(kembali, 'FM999G999G999G999'); end if;
  end if;
  if dari is not null and batas_pct is not null then
    batas := floor(greatest(public.saldo_titipan_proyek(dari, pid), 0) * batas_pct / 100.0);
    if jml > batas and not (public.super_admin() and konfirmasi) then
      raise exception 'Pinjaman melebihi batas % persen saldo titipan proyek % (maksimal Rp %). Perlu konfirmasi pemilik (super admin).', batas_pct, dari, to_char(batas, 'FM999G999G999G999');
    end if;
  end if;
  if pid is null then
    insert into public.pinjaman_proyek (tanggal, dari_proyek, ke_proyek, jumlah, alasan, rencana_kembali, disetujui_oleh, konfirmasi_pemilik, catatan)
    values ((p ->> 'tanggal')::date, dari, ke, jml, btrim(p ->> 'alasan'), (p ->> 'rencana_kembali')::date, btrim(p ->> 'disetujui_oleh'), konfirmasi, nullif(p ->> 'catatan', ''))
    returning id into pid;
  else
    update public.pinjaman_proyek set tanggal = (p ->> 'tanggal')::date, dari_proyek = dari, ke_proyek = ke, jumlah = jml, alasan = btrim(p ->> 'alasan'),
      rencana_kembali = (p ->> 'rencana_kembali')::date, disetujui_oleh = btrim(p ->> 'disetujui_oleh'), konfirmasi_pemilik = konfirmasi, catatan = nullif(p ->> 'catatan', '')
    where id = pid;
    if not found then raise exception 'Pinjaman tidak ditemukan.'; end if;
  end if;
  return pid;
end $$;

create or replace function public.hapus_pinjaman(p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if public.hak('kas') is distinct from 'ubah' then raise exception 'Anda tidak punya hak menghapus pinjaman antar proyek.'; end if;
  if exists (select 1 from public.pengembalian_pinjaman where pinjaman_id = p_id) then raise exception 'Hapus dulu riwayat pengembalian pinjaman ini.'; end if;
  delete from public.pinjaman_proyek where id = p_id;
end $$;

create or replace function public.simpan_pengembalian(p_id uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  x public.pinjaman_proyek;
  rid uuid := p_id;
  jml bigint := coalesce((p ->> 'jumlah')::bigint, 0);
  sudah bigint;
begin
  if public.hak('kas') is distinct from 'ubah' then raise exception 'Anda tidak punya hak mencatat pengembalian pinjaman.'; end if;
  select * into x from public.pinjaman_proyek
  where id = coalesce((select pinjaman_id from public.pengembalian_pinjaman where id = p_id), nullif(p ->> 'pinjaman_id', '')::uuid) for update;
  if x.id is null then raise exception 'Pinjaman tidak ditemukan.'; end if;
  if nullif(p ->> 'tanggal', '') is null then raise exception 'Tanggal wajib diisi.'; end if;
  if (p ->> 'tanggal')::date < x.tanggal then raise exception 'Tanggal pengembalian tidak boleh sebelum tanggal pinjaman.'; end if;
  if jml <= 0 then raise exception 'Jumlah dikembalikan harus lebih dari 0.'; end if;
  select coalesce(sum(jumlah), 0) into sudah from public.pengembalian_pinjaman where pinjaman_id = x.id and id is distinct from rid;
  if sudah + jml > x.jumlah then raise exception 'Pengembalian melebihi sisa pinjaman (sisa Rp %).', to_char(x.jumlah - sudah, 'FM999G999G999G999'); end if;
  if rid is null then
    insert into public.pengembalian_pinjaman (pinjaman_id, tanggal, jumlah, catatan) values (x.id, (p ->> 'tanggal')::date, jml, nullif(p ->> 'catatan', '')) returning id into rid;
  else
    update public.pengembalian_pinjaman set tanggal = (p ->> 'tanggal')::date, jumlah = jml, catatan = nullif(p ->> 'catatan', '') where id = rid;
  end if;
  return rid;
end $$;

create or replace function public.hapus_pengembalian(p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if public.hak('kas') is distinct from 'ubah' then raise exception 'Anda tidak punya hak menghapus pengembalian pinjaman.'; end if;
  delete from public.pengembalian_pinjaman where id = p_id;
end $$;

-- =====================================================================
-- 11. TUTUP BUKU DAN AUDIT
-- =====================================================================
-- Perbaikan pengaman tutup buku (Tahap 1): pengecualian khusus rekening dulu membaca new.saldo_awal langsung,
-- yang gagal ("record new has no field saldo_awal") saat baris tabel lain diubah. Sekarang dibaca lewat jsonb.
create or replace function public.jaga_tutup_buku()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  kolom text := tg_argv[0];
  d_lama date; d_baru date;
  jb jsonb; jl jsonb;
begin
  if tg_op <> 'INSERT' then jl := to_jsonb(old); d_lama := (jl ->> kolom)::date; end if;
  if tg_op <> 'DELETE' then jb := to_jsonb(new); d_baru := (jb ->> kolom)::date; end if;
  if tg_op = 'UPDATE' and tg_table_name = 'rekening'
     and jb -> 'saldo_awal' = jl -> 'saldo_awal' and jb -> 'tgl_saldo_awal' = jl -> 'tgl_saldo_awal' then
    return new; -- perubahan nama/keterangan rekening tidak menyentuh pembukuan
  end if;
  perform public.cek_bulan_terbuka(d_lama);
  perform public.cek_bulan_terbuka(d_baru);
  return case when tg_op = 'DELETE' then old else new end;
end $$;

do $$
declare t text;
begin
  foreach t in array array['opname', 'pembayaran_vendor', 'pembelian', 'pembayaran_supplier'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_tutup_buku', t);
    execute format('create trigger %I before insert or update or delete on public.%I for each row execute function public.jaga_tutup_buku(''tanggal'')', t || '_tutup_buku', t);
  end loop;
  foreach t in array array['kontrak_vendor', 'kontrak_vendor_item', 'kontrak_vendor_termin', 'opname', 'pembayaran_vendor', 'pembelian', 'pembelian_baris',
                           'pembayaran_supplier', 'pinjaman_proyek', 'pengembalian_pinjaman'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.catat_audit()', t || '_audit', t);
  end loop;
end $$;

-- =====================================================================
-- 12. PULIHKAN CADANGAN: ikut memulihkan data Tahap 4
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

-- =====================================================================
-- 13. AKSES (RLS) DAN IZIN
-- =====================================================================
-- Data keuangan proyek dibaca oleh pemegang hak salah satu menu keuangan proyek (untuk Dompet dan Detail Proyek).
create or replace function public.baca_keuangan_proyek()
returns boolean language sql stable security definer set search_path = ''
as $$
  select public.hak('kontrak') is not null or public.hak('termin') is not null or public.hak('pihak_proyek') is not null
      or public.hak('pembelian') is not null or public.hak('kas') is not null or public.hak('jurnal') is not null
$$;

do $$
declare t text;
begin
  foreach t in array array['kontrak_klien', 'kontrak_addendum', 'termin', 'penerimaan',
                           'kontrak_vendor', 'kontrak_vendor_item', 'kontrak_vendor_termin', 'opname', 'pembayaran_vendor',
                           'pembelian', 'pembelian_baris', 'pembayaran_supplier', 'pinjaman_proyek', 'pengembalian_pinjaman'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_baca', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.baca_keuangan_proyek())', t || '_baca', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
-- Rekening dan akun dibaca untuk menampilkan nama rekening pembayar.
drop policy if exists rekening_baca on public.rekening;
create policy rekening_baca on public.rekening for select to authenticated
  using (public.hak('kas') is not null or public.hak('jurnal') is not null or public.hak('pengaturan') is not null or public.baca_keuangan_proyek());

grant execute on function public.simpan_kontrak_vendor(uuid, jsonb, jsonb, jsonb), public.hapus_kontrak_vendor(uuid),
  public.simpan_opname(uuid, jsonb), public.hapus_opname(uuid), public.simpan_bayar_vendor(uuid, jsonb), public.hapus_bayar_vendor(uuid),
  public.simpan_pembelian(uuid, jsonb, jsonb), public.hapus_pembelian(uuid), public.simpan_bayar_supplier(uuid, jsonb), public.hapus_bayar_supplier(uuid),
  public.simpan_pinjaman(uuid, jsonb), public.hapus_pinjaman(uuid), public.simpan_pengembalian(uuid, jsonb), public.hapus_pengembalian(uuid),
  public.saldo_titipan_proyek(text, uuid) to authenticated;
revoke execute on function public.harga_otomatis(uuid, jsonb), public.jurnal_pembelian(uuid), public.nilai_opname(uuid, jsonb, uuid)
  from public, anon, authenticated;

-- File SPK / foto opname / bukti bayar vendor (folder pihak-proyek/) dan nota / bukti bayar pembelian (folder pembelian/).
drop policy if exists bukti_proyek_baca on storage.objects;
create policy bukti_proyek_baca on storage.objects for select to authenticated using (
  bucket_id = 'bukti-keuangan' and (((storage.foldername(name))[1] = 'pihak-proyek' and public.hak('pihak_proyek') is not null)
                                    or ((storage.foldername(name))[1] = 'pembelian' and public.hak('pembelian') is not null)));
drop policy if exists bukti_proyek_tambah on storage.objects;
create policy bukti_proyek_tambah on storage.objects for insert to authenticated with check (
  bucket_id = 'bukti-keuangan' and (((storage.foldername(name))[1] = 'pihak-proyek' and public.hak('pihak_proyek') = 'ubah')
                                    or ((storage.foldername(name))[1] = 'pembelian' and public.hak('pembelian') = 'ubah')));
drop policy if exists bukti_proyek_hapus on storage.objects;
create policy bukti_proyek_hapus on storage.objects for delete to authenticated using (
  bucket_id = 'bukti-keuangan' and (((storage.foldername(name))[1] = 'pihak-proyek' and public.hak('pihak_proyek') = 'ubah')
                                    or ((storage.foldername(name))[1] = 'pembelian' and public.hak('pembelian') = 'ubah')));

-- =====================================================================
-- 14. PEMERIKSAAN
-- =====================================================================
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('kontrak_vendor', 'kontrak_vendor_item', 'kontrak_vendor_termin',
     'opname', 'pembayaran_vendor', 'pembelian', 'pembelian_baris', 'pembayaran_supplier', 'pinjaman_proyek', 'pengembalian_pinjaman')) as tabel_baru,  -- 10
  (select count(*) from public.pemetaan_jurnal where jenis like 'opname_%' or jenis like 'bayar_vendor_%' or jenis like 'beli_%' or jenis like 'bayar_supplier_%') as pemetaan_baru, -- 16
  (select count(*) from arsip_tahap4.records) as data_lama_diarsipkan,
  (select count(*) from public.records where tabel = 'vendor') as data_lama_tersisa;                                                               -- 0
