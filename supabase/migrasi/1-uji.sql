-- Alinea 5 — Uji otomatis aturan database Tahap 1.
-- Jalankan SETELAH 1-fondasi.sql. Fungsi ini mencoba semua aturan keuangan memakai data uji,
-- lalu MEMBATALKAN semua perubahan uji itu. Data asli tidak tersentuh.
-- Pakai:  select * from public.uji_tahap1();

create or replace function public.uji_periksa()
returns void language plpgsql set search_path = ''
as $$
begin
  set constraints all immediate;
  set constraints all deferred;
end $$;

create or replace function public.uji_saldo(rid uuid)
returns bigint language sql stable set search_path = ''
as $$ select coalesce(sum(debit - kredit), 0)::bigint from public.jurnal_baris where akun_id = public.akun_rekening(rid) $$;

create or replace function public.uji_tahap1()
returns table (no int, uji text, hasil text, catatan text)
language plpgsql security definer set search_path = ''
as $$
declare
  h jsonb := '[]'::jsonb;
  sa uuid;
  hi date;
  bl date;
  bca uuid; mdr uuid; tunai uuid;
  kas_id uuid; tr_id uuid; jm uuid; sub uuid;
  e text;
  n bigint; d bigint; k bigint;
  kode_sub text;
begin
  begin
    select id into sa from public.profiles where super_admin and aktif limit 1;
    if sa is null then raise exception 'Belum ada super admin aktif.'; end if;
    perform set_config('request.jwt.claim.sub', sa::text, true);
    perform set_config('request.jwt.claims', jsonb_build_object('sub', sa, 'role', 'authenticated')::text, true);
    hi := public.hari_ini();
    bl := (date_trunc('month', hi) - interval '1 month')::date;

    -- 1. Bagan akun standar
    select count(*) into n from public.akun where standar;
    h := h || jsonb_build_object('uji', 'Bagan akun standar lengkap (48 akun) + 3-2-01 Ekuitas saldo awal',
      'hasil', case when n = 48 and public.akun_kode('3-2-01') is not null then '✓' else '✗' end, 'catatan', n || ' akun standar');

    e := null;
    begin delete from public.akun where kode = '6-3'; exception when others then e := sqlerrm; end;
    h := h || jsonb_build_object('uji', 'Akun standar tidak bisa dihapus', 'hasil', case when e is not null then '✓' else '✗' end, 'catatan', e);

    e := null;
    begin update public.akun set kode = '6-30' where kode = '6-3'; exception when others then e := sqlerrm; end;
    h := h || jsonb_build_object('uji', 'Kode akun standar tidak bisa diubah', 'hasil', case when e is not null then '✓' else '✗' end, 'catatan', e);

    insert into public.akun (kode, nama, induk_id, golongan) values ('', 'Listrik kantor', public.akun_kode('6-3'), 6) returning id, kode into sub, kode_sub;
    h := h || jsonb_build_object('uji', 'Sub-akun di bawah 6-3 mendapat kode otomatis', 'hasil', case when kode_sub = '6-3-01' then '✓' else '✗' end, 'catatan', kode_sub);

    e := null;
    begin insert into public.akun (kode, nama, golongan) values ('9-9', 'Akun liar', 6); exception when others then e := sqlerrm; end;
    h := h || jsonb_build_object('uji', 'Akun baru tanpa induk ditolak', 'hasil', case when e is not null then '✓' else '✗' end, 'catatan', e);

    e := null;
    begin insert into public.akun (kode, nama, induk_id, golongan) values ('', 'Kas liar', public.akun_kode('1-1'), 1); exception when others then e := sqlerrm; end;
    h := h || jsonb_build_object('uji', 'Sub-akun Kas dan Setara Kas hanya lewat rekening', 'hasil', case when e is not null then '✓' else '✗' end, 'catatan', e);

    -- 2. Rekening -> sub-akun 1-1 + jurnal saldo awal
    insert into public.rekening (nama, bank, no_rekening, atas_nama, jenis, saldo_awal, tgl_saldo_awal, di_invoice, utama_invoice)
      values ('UJI BCA Giro', 'BCA', '0123456789', 'PT Uji', 'Giro', 10000000, bl, true, true) returning id into bca;
    insert into public.rekening (nama, bank, no_rekening, atas_nama, jenis, saldo_awal, tgl_saldo_awal)
      values ('UJI Mandiri Tabungan', 'Mandiri', '9876543210', 'PT Uji', 'Tabungan', 5000000, bl) returning id into mdr;
    insert into public.rekening (nama, jenis, saldo_awal, tgl_saldo_awal) values ('UJI Kas kecil', 'Kas tunai', 1000000, bl) returning id into tunai;
    perform public.uji_periksa();
    select count(*) into n from public.akun a where a.rekening_id in (bca, mdr, tunai) and a.induk_id = public.akun_kode('1-1') and a.kode like '1-1-%';
    h := h || jsonb_build_object('uji', '2 rekening + 1 kas tunai menjadi sub-akun Kas dan Setara Kas', 'hasil', case when n = 3 then '✓' else '✗' end,
      'catatan', (select string_agg(kode || ' ' || nama, ', ' order by kode) from public.akun where rekening_id in (bca, mdr, tunai)));

    select coalesce(sum(b.debit), 0), coalesce(sum(b.kredit), 0) into d, k
    from public.jurnal j join public.jurnal_baris b on b.jurnal_id = j.id where j.sumber = 'saldo_awal' and j.sumber_id in (bca, mdr, tunai);
    select coalesce(sum(b.kredit), 0) into n from public.jurnal j join public.jurnal_baris b on b.jurnal_id = j.id
    where j.sumber = 'saldo_awal' and j.sumber_id in (bca, mdr, tunai) and b.akun_id = public.akun_kode('3-2-01');
    h := h || jsonb_build_object('uji', 'Saldo awal dijurnal: D rekening / K 3-2-01 Ekuitas saldo awal', 'hasil',
      case when d = 16000000 and k = 16000000 and n = 16000000 then '✓' else '✗' end, 'catatan', 'debit ' || d || ', kredit ' || k);

    e := null;
    begin update public.rekening set di_invoice = true, utama_invoice = true where id = mdr; exception when others then e := sqlerrm; end;
    h := h || jsonb_build_object('uji', 'Rekening utama invoice hanya boleh satu', 'hasil', case when e is not null then '✓' else '✗' end, 'catatan', e);

    -- 3. Kas umum: listrik Rp 500.000
    insert into public.kas_transaksi (tanggal, jenis, rekening_id, akun_id, jumlah, uraian)
      values (hi, 'keluar', bca, public.akun_kode('6-3'), 500000, 'Bayar listrik kantor') returning id into kas_id;
    perform public.uji_periksa();
    select coalesce(sum(b.debit) filter (where b.akun_id = public.akun_kode('6-3')), 0),
           coalesce(sum(b.kredit) filter (where b.akun_id = public.akun_rekening(bca)), 0) into d, k
    from public.jurnal j join public.jurnal_baris b on b.jurnal_id = j.id where j.sumber = 'kas' and j.sumber_id = kas_id;
    h := h || jsonb_build_object('uji', 'Listrik Rp 500.000: saldo BCA turun, jurnal D 6-3 Listrik / K BCA seimbang', 'hasil',
      case when public.uji_saldo(bca) = 9500000 and d = 500000 and k = 500000 then '✓' else '✗' end, 'catatan', 'saldo BCA ' || public.uji_saldo(bca));

    update public.kas_transaksi set jumlah = 600000 where id = kas_id;
    perform public.uji_periksa();
    select count(*), coalesce(sum(b.debit), 0) into n, d from public.jurnal j join public.jurnal_baris b on b.jurnal_id = j.id
    where j.sumber = 'kas' and j.sumber_id = kas_id;
    h := h || jsonb_build_object('uji', 'Mengubah transaksi sumber ikut memperbarui jurnalnya', 'hasil',
      case when n = 2 and d = 600000 and public.uji_saldo(bca) = 9400000 then '✓' else '✗' end, 'catatan', 'jurnal ' || d);
    update public.kas_transaksi set jumlah = 500000 where id = kas_id;

    e := null;
    begin
      insert into public.kas_transaksi (tanggal, jenis, rekening_id, akun_id, jumlah, uraian)
        values (hi, 'keluar', bca, public.akun_rekening(mdr), 100, 'Salah: pindah rekening');
    exception when others then e := sqlerrm; end;
    h := h || jsonb_build_object('uji', 'Pindah uang antar rekening tidak bisa lewat kas umum', 'hasil', case when e is not null then '✓' else '✗' end, 'catatan', e);

    -- 4. Transfer antar rekening dengan biaya admin
    insert into public.transfer (tanggal, dari_rekening, ke_rekening, jumlah, biaya_admin)
      values (hi, bca, mdr, 2000000, 6500) returning id into tr_id;
    perform public.uji_periksa();
    select count(*) filter (where a.golongan = 4), coalesce(sum(b.debit) filter (where a.golongan in (5, 6, 7)), 0) into n, d
    from public.jurnal j join public.jurnal_baris b on b.jurnal_id = j.id join public.akun a on a.id = b.akun_id
    where j.sumber = 'transfer' and j.sumber_id = tr_id;
    h := h || jsonb_build_object('uji', 'Transfer: kedua saldo benar, tidak ada pendapatan/beban kecuali biaya admin', 'hasil',
      case when public.uji_saldo(bca) = 7493500 and public.uji_saldo(mdr) = 7000000 and n = 0 and d = 6500 then '✓' else '✗' end,
      'catatan', 'BCA ' || public.uji_saldo(bca) || ', Mandiri ' || public.uji_saldo(mdr) || ', beban ' || d);

    -- 5. Jurnal manual
    e := null;
    begin
      perform public.simpan_jurnal_manual(null, hi, 'Jurnal tidak seimbang', jsonb_build_array(
        jsonb_build_object('akun_id', public.akun_kode('6-8'), 'debit', 100000),
        jsonb_build_object('akun_id', public.akun_kode('3-1'), 'kredit', 90000)));
      perform public.uji_periksa();
    exception when others then e := sqlerrm; end;
    h := h || jsonb_build_object('uji', 'Jurnal manual tidak seimbang ditolak', 'hasil', case when e is not null then '✓' else '✗' end, 'catatan', e);

    e := null;
    begin
      perform public.simpan_jurnal_manual(null, hi, '  ', jsonb_build_array(
        jsonb_build_object('akun_id', public.akun_kode('6-8'), 'debit', 1000),
        jsonb_build_object('akun_id', public.akun_kode('3-1'), 'kredit', 1000)));
    exception when others then e := sqlerrm; end;
    h := h || jsonb_build_object('uji', 'Jurnal manual tanpa uraian ditolak', 'hasil', case when e is not null then '✓' else '✗' end, 'catatan', e);

    jm := public.simpan_jurnal_manual(null, hi, 'Koreksi biaya administrasi', jsonb_build_array(
      jsonb_build_object('akun_id', public.akun_kode('6-8'), 'debit', 25000),
      jsonb_build_object('akun_id', public.akun_kode('3-1'), 'kredit', 25000)));
    perform public.uji_periksa();
    h := h || jsonb_build_object('uji', 'Jurnal manual seimbang diterima', 'hasil', case when jm is not null then '✓' else '✗' end, 'catatan', null);

    e := null;
    begin
      perform public.simpan_jurnal_manual((select id from public.jurnal where sumber = 'kas' and sumber_id = kas_id), hi, 'Ubah paksa',
        jsonb_build_array(jsonb_build_object('akun_id', public.akun_kode('6-8'), 'debit', 1), jsonb_build_object('akun_id', public.akun_kode('3-1'), 'kredit', 1)));
    exception when others then e := sqlerrm; end;
    h := h || jsonb_build_object('uji', 'Jurnal otomatis tidak bisa diubah langsung', 'hasil', case when e is not null then '✓' else '✗' end, 'catatan', e);

    e := null;
    begin delete from public.rekening where id = bca; exception when others then e := sqlerrm; end;
    h := h || jsonb_build_object('uji', 'Rekening yang sudah dipakai transaksi tidak bisa dihapus', 'hasil', case when e is not null then '✓' else '✗' end, 'catatan', e);

    -- 6. Tutup buku bulan lalu
    e := null;
    begin perform public.tutup_bulan(hi); exception when others then e := sqlerrm; end;
    h := h || jsonb_build_object('uji', 'Bulan berjalan belum bisa ditutup', 'hasil', case when e is not null then '✓' else '✗' end, 'catatan', e);

    perform public.tutup_bulan(bl);
    e := null;
    begin
      insert into public.kas_transaksi (tanggal, jenis, rekening_id, akun_id, jumlah, uraian)
        values (bl + 5, 'keluar', bca, public.akun_kode('6-8'), 10000, 'Transaksi bulan lalu');
    exception when others then e := sqlerrm; end;
    h := h || jsonb_build_object('uji', 'Setelah tutup buku: transaksi baru di bulan lalu ditolak', 'hasil', case when e is not null then '✓' else '✗' end, 'catatan', e);

    e := null;
    begin update public.rekening set saldo_awal = 11000000 where id = bca; exception when others then e := sqlerrm; end;
    h := h || jsonb_build_object('uji', 'Setelah tutup buku: saldo awal bertanggal bulan lalu tidak bisa diubah', 'hasil', case when e is not null then '✓' else '✗' end, 'catatan', e);

    e := null;
    begin update public.kas_transaksi set tanggal = bl + 3 where id = kas_id; exception when others then e := sqlerrm; end;
    h := h || jsonb_build_object('uji', 'Setelah tutup buku: transaksi tidak bisa dipindah ke bulan lalu', 'hasil', case when e is not null then '✓' else '✗' end, 'catatan', e);

    e := null;
    begin update public.kas_transaksi set uraian = 'Listrik kantor November' where id = kas_id; exception when others then e := sqlerrm; end;
    h := h || jsonb_build_object('uji', 'Transaksi bulan berjalan tetap bisa diubah', 'hasil', case when e is null then '✓' else '✗' end, 'catatan', e);

    e := null;
    begin perform public.buka_bulan(bl, ''); exception when others then e := sqlerrm; end;
    h := h || jsonb_build_object('uji', 'Membuka kembali buku wajib dengan alasan', 'hasil', case when e is not null then '✓' else '✗' end, 'catatan', e);

    perform public.buka_bulan(bl, 'Uji: koreksi saldo awal');
    update public.rekening set saldo_awal = 11000000 where id = bca;
    perform public.uji_periksa();
    select count(*) into n from public.tutup_buku_riwayat where bulan = bl and aksi = 'buka' and alasan = 'Uji: koreksi saldo awal';
    h := h || jsonb_build_object('uji', 'Super admin membuka kembali buku; alasan tercatat; data bisa dikoreksi', 'hasil',
      case when n = 1 and public.uji_saldo(bca) = 8493500 then '✓' else '✗' end, 'catatan', 'saldo BCA ' || public.uji_saldo(bca));

    -- 7. Audit log
    select count(*) into n from public.audit_log where tabel = 'kas_transaksi' and baris_id = kas_id::text and aksi = 'update'
      and (lama ->> 'jumlah') = '500000' and (baru ->> 'jumlah') = '600000';
    h := h || jsonb_build_object('uji', 'Audit log mencatat siapa, kapan, nilai lama → baru', 'hasil', case when n = 1 then '✓' else '✗' end,
      'catatan', (select email from public.audit_log where tabel = 'kas_transaksi' and baris_id = kas_id::text limit 1));

    -- 8. Seluruh buku seimbang
    select coalesce(sum(debit), 0), coalesce(sum(kredit), 0) into d, k from public.jurnal_baris;
    h := h || jsonb_build_object('uji', 'Total debit = total kredit di seluruh jurnal', 'hasil', case when d = k then '✓' else '✗' end, 'catatan', d || ' = ' || k);

    -- 9. Basis akuntansi
    e := null;
    begin
      update public.akuntansi set bulan_awal_buku = case when extract(month from hi) = 1 then 2 else 1 end;
      update public.akuntansi set basis = case when basis = 'kas' then 'akrual' else 'kas' end;
    exception when others then e := sqlerrm; end;
    h := h || jsonb_build_object('uji', 'Basis kas/akrual tidak bisa diubah di tengah periode', 'hasil', case when e is not null then '✓' else '✗' end, 'catatan', e);

    h := h || jsonb_build_object('uji', 'Hak akses super admin: semua menu Ubah', 'hasil',
      case when public.hak('jurnal') = 'ubah' and public.khusus('tutup_buku') then '✓' else '✗' end, 'catatan', null);

    raise exception 'uji_selesai';
  exception when others then
    if sqlerrm <> 'uji_selesai' then
      h := h || jsonb_build_object('uji', 'GALAT tak terduga (uji berhenti)', 'hasil', '✗', 'catatan', sqlerrm);
    end if;
  end;
  return query select (row_number() over ())::int, x ->> 'uji', x ->> 'hasil', x ->> 'catatan' from jsonb_array_elements(h) x;
end $$;

revoke execute on function public.uji_tahap1(), public.uji_periksa(), public.uji_saldo(uuid) from public, anon, authenticated;

select * from public.uji_tahap1();
