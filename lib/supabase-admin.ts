import 'server-only'

import { createClient } from '@supabase/supabase-js'

let cachedClient: ReturnType<typeof createClient> | null = null

export function getSupabaseAdmin() {
  if (cachedClient) {
    return cachedClient
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is required.')
  }

  if (!supabaseServiceRoleKey) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is required for uploading files to Supabase Storage.'
    )
  }

  cachedClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })

  return cachedClient
}
