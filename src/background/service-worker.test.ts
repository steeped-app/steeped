import { beforeEach, describe, expect, it, vi } from 'vitest'

function createEvent<T extends (...args: any[]) => any>() {
  const listeners: T[] = []
  return {
    listeners,
    addListener: vi.fn((listener: T) => {
      listeners.push(listener)
    }),
    removeListener: vi.fn((listener: T) => {
      const index = listeners.indexOf(listener)
      if (index >= 0) listeners.splice(index, 1)
    }),
  }
}

function installChromeMock() {
  const runtimeOnInstalled = createEvent<(details: { reason: string }) => void | Promise<void>>()
  const runtimeOnConnect = createEvent<(port: chrome.runtime.Port) => void>()
  const runtimeOnMessage = createEvent<(message: unknown, sender: chrome.runtime.MessageSender) => void>()
  const actionOnClicked = createEvent<(tab: chrome.tabs.Tab) => void | Promise<void>>()
  const contextMenuOnClicked = createEvent<(info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) => void | Promise<void>>()
  const storageSet = vi.fn(async () => {})
  const tabsCreate = vi.fn(async () => ({}))
  const tabsSendMessage = vi.fn(async () => ({}))
  const executeScript = vi.fn(async (_details?: unknown) => [])
  const contextMenusRemoveAll = vi.fn((callback?: () => void) => { callback?.() })
  const contextMenusCreate = vi.fn((_options: chrome.contextMenus.CreateProperties, callback?: () => void) => { callback?.() })
  const storageGet = vi.fn(async () => ({}))

  const mockChrome = {
    runtime: {
      lastError: undefined as chrome.runtime.LastError | undefined,
      onInstalled: runtimeOnInstalled,
      onConnect: runtimeOnConnect,
      onMessage: runtimeOnMessage,
      getURL: (path: string) => `chrome-extension://test/${path}`,
    },
    action: {
      onClicked: actionOnClicked,
    },
    contextMenus: {
      onClicked: contextMenuOnClicked,
      removeAll: contextMenusRemoveAll,
      create: contextMenusCreate,
    },
    storage: {
      local: {
        get: storageGet,
        set: storageSet,
      },
    },
    tabs: {
      create: tabsCreate,
      sendMessage: tabsSendMessage,
    },
    scripting: {
      executeScript,
    },
  }

  ;(globalThis as unknown as { chrome: typeof mockChrome }).chrome = mockChrome
  return {
    actionOnClicked,
    contextMenuOnClicked,
    contextMenusCreate,
    contextMenusRemoveAll,
    executeScript,
    runtimeOnInstalled,
    runtimeOnConnect,
    runtimeOnMessage,
    storageGet,
    storageSet,
    tabsCreate,
    tabsSendMessage,
  }
}

function createPort(tabId = 99) {
  const onMessage = createEvent<(msg: any) => void | Promise<void>>()
  const onDisconnect = createEvent<() => void>()
  const posted: unknown[] = []
  const postMessage = vi.fn((msg: unknown) => {
    posted.push(msg)
  })

  return {
    name: 'steeped-summarize',
    sender: { tab: { id: tabId } },
    onMessage,
    onDisconnect,
    postMessage,
    posted,
  } as unknown as chrome.runtime.Port & {
    onMessage: ReturnType<typeof createEvent<(msg: any) => void | Promise<void>>>
    onDisconnect: ReturnType<typeof createEvent<() => void>>
    posted: unknown[]
  }
}

function mockStreamingAnthropic() {
  const body = [
    'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"## Note\\nA note [1]."}}',
    '',
    'data: [DONE]',
    '',
  ].join('\n')

  vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200 })))
}

function mockExtraction(chromeMock: ReturnType<typeof installChromeMock>, extraction?: Partial<{ title: string; url: string; chunks: Array<{ id: number; text: string }> }>) {
  let requestId = ''
  chromeMock.executeScript.mockImplementation(async (details: any) => {
    if (details.args?.[0]) requestId = String(details.args[0])
    if (Array.isArray(details.files) && details.files.includes('content/extractor.js')) {
      queueMicrotask(() => {
        for (const listener of chromeMock.runtimeOnMessage.listeners) {
          listener({
            type: 'steeped:extracted',
            requestId,
            title: extraction?.title || 'Source page',
            url: extraction?.url || 'https://example.test/source',
            chunks: extraction?.chunks || [{ id: 1, text: 'The source paragraph contains enough specific words for citation jumping.' }],
            warnings: [],
          }, { tab: { id: 99 } } as chrome.runtime.MessageSender)
        }
      })
    }
    return []
  })
}

describe('service worker activation surfaces', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('registers one page menu for normal web pages on install and update', async () => {
    const chromeMock = installChromeMock()
    await import('./service-worker')

    await chromeMock.runtimeOnInstalled.listeners[0]({ reason: 'update' })
    await chromeMock.runtimeOnInstalled.listeners[0]({ reason: 'install' })

    expect(chromeMock.contextMenusRemoveAll).toHaveBeenCalledTimes(2)
    expect(chromeMock.contextMenusCreate).toHaveBeenCalledTimes(2)
    expect(chromeMock.contextMenusCreate).toHaveBeenLastCalledWith({
      id: 'steeped-open-page',
      title: 'Open Steeped for this page',
      contexts: ['page', 'selection', 'link'],
      documentUrlPatterns: ['http://*/*', 'https://*/*'],
    }, expect.any(Function))
    expect(chromeMock.storageSet).toHaveBeenCalledTimes(1)
    expect(chromeMock.tabsCreate).toHaveBeenCalledWith({
      url: 'chrome-extension://test/settings/settings.html?welcome=1',
    })
  })

  it('opens the panel as a toggle from the toolbar action', async () => {
    const chromeMock = installChromeMock()
    await import('./service-worker')

    await chromeMock.actionOnClicked.listeners[0]({ id: 12 } as chrome.tabs.Tab)

    expect(chromeMock.tabsSendMessage).toHaveBeenCalledWith(12, { type: 'steeped:open' })
    expect(chromeMock.executeScript).not.toHaveBeenCalled()
  })

  it('shows the panel from the context menu without toggling it closed', async () => {
    const chromeMock = installChromeMock()
    await import('./service-worker')

    await chromeMock.contextMenuOnClicked.listeners[0](
      { menuItemId: 'steeped-open-page' } as chrome.contextMenus.OnClickData,
      { id: 34 } as chrome.tabs.Tab,
    )

    expect(chromeMock.tabsSendMessage).toHaveBeenCalledWith(34, { type: 'steeped:show' })
    expect(chromeMock.executeScript).not.toHaveBeenCalled()
  })

  it('injects the panel host if the page has not seen Steeped yet', async () => {
    const chromeMock = installChromeMock()
    chromeMock.tabsSendMessage.mockRejectedValueOnce(new Error('No receiver'))
    await import('./service-worker')

    await chromeMock.contextMenuOnClicked.listeners[0](
      { menuItemId: 'steeped-open-page' } as chrome.contextMenus.OnClickData,
      { id: 56 } as chrome.tabs.Tab,
    )

    expect(chromeMock.executeScript).toHaveBeenCalledWith({
      target: { tabId: 56 },
      files: ['content/panel-host.js'],
    })
  })

  it('ignores context-menu clicks without a matching menu item or tab id', async () => {
    const chromeMock = installChromeMock()
    await import('./service-worker')

    await chromeMock.contextMenuOnClicked.listeners[0](
      { menuItemId: 'other' } as chrome.contextMenus.OnClickData,
      { id: 78 } as chrome.tabs.Tab,
    )
    await chromeMock.contextMenuOnClicked.listeners[0](
      { menuItemId: 'steeped-open-page' } as chrome.contextMenus.OnClickData,
      {} as chrome.tabs.Tab,
    )

    expect(chromeMock.tabsSendMessage).not.toHaveBeenCalled()
    expect(chromeMock.executeScript).not.toHaveBeenCalled()
  })

  it('sends extracted source chunks to the page host cache before streaming', async () => {
    const chromeMock = installChromeMock()
    chromeMock.storageGet.mockResolvedValue({ apiKey: 'sk-ant-test' })
    mockStreamingAnthropic()
    mockExtraction(chromeMock)
    await import('./service-worker')

    const port = createPort(99)
    chromeMock.runtimeOnConnect.listeners[0](port)
    await port.onMessage.listeners[0]({ type: 'start', mode: 'concise' })

    expect(chromeMock.tabsSendMessage).toHaveBeenCalledWith(99, expect.objectContaining({
      type: 'steeped:source-cache',
      url: 'https://example.test/source',
      chunks: [{ id: 1, text: 'The source paragraph contains enough specific words for citation jumping.' }],
    }))
    expect(port.postMessage).toHaveBeenCalledWith({ type: 'done' })
  })

  it('continues summarizing if the page host cannot receive the source cache', async () => {
    const chromeMock = installChromeMock()
    chromeMock.storageGet.mockResolvedValue({ apiKey: 'sk-ant-test' })
    chromeMock.tabsSendMessage.mockRejectedValueOnce(new Error('No receiver'))
    mockStreamingAnthropic()
    mockExtraction(chromeMock)
    await import('./service-worker')

    const port = createPort(99)
    chromeMock.runtimeOnConnect.listeners[0](port)
    await port.onMessage.listeners[0]({ type: 'start', mode: 'concise' })

    expect(port.postMessage).toHaveBeenCalledWith({ type: 'done' })
  })

  it('does not push saved history chunks into the current page for start-existing rebuilds', async () => {
    const chromeMock = installChromeMock()
    chromeMock.storageGet.mockResolvedValue({ apiKey: 'sk-ant-test' })
    mockStreamingAnthropic()
    await import('./service-worker')

    const port = createPort(99)
    chromeMock.runtimeOnConnect.listeners[0](port)
    await port.onMessage.listeners[0]({
      type: 'start-existing',
      mode: 'concise',
      extraction: {
        title: 'Saved page',
        url: 'https://saved.example/page',
        chunks: [{ id: 1, text: 'Saved source text should not be pushed into a different page host.' }],
      },
    })

    expect(chromeMock.tabsSendMessage).not.toHaveBeenCalledWith(99, expect.objectContaining({
      type: 'steeped:source-cache',
    }))
    expect(port.postMessage).toHaveBeenCalledWith({ type: 'done' })
  })
})
