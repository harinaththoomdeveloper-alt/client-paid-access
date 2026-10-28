// Creates the test clients (Supabase Auth users + clients rows), the sample
// document rows and uploads their files to the private bucket. Re-runnable.
// Usage: npm run seed
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { SEED_CLIENTS, SEED_DOCUMENTS } from '../../seed/seed-data.js'
import { DOCUMENTS_BUCKET, db } from '../lib/supabase.js'

const password = process.env.SEED_TEST_PASSWORD
if (!password || password.length < 6) {
  throw new Error('Set SEED_TEST_PASSWORD (6+ characters) in server/.env before seeding')
}

async function findUserIdByEmail(email: string): Promise<string | null> {
  for (let page = 1; ; page++) {
    const { data, error } = await db().auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw error
    const user = data.users.find((u) => u.email === email)
    if (user) return user.id
    if (data.users.length < 200) return null
  }
}

for (const c of SEED_CLIENTS) {
  if (!/^\d+$/.test(c.zohoAccountId)) throw new Error(`Fill in the Zoho account id for ${c.email} in server/seed/seed-data.ts`)

  let userId = await findUserIdByEmail(c.email)
  if (!userId) {
    const { data, error } = await db().auth.admin.createUser({ email: c.email, password, email_confirm: true })
    if (error) throw error
    userId = data.user.id
  } else {
    const { error } = await db().auth.admin.updateUserById(userId, { password })
    if (error) throw error
  }

  const { error } = await db()
    .from('clients')
    .upsert({ id: userId, email: c.email, full_name: c.fullName, zoho_account_id: c.zohoAccountId })
  if (error) throw error
  console.log(`client ready: ${c.email} → Zoho account ${c.zohoAccountId}`)
}

for (const d of SEED_DOCUMENTS) {
  const { error: docErr } = await db().from('documents').upsert({
    id: d.id,
    title: d.title,
    description: d.description,
    price_cents: d.priceCents,
    currency: d.currency,
    storage_path: d.storagePath,
  })
  if (docErr) throw docErr

  const file = await readFile(fileURLToPath(new URL(`../../seed/${d.localFile}`, import.meta.url)))
  const { error: upErr } = await db()
    .storage.from(DOCUMENTS_BUCKET)
    .upload(d.storagePath, file, { contentType: 'text/plain; charset=utf-8', upsert: true })
  if (upErr) throw upErr
  console.log(`document ready: "${d.title}" $${(d.priceCents / 100).toFixed(2)} (${d.id})`)
}
