// Minimal chrome.storage.local shim for unit tests.
// Install into globalThis.chrome in a beforeEach.

type StorageValue = unknown

export interface MockChromeStorage {
  store: Map<string, StorageValue>
  get: (keys?: string | string[] | null) => Promise<Record<string, StorageValue>>
  set: (items: Record<string, StorageValue>) => Promise<void>
  remove: (keys: string | string[]) => Promise<void>
  clear: () => Promise<void>
}

export function createChromeMock(): { storage: { local: MockChromeStorage } } {
  const store = new Map<string, StorageValue>()

  const local: MockChromeStorage = {
    store,

    async get(keys) {
      if (keys === null || keys === undefined) {
        return Object.fromEntries(store)
      }
      const out: Record<string, StorageValue> = {}
      const list = Array.isArray(keys) ? keys : [keys]
      for (const k of list) {
        if (store.has(k)) out[k] = store.get(k)
      }
      return out
    },

    async set(items) {
      for (const [k, v] of Object.entries(items)) {
        store.set(k, v)
      }
    },

    async remove(keys) {
      const list = Array.isArray(keys) ? keys : [keys]
      for (const k of list) store.delete(k)
    },

    async clear() {
      store.clear()
    },
  }

  return { storage: { local } }
}

export function installChromeMock(): MockChromeStorage {
  const mock = createChromeMock()
  ;(globalThis as unknown as { chrome: typeof mock }).chrome = mock
  return mock.storage.local
}
