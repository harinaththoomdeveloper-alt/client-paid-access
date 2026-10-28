// One-time: exchanges a Zoho Self Client grant code for a refresh token and
// writes it into server/.env. The token is never printed.
// Usage: npm run zoho:exchange-code -- <grant code>
import { readFile, writeFile } from 'node:fs/promises'

const code = process.argv[2]
const { ZOHO_ACCOUNTS_URL, ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET } = process.env
if (!code) throw new Error('Usage: npm run zoho:exchange-code -- <grant code>')
if (!ZOHO_ACCOUNTS_URL || !ZOHO_CLIENT_ID || !ZOHO_CLIENT_SECRET) {
  throw new Error('Set ZOHO_ACCOUNTS_URL, ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET in server/.env first')
}

const res = await fetch(`${ZOHO_ACCOUNTS_URL}/oauth/v2/token`, {
  method: 'POST',
  body: new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: ZOHO_CLIENT_ID,
    client_secret: ZOHO_CLIENT_SECRET,
  }),
})
const json = (await res.json()) as { refresh_token?: string; api_domain?: string; error?: string }
if (!json.refresh_token) {
  throw new Error(`Zoho did not return a refresh token: ${json.error ?? `HTTP ${res.status}`} (grant codes expire after a few minutes and work once)`)
}

const envPath = new URL('../../.env', import.meta.url)
const env = await readFile(envPath, 'utf8')
const line = `ZOHO_REFRESH_TOKEN=${json.refresh_token}`
await writeFile(envPath, /^ZOHO_REFRESH_TOKEN=.*$/m.test(env) ? env.replace(/^ZOHO_REFRESH_TOKEN=.*$/m, line) : `${env}\n${line}\n`)

console.log('Refresh token saved to server/.env')
console.log(`Zoho API domain for this account: ${json.api_domain} (ZOHO_API_URL must match)`)
