import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

interface CdpTarget {
  id: string
  type: string
  title: string
  url: string
  webSocketDebuggerUrl: string
}

interface CdpClient {
  call<T = any>(method: string, params?: Record<string, unknown>): Promise<T>
  close(): void
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
const port = Number(args.get('port') || '9335')
let extensionId = args.get('extension-id') || ''
let extensionOrigin = extensionId ? `chrome-extension://${extensionId}` : ''
const outDir = args.get('out') || 'design/source-captures/store'
const apiKey = process.env.ANTHROPIC_API_KEY || ''
const readyUrl = 'https://www.joshwcomeau.com/css/custom-css-reset/'
const sourcesUrl = 'https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle'
const threadUrl = 'https://github.com/microsoft/vscode/issues/204861'
const historyUrl = 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise'

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
  const hostMatch = url.match(/^[a-z-]+:\/\/([^/]+)/)
  const hostname = hostMatch?.[1] || ''
  const isExtensionUrl = url.startsWith('chrome-extension://')
  const deadline = Date.now() + 12_000
  while (Date.now() < deadline) {
    const target = (await targets()).find(item =>
      item.type === 'page' &&
      (
        item.url === url ||
        (!isExtensionUrl && item.url.startsWith(url.slice(0, 42))) ||
        (!isExtensionUrl && hostname && item.url.includes(hostname))
      ),
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

    ws.addEventListener('open', () => {
      resolve({
        call(method, params = {}) {
          return new Promise((callResolve, callReject) => {
            id += 1
            pending.set(id, { resolve: callResolve, reject: callReject })
            ws.send(JSON.stringify({ id, method, params }))
          })
        },
        close() {
          ws.close()
        },
      })
    })

    ws.addEventListener('message', event => {
      const message = JSON.parse(String(event.data))
      if (!message.id || !pending.has(message.id)) return
      const item = pending.get(message.id)!
      pending.delete(message.id)
      if (message.error) item.reject(new Error(JSON.stringify(message.error)))
      else item.resolve(message.result)
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

async function waitFor<T>(name: string, fn: () => Promise<T | null | false | undefined>, timeoutMs = 90_000, intervalMs = 300): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await fn()
    if (value) return value
    await sleep(intervalMs)
  }
  throw new Error(`Timed out waiting for ${name}`)
}

async function waitDocument(client: CdpClient) {
  await waitFor('document ready', () => evaluate<{ state: string; bodyLength: number }>(client, `
    ({ state: document.readyState, bodyLength: document.body?.innerText?.length || 0 })
  `).then(state => (
    (state.state === 'interactive' || state.state === 'complete') && state.bodyLength > 60 ? state : null
  )), 30_000)
}

async function screenshot(client: CdpClient, name: string) {
  const shot = await client.call<{ data: string }>('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  })
  const path = join(outDir, name)
  writeFileSync(path, Buffer.from(shot.data, 'base64'))
  console.log(path)
}

function writeManifest() {
  writeFileSync(
    join(outDir, 'manifest.json'),
    JSON.stringify({
      schema: 'steeped-store-source-captures-v1',
      capturedAt: new Date().toISOString(),
      notes: [
        'Raw live captures for launch graphics.',
        'Run npm run graphics:launch to render the CWS/social asset package.',
      ],
      captures: [
        {
          file: '01-big-reads-small-notes-live.png',
          sourceUrl: readyUrl,
          state: 'ready panel',
        },
        {
          file: '02-sources-attached-live.png',
          sourceUrl: sourcesUrl,
          state: 'summary with citation expanded',
        },
        {
          file: '03-ask-about-same-page-live.png',
          sourceUrl: threadUrl,
          state: 'follow-up chat',
        },
        {
          file: '04-your-key-stays-in-chrome-live.png',
          sourceUrl: `${extensionOrigin}/settings/settings.html`,
          state: 'settings page with fake demo key',
        },
        {
          file: '05-local-history-live.png',
          sourceUrl: historyUrl,
          state: 'history view',
        },
      ],
    }, null, 2),
  )
}

async function setViewport(client: CdpClient) {
  await client.call('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  })
}

async function openContent(url: string): Promise<CdpClient> {
  await cleanupHttpPages()
  const page = await newPage(url)
  const client = await connect(page.webSocketDebuggerUrl)
  await client.call('Page.enable')
  await setViewport(client)
  await client.call('Page.bringToFront')
  await waitDocument(client)
  return client
}

async function openPanel(pageClient: CdpClient): Promise<CdpClient> {
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
  await pageClient.call('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...params })
  await pageClient.call('Input.dispatchKeyEvent', { type: 'keyUp', ...params })
  await waitFor('panel iframe', () => evaluate<{ hasPanel: boolean }>(pageClient, `
    ({ hasPanel: Boolean(document.querySelector('#steeped-panel')) })
  `).then(state => state.hasPanel ? state : null), 10_000)

  const panel = await waitFor('panel target', async () => {
    return (await targets()).find(item =>
      item.type === 'iframe' &&
      item.url.startsWith(extensionOrigin) &&
      item.url.includes('/panel/index.html'),
    )
  }, 10_000)
  const client = await connect(panel.webSocketDebuggerUrl)
  await evaluate(client, `localStorage.setItem('st-qa-capture', 'true')`)
  return client
}

async function clickButton(client: CdpClient, matcher: string) {
  await evaluate(client, `
    (() => {
      const matcher = ${JSON.stringify(matcher)}
      const button = [...document.querySelectorAll('button')].find(btn =>
        btn.innerText.trim() === matcher ||
        btn.title === matcher ||
        btn.getAttribute('aria-label') === matcher
      )
      if (!(button instanceof HTMLButtonElement)) throw new Error('No button found: ' + matcher)
      button.click()
    })()
  `)
}

async function captureState(panelClient: CdpClient, predicate: (capture: any) => boolean, label: string) {
  return waitFor(label, async () => {
    const capture = await evaluate<any>(panelClient, `
      typeof window.__steepedQaCapture === 'function' ? window.__steepedQaCapture() : null
    `)
    return capture && predicate(capture) ? capture : null
  })
}

async function summarize(panelClient: CdpClient, mode?: string) {
  if (mode) await clickButton(panelClient, mode)
  await clickButton(panelClient, 'Summarize')
  return captureState(panelClient, capture => capture.panel?.view === 'summary' && (capture.summaryText || '').length > 120, 'summary')
}

async function setPanelWidth(pageClient: CdpClient, width: number) {
  await evaluate(pageClient, `
    (() => {
      const iframe = document.querySelector('#steeped-panel')
      const handle = document.querySelector('#steeped-resize')
      if (iframe instanceof HTMLElement) iframe.style.width = '${width}px'
      if (handle instanceof HTMLElement) handle.style.right = '${width - 3}px'
      document.documentElement.style.marginRight = '${width}px'
    })()
  `)
}

async function resetStorage() {
  const page = await newPage(`${extensionOrigin}/panel/index.html`)
  const client = await connect(page.webSocketDebuggerUrl)
  await client.call('Page.enable')
  await waitFor('extension storage API', () => evaluate<boolean>(client, `
    Boolean(globalThis.chrome?.storage?.local)
  `).then(Boolean), 10_000)
  await evaluate(client, `
    chrome.storage.local.clear().then(() => {
      localStorage.setItem('st-qa-capture', 'true')
      return chrome.storage.local.set({ apiKey: ${JSON.stringify(apiKey)}, darkMode: true, stPanelWidth: 380 })
    })
  `)
  client.close()
  await closeTarget(page)
}

async function findExtensionOrigin(): Promise<string> {
  if (extensionOrigin) return extensionOrigin

  const currentTargets = await targets()
  const extensionTarget = currentTargets.find(target =>
    target.url.startsWith('chrome-extension://') &&
    (
      target.url.includes('/panel/index.html') ||
      target.url.includes('/background/service-worker.js') ||
      target.type === 'service_worker'
    ),
  )
  if (!extensionTarget) {
    throw new Error('Could not find loaded Steeped extension. Start Chrome/Brave with --load-extension=dist or pass --extension-id=<id>.')
  }

  const extensionMatch = extensionTarget.url.match(/^chrome-extension:\/\/([^/]+)/)
  if (!extensionMatch) {
    throw new Error(`Loaded extension target has an unexpected URL: ${extensionTarget.url}`)
  }
  extensionId = extensionMatch[1]
  const origin = `chrome-extension://${extensionId}`
  extensionOrigin = origin
  return origin
}

async function saveDemoKeyForScreenshot() {
  const page = await newPage(`${extensionOrigin}/panel/index.html`)
  const client = await connect(page.webSocketDebuggerUrl)
  await client.call('Page.enable')
  await waitFor('extension storage API', () => evaluate<boolean>(client, `
    Boolean(globalThis.chrome?.storage?.local)
  `).then(Boolean), 10_000)
  await evaluate(client, `
    chrome.storage.local.set({
      apiKey: 'sk-ant-api03-demo-screenshot-key-0000',
      darkMode: true,
      stPanelWidth: 380,
    })
  `)
  client.close()
  await closeTarget(page)
}

async function main() {
  await findExtensionOrigin()
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is required for screenshot capture.')

  if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  await resetStorage()

  const readyPage = await openContent(readyUrl)
  const readyPanel = await openPanel(readyPage)
  await captureState(readyPanel, capture => capture.panel?.view === 'ready', 'ready panel')
  await screenshot(readyPage, '01-big-reads-small-notes-live.png')
  readyPanel.close()
  readyPage.close()

  const sourcesPage = await openContent(sourcesUrl)
  const sourcesPanel = await openPanel(sourcesPage)
  await summarize(sourcesPanel)
  await setPanelWidth(sourcesPage, 500)
  await evaluate(sourcesPanel, `
    (() => {
      const cite = document.querySelector('button[aria-label^="Open source chunk"]')
      if (cite instanceof HTMLElement) cite.click()
    })()
  `)
  await sleep(500)
  await screenshot(sourcesPage, '02-sources-attached-live.png')
  sourcesPanel.close()
  sourcesPage.close()

  const threadPage = await openContent(threadUrl)
  const threadPanel = await openPanel(threadPage)
  await summarize(threadPanel)
  await setPanelWidth(threadPage, 500)
  await evaluate(threadPanel, `
    (() => {
      const input = document.querySelector('input[placeholder="Ask about this page"]')
      if (!(input instanceof HTMLInputElement)) throw new Error('No chat input')
      input.value = 'What should I read first?'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })()
  `)
  await captureState(threadPanel, capture =>
    capture.panel?.view === 'summary' &&
    Array.isArray(capture.chatMessages) &&
    capture.chatMessages.some((message: any) => message.role === 'assistant'),
    'chat answer',
  )
  await evaluate(threadPanel, `
    (() => {
      const labels = [...document.querySelectorAll('span')].filter(el => (el.textContent || '').includes('Follow-up'))
      labels.at(-1)?.scrollIntoView({ block: 'start' })
    })()
  `)
  await sleep(500)
  await screenshot(threadPage, '03-ask-about-same-page-live.png')
  threadPanel.close()
  threadPage.close()

  const historyPage = await openContent(historyUrl)
  const historyPanel = await openPanel(historyPage)
  await summarize(historyPanel)
  await clickButton(historyPanel, 'History')
  await sleep(750)
  await screenshot(historyPage, '05-local-history-live.png')
  historyPanel.close()
  historyPage.close()

  await saveDemoKeyForScreenshot()
  const settingsPage = await newPage(`${extensionOrigin}/settings/settings.html`)
  const settingsClient = await connect(settingsPage.webSocketDebuggerUrl)
  await settingsClient.call('Page.enable')
  await setViewport(settingsClient)
  await settingsClient.call('Page.bringToFront')
  await waitDocument(settingsClient)
  await sleep(500)
  await screenshot(settingsClient, '04-your-key-stays-in-chrome-live.png')
  settingsClient.close()

  writeManifest()
  process.exit(0)
}

main().catch(error => {
  console.error(error instanceof Error ? (error.stack || error.message) : error)
  process.exit(1)
})
