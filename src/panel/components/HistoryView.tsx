import { useState, useEffect } from 'react'
import { getIndex, deleteEntry, clearAll } from '../../lib/storage'

interface IndexEntry {
  id: string
  url: string
  title: string
  domain: string
  timestamp: number
}

interface Props {
  onBack: () => void
  onRestore: (id: string) => void
}

export default function HistoryView({ onBack, onRestore }: Props) {
  const [entries, setEntries] = useState<IndexEntry[]>([])
  const [confirmClear, setConfirmClear] = useState(false)

  useEffect(() => {
    getIndex().then(setEntries)
  }, [])

  const handleDelete = async (id: string) => {
    await deleteEntry(id)
    setEntries(prev => prev.filter(e => e.id !== id))
  }

  const handleClearAll = async () => {
    if (!confirmClear) {
      setConfirmClear(true)
      return
    }
    await clearAll()
    setEntries([])
    setConfirmClear(false)
  }

  const relativeTime = (ts: number) => {
    const diff = Date.now() - ts
    const mins = Math.floor(diff / 60_000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    const days = Math.floor(hrs / 24)
    if (days === 1) return 'Yesterday'
    if (days < 7) return `${days}d ago`
    return new Date(ts).toLocaleDateString()
  }

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-st-border shrink-0">
        <div className="flex items-center gap-1">
          <button
            onClick={onBack}
            className="w-7 h-7 flex items-center justify-center rounded-md text-st-text-tertiary hover:text-st-text-secondary hover:bg-st-bg-surface transition-colors -ml-1"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <span className="text-[13px] font-semibold">History</span>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'thin', scrollbarColor: '#E4E4E3 transparent' }}>
        {entries.length === 0 && (
          <div className="flex items-center justify-center h-full text-[13px] text-st-text-tertiary">
            Nothing saved yet
          </div>
        )}

        <div className="px-4">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className="group flex items-start py-3 border-b border-st-border-light cursor-pointer hover:bg-st-accent-faint -mx-4 px-4 transition-colors"
              onClick={() => onRestore(entry.id)}
            >
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium text-st-text-primary truncate mb-0.5">
                  {entry.title}
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-st-text-tertiary">
                  <span>{entry.domain}</span>
                  <span className="w-[3px] h-[3px] rounded-full bg-st-text-tertiary opacity-50" />
                  <span>{relativeTime(entry.timestamp)}</span>
                </div>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); handleDelete(entry.id) }}
                className="w-6 h-6 flex items-center justify-center rounded text-st-text-tertiary hover:text-st-error hover:bg-st-error-bg transition-all opacity-0 group-hover:opacity-100 shrink-0 mt-0.5"
                title="Delete"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      {entries.length > 0 && (
        <div className="px-4 py-3 border-t border-st-border text-center shrink-0">
          <button
            onClick={handleClearAll}
            className="text-[12px] font-medium text-st-text-tertiary hover:text-st-error transition-colors"
          >
            {confirmClear ? 'Clear everything?' : 'Clear history'}
          </button>
        </div>
      )}
    </>
  )
}
