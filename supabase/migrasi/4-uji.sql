-- Alinea 5 — Uji otomatis aturan database Tahap 4.
-- Jalankan SETELAH 4-proyek.sql. Fungsi ini mencoba kontrak vendor, opname, pembayaran vendor, pembelian, dan pinjaman
-- antar proyek memakai data uji, lalu MEMBATALKAN semua perubahan uji itu. Data asli tidak tersentuh.
-- Pakai:  select * from public.uji_tahap4();

create or replace function public.uji_tahap4()
returns table (no int, uji text, hasil text, catatan text)
language plpgsql security definer set search_path = ''
as $$
declare
  h jsonb := '[]'::jsonb;
  sa uuid;
  e text;
  hi date;
  rek uuid;
  ven uuid; sup uuid; kerja1 uuid; kerja2 uuid; b1 uuid; b2 uuid; b3 uuid;
  kid uuid; kv uuid; kp uuid; o1 uuid; o2 uuid; o3 uuid; o4 uuid; bv uuid; pb1 uuid; pb2 uuid; bs uuid; pj uuid; t uuid;
  i1 uuid; i2 uuid;
  n bigint; n2 bigint; d bigint; k bigint; x bigint; y bigint; z bigint; s0 bigint; s1 bigint; j0 bigint; j1 bigint;
begin
  begin
    select id into sa from public.profiles where super_admin and aktif limit 1;
    if sa is null then raise exception 'Belum ada super admin aktif.'; end if;
    perform set_config('request.jwt.claim.sub', sa::text, true);
    perform set_config('request.jwt.claims', jsonb_build_object('sub', sa, 'role', 'authenticated')::text, true);
    hi := public.hari_ini();

    insert into public.records (tabel, data) values ('proyek', '{"kode":"UJI4-A","nama":"Proyek uji A"}'), ('proyek', '{"kode":"UJI4-B","nama":"Proyek uji B"}');
    insert into public.rekening (nama, jenis, saldo_awal, tgl_saldo_awal) values ('UJI4 Giro', 'Giro', 500000000, hi - 400) returning id into rek;
    insert into public.records (tabel, data) values ('vendor_tukang', '{"nama":"UJI4 Tukang Kayu","jenis":"Tukang"}') returning id into ven;
    insert into public.records (tabel, data) values ('supplier', '{"nama":"UJI4 Toko Bangunan","pkp":true}') returning id into sup;
    insert into public.records (tabel, data) values ('barang', '{"nama":"UJI4 Kitchen set","jenis":"pekerjaan","satuan":"m"}') returning id into kerja1;
    insert into public.records (tabel, data) values ('barang', '{"nama":"UJI4 Plafon","jenis":"pekerjaan","satuan":"m2"}') returning id into kerja2;
    insert into public.records (tabel, data) values ('barang', '{"nama":"UJI4 Semen","jenis":"barang","satuan":"sak"}') returning id into b1;
    insert into public.records (tabel, data) values ('barang', '{"nama":"UJI4 Multipleks","jenis":"barang","satuan":"m2","konversi":[{"satuan":"lembar","faktor":2.9768}]}') returning id into b2;
    insert into public.records (tabel, data) values ('barang', '{"nama":"UJI4 Cat","jenis":"barang","satuan":"kaleng"}') returning id into b3;
    update public.perusahaan set data = data || jsonb_build_object('pkp', true, 'tgl_pkp', (hi - 400)::text) where id = public.perusahaan_tunggal();
    update public.akuntansi set batas_pinjam_titipan_persen = null;

    -- Dana titipan masuk ke proyek UJI4-B (kontrak klien turn-key, termin dibayar penuh).
    kid := public.simpan_kontrak(null, jsonb_build_object('proyek_kode', 'UJI4-B', 'no_kontrak', 'UJI4/KONTRAK/B', 'tanggal', hi - 90, 'nilai_jasa', 10000000,
      'nilai_titipan', 100000000, 'ppn', 'tidak', 'akun_pendapatan', '4-2'), jsonb_build_array(jsonb_build_object('jasa', 10000000, 'titipan', 100000000)));
    select id into t from public.termin where kontrak_id = kid and jenis = 'termin';
    perform public.terbitkan_invoice(t, hi - 80, hi - 70, rek);
    perform public.simpan_penerimaan(null, jsonb_build_object('termin_id', t, 'tanggal', hi - 75, 'jumlah', 110000000, 'rekening_id', rek));
    s0 := public.saldo_titipan_proyek('UJI4-B');

    -- 1. Kontrak volume 2 item; opname Draft tidak menambah hak; disetujui -> hak benar.
    kv := public.simpan_kontrak_vendor(null, jsonb_build_object('proyek_kode', 'UJI4-A', 'vendor_id', ven, 'tanggal', hi - 60, 'sumber_dana', 'perusahaan',
      'skema', 'volume', 'retensi_bp', 500, 'masa_retensi_hari', 30, 'no_spk', 'UJI4/SPK/01'),
      jsonb_build_array(jsonb_build_object('barang_id', kerja1, 'uraian', 'Kitchen set', 'satuan', 'm', 'volume', 10, 'harga', 100000),
                        jsonb_build_object('barang_id', kerja2, 'uraian', 'Plafon', 'satuan', 'm2', 'volume', 5, 'harga', 200000)), null);
    select id into i1 from public.kontrak_vendor_item where kontrak_id = kv and urut = 1;
    select id into i2 from public.kontrak_vendor_item where kontrak_id = kv and urut = 2;
    select count(*) into n from public.records where tabel = 'harga' and data ->> 'sumber_id' = kv::text;
    h := h || jsonb_build_object('uji', 'Kontrak volume: nilai = Σ volume × harga, item masuk riwayat Harga Pekerjaan', 'hasil',
      case when public.nilai_kontrak_vendor(kv) = 2000000 and n = 2 then '✓' else '✗' end, 'catatan', 'nilai ' || public.nilai_kontrak_vendor(kv) || ' · riwayat ' || n);
    o1 := public.simpan_opname(null, jsonb_build_object('kontrak_id', kv, 'tanggal', hi - 40, 'status', 'draft',
      'detail', jsonb_build_object('volume', jsonb_build_object(i1::text, 4, i2::text, 2))));
    select count(*) into n from public.jurnal where sumber = 'opname' and sumber_id = o1;
    select coalesce(sum(nilai), 0) into x from public.opname where kontrak_id = kv and status = 'disetujui';
    h := h || jsonb_build_object('uji', 'Opname Draft tidak menambah hak dan tidak membuat jurnal', 'hasil', case when n = 0 and x = 0 then '✓' else '✗' end, 'catatan', 'hak ' || x || ' · jurnal ' || n);
    perform public.simpan_opname(o1, jsonb_build_object('tanggal', hi - 40, 'status', 'disetujui', 'diperiksa_oleh', 'uji', 'diperiksa_nama', 'Pengawas uji',
      'detail', jsonb_build_object('volume', jsonb_build_object(i1::text, 4, i2::text, 2))));
    select coalesce(sum(b.debit) filter (where b.akun_id = public.akun_kode('5-2')), 0), coalesce(sum(b.kredit) filter (where b.akun_id = public.akun_kode('2-1')), 0),
           coalesce(sum(b.kredit) filter (where b.akun_id = public.akun_kode('2-2')), 0)
      into x, y, z from public.jurnal j join public.jurnal_baris b on b.jurnal_id = j.id where j.sumber = 'opname' and j.sumber_id = o1;
    h := h || jsonb_build_object('uji', 'Opname disetujui 4 m + 2 m² → hak Rp 800.000, retensi 5% ditahan; jurnal D 5-2 / K 2-1 + K 2-2', 'hasil',
      case when x = 800000 and y = 760000 and z = 40000 then '✓' else '✗' end, 'catatan', '5-2: ' || x || ' · 2-1: ' || y || ' · 2-2: ' || z);

    -- 2. Pembayaran dengan potongan pajak -> hutang 0; pencairan retensi belum boleh.
    bv := public.simpan_bayar_vendor(null, jsonb_build_object('kontrak_id', kv, 'tanggal', hi - 35, 'jumlah', 744800, 'potongan_pajak', 15200, 'rekening_id', rek));
    select coalesce(sum(b.debit) filter (where b.akun_id = public.akun_kode('2-1')), 0), coalesce(sum(b.kredit) filter (where b.akun_id = public.akun_rekening(rek)), 0),
           coalesce(sum(b.kredit) filter (where b.akun_id = public.akun_kode('2-6')), 0)
      into x, y, z from public.jurnal j join public.jurnal_baris b on b.jurnal_id = j.id where j.sumber = 'bayar_vendor' and j.sumber_id = bv;
    select (select sum(nilai - retensi) from public.opname where kontrak_id = kv and status = 'disetujui')
         - (select sum(jumlah + potongan_pajak) from public.pembayaran_vendor where kontrak_id = kv) into n;
    h := h || jsonb_build_object('uji', 'Bayar Rp 744.800 + PPh dipotong Rp 15.200 → hutang 0, retensi tetap Rp 40.000; jurnal D 2-1 / K Kas + K 2-6', 'hasil',
      case when x = 760000 and y = 744800 and z = 15200 and n = 0 then '✓' else '✗' end, 'catatan', 'hutang ' || n || ' · 2-1: ' || x || ' · kas: ' || y || ' · 2-6: ' || z);
    e := null;
    begin perform public.simpan_bayar_vendor(null, jsonb_build_object('kontrak_id', kv, 'jenis', 'retensi', 'tanggal', hi, 'jumlah', 40000, 'rekening_id', rek));
    exception when others then e := sqlerrm; end;
    h := h || jsonb_build_object('uji', 'Pencairan retensi ditolak sebelum masa retensi selesai', 'hasil', case when e is not null then '✓' else '✗' end, 'catatan', e);
    perform public.simpan_kontrak_vendor(kv, jsonb_build_object('proyek_kode', 'UJI4-A', 'vendor_id', ven, 'tanggal', hi - 60, 'sumber_dana', 'perusahaan',
      'skema', 'volume', 'retensi_bp', 500, 'masa_retensi_hari', 30, 'no_spk', 'UJI4/SPK/01', 'tgl_selesai', hi - 31), null, null);
    bv := public.simpan_bayar_vendor(null, jsonb_build_object('kontrak_id', kv, 'jenis', 'retensi', 'tanggal', hi, 'jumlah', 40000, 'rekening_id', rek));
    select coalesce(sum(b.debit) filter (where b.akun_id = public.akun_kode('2-2')), 0) into x
    from public.jurnal j join public.jurnal_baris b on b.jurnal_id = j.id where j.sumber = 'bayar_vendor' and j.sumber_id = bv;
    h := h || jsonb_build_object('uji', 'Pencairan retensi setelah masa retensi → D 2-2 Hutang Retensi', 'hasil', case when x = 40000 then '✓' else '✗' end, 'catatan', '2-2: ' || x);

    -- Skema persen: opname kumulatif 40% lalu 70% → nilai 40% dan 30%.
    kp := public.simpan_kontrak_vendor(null, jsonb_build_object('proyek_kode', 'UJI4-A', 'vendor_id', ven, 'tanggal', hi - 60, 'sumber_dana', 'perusahaan',
      'skema', 'persen', 'nilai', 10000000, 'retensi_bp', 0), null, null);
    o2 := public.simpan_opname(null, jsonb_build_object('kontrak_id', kp, 'tanggal', hi - 30, 'status', 'disetujui', 'diperiksa_oleh', 'uji', 'detail', '{"persen_bp":4000}'::jsonb));
    o3 := public.simpan_opname(null, jsonb_build_object('kontrak_id', kp, 'tanggal', hi - 20, 'status', 'disetujui', 'diperiksa_oleh', 'uji', 'detail', '{"persen_bp":7000}'::jsonb));
    select nilai into x from public.opname where id = o2; select nilai into y from public.opname where id = o3;
    h := h || jsonb_build_object('uji', 'Skema persentase: opname 40% lalu 70% → hak Rp 4 jt lalu Rp 3 jt', 'hasil', case when x = 4000000 and y = 3000000 then '✓' else '✗' end, 'catatan', x || ' · ' || y);
    e := null;
    begin perform public.hapus_opname(o2); exception when others then e := sqlerrm; end;
    h := h || jsonb_build_object('uji', 'Opname disetujui yang bukan terakhir tidak bisa dihapus', 'hasil', case when e is not null then '✓' else '✗' end, 'catatan', e);

    -- 3. Pembelian 3 barang dari dana titipan UJI4-B.
    select count(*) into j0 from public.records where tabel = 'harga' and data ->> 'barang_id' in (b1::text, b2::text, b3::text);
    pb1 := public.simpan_pembelian(null, jsonb_build_object('tanggal', hi - 10, 'supplier_id', sup, 'no_nota', 'UJI4-NOTA-1', 'tujuan', 'proyek', 'proyek_kode', 'UJI4-B',
      'sumber_dana', 'titipan', 'cara_bayar', 'tunai', 'rekening_id', rek, 'ppn', 0, 'ongkir', 50000),
      jsonb_build_array(jsonb_build_object('barang_id', b1, 'qty', 10, 'satuan', 'sak', 'harga', 65000),
                        jsonb_build_object('barang_id', b2, 'qty', 2, 'satuan', 'lembar', 'harga', 250000, 'diskon', 20000),
                        jsonb_build_object('barang_id', b3, 'qty', 1.5, 'satuan', 'kaleng', 'harga', 120000)));
    select count(*) into j1 from public.records where tabel = 'harga' and data ->> 'barang_id' in (b1::text, b2::text, b3::text);
    select total into n from public.pembelian where id = pb1;
    select coalesce(sum(b.debit) filter (where b.akun_id = public.akun_kode('2-4')), 0), coalesce(sum(b.debit) filter (where b.akun_id = public.akun_kode('5-1')), 0)
      into x, y from public.jurnal j join public.jurnal_baris b on b.jurnal_id = j.id where j.sumber = 'pembelian' and j.sumber_id = pb1;
    s1 := public.saldo_titipan_proyek('UJI4-B');
    h := h || jsonb_build_object('uji', 'Pembelian 3 barang dari titipan: riwayat harga +3, saldo titipan berkurang, jurnal mengurangi 2-4 (bukan beban 5-1)', 'hasil',
      case when n = 650000 + 480000 + 180000 + 50000 and j1 - j0 = 3 and s0 - s1 = n and x = n and y = 0 then '✓' else '✗' end,
      'catatan', 'total ' || n || ' · riwayat +' || (j1 - j0) || ' · titipan ' || s0 || '→' || s1 || ' · 2-4: ' || x || ' · 5-1: ' || y);

    -- 4. Pembelian tempo -> Hutang Supplier; pembayaran melunasi. PPN dikreditkan (perusahaan & supplier PKP).
    pb2 := public.simpan_pembelian(null, jsonb_build_object('tanggal', hi - 10, 'supplier_id', sup, 'no_nota', 'UJI4-NOTA-2', 'tujuan', 'proyek', 'proyek_kode', 'UJI4-A',
      'sumber_dana', 'perusahaan', 'cara_bayar', 'tempo', 'jatuh_tempo', hi + 20, 'ppn', 110000, 'ppn_kredit', true),
      jsonb_build_array(jsonb_build_object('barang_id', b1, 'qty', 20, 'satuan', 'sak', 'harga', 50000)));
    select coalesce(sum(b.kredit) filter (where b.akun_id = public.akun_kode('2-3')), 0), coalesce(sum(b.debit) filter (where b.akun_id = public.akun_kode('1-4')), 0),
           coalesce(sum(b.debit) filter (where b.akun_id = public.akun_kode('5-1')), 0)
      into x, y, z from public.jurnal j join public.jurnal_baris b on b.jurnal_id = j.id where j.sumber = 'pembelian' and j.sumber_id = pb2;
    h := h || jsonb_build_object('uji', 'Pembelian tempo → K 2-3 Hutang Supplier; PPN masukan ke 1-4', 'hasil', case when x = 1110000 and y = 110000 and z = 1000000 then '✓' else '✗' end,
      'catatan', '2-3: ' || x || ' · 1-4: ' || y || ' · 5-1: ' || z);
    bs := public.simpan_bayar_supplier(null, jsonb_build_object('pembelian_id', pb2, 'tanggal', hi - 5, 'jumlah', 1110000, 'rekening_id', rek));
    select coalesce(sum(b.kredit - b.debit), 0) into x from public.jurnal j join public.jurnal_baris b on b.jurnal_id = j.id
    where j.sumber in ('pembelian', 'bayar_supplier') and j.sumber_id in (pb2, bs) and b.akun_id = public.akun_kode('2-3');
    h := h || jsonb_build_object('uji', 'Pembayaran hutang supplier melunasi (saldo 2-3 pembelian ini = 0)', 'hasil', case when x = 0 then '✓' else '✗' end, 'catatan', 'saldo 2-3: ' || x);
    e := null;
    begin perform public.simpan_bayar_supplier(null, jsonb_build_object('pembelian_id', pb2, 'tanggal', hi, 'jumlah', 1, 'rekening_id', rek)); exception when others then e := sqlerrm; end;
    h := h || jsonb_build_object('uji', 'Bayar melebihi sisa hutang supplier ditolak', 'hasil', case when e is not null then '✓' else '✗' end, 'catatan', e);

    -- 5. Pinjaman Rp 30 jt dari UJI4-B ke UJI4-A: tanpa jurnal, saldo titipan pemberi berkurang.
    select count(*) into j0 from public.jurnal;
    s0 := public.saldo_titipan_proyek('UJI4-B');
    pj := public.simpan_pinjaman(null, jsonb_build_object('tanggal', hi - 3, 'dari_proyek', 'UJI4-B', 'ke_proyek', 'UJI4-A', 'jumlah', 30000000,
      'alasan', 'Uji', 'rencana_kembali', hi + 30, 'disetujui_oleh', 'Pemilik'));
    select count(*) into j1 from public.jurnal;
    s1 := public.saldo_titipan_proyek('UJI4-B');
    h := h || jsonb_build_object('uji', 'Pinjaman Rp 30 jt: tidak ada jurnal, saldo titipan pemberi berkurang Rp 30 jt', 'hasil', case when j1 = j0 and s0 - s1 = 30000000 then '✓' else '✗' end,
      'catatan', 'jurnal ' || j0 || '→' || j1 || ' · titipan ' || s0 || '→' || s1);
    update public.akuntansi set batas_pinjam_titipan_persen = 10;
    e := null;
    begin perform public.simpan_pinjaman(null, jsonb_build_object('tanggal', hi - 3, 'dari_proyek', 'UJI4-B', 'ke_proyek', 'UJI4-A', 'jumlah', 30000000,
      'alasan', 'Uji', 'rencana_kembali', hi + 30, 'disetujui_oleh', 'Pemilik')); exception when others then e := sqlerrm; end;
    perform public.simpan_pinjaman(null, jsonb_build_object('tanggal', hi - 3, 'dari_proyek', 'UJI4-B', 'ke_proyek', 'UJI4-A', 'jumlah', 30000000,
      'alasan', 'Uji', 'rencana_kembali', hi + 30, 'disetujui_oleh', 'Pemilik', 'konfirmasi_pemilik', true));
    h := h || jsonb_build_object('uji', 'Batas pinjaman 10% saldo titipan: melebihi ditolak tanpa konfirmasi pemilik, diterima dengan konfirmasi', 'hasil',
      case when e like 'Pinjaman melebihi batas%' then '✓' else '✗' end, 'catatan', e);
    perform public.simpan_pengembalian(null, jsonb_build_object('pinjaman_id', pj, 'tanggal', hi, 'jumlah', 10000000));
    e := null;
    begin perform public.simpan_pengembalian(null, jsonb_build_object('pinjaman_id', pj, 'tanggal', hi, 'jumlah', 25000000)); exception when others then e := sqlerrm; end;
    h := h || jsonb_build_object('uji', 'Pengembalian melebihi sisa pinjaman ditolak', 'hasil', case when e is not null then '✓' else '✗' end, 'catatan', e);

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

revoke execute on function public.uji_tahap4() from public, anon, authenticated;

select * from public.uji_tahap4();
