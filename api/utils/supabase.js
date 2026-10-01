const { createClient } = require('@supabase/supabase-js');

let supabase = null;

/**
 * Get or initialize Supabase client strictly from process.env credentials
 */
function getSupabaseClient() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

  if (!supabase && supabaseUrl && supabaseServiceKey) {
    try {
      supabase = createClient(supabaseUrl, supabaseServiceKey, {
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
