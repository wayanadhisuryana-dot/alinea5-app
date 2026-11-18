-- Alinea 5 — Uji otomatis aturan database Tahap 2.
-- Jalankan SETELAH 2-master.sql. Fungsi ini mencoba aturan master memakai data uji, lalu MEMBATALKAN
-- semua perubahan uji itu. Data asli tidak tersentuh.
-- Pakai:  select * from public.uji_tahap2();

create or replace function public.uji_tahap2()
returns table (no int, uji text, hasil text, catatan text)
language plpgsql security definer set search_path = ''
as $$
declare
  h jsonb := '[]'::jsonb;
  sa uuid;
  e text;
  v1 uuid := gen_random_uuid();
begin
  begin
    select id into sa from public.profiles where super_admin and aktif limit 1;
    if sa is null then raise exception 'Belum ada super admin aktif.'; end if;
    perform set_config('request.jwt.claim.sub', sa::text, true);
    perform set_config('request.jwt.claims', jsonb_build_object('sub', sa, 'role', 'authenticated')::text, true);

    h := h || jsonb_build_object('uji', 'Nama tabel master dipetakan ke menunya', 'hasil',
      case when public.menu_tabel('vendor_tukang') = 'vendor' and public.menu_tabel('harga') = 'barang'
                and public.menu_tabel('supplier') = 'supplier' and public.menu_tabel('vendor') = 'pihak_proyek' then '✓' else '✗' end, 'catatan', null);

    e := null;
    begin
      insert into public.records (id, tabel, data) values
        (v1, 'vendor_tukang', '{"nama":"UJI Tukang A","jenis":"Tukang","nik":"9999000011112222"}'),
        (gen_random_uuid(), 'supplier', '{"nama":"UJI Supplier","npwp":"9999000011112222"}'),
        (gen_random_uuid(), 'barang', '{"nama":"UJI Multipleks","kode":"UJI-0001","satuan":"m²"}'),
        (gen_random_uuid(), 'harga', '{"barang_id":"x","harga":450000}'),
        (gen_random_uuid(), 'tim', jsonb_build_object('vendor_id', v1, 'nama', 'UJI Tukang A', 'aktif', true, 'tim_proyek', true));
    exception when others then e := sqlerrm; end;
    h := h || jsonb_build_object('uji', 'Data vendor, supplier, barang, harga, dan direktori tim bisa disimpan', 'hasil', case when e is null then '✓' else '✗' end, 'catatan', e);

    e := null;
    begin
      insert into public.records (tabel, data) values ('vendor_tukang', '{"nama":"UJI Tukang B","jenis":"Mandor","nik":"9999000011112222"}');
    exception when others then e := sqlerrm; end;
    h := h || jsonb_build_object('uji', 'NIK vendor sama ditolak', 'hasil', case when e is not null then '✓' else '✗' end, 'catatan', e);

    e := null;
    begin
      insert into public.records (tabel, data) values ('supplier', '{"nama":"UJI Supplier 2","npwp":"9999000011112222"}');
    exception when others then e := sqlerrm; end;
    h := h || jsonb_build_object('uji', 'NPWP supplier sama ditolak', 'hasil', case when e is not null then '✓' else '✗' end, 'catatan', e);

    e := null;
    begin
      insert into public.records (tabel, data) values ('barang', '{"nama":"UJI Barang 2","kode":"UJI-0001"}');
    exception when others then e := sqlerrm; end;
    h := h || jsonb_build_object('uji', 'Kode barang sama ditolak', 'hasil', case when e is not null then '✓' else '✗' end, 'catatan', e);

    e := null;
    begin
      insert into public.records (tabel, data) values ('vendor_tukang', '{"nama":"UJI Tanpa NIK 1","jenis":"Lainnya"}'), ('vendor_tukang', '{"nama":"UJI Tanpa NIK 2","jenis":"Lainnya"}');
    exception when others then e := sqlerrm; end;
    h := h || jsonb_build_object('uji', 'Beberapa vendor tanpa NIK tetap boleh', 'hasil', case when e is null then '✓' else '✗' end, 'catatan', e);

    e := null;
    begin
      insert into public.records (tabel, data) values ('tidak_dikenal', '{}');
    exception when others then e := sqlerrm; end;
    h := h || jsonb_build_object('uji', 'Nama tabel di luar daftar tetap ditolak', 'hasil', case when e is not null then '✓' else '✗' end, 'catatan', e);

    h := h || jsonb_build_object('uji', 'Tempat file dokumen-master tersedia', 'hasil',
      case when exists (select 1 from storage.buckets where id = 'dokumen-master') then '✓' else '✗' end, 'catatan', null);

    raise exception 'uji_selesai';
  exception when others then
    if sqlerrm <> 'uji_selesai' then
      h := h || jsonb_build_object('uji', 'GALAT tak terduga (uji berhenti)', 'hasil', '✗', 'catatan', sqlerrm);
    end if;
  end;
  return query select (row_number() over ())::int, x ->> 'uji', x ->> 'hasil', x ->> 'catatan' from jsonb_array_elements(h) x;
end $$;

revoke execute on function public.uji_tahap2() from public, anon, authenticated;

select * from public.uji_tahap2();
