-- Alinea 5 — Uji otomatis aturan database Tahap 3.
-- Jalankan SETELAH 3-kontrak.sql. Fungsi ini mencoba kontrak, termin, invoice, penerimaan, dan addendum
-- memakai data uji, lalu MEMBATALKAN semua perubahan uji itu. Data asli tidak tersentuh.
-- Pakai:  select * from public.uji_tahap3();

create or replace function public.uji_tahap3()
returns table (no int, uji text, hasil text, catatan text)
language plpgsql security definer set search_path = ''
as $$
declare
  h jsonb := '[]'::jsonb;
  sa uuid;
  e text;
  hi date;
  basis text := (select basis from public.akuntansi limit 1);
  rek uuid; akun_rek uuid;
  kid uuid; kid2 uuid; t1 uuid; t2 uuid; tr uuid; tt uuid; a1 uuid; a2 uuid;
  p1 uuid; p2 uuid; p3 uuid;
  nomor text; s0 bigint; s1 bigint; n bigint; d bigint; k bigint; x bigint; y bigint; z bigint;
  tarif int;
  t public.termin;
  dasar jsonb;
begin
  begin
    select id into sa from public.profiles where super_admin and aktif limit 1;
    if sa is null then raise exception 'Belum ada super admin aktif.'; end if;
    perform set_config('request.jwt.claim.sub', sa::text, true);
    perform set_config('request.jwt.claims', jsonb_build_object('sub', sa, 'role', 'authenticated')::text, true);
    hi := public.hari_ini();

    insert into public.records (tabel, data) values ('proyek', '{"kode":"UJI3-001","nama":"Proyek uji Tahap 3"}');
    insert into public.rekening (nama, jenis, saldo_awal, tgl_saldo_awal, di_invoice) values ('UJI3 Giro', 'Giro', 0, hi - 400, true) returning id into rek;
    akun_rek := public.akun_rekening(rek);
    update public.akuntansi set format_invoice = 'UJI3/{YYYY}/{MM}/{NNN}';
    -- Perusahaan dianggap PKP untuk uji PPN (dibatalkan di akhir).
    update public.perusahaan set data = data || jsonb_build_object('pkp', true, 'tgl_pkp', (hi - 400)::text) where id = public.perusahaan_tunggal();

    -- 1. Kontrak 3 termin 30/40/30
    dasar := jsonb_build_object('proyek_kode', 'UJI3-001', 'no_kontrak', 'UJI3/SPK/001', 'tanggal', hi - 60, 'nilai_jasa', 100000000,
      'nilai_titipan', 0, 'ppn', 'tidak', 'akun_pendapatan', '4-1');
    kid := public.simpan_kontrak(null, dasar, jsonb_build_array(
      jsonb_build_object('milestone', 'Uang muka', 'jasa', 30000000, 'titipan', 0),
      jsonb_build_object('milestone', 'Gambar kerja', 'jasa', 40000000, 'titipan', 0),
      jsonb_build_object('milestone', 'Serah terima', 'jasa', 30000000, 'titipan', 0)));
    select count(*), string_agg(ke || ':' || tagihan, ', ' order by ke) into n, e from public.termin where kontrak_id = kid and jenis = 'termin';
    h := h || jsonb_build_object('uji', 'Kontrak 30/40/30 → 3 baris termin otomatis', 'hasil', case when n = 3 then '✓' else '✗' end, 'catatan', e);

    e := null;
    begin
      perform public.simpan_kontrak(null, dasar || '{"no_kontrak":"UJI3/SPK/002"}', jsonb_build_array(
        jsonb_build_object('jasa', 30000000, 'titipan', 0), jsonb_build_object('jasa', 40000000, 'titipan', 0), jsonb_build_object('jasa', 20000000, 'titipan', 0)));
    exception when others then e := sqlerrm; end;
    h := h || jsonb_build_object('uji', 'Total termin ≠ 100% ditolak', 'hasil', case when e like 'Total termin harus 100%%' then '✓' else '✗' end, 'catatan', e);

    e := null;
    begin
      perform public.simpan_kontrak(null, dasar || '{"no_kontrak":"uji3/spk/001"}', jsonb_build_array(jsonb_build_object('jasa', 100000000, 'titipan', 0)));
    exception when others then e := sqlerrm; end;
    h := h || jsonb_build_object('uji', 'No. kontrak sama ditolak', 'hasil', case when e is not null then '✓' else '✗' end, 'catatan', e);

    -- 2. Invoice termin 1: nomor otomatis
    select id into t1 from public.termin where kontrak_id = kid and ke = 1;
    select id into t2 from public.termin where kontrak_id = kid and ke = 2;
    nomor := public.terbitkan_invoice(t1, hi - 40, hi - 30, rek);
    h := h || jsonb_build_object('uji', 'Terbitkan invoice termin 1 → nomor otomatis', 'hasil',
      case when nomor = 'UJI3/' || to_char(hi - 40, 'YYYY/MM') || '/001' then '✓' else '✗' end, 'catatan', nomor);
    h := h || jsonb_build_object('uji', 'Invoice tidak membuat jurnal pada basis kas', 'hasil',
      case when basis <> 'kas' or not exists (select 1 from public.jurnal where sumber = 'invoice' and sumber_id = t1) then '✓' else '✗' end, 'catatan', 'basis ' || basis);

    e := null;
    begin
      perform public.simpan_kontrak(kid, dasar, jsonb_build_array(
        jsonb_build_object('id', t1, 'jasa', 25000000, 'titipan', 0), jsonb_build_object('id', t2, 'jasa', 45000000, 'titipan', 0),
        jsonb_build_object('jasa', 30000000, 'titipan', 0)));
    exception when others then e := sqlerrm; end;
    h := h || jsonb_build_object('uji', 'Nilai termin yang sudah ditagih tidak bisa diubah', 'hasil', case when e is not null then '✓' else '✗' end, 'catatan', e);

    -- 3. Dua penerimaan sebagian + potongan pajak
    select coalesce(sum(debit - kredit), 0) into s0 from public.jurnal_baris where akun_id = akun_rek;
    p1 := public.simpan_penerimaan(null, jsonb_build_object('termin_id', t1, 'tanggal', hi - 25, 'jumlah', 10000000, 'potongan_pajak', 600000, 'rekening_id', rek));
    p2 := public.simpan_penerimaan(null, jsonb_build_object('termin_id', t1, 'tanggal', hi - 20, 'jumlah', 19400000, 'potongan_pajak', 0, 'rekening_id', rek));
    execute 'set constraints all immediate';
    execute 'set constraints all deferred';
    select coalesce(sum(jumlah + potongan_pajak), 0) into x from public.penerimaan where termin_id = t1;
    h := h || jsonb_build_object('uji', '2 penerimaan sebagian + potongan pajak → lunas (diterima + potongan = tagihan)', 'hasil',
      case when x = 30000000 then '✓' else '✗' end, 'catatan', 'Rp ' || x);
    select coalesce(sum(b.debit), 0), coalesce(sum(b.kredit), 0) into d, k from public.jurnal j join public.jurnal_baris b on b.jurnal_id = j.id
    where j.sumber = 'penerimaan' and j.sumber_id in (p1, p2);
    select coalesce(sum(b.debit), 0) into x from public.jurnal j join public.jurnal_baris b on b.jurnal_id = j.id
    where j.sumber = 'penerimaan' and j.sumber_id = p1 and b.akun_id = public.akun_kode('1-3');
    select coalesce(sum(b.kredit), 0) into y from public.jurnal j join public.jurnal_baris b on b.jurnal_id = j.id
    where j.sumber = 'penerimaan' and j.sumber_id in (p1, p2) and b.akun_id = public.akun_kode(case when basis = 'kas' then '4-1' else '1-2' end);
    h := h || jsonb_build_object('uji', 'Jurnal penerimaan seimbang; potongan pajak ke 1-3; jasa ke 4-1', 'hasil',
      case when d = k and d = 30000000 and x = 600000 and y = 30000000 then '✓' else '✗' end, 'catatan', 'D ' || d || ' = K ' || k || ' · 1-3: ' || x || ' · kredit pendapatan/piutang: ' || y);
    select coalesce(sum(debit - kredit), 0) into s1 from public.jurnal_baris where akun_id = akun_rek;
    h := h || jsonb_build_object('uji', 'Saldo rekening bertambah sebesar uang yang diterima', 'hasil', case when s1 - s0 = 29400000 then '✓' else '✗' end, 'catatan', 'bertambah Rp ' || (s1 - s0));

    e := null;
    begin perform public.simpan_penerimaan(null, jsonb_build_object('termin_id', t1, 'tanggal', hi - 19, 'jumlah', 1, 'rekening_id', rek)); exception when others then e := sqlerrm; end;
    h := h || jsonb_build_object('uji', 'Penerimaan melebihi sisa tagihan ditolak', 'hasil', case when e is not null then '✓' else '✗' end, 'catatan', e);
    e := null;
    begin perform public.hapus_penerimaan(p1); exception when others then e := sqlerrm; end;
    h := h || jsonb_build_object('uji', 'Hanya penerimaan terakhir yang bisa dihapus', 'hasil', case when e is not null then '✓' else '✗' end, 'catatan', e);
    e := null;
    begin perform public.hapus_kontrak(kid); exception when others then e := sqlerrm; end;
    h := h || jsonb_build_object('uji', 'Kontrak yang sudah punya invoice tidak bisa dihapus', 'hasil', case when e is not null then '✓' else '✗' end, 'catatan', e);

    -- 4. Addendum: termin tambahan, lalu sesuaikan termin yang belum ditagih, lalu hapus addendum terakhir
    a1 := public.simpan_addendum(kid, null, jsonb_build_object('no', 'ADD-01', 'tanggal', hi - 10, 'tambah_jasa', 20000000, 'tambah_titipan', 0, 'cara_termin', 'tambah'),
      jsonb_build_array(jsonb_build_object('milestone', 'Pekerjaan tambah', 'jasa', 20000000, 'titipan', 0)));
    select count(*), sum(jasa) into n, x from public.termin where kontrak_id = kid and jenis = 'termin';
    h := h || jsonb_build_object('uji', 'Addendum +Rp 20 jt (termin tambahan) → 4 termin, total 120 jt', 'hasil', case when n = 4 and x = 120000000 then '✓' else '✗' end, 'catatan', n || ' termin, Rp ' || x);
    select id into tt from public.termin where kontrak_id = kid and ke = 3;
    a2 := public.simpan_addendum(kid, null, jsonb_build_object('no', 'ADD-02', 'tanggal', hi - 5, 'tambah_jasa', 7000000, 'tambah_titipan', 0, 'cara_termin', 'sesuaikan'),
      jsonb_build_array(jsonb_build_object('id', t2, 'jasa', 44000000, 'titipan', 0), jsonb_build_object('id', tt, 'jasa', 33000000, 'titipan', 0)));
    select sum(jasa) into x from public.termin where kontrak_id = kid and jenis = 'termin';
    select jasa into y from public.termin where id = t2;
    h := h || jsonb_build_object('uji', 'Addendum +Rp 7 jt (sesuaikan termin belum ditagih) → total 127 jt', 'hasil', case when x = 127000000 and y = 44000000 then '✓' else '✗' end, 'catatan', 'Rp ' || x);
    e := null;
    begin perform public.hapus_addendum(a1); exception when others then e := sqlerrm; end;
    h := h || jsonb_build_object('uji', 'Hanya addendum terakhir yang bisa dihapus', 'hasil', case when e is not null then '✓' else '✗' end, 'catatan', e);
    perform public.hapus_addendum(a2);
    select jasa into y from public.termin where id = t2;
    select sum(jasa) into x from public.termin where kontrak_id = kid and jenis = 'termin';
    h := h || jsonb_build_object('uji', 'Hapus addendum terakhir → termin kembali seperti semula', 'hasil', case when y = 40000000 and x = 120000000 then '✓' else '✗' end, 'catatan', 'termin 2: Rp ' || y || ' · total Rp ' || x);
    e := null;
    begin
      perform public.simpan_addendum(kid, null, jsonb_build_object('no', 'ADD-03', 'tanggal', hi, 'tambah_jasa', 5000000, 'tambah_titipan', 0, 'cara_termin', 'tambah'),
        jsonb_build_array(jsonb_build_object('jasa', 4000000, 'titipan', 0)));
    exception when others then e := sqlerrm; end;
    h := h || jsonb_build_object('uji', 'Termin tambahan ≠ nilai addendum ditolak', 'hasil', case when e is not null then '✓' else '✗' end, 'catatan', e);

    -- 5. Kontrak turn-key + PPN (belum termasuk) + retensi 5%
    kid2 := public.simpan_kontrak(null, jsonb_build_object('proyek_kode', 'UJI3-001', 'no_kontrak', 'UJI3/SPK/TK', 'tanggal', hi - 30, 'nilai_jasa', 50000000,
      'nilai_titipan', 150000000, 'ppn', 'belum', 'akun_pendapatan', '4-2', 'retensi_bp', 500, 'masa_pemeliharaan_hari', 90),
      jsonb_build_array(jsonb_build_object('milestone', 'Lunas', 'jasa', 50000000, 'titipan', 150000000)));
    select tarif_ppn_bp into tarif from public.kontrak_klien where id = kid2;
    select * into t from public.termin where kontrak_id = kid2 and jenis = 'termin';
    select id into tr from public.termin where kontrak_id = kid2 and jenis = 'retensi';
    h := h || jsonb_build_object('uji', 'PPN hanya atas jasa; retensi 5% dipotong tiap termin dan dikumpulkan jadi tagihan retensi', 'hasil',
      case when t.ppn = public.bagi(50000000, tarif, 10000) and t.ret_jasa = 2500000 and t.ret_titipan = 7500000
                and t.tagihan = 50000000 + t.ppn + 150000000 - 10000000
                and (select jasa + titipan from public.termin where id = tr) = 10000000 then '✓' else '✗' end,
      'catatan', 'PPN ' || t.ppn || ' · retensi ' || (t.ret_jasa + t.ret_titipan) || ' · tagihan ' || t.tagihan);
    perform public.terbitkan_invoice(t.id, hi - 20, hi - 6, rek);
    p3 := public.simpan_penerimaan(null, jsonb_build_object('termin_id', t.id, 'tanggal', hi - 10, 'jumlah', t.tagihan, 'rekening_id', rek));
    select coalesce(sum(b.kredit) filter (where b.akun_id = public.akun_kode('2-4')), 0),
           coalesce(sum(b.kredit) filter (where b.akun_id = public.akun_kode('4-2')), 0),
           coalesce(sum(b.kredit) filter (where b.akun_id = public.akun_kode('2-5')), 0)
      into x, y, z
    from public.jurnal j join public.jurnal_baris b on b.jurnal_id = j.id where j.sumber = 'penerimaan' and j.sumber_id = p3;
    h := h || jsonb_build_object('uji', 'Turn-key: porsi titipan ke 2-4 Hutang Dana Titipan Klien, bukan pendapatan', 'hasil',
      case when basis <> 'kas' or (x = 142500000 and y = 47500000 and z = t.ppn) then '✓' else '✗' end,
      'catatan', '2-4: ' || x || ' · 4-2: ' || y || ' · 2-5: ' || z);
    e := null;
    begin perform public.terbitkan_invoice(tr, hi, hi + 14, rek); exception when others then e := sqlerrm; end;
    h := h || jsonb_build_object('uji', 'Retensi belum bisa ditagih sebelum masa pemeliharaan selesai', 'hasil', case when e is not null then '✓' else '✗' end, 'catatan', e);

    update public.perusahaan set data = data || '{"pkp": false}'::jsonb where id = public.perusahaan_tunggal();
    e := null;
    begin
      perform public.simpan_kontrak(null, dasar || '{"no_kontrak":"UJI3/SPK/PPN","ppn":"belum"}', jsonb_build_array(jsonb_build_object('jasa', 100000000, 'titipan', 0)));
    exception when others then e := sqlerrm; end;
    h := h || jsonb_build_object('uji', 'PPN ditolak bila perusahaan belum PKP', 'hasil', case when e is not null then '✓' else '✗' end, 'catatan', e);

    execute 'set constraints all immediate';
    execute 'set constraints all deferred';
    select coalesce(sum(debit), 0), coalesce(sum(kredit), 0) into d, k from public.jurnal_baris;
    h := h || jsonb_build_object('uji', 'Total debit = total kredit di seluruh jurnal', 'hasil', case when d = k then '✓' else '✗' end, 'catatan', d || ' = ' || k);

    raise exception 'uji_selesai';
  exception when others then
    if sqlerrm <> 'uji_selesai' then
      h := h || jsonb_build_object('uji', 'GALAT tak terduga (uji berhenti)', 'hasil', '✗', 'catatan', sqlerrm);
    end if;
  end;
  return query select (row_number() over ())::int, x2 ->> 'uji', x2 ->> 'hasil', x2 ->> 'catatan' from jsonb_array_elements(h) x2;
end $$;

revoke execute on function public.uji_tahap3() from public, anon, authenticated;

select * from public.uji_tahap3();
