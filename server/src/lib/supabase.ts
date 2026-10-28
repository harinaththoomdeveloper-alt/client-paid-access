import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import WebSocket from 'ws'
import { supabaseConfig } from '../config.js'

let client: SupabaseClient | undefined

// Service-role client: bypasses RLS, so it must only be used in server code
// and every query must scope rows to the authenticated client explicitly.
export function db(): SupabaseClient {
  if (!client) {
    const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = supabaseConfig()
    client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      // Node 20 has no global WebSocket, which supabase-js requires
      // (ws is runtime-compatible; its constructor typings differ slightly)
      realtime: { transport: WebSocket as never },
    })
  }
  return client
}

export const DOCUMENTS_BUCKET = 'documents'
