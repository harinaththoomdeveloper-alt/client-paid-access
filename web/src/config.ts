const env = import.meta.env

export const config = {
  useMock: env.VITE_USE_MOCK === 'true',
  supabaseUrl: env.VITE_SUPABASE_URL as string | undefined,
  supabaseAnonKey: env.VITE_SUPABASE_ANON_KEY as string | undefined,
  apiUrl: (env.VITE_API_URL as string | undefined) ?? 'http://localhost:4000',
  mockZohoFails: env.VITE_MOCK_ZOHO_FAIL === 'true',
}
