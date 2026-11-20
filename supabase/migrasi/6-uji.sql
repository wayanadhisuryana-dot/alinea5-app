-- Alinea 5 — Uji otomatis aturan database Tahap 6 (Hutang Lain).
-- Jalankan SETELAH 6-hutang.sql. Fungsi ini mencoba kreditur, hutang, jadwal, pembayaran, dan tautan aset memakai data uji,
-- lalu MEMBATALKAN semua perubahan uji itu. Data asli tidak tersentuh.
-- Jadwal otomatis dan notifikasi H-3 dihitung aplikasi; ujinya ada di layar Hutang Lain dan lonceng notifikasi.
-- Pakai:  select * from public.uji_tahap6();

create or replace function public.uji_tahap6()
returns table (no int, uji text, hasil text, catatan text)
language plpgsql security definer set search_path = ''
as $$
declare
  h jsonb := '[]'::jsonb;
  sa uuid;
  e text; e2 text;
  hi date;
  y int;
  mulai date;
  rek uuid; kb uuid; kp uuid; ka uuid; k_knd uuid;
  h1 uuid; h2 uuid; h3 uuid; h4 uuid; h5 uuid; b1 uuid; b2 uuid; a1 uuid;
  jadwal jsonb; salah jsonb; impor jsonb;
  n bigint; n2 bigint; d bigint; k bigint; x bigint; z bigint;
  s text;
begin
  begin
    select id into sa from public.profiles where super_admin and aktif limit 1;
    if sa is null then raise exception 'Belum ada super admin aktif.'; end if;
    perform set_config('request.jwt.claim.sub', sa::text, true);
    perform set_config('request.jwt.claims', jsonb_build_object('sub', sa, 'role', 'authenticated')::text, true);
    hi := public.hari_ini();
    y := extract(year from hi)::int - 1;          -- tahun lalu: semua bulannya sudah berakhir
    mulai := make_date(y, 1, 15);
    delete from public.tutup_buku;                -- ikut dibatalkan di akhir uji
    update public.perusahaan set data = data || jsonb_build_object('pkp', false) where id = public.perusahaan_tunggal();

    insert into public.rekening (nama, jenis, saldo_awal, tgl_saldo_awal) values ('UJI6 Giro', 'Giro', 2000000000, make_date(y - 2, 1, 1)) returning id into rek;
    kb := public.simpan_kreditur(null, '{"nama":"UJI6 Bank Satu"}');
    kp := public.simpan_kreditur(null, '{"nama":"UJI6 Pak Pemilik"}');
    ka := public.simpan_kreditur(null, '{"nama":"UJI6 PT Saudara","afiliasi":true}');

    -- 1. Kreditur tersimpan sekali saja (nama sama ditolak).
    e := null;
    begin perform public.simpan_kreditur(null, '{"nama":"  uji6 bank satu "}'); exception when others then e := sqlerrm; end;
    h := h || jsonb_build_object('uji', 'Daftar kreditur: nama yang sama tidak bisa dibuat dua kali', 'hasil', case when e like 'Kreditur "%" sudah ada%' then '✓' else '✗' end,
      'catatan', coalesce(e, 'tidak ditolak'));

    -- 2. 120 jt / 12 bln / flat 10%: jadwal 10 jt pokok + 1 jt bunga tiap bulan (dibuat seperti aplikasi membuatnya).
    select jsonb_agg(jsonb_build_object('ke', i, 'tanggal', (mulai + make_interval(months => i))::date, 'pokok', 10000000, 'bunga', 1000000) order by i)
      into jadwal from generate_series(1, 12) i;
    h1 := public.simpan_hutang(null, jsonb_build_object('kreditur_id', kb, 'jenis', 'kredit_bank', 'uraian', 'UJI6 Modal kerja', 'pokok', 120000000,
      'bunga_bp', 1000, 'metode_bunga', 'flat', 'tenor_bulan', 12, 'tgl_mulai', mulai, 'hari_angsuran', 15, 'cara', 'tunai', 'rekening_id', rek), jadwal);
    select count(*), coalesce(sum(pokok), 0), coalesce(sum(bunga), 0), min(tanggal)::text into n, x, z, s from public.hutang_angsuran where hutang_id = h1;
    select coalesce(sum(b.debit) filter (where b.akun_id = public.akun_rekening(rek)), 0), coalesce(sum(b.kredit) filter (where b.akun_id = public.akun_kode('2-8')), 0)
      into d, k from public.jurnal_baris b join public.jurnal j on j.id = b.jurnal_id where j.sumber = 'hutang' and j.sumber_id = h1;
    h := h || jsonb_build_object('uji', '120 jt / 12 bln / flat 10%: 12 angsuran, pokok 120 jt, bunga 12 jt; jurnal D rekening / K 2-8 120 jt', 'hasil',
      case when n = 12 and x = 120000000 and z = 12000000 and s = make_date(y, 2, 15)::text and d = 120000000 and k = 120000000 then '✓' else '✗' end,
      'catatan', n || ' angsuran · pokok ' || x || ' · bunga ' || z || ' · pertama ' || s || ' · jurnal ' || d || '/' || k);

    -- 3. Impor jadwal: total pokok salah ditolak; total benar mengganti jadwal otomatis.
    select jsonb_agg(jsonb_build_object('ke', i, 'tanggal', (mulai + make_interval(months => i))::date, 'pokok', 19000000, 'bunga', 1500000) order by i)
      into salah from generate_series(1, 6) i;
    e := null;
    begin perform public.simpan_jadwal_hutang(h1, salah, 'impor'); exception when others then e := sqlerrm; end;
    select jsonb_agg(jsonb_build_object('ke', i, 'tanggal', (mulai + make_interval(months => i))::date, 'pokok', 20000000, 'bunga', 1500000) order by i)
      into impor from generate_series(1, 6) i;
    perform public.simpan_jadwal_hutang(h1, impor, 'impor');
    select count(*), coalesce(sum(pokok), 0) into n, x from public.hutang_angsuran where hutang_id = h1;
    select jadwal_sumber into s from public.hutang where id = h1;
    h := h || jsonb_build_object('uji', 'Impor jadwal mengganti jadwal otomatis; total pokok ≠ pokok pinjaman ditolak', 'hasil',
      case when e like 'Total pokok jadwal%' and n = 6 and x = 120000000 and s = 'impor' then '✓' else '✗' end,
      'catatan', n || ' angsuran (' || s || ') · salah: ' || coalesce(e, 'tidak ditolak'));
    perform public.simpan_jadwal_hutang(h1, jadwal, 'otomatis');

    -- 4. Bayar angsuran ke-1: sisa pokok turun hanya sebesar pokok; bunga ke 7-1; jurnal seimbang.
    b1 := public.simpan_bayar_hutang(null, jsonb_build_object('hutang_id', h1, 'angsuran_ke', 1, 'tanggal', make_date(y, 2, 15), 'pokok', 10000000, 'bunga', 1000000,
      'rekening_id', rek));
    n := public.sisa_pokok_hutang(h1);
    select coalesce(sum(b.debit) filter (where b.akun_id = public.akun_kode('2-8')), 0), coalesce(sum(b.debit) filter (where b.akun_id = public.akun_kode('7-1')), 0),
      coalesce(sum(b.kredit) filter (where b.akun_id = public.akun_rekening(rek)), 0), coalesce(sum(b.debit), 0) - coalesce(sum(b.kredit), 0)
      into d, k, x, z from public.jurnal_baris b join public.jurnal j on j.id = b.jurnal_id where j.sumber = 'bayar_hutang' and j.sumber_id = b1;
    h := h || jsonb_build_object('uji', 'Bayar: sisa pokok turun sebesar porsi pokok saja; D 2-8 pokok + D 7-1 bunga / K rekening; seimbang', 'hasil',
      case when n = 110000000 and d = 10000000 and k = 1000000 and x = 11000000 and z = 0 then '✓' else '✗' end,
      'catatan', 'sisa ' || n || ' · D hutang ' || d || ' · D bunga ' || k || ' · K rekening ' || x);

    -- 5. Pembayaran yang salah ditolak: pokok melebihi sisa, angsuran tak ada, sebelum tanggal mulai.
    e := null; e2 := null; s := null;
    begin perform public.simpan_bayar_hutang(null, jsonb_build_object('hutang_id', h1, 'tanggal', make_date(y, 3, 1), 'pokok', 110000001, 'rekening_id', rek));
    exception when others then e := sqlerrm; end;
    begin perform public.simpan_bayar_hutang(null, jsonb_build_object('hutang_id', h1, 'angsuran_ke', 99, 'tanggal', make_date(y, 3, 1), 'pokok', 1, 'rekening_id', rek));
    exception when others then e2 := sqlerrm; end;
    begin perform public.simpan_bayar_hutang(null, jsonb_build_object('hutang_id', h1, 'tanggal', make_date(y, 1, 1), 'bunga', 1, 'rekening_id', rek));
    exception when others then s := sqlerrm; end;
    h := h || jsonb_build_object('uji', 'Pembayaran ditolak bila pokok > sisa, angsuran tidak ada, atau sebelum tanggal mulai', 'hasil',
      case when e like 'Porsi pokok%melebihi sisa%' and e2 like 'Angsuran ke-99 tidak ada%' and s like 'Tanggal bayar tidak boleh sebelum tanggal mulai%' then '✓' else '✗' end,
      'catatan', coalesce(e, '-') || ' · ' || coalesce(e2, '-') || ' · ' || coalesce(s, '-'));

    -- 6. Pelunasan dipercepat: sisa pokok dibayar sekaligus (+ denda ke 7-3) → sisa 0; jadwal sisa tidak bisa diimpor lagi; hutang berpembayaran tidak bisa dihapus.
    b2 := public.simpan_bayar_hutang(null, jsonb_build_object('hutang_id', h1, 'tanggal', make_date(y, 3, 20), 'pokok', 110000000, 'bunga', 500000, 'denda', 250000,
      'rekening_id', rek, 'catatan', 'Pelunasan dipercepat'));
    n := public.sisa_pokok_hutang(h1);
    select coalesce(sum(b.debit) filter (where b.akun_id = public.akun_kode('7-3')), 0), coalesce(sum(b.kredit) filter (where b.akun_id = public.akun_rekening(rek)), 0)
      into d, x from public.jurnal_baris b join public.jurnal j on j.id = b.jurnal_id where j.sumber = 'bayar_hutang' and j.sumber_id = b2;
    e := null;
    begin perform public.hapus_hutang(h1); exception when others then e := sqlerrm; end;
    h := h || jsonb_build_object('uji', 'Pelunasan dipercepat: sisa pokok 0, denda ke 7-3; hutang berpembayaran tidak bisa dihapus', 'hasil',
      case when n = 0 and d = 250000 and x = 110750000 and e like 'Hutang ini sudah punya pembayaran%' then '✓' else '✗' end,
      'catatan', 'sisa ' || n || ' · denda ' || d || ' · dibayar ' || x || ' · hapus: ' || coalesce(e, 'tidak ditolak'));

    -- 7. Kredit mobil: aset kredit dengan uang muka → D aset / K rekening (DP) / K 2-8 (sisa); hutang tertaut ke aset, pokok harus = sisa.
    select id into k_knd from public.aset_kategori where prefix = 'KND';
    if k_knd is null then raise exception 'Kategori isi awal KND tidak ditemukan.'; end if;
    a1 := public.simpan_aset(null, jsonb_build_object('nama', 'UJI6 Mobil kredit', 'kategori_id', k_knd, 'tgl_perolehan', make_date(y, 4, 1), 'harga', 300000000,
      'cara', 'kredit', 'uang_muka', 60000000, 'rekening_id', rek, 'umur_bulan', 96));
    select coalesce(sum(b.kredit) filter (where b.akun_id = public.akun_rekening(rek)), 0), coalesce(sum(b.kredit) filter (where b.akun_id = public.akun_kode('2-8')), 0)
      into d, k from public.jurnal_baris b join public.jurnal j on j.id = b.jurnal_id where j.sumber = 'aset' and j.sumber_id = a1;
    e := null;
    begin perform public.simpan_hutang(null, jsonb_build_object('kreditur_id', kb, 'jenis', 'leasing', 'pokok', 300000000, 'tgl_mulai', make_date(y, 4, 1),
      'cara', 'aset', 'aset_id', a1)); exception when others then e := sqlerrm; end;
    h2 := public.simpan_hutang(null, jsonb_build_object('kreditur_id', kb, 'jenis', 'leasing', 'uraian', 'UJI6 Leasing mobil', 'pokok', 240000000, 'bunga_bp', 800,
      'metode_bunga', 'flat', 'tenor_bulan', 36, 'tgl_mulai', make_date(y, 4, 1), 'cara', 'aset', 'aset_id', a1));
    select count(*) into n from public.aset where id = a1 and hutang_id = h2;
    select count(*) into n2 from public.jurnal where sumber = 'hutang' and sumber_id = h2;
    e2 := null;
    begin perform public.hapus_aset(a1); exception when others then e2 := sqlerrm; end;
    h := h || jsonb_build_object('uji', 'Kredit mobil: DP dari rekening, sisa ke 2-8; hutang tertaut ke aset (tanpa jurnal ganda); pokok ≠ sisa ditolak; aset tertaut tidak bisa dihapus', 'hasil',
      case when d = 60000000 and k = 240000000 and n = 1 and n2 = 0 and e like 'Pokok hutang harus sama%' and e2 like 'Aset ini tertaut ke hutang%' then '✓' else '✗' end,
      'catatan', 'DP ' || d || ' · hutang aset ' || k || ' · jurnal hutang ' || n2 || ' · ' || coalesce(e, 'pokok salah tidak ditolak'));

    -- 8. Pinjaman pemilik dan kreditur afiliasi → 2-9; pinjaman pihak lain → 2-10.
    h3 := public.simpan_hutang(null, jsonb_build_object('kreditur_id', kp, 'jenis', 'pinjaman_pemilik', 'pokok', 50000000, 'metode_bunga', 'tanpa',
      'tgl_mulai', make_date(y, 5, 1), 'cara', 'tunai', 'rekening_id', rek));
    h4 := public.simpan_hutang(null, jsonb_build_object('kreditur_id', ka, 'jenis', 'pinjaman_lain', 'pokok', 20000000, 'tgl_mulai', make_date(y, 5, 1),
      'cara', 'tunai', 'rekening_id', rek));
    h5 := public.simpan_hutang(null, jsonb_build_object('kreditur_id', kb, 'jenis', 'pinjaman_lain', 'pokok', 5000000, 'tgl_mulai', make_date(y, 5, 1),
      'cara', 'tunai', 'rekening_id', rek));
    select string_agg(akun_kode, ',' order by array_position(array[h3, h4, h5], id)) into s from public.hutang where id in (h3, h4, h5);
    select coalesce(sum(b.kredit), 0) into k from public.jurnal_baris b join public.jurnal j on j.id = b.jurnal_id
      where j.sumber = 'hutang' and j.sumber_id in (h3, h4) and b.akun_id = public.akun_kode('2-9');
    h := h || jsonb_build_object('uji', 'Pinjaman pemilik / kreditur afiliasi → 2-9 (Hutang kepada Pemilik/Afiliasi); pihak lain → 2-10', 'hasil',
      case when s = '2-9,2-9,2-10' and k = 70000000 then '✓' else '✗' end, 'catatan', s || ' · K 2-9 ' || k);

    -- 9. Hutang lama (saldo awal): D 3-2-01 / K hutang sebesar sisa pokok, tanpa uang masuk; pembayaran sebelum tanggal saldo awal ditolak.
    h5 := public.simpan_hutang(null, jsonb_build_object('kreditur_id', kb, 'jenis', 'kredit_bank', 'uraian', 'UJI6 KPR lama', 'pokok', 100000000, 'bunga_bp', 900,
      'metode_bunga', 'anuitas', 'tenor_bulan', 60, 'tgl_mulai', make_date(y - 2, 1, 10), 'cara', 'saldo_awal', 'tgl_saldo_awal', make_date(y, 1, 1),
      'sisa_pokok_awal', 70000000));
    select coalesce(sum(b.debit) filter (where b.akun_id = public.akun_kode('3-2-01')), 0), coalesce(sum(b.kredit) filter (where b.akun_id = public.akun_kode('2-8')), 0),
      count(*) filter (where b.akun_id = public.akun_rekening(rek))
      into d, k, x from public.jurnal_baris b join public.jurnal j on j.id = b.jurnal_id where j.sumber = 'hutang' and j.sumber_id = h5;
    e := null;
    begin perform public.simpan_bayar_hutang(null, jsonb_build_object('hutang_id', h5, 'tanggal', make_date(y - 1, 6, 10), 'pokok', 1000000, 'rekening_id', rek));
    exception when others then e := sqlerrm; end;
    h := h || jsonb_build_object('uji', 'Saldo awal hutang lama: D 3-2-01 / K 2-8 sebesar sisa pokok, tanpa rekening; bayar sebelum tanggal saldo awal ditolak', 'hasil',
      case when d = 70000000 and k = 70000000 and x = 0 and public.sisa_pokok_hutang(h5) = 70000000 and e like 'Tanggal bayar tidak boleh sebelum tanggal saldo awal%' then '✓' else '✗' end,
      'catatan', 'D ekuitas ' || d || ' · K hutang ' || k || ' · ' || coalesce(e, 'tidak ditolak'));

    -- 10. Bulan yang sudah ditutup: pembayaran di bulan itu ditolak.
    insert into public.tutup_buku (bulan) values (make_date(y, 6, 1));
    e := null;
    begin perform public.simpan_bayar_hutang(null, jsonb_build_object('hutang_id', h5, 'tanggal', make_date(y, 6, 10), 'pokok', 1000000, 'rekening_id', rek));
    exception when others then e := sqlerrm; end;
    h := h || jsonb_build_object('uji', 'Pembayaran di bulan yang sudah ditutup ditolak', 'hasil', case when e is not null then '✓' else '✗' end, 'catatan', coalesce(e, 'tidak ditolak'));

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

revoke execute on function public.uji_tahap6() from public, anon, authenticated;

select * from public.uji_tahap6();
