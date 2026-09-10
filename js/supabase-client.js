// ====== CONFIG ======
const SUPABASE_URL = "https://vymgetntxoedcnrsnlhx.supabase.co";
const SUPABASE_KEY = "sb_publishable_n77TAliMjWJBrsnMiFWTPA_ooLzPd1l";
// =====================

// `window.supabase` comes from the CDN <script> tag loaded in index.html
// before this module runs.
export const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
