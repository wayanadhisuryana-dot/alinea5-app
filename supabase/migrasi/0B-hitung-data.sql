-- Alinea 5 — hitung jumlah data per tabel.
-- Jalankan SEBELUM dan SESUDAH migrasi; kedua hasilnya harus sama persis.
select tabel, count(*) as jumlah
from public.records
group by tabel
union all
select '— TOTAL —', count(*) from public.records
order by tabel;
