import { useCallback, useEffect, useState } from 'react'
import { portalService } from '../services'
import type { PortalDocument } from '../types'

// Loads the signed-in client's documents. Re-polls every `pollMs` while
// `shouldPoll` returns true (e.g. waiting for the webhook or a CRM sync).
export function useDocuments(pollMs = 3000, shouldPoll: (docs: PortalDocument[]) => boolean = () => false) {
  const [docs, setDocs] = useState<PortalDocument[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setDocs(await portalService.getDocuments())
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const polling = docs !== null && shouldPoll(docs)
  useEffect(() => {
    if (!polling) return
    const id = setInterval(load, pollMs)
    return () => clearInterval(id)
  }, [polling, pollMs, load])

  return { docs, error, reload: load }
}
