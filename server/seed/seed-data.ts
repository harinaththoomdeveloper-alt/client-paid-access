// Test data only. Passwords are not stored here: the seed uses
// SEED_TEST_PASSWORD from server/.env for all test clients.

// zohoAccountId: the client's Zoho CRM Account; one Deal is created under it per purchase.
export const SEED_CLIENTS = [
  { email: 'demo@test.com', fullName: 'Demo Client', zohoAccountId: '1487951000000480618' },
  { email: 'client-b@test.com', fullName: 'Client B', zohoAccountId: '1487951000000480628' },
]

// Fixed ids so re-running the seed updates instead of duplicating
export const SEED_DOCUMENTS = [
  {
    id: '7d0c6a3e-5b1f-4c2a-9e8d-1f2a3b4c5d6e',
    title: 'Sample Document',
    description: 'Paid sample document, unlocked after a successful Stripe test payment.',
    priceCents: 4900,
    currency: 'usd',
    storagePath: 'sample-document.txt',
    localFile: 'sample-document.txt',
  },
  {
    id: '2b8f4c1d-6e3a-4f7b-9c2d-8a1e5f3b7c90',
    title: 'Market Report 2026',
    description: 'Sample industry report for testing a second purchase.',
    priceCents: 1900,
    currency: 'usd',
    storagePath: 'market-report-2026.txt',
    localFile: 'market-report-2026.txt',
  },
  {
    id: '9e4a7b2c-3d1f-4a8e-b6c5-0f2d9e8a1b34',
    title: 'Integration Playbook',
    description: 'Sample premium guide for testing a higher-priced purchase.',
    priceCents: 9900,
    currency: 'usd',
    storagePath: 'integration-playbook.txt',
    localFile: 'integration-playbook.txt',
  },
]
