import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

interface CdpTarget {
  id: string
  type: string
  title: string
  url: string
  webSocketDebuggerUrl: string
}

interface CdpClient {
  call<T = any>(method: string, params?: Record<string, unknown>): Promise<T>
  on(method: string, handler: (params: any) => void): void
  close(): void
}

interface TestResult {
  id: string
  name: string
  status: 'pass' | 'fail'
  detail: string
  elapsedMs: number
}

interface QaContext {
  outDir: string
  extensionId: string
  extensionOrigin: string
  pageClient?: CdpClient
  panelClient?: CdpClient
  settingsClient?: CdpClient
}

const args = new Map(
  process.argv.slice(2).map(arg => {
    const stripped = arg.replace(/^--/, '')
    const equals = stripped.indexOf('=')
    if (equals === -1) return [stripped, 'true']
    return [stripped.slice(0, equals), stripped.slice(equals + 1)]
  }),
)

const host = args.get('host') || '127.0.0.1'
const port = Number(args.get('port') || '9333')
const outRoot = args.get('out') || 'eval/extension-ux-results'
const key = process.env.ANTHROPIC_API_KEY || ''
const teaUrl = 'https://en.wikipedia.org/wiki/Tea'
const tokyoUrl = 'https://ja.wikipedia.org/wiki/%E6%9D%B1%E4%BA%AC'

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function httpJson<T>(path: string, method = 'GET'): Promise<T> {
  const res = await fetch(`http://${host}:${port}${path}`, { method })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${path} failed: ${res.status} ${text}`)
  return JSON.parse(text) as T
}

async function httpText(path: string, method = 'GET'): Promise<string> {
  const res = await fetch(`http://${host}:${port}${path}`, { method })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${path} failed: ${res.status} ${text}`)
  return text
}

async function targets(): Promise<CdpTarget[]> {
  return httpJson<CdpTarget[]>('/json/list')
}

async function closeTarget(target: CdpTarget) {
  try {
    await httpText(`/json/close/${target.id}`)
  } catch {}
}

async function cleanupHttpPages() {
  const pages = (await targets()).filter(target =>
    target.type === 'page' &&
    (target.url.startsWith('http://') || target.url.startsWith('https://')),
  )
  await Promise.all(pages.map(closeTarget))
  await sleep(500)
}

async function newPage(url: string): Promise<CdpTarget> {
  await httpText(`/json/new?${encodeURIComponent(url)}`, 'PUT')
  const deadline = Date.now() + 12_000
  while (Date.now() < deadline) {
    const target = (await targets()).find(item =>
      item.type === 'page' &&
      (item.url === url || item.url.startsWith(url.slice(0, 42)) || item.url.includes(new URL(url).hostname)),
    )
    if (target) return target
    await sleep(250)
  }
  throw new Error(`Could not open page target for ${url}`)
}

function connect(wsUrl: string): Promise<CdpClient> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    let id = 0
    const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>()
    const listeners = new Map<string, Array<(params: any) => void>>()

    ws.addEventListener('open', () => {
      resolve({
        call(method, params = {}) {
          return new Promise((callResolve, callReject) => {
            id += 1
            pending.set(id, { resolve: callResolve, reject: callReject })
            ws.send(JSON.stringify({ id, method, params }))
          })
        },
        on(method, handler) {
          listeners.set(method, [...(listeners.get(method) || []), handler])
        },
        close() {
          ws.close()
        },
      })
    })

    ws.addEventListener('message', event => {
      const message = JSON.parse(String(event.data))
      if (message.id && pending.has(message.id)) {
        const item = pending.get(message.id)!
        pending.delete(message.id)
        if (message.error) item.reject(new Error(JSON.stringify(message.error)))
        else item.resolve(message.result)
        return
      }

      for (const handler of listeners.get(message.method) || []) {
        handler(message.params)
      }
    })

    ws.addEventListener('error', () => reject(new Error(`Could not connect to ${wsUrl}`)))
  })
}

async function evaluate<T>(client: CdpClient, expression: string): Promise<T> {
  const result = await client.call<{ result: { value: T }; exceptionDetails?: unknown }>('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (result.exceptionDetails) throw new Error(`Evaluation failed: ${JSON.stringify(result.exceptionDetails)}`)
  return result.result.value
}

async function waitFor<T>(name: string, fn: () => Promise<T | null | false | undefined>, timeoutMs = 20_000, intervalMs = 300): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await fn()
    if (value) return value
    await sleep(intervalMs)
  }
  throw new Error(`Timed out waiting for ${name}`)
}

async function findExtensionId(): Promise<string> {
  const explicit = args.get('extension-id')
  if (explicit) return explicit

  const target = (await targets()).find(item => item.url.startsWith('chrome-extension://'))
  if (!target) throw new Error('Could not find a loaded extension target. Pass --extension-id=<id>.')
  return new URL(target.url).hostname
}

async function openExtensionPage(ctx: QaContext, path: string): Promise<CdpTarget> {
  return newPage(`${ctx.extensionOrigin}/${path.replace(/^\/+/, '')}`)
}

async function resetExtensionState(ctx: QaContext) {
  const page = await openExtensionPage(ctx, 'panel/index.html')
  const client = await connect(page.webSocketDebuggerUrl)
  await evaluate(client, `
    chrome.storage.local.get(null).then(all => {
      const keys = Object.keys(all).filter(key =>
        key === 'apiKey' ||
        key === 'darkMode' ||
        key === 'themePalette' ||
        key === 'firstRunOpenedAt' ||
        key === 'stPanelWidth' ||
        key.startsWith('st_')
      )
      return chrome.storage.local.remove(keys)
    }).then(() => {
      localStorage.setItem('st-qa-capture', 'true')
      localStorage.removeItem('st-dark')
      return true
    })
  `)
  client.close()
}

async function dispatchActionShortcut(client: CdpClient) {
  const isMac = process.platform === 'darwin'
  const params = {
    key: isMac ? 'S' : 's',
    code: 'KeyS',
    text: '',
    unmodifiedText: '',
    windowsVirtualKeyCode: 83,
    nativeVirtualKeyCode: 83,
    modifiers: isMac ? 10 : 1,
  }
  await client.call('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...params })
  await client.call('Input.dispatchKeyEvent', { type: 'keyUp', ...params })
}

async function waitForDocument(client: CdpClient) {
  await waitFor('document ready', () => evaluate<{ state: string; bodyLength: number }>(client, `
    ({ state: document.readyState, bodyLength: document.body?.innerText?.length || 0 })
  `).then(state => (
    (state.state === 'interactive' || state.state === 'complete') && state.bodyLength > 60 ? state : null
  )), 30_000)
}

async function openContentPage(ctx: QaContext, url: string): Promise<CdpClient> {
  ctx.panelClient?.close()
  ctx.pageClient?.close()
  await cleanupHttpPages()
  const page = await newPage(url)
  const client = await connect(page.webSocketDebuggerUrl)
  await client.call('Page.enable')
  await client.call('Page.bringToFront')
  await waitForDocument(client)
  ctx.pageClient = client
  return client
}

async function waitForEmbeddedPanel(): Promise<CdpTarget> {
  return waitFor('embedded Steeped iframe target', async () => {
    return (await targets()).find(item =>
      item.type === 'iframe' &&
      item.url.startsWith('chrome-extension://') &&
      item.url.includes('/panel/index.html'),
    )
  }, 10_000)
}

async function openPanel(ctx: QaContext, pageClient = ctx.pageClient!): Promise<CdpClient> {
  await dispatchActionShortcut(pageClient)
  await waitFor('panel iframe on page', () => evaluate<{ hasPanel: boolean }>(pageClient, `
    ({ hasPanel: Boolean(document.querySelector('#steeped-panel')) })
  `).then(state => state.hasPanel ? state : null), 10_000)
  const panelTarget = await waitForEmbeddedPanel()
  const panelClient = await connect(panelTarget.webSocketDebuggerUrl)
  await evaluate(panelClient, `localStorage.setItem('st-qa-capture', 'true')`)
  ctx.panelClient = panelClient
  return panelClient
}

async function waitCapture(panelClient: CdpClient, predicate: (capture: any) => boolean, label: string, timeoutMs = 90_000) {
  return waitFor(label, async () => {
    const capture = await evaluate<any>(panelClient, `
      typeof window.__steepedQaCapture === 'function' ? window.__steepedQaCapture() : null
    `)
    return capture && predicate(capture) ? capture : null
  }, timeoutMs, 500)
}

async function clickPanelButton(panelClient: CdpClient, matcher: string) {
  const matcherJson = JSON.stringify(matcher)
  await evaluate(panelClient, `
    (() => {
      const matcher = ${matcherJson}
      const button = [...document.querySelectorAll('button')].find(btn =>
        btn.innerText.trim() === matcher ||
        btn.title === matcher ||
        btn.getAttribute('aria-label') === matcher
      )
      if (!button) throw new Error('No button found: ' + matcher)
      button.click()
      return true
    })()
  `)
}

async function setMode(panelClient: CdpClient, mode: string) {
  await clickPanelButton(panelClient, mode[0].toUpperCase() + mode.slice(1))
  await sleep(250)
}

async function summarize(panelClient: CdpClient, mode?: string) {
  if (mode) await setMode(panelClient, mode)
  await clickPanelButton(panelClient, 'Summarize')
  return waitCapture(panelClient, capture => capture.panel?.view === 'summary' && (capture.summaryText || '').length > 120, 'summary complete')
}

async function settingsTarget(): Promise<CdpTarget> {
  return waitFor('settings tab', async () => {
    return (await targets()).find(item =>
      item.type === 'page' &&
      item.url.startsWith('chrome-extension://') &&
      item.url.includes('/settings/settings.html'),
    )
  }, 8_000)
}

async function waitSettingsStatus(client: CdpClient, expected: RegExp, timeoutMs = 20_000): Promise<string> {
  const source = expected.source
  const flags = expected.flags
  return waitFor('settings status', async () => {
    const text = await evaluate<string>(client, `
      document.getElementById('key-save-status')?.textContent?.trim() || ''
    `)
    return new RegExp(source, flags).test(text) ? text : null
  }, timeoutMs, 500)
}

async function setSettingsKey(client: CdpClient, value: string) {
  const valueJson = JSON.stringify(value)
  await evaluate(client, `
    (() => {
      const input = document.getElementById('api-key-input')
      if (!(input instanceof HTMLInputElement)) throw new Error('No key input')
      input.value = ${valueJson}
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })()
  `)
}

async function clickSettingsButton(client: CdpClient, id: string) {
  const idJson = JSON.stringify(id)
  await evaluate(client, `
    (() => {
      const button = document.getElementById(${idJson})
      if (!(button instanceof HTMLButtonElement)) throw new Error('No settings button ' + ${idJson})
      button.click()
    })()
  `)
}

async function localFontUrls(client: CdpClient): Promise<string[]> {
  return evaluate<string[]>(client, `
    performance.getEntriesByType('resource')
      .map(entry => entry.name)
      .filter(name => /fonts\\.(googleapis|gstatic)\\.com/i.test(name))
  `)
}

async function storageState(client: CdpClient) {
  return evaluate<any>(client, `
    chrome.storage.local.get(null).then(all => ({
      hasApiKey: Boolean(all.apiKey),
      darkMode: all.darkMode,
      stPanelWidth: all.stPanelWidth,
      historyCount: Array.isArray(all.st_history_index) ? all.st_history_index.length : 0,
      historyTitles: Array.isArray(all.st_history_index) ? all.st_history_index.map(item => item.title) : [],
    }))
  `)
}

async function withTest(results: TestResult[], id: string, name: string, fn: () => Promise<string>) {
  const started = Date.now()
  try {
    const detail = await fn()
    results.push({ id, name, status: 'pass', detail, elapsedMs: Date.now() - started })
    process.stderr.write(`[ux] ${id}: pass - ${detail}\n`)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    results.push({ id, name, status: 'fail', detail, elapsedMs: Date.now() - started })
    process.stderr.write(`[ux] ${id}: fail - ${detail}\n`)
  }
}

async function screenshot(pageClient: CdpClient, path: string) {
  try {
    const shot = await pageClient.call<{ data: string }>('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    })
    writeFileSync(path, Buffer.from(shot.data, 'base64'))
  } catch {}
}

async function testCancellation(ctx: QaContext): Promise<string> {
  const pageClient = await openContentPage(ctx, teaUrl)
  const panelClient = await openPanel(ctx, pageClient)
  await waitCapture(panelClient, capture => capture.panel?.view === 'ready', 'ready panel')

  const worker = await waitFor('service worker target', async () => {
    return (await targets()).find(item =>
      item.type === 'service_worker' &&
      item.url.startsWith(ctx.extensionOrigin) &&
      item.url.includes('/background/service-worker.js'),
    )
  }, 8_000)
  const workerClient = await connect(worker.webSocketDebuggerUrl)
  await workerClient.call('Network.enable')

  let requestId = ''
  let requestSeen = false
  let cancelled = false
  workerClient.on('Network.requestWillBeSent', params => {
    if (String(params?.request?.url || '').includes('api.anthropic.com/v1/messages')) {
      requestSeen = true
      requestId = params.requestId
    }
  })
  workerClient.on('Network.loadingFailed', params => {
    if ((!requestId || params.requestId === requestId) && String(params?.errorText || '').includes('ERR_ABORTED')) {
      cancelled = true
    }
    if ((!requestId || params.requestId === requestId) && params?.canceled) {
      cancelled = true
    }
  })

  await clickPanelButton(panelClient, 'Detailed')
  await clickPanelButton(panelClient, 'Summarize')
  await waitFor('Anthropic request start', async () => requestSeen ? true : null, 15_000, 100)
  await clickPanelButton(panelClient, 'Close panel')
  await waitFor('cancelled Anthropic request', async () => cancelled ? true : null, 15_000, 200)
  workerClient.close()

  return 'Anthropic request observed and cancelled after panel close.'
}

async function testExportHistoryThemeResize(ctx: QaContext, results: TestResult[]) {
  const pageClient = await openContentPage(ctx, tokyoUrl)
  const panelClient = await openPanel(ctx, pageClient)
  const capture = await summarize(panelClient, 'translate')

  await withTest(results, '10-export-japanese-filename', 'Export preserves non-ASCII filename', async () => {
    const downloadDir = join(ctx.outDir, 'downloads')
    if (existsSync(downloadDir)) rmSync(downloadDir, { recursive: true, force: true })
    mkdirSync(downloadDir, { recursive: true })
    await panelClient.call('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir })
    await clickPanelButton(panelClient, 'Export to Markdown')
    const file = await waitFor('downloaded markdown file', async () => {
      return readdirSync(downloadDir).find(name => name.endsWith('.md') && !name.endsWith('.crdownload')) || null
    }, 10_000, 250)
    if (!file.includes('東京')) throw new Error(`Filename did not preserve Japanese title: ${file}`)
    if (file === 'steeped-export.md') throw new Error('Filename fell back to steeped-export.md')
    return `Downloaded ${file}.`
  })

  await withTest(results, '11-history-list', 'History lists prior summaries', async () => {
    await clickPanelButton(panelClient, 'History')
    await waitFor('history entries', async () => {
      const text = await evaluate<string>(panelClient, `document.body.innerText`)
      return text.includes('Tea') && text.includes('東京') ? text : null
    }, 8_000)
    const state = await storageState(panelClient)
    if (state.historyCount < 2) throw new Error(`Expected at least 2 history entries, found ${state.historyCount}`)
    return `History contains ${state.historyCount} entries including Tea and Tokyo.`
  })

  await withTest(results, '12-history-restore', 'History restores a summary', async () => {
    await evaluate(panelClient, `
      (() => {
        const rows = [...document.querySelectorAll('.cursor-pointer')]
        const row = rows.find(el => (el.textContent || '').includes('Tea')) || rows[0]
        if (!(row instanceof HTMLElement)) throw new Error('No history row found')
        row.click()
      })()
    `)
    const restored = await waitCapture(panelClient, item =>
      item.panel?.view === 'summary' && Boolean(item.page?.title) && (item.summaryText || '').length > 120,
      'restored history entry',
    )
    return `Restored ${restored.page?.title}.`
  })

  await withTest(results, '14-theme-persists', 'Theme persists after close/reopen', async () => {
    const before = await waitCapture(panelClient, item => item.panel?.view === 'summary', 'summary capture')
    if (!before.panel?.darkMode) throw new Error('Expected dark mode before toggling')
    await clickPanelButton(panelClient, 'Light mode')
    await waitFor('darkMode false in storage', async () => {
      const state = await storageState(panelClient)
      return state.darkMode === false ? state : null
    }, 5_000)
    await clickPanelButton(panelClient, 'Close panel')
    await sleep(500)
    await dispatchActionShortcut(pageClient)
    const reopened = await waitCapture(panelClient, item => item.panel?.view === 'summary' && item.panel.darkMode === false, 'reopened light panel', 8_000)
    return `Theme persisted as ${reopened.panel?.darkMode ? 'dark' : 'light'}.`
  })

  await withTest(results, '15-resize-persists', 'Panel resize wraps and persists', async () => {
    const handleRect = await evaluate<{ x: number; y: number; width: number; height: number }>(pageClient, `
      (() => {
        const handle = document.querySelector('#steeped-resize')
        if (!(handle instanceof HTMLElement)) throw new Error('No resize handle')
        const rect = handle.getBoundingClientRect()
        return { x: rect.left + rect.width / 2, y: 160, width: rect.width, height: rect.height }
      })()
    `)
    await pageClient.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: handleRect.x, y: handleRect.y, button: 'left', clickCount: 1 })
    await pageClient.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: handleRect.x - 150, y: handleRect.y, button: 'left' })
    await pageClient.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: handleRect.x - 150, y: handleRect.y, button: 'left', clickCount: 1 })
    await sleep(500)
    const iframeState = await evaluate<{ iframeWidth: number }>(pageClient, `
      (() => {
        const iframe = document.querySelector('#steeped-panel')
        return {
          iframeWidth: iframe ? Math.round(iframe.getBoundingClientRect().width) : 0,
        }
      })()
    `)
    const storage = await evaluate<{ stPanelWidth?: number }>(panelClient, `
      chrome.storage.local.get('stPanelWidth')
    `)
    if (iframeState.iframeWidth < 450 || (storage.stPanelWidth || 0) < 450) {
      throw new Error(`Resize did not persist wide width: iframe=${iframeState.iframeWidth}, storage=${storage.stPanelWidth}`)
    }
    return `Panel resized to ${iframeState.iframeWidth}px and storage saved ${storage.stPanelWidth}px.`
  })

  await screenshot(pageClient, join(ctx.outDir, 'final-extension-panel.png'))
  if (!capture.page?.title) throw new Error('Tokyo capture did not retain page title')
}

function writeReport(outDir: string, results: TestResult[]) {
  const rows = results.map(result =>
    `| ${result.id} | ${result.status.toUpperCase()} | ${result.detail.replace(/\|/g, '\\|')} | ${result.elapsedMs} |`,
  ).join('\n')

  const report = `# Steeped Extension UX QA

Generated: ${new Date().toISOString()}

Browser target: http://${host}:${port}

| Test | Status | Detail | ms |
| --- | --- | --- | ---: |
${rows}
`
  writeFileSync(join(outDir, 'report.md'), report)
}

async function main() {
  if (!key) throw new Error('ANTHROPIC_API_KEY is required for extension UX QA.')

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outDir = join(process.cwd(), outRoot, stamp)
  mkdirSync(outDir, { recursive: true })

  const extensionId = await findExtensionId()
  const ctx: QaContext = {
    outDir,
    extensionId,
    extensionOrigin: `chrome-extension://${extensionId}`,
  }
  const results: TestResult[] = []

  await resetExtensionState(ctx)

  await withTest(results, '16-fresh-tab-injection', 'Fresh tab opens panel through action injection', async () => {
    const pageClient = await openContentPage(ctx, teaUrl)
    const before = await evaluate<{ hasPanel: boolean }>(pageClient, `({ hasPanel: Boolean(document.querySelector('#steeped-panel')) })`)
    if (before.hasPanel) throw new Error('Panel existed before action shortcut')
    const panelClient = await openPanel(ctx, pageClient)
    const capture = await waitCapture(panelClient, item => item.panel?.view === 'setup', 'setup capture')
    return `Panel injected on fresh tab; initial view is ${capture.panel.view}.`
  })

  await withTest(results, '13-default-dark', 'Fresh install opens in dark mode', async () => {
    const capture = await waitCapture(ctx.panelClient!, item => item.panel?.view === 'setup', 'setup capture')
    if (!capture.panel.darkMode) throw new Error('Panel did not default to dark mode')
    return 'Default panel dark mode is active.'
  })

  await withTest(results, '01-local-fonts', 'Panel uses local fonts only', async () => {
    const bad = await localFontUrls(ctx.panelClient!)
    if (bad.length) throw new Error(`Remote font requests found: ${bad.join(', ')}`)
    return 'No fonts.googleapis.com or fonts.gstatic.com panel requests.'
  })

  await withTest(results, '02-settings-opens', 'Settings icon opens options page', async () => {
    await clickPanelButton(ctx.panelClient!, 'Settings')
    const target = await settingsTarget()
    const client = await connect(target.webSocketDebuggerUrl)
    ctx.settingsClient = client
    const title = await waitFor('settings page rendered', () => evaluate<{ title: string; hasInput: boolean }>(client, `
      ({ title: document.title, hasInput: Boolean(document.getElementById('api-key-input')) })
    `).then(state => state.title.includes('Steeped') && state.hasInput ? state.title : null), 10_000)
    if (!title.includes('Steeped')) throw new Error(`Unexpected settings title: ${title}`)
    const bad = await localFontUrls(client)
    if (bad.length) throw new Error(`Remote font requests found in settings: ${bad.join(', ')}`)
    return `Opened ${target.url}.`
  })

  await withTest(results, '03-bogus-key-rejected', 'Bogus Anthropic key is rejected', async () => {
    const client = ctx.settingsClient!
    await setSettingsKey(client, 'sk-ant-bogus')
    await clickSettingsButton(client, 'test-key-btn')
    const status = await waitSettingsStatus(client, /rejected by anthropic/i)
    return status
  })

  await withTest(results, '04-real-key-works', 'Real Anthropic key tests green', async () => {
    const client = ctx.settingsClient!
    await setSettingsKey(client, key)
    await clickSettingsButton(client, 'test-key-btn')
    const status = await waitSettingsStatus(client, /key works/i, 30_000)
    return status
  })

  await withTest(results, '05-key-saved', 'API key saves locally', async () => {
    const client = ctx.settingsClient!
    await setSettingsKey(client, key)
    await clickSettingsButton(client, 'save-key-btn')
    const status = await waitSettingsStatus(client, /key saved/i)
    const state = await storageState(client)
    if (!state.hasApiKey) throw new Error('chrome.storage.local has no apiKey after save')
    return status
  })

  await withTest(results, '17-opening-guidance', 'Settings and ready view explain non-shortcut opening', async () => {
    const settingsText = await evaluate<string>(ctx.settingsClient!, `document.body.innerText`)
    for (const expected of ['Ways to open', 'Toolbar icon', 'Right-click page', 'Open Steeped for this page']) {
      if (!settingsText.includes(expected)) throw new Error(`Settings page missing opening guidance: ${expected}`)
    }

    const pageClient = await openContentPage(ctx, teaUrl)
    const panelClient = await openPanel(ctx, pageClient)
    const capture = await waitCapture(panelClient, item => item.panel?.view === 'ready', 'ready panel')
    const panelText = await evaluate<string>(panelClient, `document.body.innerText`)
    if (!panelText.includes('Tip: you can right-click a page to open Steeped.')) {
      throw new Error('Ready panel is missing first-use right-click hint')
    }
    if ((capture.summaryText || '').length > 0 || capture.panel?.view !== 'ready') {
      throw new Error('Opening the panel should not auto-summarize')
    }
    return 'Settings copy and first-use ready hint are present; panel opens without starting a summary.'
  })

  await withTest(results, '06-summary-streams', 'Wikipedia Tea streams Note + What Matters with citations', async () => {
    const pageClient = await openContentPage(ctx, teaUrl)
    const panelClient = await openPanel(ctx, pageClient)
    const capture = await summarize(panelClient)
    if (!capture.summaryText.includes('## Note') || !capture.summaryText.includes('## What Matters')) {
      throw new Error('Summary missing Note/What Matters headings')
    }
    if (!/\[\d+\]/.test(capture.summaryText)) throw new Error('Summary has no citations')
    return `${capture.page.title}; ${capture.summaryText.length} chars; ${capture.chunks.length} chunks.`
  })

  await withTest(results, '07-citation-expands', 'Citation chip expands source chunk and cues the page source', async () => {
    const firstChunkText = await evaluate<string>(ctx.panelClient!, `
      (() => {
        const capture = window.__steepedQaCapture?.()
        return String(capture?.chunks?.[0]?.text || '').slice(0, 160)
      })()
    `)
    await evaluate(ctx.pageClient!, `
      (() => {
        window.__steepedSeenMessages = []
        window.addEventListener('message', event => {
          window.__steepedSeenMessages.push(JSON.stringify(event.data || {}))
        }, { once: false })
      })()
    `)
    await evaluate(ctx.panelClient!, `
      (() => {
        const cite = document.querySelector('button[aria-label^="Open source chunk"]')
        if (!(cite instanceof HTMLElement)) throw new Error('No citation chip found')
        cite.click()
      })()
    `)
    const text = await waitFor('source expansion', () => evaluate<string>(ctx.panelClient!, `document.body.innerText`).then(text =>
      /Source (?:- Chunk )?[0-9]+/i.test(text) ? text : null,
    ), 5_000)
    const cue = await waitFor('page source cue', () => evaluate<{ id: string | null; text: string; scrollY: number } | null>(ctx.pageClient!, `
      (() => {
        const cue = document.querySelector('[data-steeped-source-cue="true"]')
        return cue ? {
          id: cue.getAttribute('data-steeped-source-id'),
          text: cue.textContent || '',
          scrollY: window.scrollY,
        } : null
      })()
    `), 7_000)
    const seenMessages = await evaluate<string[]>(ctx.pageClient!, `window.__steepedSeenMessages || []`)
    const leakedSourceText = firstChunkText.length > 40 && seenMessages.some(message => message.includes(firstChunkText.slice(0, 40)))
    if (leakedSourceText) throw new Error('Citation source-jump message exposed chunk text to the page')

    await waitFor('page source cue cleanup', () => evaluate<boolean>(ctx.pageClient!, `
      !document.querySelector('[data-steeped-source-cue="true"]')
    `).then(done => done ? true : null), 6_000)

    return `${text.match(/Source (?:- Chunk )?[0-9]+/i)?.[0] || 'Source expanded'}; page cue ${cue.text.trim() || cue.id}.`
  })

  await withTest(results, '08-follow-up-chat', 'Follow-up answer streams with citations', async () => {
    await evaluate(ctx.panelClient!, `
      (() => {
        const input = document.querySelector('input[placeholder="Ask about this page"]')
        if (!(input instanceof HTMLInputElement)) throw new Error('No chat input')
        input.value = 'What is one concrete number from the page?'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      })()
    `)
    const capture = await waitCapture(ctx.panelClient!, item =>
      item.panel?.view === 'summary' &&
      Array.isArray(item.chatMessages) &&
      item.chatMessages.some((msg: any) => msg.role === 'assistant' && /\[\d+\]/.test(msg.text || '')),
      'follow-up answer',
      45_000,
    )
    const assistant = capture.chatMessages.find((msg: any) => msg.role === 'assistant')
    return `Assistant follow-up ${assistant.text.length} chars with citation.`
  })

  await withTest(results, '18-first-use-hint-clears', 'First-use right-click hint clears after a saved note', async () => {
    await clickPanelButton(ctx.panelClient!, 'New summary')
    const capture = await waitCapture(ctx.panelClient!, item =>
      item.panel?.view === 'ready' && item.panel.hasSavedNotes === true,
      'ready panel after saved note',
      8_000,
    )
    const panelText = await evaluate<string>(ctx.panelClient!, `document.body.innerText`)
    if (panelText.includes('Tip: you can right-click a page to open Steeped.')) {
      throw new Error('First-use hint was still visible after a saved note')
    }
    return `Ready panel returned with hasSavedNotes=${capture.panel.hasSavedNotes}.`
  })

  await withTest(results, '09-close-cancels-request', 'Closing panel cancels in-flight Anthropic request', () => testCancellation(ctx))

  await testExportHistoryThemeResize(ctx, results)

  writeFileSync(join(outDir, 'results.json'), JSON.stringify(results, null, 2))
  writeReport(outDir, results)
  console.log(`Extension UX QA complete: ${results.filter(r => r.status === 'pass').length}/${results.length} pass`)
  console.log(`Artifacts: ${outDir}`)

  process.exit(results.some(result => result.status === 'fail') ? 1 : 0)
}

main().catch(error => {
  console.error(error instanceof Error ? (error.stack || error.message) : error)
  process.exit(1)
})
