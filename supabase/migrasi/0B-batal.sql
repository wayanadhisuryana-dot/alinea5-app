-- Alinea 5 — Pembatalan migrasi Tahap 0B.
-- Mengembalikan struktur database seperti sebelum 0B-perusahaan-id.sql.
-- Isi data TIDAK dihapus: hanya kolom perusahaan_id dan tabel perusahaan yang dilepas.
-- Tabel cadangan records_cadangan_0b sengaja DIBIARKAN (hapus manual bila sudah yakin).

alter table public.records alter column perusahaan_id drop default;
drop index if exists public.records_perusahaan_idx;
alter table public.records drop column if exists perusahaan_id;
drop function if exists public.perusahaan_tunggal();
drop table if exists public.perusahaan;

-- Pemeriksaan: jumlah data harus sama dengan sebelum migrasi.
select count(*) as jumlah_data from public.records;
