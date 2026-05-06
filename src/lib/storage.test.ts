import { describe, it, expect, beforeEach, vi } from 'vitest'
import { installChromeMock, type MockChromeStorage } from '../test/chrome-mock'

let storageMock: MockChromeStorage
let storage: typeof import('./storage')

beforeEach(async () => {
  vi.resetModules()
  storageMock = installChromeMock()
  storage = await import('./storage')
})

describe('saveEntry', () => {
  it('writes the entry and an index record', async () => {
    const id = await storage.saveEntry(
      'https://example.com/a',
      'Example A',
      'example.com',
      '## TL;DR\nHi',
      [{ id: 1, text: 'chunk 1' }],
      [],
    )

    expect(id).toBeTruthy()
    expect(storageMock.store.has(`st_entry_${id}`)).toBe(true)

    const index = await storage.getIndex()
    expect(index).toHaveLength(1)
    expect(index[0].id).toBe(id)
    expect(index[0].title).toBe('Example A')
    expect(index[0].domain).toBe('example.com')
  })

  it('persists extraction warnings with the entry', async () => {
    const id = await storage.saveEntry(
      'https://example.com/locked',
      'Locked Example',
      'example.com',
      'summary',
      [{ id: 1, text: 'Subscribe to continue reading.' }],
      [],
      [{ code: 'possible-paywall', message: 'This page looks partly locked.' }],
    )

    const entry = await storage.getEntry(id)
    expect(entry?.warnings).toEqual([{ code: 'possible-paywall', message: 'This page looks partly locked.' }])
  })

  it('persists discussion surface metadata with the entry', async () => {
    const surfaceInfo = {
      kind: 'discussion-thread' as const,
      confidence: 'high' as const,
      label: 'Discussion',
      reason: 'forum-style URL path',
      rootPostVisible: true as const,
      pagePosition: 'unknown' as const,
      rankingSignals: ['reactions'],
    }

    const id = await storage.saveEntry(
      'https://forum.example/t/cloudy-tank/123',
      'Cloudy tank thread',
      'forum.example',
      'summary',
      [{ id: 1, text: 'Original poster and replies.' }],
      [],
      [],
      surfaceInfo,
      true,
    )

    const entry = await storage.getEntry(id)
    expect(entry?.surfaceInfo).toEqual(surfaceInfo)
    expect(entry?.discussionNoteActive).toBe(true)
  })

  it('puts newest entry first in the index', async () => {
    const first = await storage.saveEntry('https://a.test', 'A', 'a.test', 'sum', [], [])
    const second = await storage.saveEntry('https://b.test', 'B', 'b.test', 'sum', [], [])

    const index = await storage.getIndex()
    expect(index.map(e => e.id)).toEqual([second, first])
  })

  it('evicts oldest entries beyond MAX_HISTORY_ENTRIES', async () => {
    const cap = storage.MAX_HISTORY_ENTRIES
    const ids: string[] = []

    for (let i = 0; i < cap + 5; i++) {
      const id = await storage.saveEntry(
        `https://e${i}.test`,
        `Entry ${i}`,
        `e${i}.test`,
        'sum',
        [],
        [],
      )
      ids.push(id)
    }

    const index = await storage.getIndex()
    expect(index).toHaveLength(cap)

    // Oldest 5 should be gone from the index AND their entry keys removed.
    const evicted = ids.slice(0, 5)
    for (const id of evicted) {
      expect(storageMock.store.has(`st_entry_${id}`)).toBe(false)
    }
    // Newest should still be present.
    const newest = ids.slice(-5)
    for (const id of newest) {
      expect(storageMock.store.has(`st_entry_${id}`)).toBe(true)
    }
  })

  it('serializes concurrent saves without losing index records', async () => {
    const saves = Array.from({ length: 10 }, (_, i) =>
      storage.saveEntry(`https://p${i}.test`, `P${i}`, `p${i}.test`, 'sum', [], []),
    )
    const ids = await Promise.all(saves)
    const index = await storage.getIndex()
    expect(index).toHaveLength(10)
    expect(new Set(index.map(e => e.id))).toEqual(new Set(ids))
  })
})

describe('updateEntry', () => {
  it('patches summaryText and chatMessages without clobbering other fields', async () => {
    const id = await storage.saveEntry('https://x.test', 'X', 'x.test', 'old', [{ id: 1, text: 'c' }], [])

    await storage.updateEntry(id, {
      summaryText: 'new',
      chatMessages: [{ role: 'user', text: 'hi' }],
      discussionNoteActive: true,
    })

    const entry = await storage.getEntry(id)
    expect(entry?.summaryText).toBe('new')
    expect(entry?.chatMessages).toEqual([{ role: 'user', text: 'hi' }])
    expect(entry?.discussionNoteActive).toBe(true)
    expect(entry?.title).toBe('X')
    expect(entry?.chunks).toEqual([{ id: 1, text: 'c' }])
  })

  it('is a no-op for a missing entry', async () => {
    await storage.updateEntry('nonexistent', { summaryText: 'x' })
    const entry = await storage.getEntry('nonexistent')
    expect(entry).toBeNull()
  })
})

describe('getEntry', () => {
  it('returns null for missing ids', async () => {
    expect(await storage.getEntry('nope')).toBeNull()
  })
})

describe('deleteEntry', () => {
  it('removes the entry record and its index row', async () => {
    const id = await storage.saveEntry('https://d.test', 'D', 'd.test', 's', [], [])
    await storage.deleteEntry(id)

    expect(storageMock.store.has(`st_entry_${id}`)).toBe(false)
    const index = await storage.getIndex()
    expect(index.find(e => e.id === id)).toBeUndefined()
  })

  it('leaves other entries untouched', async () => {
    const a = await storage.saveEntry('https://a.test', 'A', 'a.test', 's', [], [])
    const b = await storage.saveEntry('https://b.test', 'B', 'b.test', 's', [], [])
    await storage.deleteEntry(a)

    expect(storageMock.store.has(`st_entry_${b}`)).toBe(true)
    const index = await storage.getIndex()
    expect(index).toHaveLength(1)
    expect(index[0].id).toBe(b)
  })
})

describe('clearAll', () => {
  it('removes every entry and the index', async () => {
    await storage.saveEntry('https://a.test', 'A', 'a.test', 's', [], [])
    await storage.saveEntry('https://b.test', 'B', 'b.test', 's', [], [])

    await storage.clearAll()

    expect(storageMock.store.size).toBe(0)
    expect(await storage.getIndex()).toEqual([])
  })
})
