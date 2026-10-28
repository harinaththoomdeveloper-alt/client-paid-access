type Tone = 'success' | 'warning' | 'danger' | 'neutral'

export function StatusBadge({ tone, children }: { tone: Tone; children: string }) {
  return <span className={`badge badge-${tone}`}>{children}</span>
}
