// Steeped — Local Storage
// Saves summary sessions to chrome.storage.local

import type { Chunk, ExtractionWarning, SurfaceInfo } from './types'

export interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
}

export interface HistoryEntry {
  id: string
  url: string
  title: string
  domain: string
  timestamp: number
  summaryText: string
  chunks: Chunk[]
  warnings: ExtractionWarning[]
  surfaceInfo?: SurfaceInfo
  discussionNoteActive?: boolean
  chatMessages: ChatMessage[]
}

export interface IndexEntry {
  id: string
  url: string
  title: string
  domain: string
  timestamp: number
}

const INDEX_KEY = 'st_history_index'
const ENTRY_PREFIX = 'st_entry_'
export const MAX_HISTORY_ENTRIES = 50

function entryKey(id: string) {
  return `${ENTRY_PREFIX}${id}`
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

// Serialize all index mutations to avoid read-modify-write races.
let indexLock: Promise<unknown> = Promise.resolve()
function withIndexLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = indexLock.then(fn, fn)
  indexLock = run.catch(() => {})
  return run
}

async function readIndex(): Promise<IndexEntry[]> {
  const { [INDEX_KEY]: index = [] } = await chrome.storage.local.get(INDEX_KEY)
  return index as IndexEntry[]
}

export async function saveEntry(
  url: string,
  title: string,
  domain: string,
  summaryText: string,
  chunks: Chunk[],
  chatMessages: ChatMessage[],
  warnings: ExtractionWarning[] = [],
  surfaceInfo?: SurfaceInfo,
  discussionNoteActive = false,
): Promise<string> {
  const id = generateId()
  const timestamp = Date.now()
  const entry: HistoryEntry = {
    id,
    url,
    title,
    domain,
    timestamp,
    summaryText,
    chunks,
    warnings,
    surfaceInfo,
    discussionNoteActive,
    chatMessages,
  }

  await chrome.storage.local.set({ [entryKey(id)]: entry })

  return withIndexLock(async () => {
    const index = await readIndex()
    const indexEntry: IndexEntry = { id, url, title, domain, timestamp }
    const newIndex = [indexEntry, ...index]

    // Evict oldest entries if over cap.
    if (newIndex.length > MAX_HISTORY_ENTRIES) {
      const toEvict = newIndex.slice(MAX_HISTORY_ENTRIES)
      const evictKeys = toEvict.map(e => entryKey(e.id))
      await chrome.storage.local.remove(evictKeys)
      newIndex.length = MAX_HISTORY_ENTRIES
    }

    await chrome.storage.local.set({ [INDEX_KEY]: newIndex })
    return id
  })
}

export async function updateEntry(
  id: string,
  updates: Partial<Pick<HistoryEntry, 'summaryText' | 'chatMessages' | 'chunks' | 'warnings' | 'surfaceInfo' | 'discussionNoteActive'>>,
): Promise<void> {
  const key = entryKey(id)
  const { [key]: entry } = await chrome.storage.local.get(key)
  if (!entry) return
  await chrome.storage.local.set({ [key]: { ...entry, ...updates } })
}

export async function getEntry(id: string): Promise<HistoryEntry | null> {
  const { [entryKey(id)]: entry } = await chrome.storage.local.get(entryKey(id))
  return entry || null
}

export async function getIndex(): Promise<IndexEntry[]> {
  return readIndex()
}

export async function deleteEntry(id: string): Promise<void> {
  await chrome.storage.local.remove(entryKey(id))
  await withIndexLock(async () => {
    const index = await readIndex()
    const filtered = index.filter(e => e.id !== id)
    await chrome.storage.local.set({ [INDEX_KEY]: filtered })
  })
}

export async function clearAll(): Promise<void> {
  await withIndexLock(async () => {
    const index = await readIndex()
    const keys = index.map(e => entryKey(e.id))
    await chrome.storage.local.remove([INDEX_KEY, ...keys])
  })
}
