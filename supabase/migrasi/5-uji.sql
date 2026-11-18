-- Alinea 5 — Uji otomatis aturan database Tahap 5 (Aset + Penyusutan).
-- Jalankan SETELAH 5-aset.sql. Fungsi ini mencoba aset, penyusutan, pelepasan, dan servis memakai data uji,
-- lalu MEMBATALKAN semua perubahan uji itu. Data asli tidak tersentuh.
-- Penyusutan fiskal (buku pajak) dihitung aplikasi, bukan database; ujinya ada di layar Aset → Laporan Pajak.
-- Pakai:  select * from public.uji_tahap5();

create or replace function public.uji_tahap5()
returns table (no int, uji text, hasil text, catatan text)
language plpgsql security definer set search_path = ''
as $$
declare
  h jsonb := '[]'::jsonb;
  sa uuid;
  e text;
  hi date;
  y int;
  jan date; des date;
  rek uuid; sup uuid; pgw uuid;
  k_knd uuid; k_tnh uuid; k_kmp uuid;
  a1 uuid; a2 uuid; a3 uuid; a4 uuid; a5 uuid; a6 uuid; a7 uuid; a8 uuid; s1 uuid; s2 uuid;
  kd1 text; kd2 text;
  n bigint; n2 bigint; d bigint; k bigint; x bigint; z bigint;
  r public.aset;
begin
  begin
    select id into sa from public.profiles where super_admin and aktif limit 1;
    if sa is null then raise exception 'Belum ada super admin aktif.'; end if;
    perform set_config('request.jwt.claim.sub', sa::text, true);
    perform set_config('request.jwt.claims', jsonb_build_object('sub', sa, 'role', 'authenticated')::text, true);
    hi := public.hari_ini();
    y := extract(year from hi)::int - 1;          -- tahun lalu: semua bulannya sudah berakhir
    jan := make_date(y, 1, 1); des := make_date(y, 12, 31);
    delete from public.tutup_buku;                -- ikut dibatalkan di akhir uji
    update public.akuntansi set batas_kapitalisasi = 10000000;
    update public.aset_kategori set umur_bulan = null;

    insert into public.rekening (nama, jenis, saldo_awal, tgl_saldo_awal) values ('UJI5 Giro', 'Giro', 2000000000, make_date(y - 2, 1, 1)) returning id into rek;
    insert into public.records (tabel, data) values ('supplier', '{"nama":"UJI5 Dealer Mobil","pkp":true}') returning id into sup;
    insert into public.records (tabel, data) values ('sdm', '{"nama":"UJI5 Pegawai"}') returning id into pgw;
    select id into k_knd from public.aset_kategori where prefix = 'KND';
    select id into k_tnh from public.aset_kategori where prefix = 'TNH';
    select id into k_kmp from public.aset_kategori where prefix = 'KMP';
    if k_knd is null or k_tnh is null or k_kmp is null then raise exception 'Kategori isi awal (KND, TNH, KMP) tidak ditemukan.'; end if;

    -- 1. Kode otomatis sesuai prefix, berurutan, tidak bisa dobel.
    update public.perusahaan set data = data || jsonb_build_object('pkp', false) where id = public.perusahaan_tunggal();
    a1 := public.simpan_aset(null, jsonb_build_object('nama', 'UJI5 Mobil A', 'kategori_id', k_knd, 'tgl_perolehan', jan, 'harga', 200000000, 'ppn', 22000000,
      'cara', 'tunai', 'rekening_id', rek, 'umur_bulan', 96, 'pemegang_id', pgw));
    a2 := public.simpan_aset(null, jsonb_build_object('nama', 'UJI5 Mobil B', 'kategori_id', k_knd, 'tgl_perolehan', jan, 'harga', 150000000,
      'cara', 'kredit', 'umur_bulan', 96));
    select kode into kd1 from public.aset where id = a1;
    select kode into kd2 from public.aset where id = a2;
    e := null;
    begin update public.aset set kode = kd1 where id = a2; exception when others then e := sqlerrm; end;
    h := h || jsonb_build_object('uji', 'Kode aset otomatis <prefix>-<3 digit>, berurutan, tidak bisa dobel', 'hasil',
      case when kd1 ~ '^KND-[0-9]{3,}$' and substring(kd2 from '[0-9]+$')::int = substring(kd1 from '[0-9]+$')::int + 1 and e like '%aset_kode_key%' then '✓' else '✗' end,
      'catatan', kd1 || ', ' || kd2 || ' · dobel: ' || coalesce(e, 'tidak ditolak'));
    select count(*) into n from public.aset_mutasi where aset_id = a1 and ke_pemegang = 'UJI5 Pegawai';
    h := h || jsonb_build_object('uji', 'Penempatan awal tercatat di riwayat mutasi', 'hasil', case when n = 1 then '✓' else '✗' end, 'catatan', n || ' baris');

    -- 2. PPN: non-PKP termasuk PPN; PKP setelah tanggal PKP tanpa PPN; PKP sebelum tanggal PKP termasuk PPN.
    select nilai_perolehan into n from public.aset where id = a1;
    e := null;
    begin perform public.simpan_aset(null, jsonb_build_object('nama', 'UJI5 X', 'kategori_id', k_knd, 'tgl_perolehan', jan, 'harga', 200000000, 'ppn', 22000000,
      'ppn_kredit', true, 'cara', 'kredit', 'umur_bulan', 96)); exception when others then e := sqlerrm; end;
    h := h || jsonb_build_object('uji', 'Non-PKP: nilai perolehan termasuk PPN; PPN tidak bisa dikreditkan', 'hasil',
      case when n = 222000000 and e like 'PPN hanya bisa dikreditkan%' then '✓' else '✗' end, 'catatan', 'nilai ' || n || ' · ' || coalesce(e, 'tidak ditolak'));
    update public.perusahaan set data = data || jsonb_build_object('pkp', true, 'tgl_pkp', make_date(y, 6, 1)::text) where id = public.perusahaan_tunggal();
    a3 := public.simpan_aset(null, jsonb_build_object('nama', 'UJI5 Laptop PKP', 'kategori_id', k_kmp, 'tgl_perolehan', make_date(y, 7, 1), 'harga', 20000000,
      'ppn', 2200000, 'ppn_kredit', true, 'cara', 'tunai', 'rekening_id', rek, 'umur_bulan', 48));
    select nilai_perolehan into n from public.aset where id = a3;
    select coalesce(sum(b.debit), 0) into x from public.jurnal_baris b join public.jurnal j on j.id = b.jurnal_id
      where j.sumber = 'aset' and j.sumber_id = a3 and b.akun_id = public.akun_kode('1-4');
    e := null;
    begin perform public.simpan_aset(null, jsonb_build_object('nama', 'UJI5 Y', 'kategori_id', k_kmp, 'tgl_perolehan', make_date(y, 5, 1), 'harga', 20000000,
      'ppn', 2200000, 'ppn_kredit', true, 'cara', 'kredit', 'umur_bulan', 48)); exception when others then e := sqlerrm; end;
    a4 := public.simpan_aset(null, jsonb_build_object('nama', 'UJI5 Laptop sebelum PKP', 'kategori_id', k_kmp, 'tgl_perolehan', make_date(y, 5, 1), 'harga', 20000000,
      'ppn', 2200000, 'cara', 'kredit', 'umur_bulan', 48));
    select nilai_perolehan into n2 from public.aset where id = a4;
    h := h || jsonb_build_object('uji', 'PKP setelah tanggal PKP: tanpa PPN (PPN ke 1-4); sebelum tanggal PKP: termasuk PPN', 'hasil',
      case when n = 20000000 and x = 2200000 and n2 = 22200000 and e like 'PPN hanya bisa dikreditkan%' then '✓' else '✗' end,
      'catatan', 'setelah ' || n || ' (PPN masukan ' || x || ') · sebelum ' || n2);

    -- 3. Aset Rp 6 jt -> peringatan batas kapitalisasi; tetap bisa disimpan sebagai aset bila dikonfirmasi.
    e := null;
    begin perform public.simpan_aset(null, jsonb_build_object('nama', 'UJI5 Printer', 'kategori_id', k_kmp, 'tgl_perolehan', jan, 'harga', 6000000,
      'cara', 'tunai', 'rekening_id', rek, 'umur_bulan', 48)); exception when others then e := sqlerrm; end;
    a5 := public.simpan_aset(null, jsonb_build_object('nama', 'UJI5 Printer', 'kategori_id', k_kmp, 'tgl_perolehan', jan, 'harga', 6000000,
      'cara', 'tunai', 'rekening_id', rek, 'umur_bulan', 48, 'tetap_aset', true));
    select di_bawah_batas into r.di_bawah_batas from public.aset where id = a5;
    h := h || jsonb_build_object('uji', 'Aset Rp 6 jt: peringatan "Sebaiknya dicatat sebagai biaya (OPEX)"; [Tetap simpan sebagai aset] berhasil', 'hasil',
      case when e like '%Sebaiknya dicatat sebagai biaya (OPEX)%' and r.di_bawah_batas then '✓' else '✗' end, 'catatan', e);

    -- 4. Tanah tanpa penyusutan.
    a6 := public.simpan_aset(null, jsonb_build_object('nama', 'UJI5 Tanah', 'kategori_id', k_tnh, 'tgl_perolehan', make_date(y - 1, 1, 1), 'harga', 500000000,
      'cara', 'kredit', 'umur_bulan', 240));
    select umur_bulan, tgl_mulai into r.umur_bulan, r.tgl_mulai from public.aset where id = a6;
    h := h || jsonb_build_object('uji', 'Tanah: tanpa penyusutan (umur dan tanggal mulai diabaikan)', 'hasil',
      case when public.akumulasi_aset(a6, public.idx_bulan(hi)) = 0 and r.umur_bulan is null then '✓' else '✗' end,
      'catatan', 'akumulasi ' || public.akumulasi_aset(a6, public.idx_bulan(hi)));

    -- 5. Aset 24 jt, umur 4 thn, residu 0, mulai Januari -> 500.000/bulan; 31 Desember akumulasi 6 jt; jurnal bulanan terbentuk.
    a7 := public.simpan_aset(null, jsonb_build_object('nama', 'UJI5 Server', 'kategori_id', k_kmp, 'tgl_perolehan', jan, 'harga', 24000000,
      'cara', 'tunai', 'rekening_id', rek, 'umur_bulan', 48, 'residu', 0));
    x := public.akumulasi_aset(a7, public.idx_bulan(jan)); z := public.akumulasi_aset(a7, public.idx_bulan(des));
    perform public.bukukan_penyusutan(des);
    select count(*), coalesce(sum(pa.jumlah), 0), coalesce(min(pa.jumlah), 0), coalesce(max(pa.jumlah), 0) into n, n2, d, k
    from public.penyusutan_aset pa join public.penyusutan_bulan b on b.id = pa.bulan_id where pa.aset_id = a7 and b.bulan between jan and des;
    h := h || jsonb_build_object('uji', 'Aset 24 jt / 4 thn: Rp 500.000 per bulan, akumulasi 31 Desember Rp 6 jt', 'hasil',
      case when x = 500000 and z = 6000000 and n = 12 and n2 = 6000000 and d = 500000 and k = 500000 then '✓' else '✗' end,
      'catatan', 'Januari ' || x || ' · 31 Des ' || z || ' · dibukukan ' || n || ' bulan = ' || n2);
    select count(*) into n from public.jurnal j where j.sumber = 'penyusutan' and j.tanggal between jan and des
      and exists (select 1 from public.jurnal_baris b where b.jurnal_id = j.id and b.akun_id = public.akun_kode('6-4') and b.debit > 0)
      and exists (select 1 from public.jurnal_baris b where b.jurnal_id = j.id and b.akun_id = public.akun_kode('1-8') and b.kredit > 0);
    h := h || jsonb_build_object('uji', 'Jurnal penyusutan bulanan terbentuk (D 6-4 / K 1-8), bertanggal akhir bulan', 'hasil',
      case when n = 12 and exists (select 1 from public.jurnal where sumber = 'penyusutan' and tanggal = des) then '✓' else '✗' end, 'catatan', n || ' jurnal');
    n := public.bukukan_penyusutan(des);
    h := h || jsonb_build_object('uji', 'Membukukan ulang tanpa perubahan tidak membuat jurnal baru', 'hasil', case when n = 0 then '✓' else '✗' end, 'catatan', n || ' bulan berubah');

    -- 6. Penyusutan tertinggal (bulan sudah ditutup) dibukukan sekaligus di bulan terbuka berikutnya.
    insert into public.tutup_buku (bulan) values (make_date(y, 2, 1)), (make_date(y, 3, 1));
    a8 := public.simpan_aset(null, jsonb_build_object('nama', 'UJI5 Proyektor', 'kategori_id', k_kmp, 'tgl_perolehan', jan, 'harga', 12000000,
      'cara', 'tunai', 'rekening_id', rek, 'umur_bulan', 24));
    perform public.bukukan_penyusutan(des);
    select coalesce(sum(pa.jumlah) filter (where b.bulan = make_date(y, 4, 1)), 0), coalesce(sum(pa.jumlah), 0) into x, z
    from public.penyusutan_aset pa join public.penyusutan_bulan b on b.id = pa.bulan_id where pa.aset_id = a8;
    h := h || jsonb_build_object('uji', 'Aset dicatat terlambat: Februari–Maret sudah ditutup, penyusutannya dibukukan sekaligus di April', 'hasil',
      case when x = 1500000 and z = 6000000 then '✓' else '✗' end, 'catatan', 'April ' || x || ' (3 bulan × 500.000) · total ' || z);
    delete from public.tutup_buku;

    -- 7. Aset Hilang dengan nilai buku 10 jt -> rugi 10 jt; keluar dari aset aktif; penyusutan berhenti.
    perform public.simpan_aset(a8, jsonb_build_object('nama', 'UJI5 Proyektor', 'kategori_id', k_kmp, 'tgl_perolehan', jan, 'harga', 12000000,
      'cara', 'tunai', 'rekening_id', rek, 'umur_bulan', 24, 'status', 'Hilang', 'tgl_pelepasan', make_date(y, 5, 15), 'alasan_pelepasan', 'Hilang di lokasi'));
    select * into r from public.aset where id = a8;
    select coalesce(sum(b.debit), 0) into x from public.jurnal_baris b join public.jurnal j on j.id = b.jurnal_id
      where j.sumber = 'pelepasan_aset' and j.sumber_id = a8 and b.akun_id = public.akun_kode('7-2');
    perform public.bukukan_penyusutan(des);
    select coalesce(sum(jumlah), 0) into z from public.penyusutan_aset where aset_id = a8;
    h := h || jsonb_build_object('uji', 'Aset Hilang, nilai buku Rp 10 jt: rugi Rp 10 jt (D 7-2), penyusutan berhenti sebelum bulan pelepasan', 'hasil',
      case when r.nilai_buku_lepas = 10000000 and r.laba_lepas = -10000000 and x = 10000000 and z = 2000000 and r.status = 'Hilang' then '✓' else '✗' end,
      'catatan', 'nilai buku ' || r.nilai_buku_lepas || ' · rugi jurnal ' || x || ' · akumulasi dibukukan ' || z);

    -- 8. Dijual dengan laba -> K 4-4; Dihapuskan / Hilang wajib nilai jual 0.
    perform public.simpan_aset(a5, jsonb_build_object('nama', 'UJI5 Printer', 'kategori_id', k_kmp, 'tgl_perolehan', jan, 'harga', 6000000,
      'cara', 'tunai', 'rekening_id', rek, 'umur_bulan', 48, 'tetap_aset', true, 'status', 'Dijual', 'tgl_pelepasan', make_date(y, 7, 10), 'nilai_jual', 6000000,
      'rekening_jual_id', rek, 'alasan_pelepasan', 'Dijual'));
    select * into r from public.aset where id = a5;
    select coalesce(sum(b.kredit), 0) into x from public.jurnal_baris b join public.jurnal j on j.id = b.jurnal_id
      where j.sumber = 'pelepasan_aset' and j.sumber_id = a5 and b.akun_id = public.akun_kode('4-4');
    h := h || jsonb_build_object('uji', 'Aset dijual di atas nilai buku: laba pelepasan ke 4-4', 'hasil',
      case when r.akumulasi_lepas = 750000 and r.laba_lepas = 750000 and x = 750000 then '✓' else '✗' end,
      'catatan', 'akumulasi 6 bulan ' || r.akumulasi_lepas || ' · laba ' || r.laba_lepas || ' · jurnal 4-4 ' || x);

    -- 9. Servis: biaya biasa -> 6-5; dikapitalisasi di bawah batas ditolak; dikapitalisasi -> menambah nilai aset.
    s1 := public.simpan_servis_aset(null, jsonb_build_object('aset_id', a1, 'tanggal', make_date(y, 3, 10), 'uraian', 'Ganti oli', 'biaya', 750000, 'rekening_id', rek));
    select coalesce(sum(b.debit), 0) into x from public.jurnal_baris b join public.jurnal j on j.id = b.jurnal_id
      where j.sumber = 'servis_aset' and j.sumber_id = s1 and b.akun_id = public.akun_kode('6-5');
    e := null;
    begin perform public.simpan_servis_aset(null, jsonb_build_object('aset_id', a1, 'tanggal', make_date(y, 6, 10), 'uraian', 'Overhaul', 'biaya', 5000000,
      'rekening_id', rek, 'kapitalisasi', true, 'sisa_umur_bulan', 90)); exception when others then e := sqlerrm; end;
    s2 := public.simpan_servis_aset(null, jsonb_build_object('aset_id', a1, 'tanggal', make_date(y, 6, 10), 'uraian', 'Overhaul mesin', 'biaya', 18000000,
      'rekening_id', rek, 'kapitalisasi', true, 'sisa_umur_bulan', 90));
    select coalesce(sum(b.debit), 0) into z from public.jurnal_baris b join public.jurnal j on j.id = b.jurnal_id
      where j.sumber = 'servis_aset' and j.sumber_id = s2 and b.akun_id = public.akun_kode('1-7');
    -- Juli: (222 jt − 6 × 2.312.500 + 18 jt) ÷ 90 bulan.
    n := public.akumulasi_aset(a1, public.idx_bulan(make_date(y, 7, 1))) - public.akumulasi_aset(a1, public.idx_bulan(make_date(y, 6, 1)));
    h := h || jsonb_build_object('uji', 'Servis biasa ke 6-5; kapitalisasi di bawah batas ditolak; kapitalisasi menambah nilai aset dan menghitung ulang penyusutan', 'hasil',
      case when x = 750000 and e like 'Servis hanya bisa dikapitalisasi%' and z = 18000000 and n = round((222000000 - 6 * 2312500 + 18000000) / 90.0) then '✓' else '✗' end,
      'catatan', 'beban ' || x || ' · aset +' || z || ' · Juli ' || n);

    -- 10. Bulan yang ditutup melindungi data aset.
    insert into public.tutup_buku (bulan) values (date_trunc('month', jan)::date);
    e := null;
    begin perform public.simpan_aset(a7, jsonb_build_object('nama', 'UJI5 Server', 'kategori_id', k_kmp, 'tgl_perolehan', jan, 'harga', 25000000,
      'cara', 'tunai', 'rekening_id', rek, 'umur_bulan', 48)); exception when others then e := sqlerrm; end;
    perform public.simpan_aset(a7, jsonb_build_object('nama', 'UJI5 Server ruang rapat', 'kategori_id', k_kmp, 'tgl_perolehan', jan, 'harga', 24000000,
      'cara', 'tunai', 'rekening_id', rek, 'umur_bulan', 48, 'kondisi', 'Perlu servis'));
    select kondisi into r.kondisi from public.aset where id = a7;
    h := h || jsonb_build_object('uji', 'Bulan perolehan sudah ditutup: nilai tidak bisa diubah, tetapi nama / kondisi tetap bisa', 'hasil',
      case when e like 'Bulan % sudah ditutup%' and r.kondisi = 'Perlu servis' then '✓' else '✗' end, 'catatan', e);
    delete from public.tutup_buku;

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

revoke execute on function public.uji_tahap5() from public, anon, authenticated;

select * from public.uji_tahap5();
