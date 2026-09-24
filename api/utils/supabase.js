const { createClient } = require('@supabase/supabase-js');

let supabase = null;

/**
 * Get or initialize Supabase client
 */
function getSupabaseClient() {
  if (!supabase && process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY)) {
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY,
      { auth: { persistSession: false } }
    );
  }
  return supabase;
}

module.exports = {
  getSupabaseClient
};
