const { createClient } = require('@supabase/supabase-js');

let supabase = null;

/**
 * Get or initialize Supabase client strictly from process.env credentials
 */
function getSupabaseClient() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_KEY ||
    process.env.SUPABASE_ANON_KEY;

  if (!supabase && supabaseUrl && supabaseKey) {
    try {
      supabase = createClient(supabaseUrl, supabaseKey, {
        auth: { persistSession: false }
      });
    } catch (e) {
      console.warn('[Supabase Client Init Warning]', e.message);
    }
  }
  return supabase;
}

module.exports = {
  getSupabaseClient
};
