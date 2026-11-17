// Sambungan ke Supabase. Isi dua nilai di bawah dari Supabase: Project Settings > API.
// Selama keduanya kosong, aplikasi berjalan dalam MODE DEMO: data hanya disimpan di browser ini.
//
// Kunci "anon / publishable" memang dirancang untuk ditaruh di kode yang terbuka; yang melindungi
// data adalah login dan aturan Row Level Security di supabase/schema.sql.
// JANGAN PERNAH menaruh kunci "service_role" / "secret" di file ini.
export const SUPABASE_URL = 'https://mkawrfwkldeisuayaqzn.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_DHBPULPUg9OSaYFoiMk8nA_2XhhDQiK';
