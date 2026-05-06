import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { MODEL_ID } from '../src/lib/prompts'
import { parseSteepedNote } from '../src/lib/note'
import type { Chunk, ExtractionWarning, SurfaceInfo } from '../src/lib/types'

type SummaryMode = 'concise' | 'detailed' | 'simplify' | 'translate'

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

interface LiveTarget {
  id: string
  surface: string
  url: string
  mode?: SummaryMode
  timeoutMs?: number
  expectFailure?: boolean
}

interface LiveCapture {
  schema?: string
  capturedAt?: string
  panel?: {
    width?: number
    height?: number
    darkMode?: boolean
    view?: string
  }
  page?: {
    title?: string
    url?: string
    domain?: string
  }
  mode?: SummaryMode
  surfaceInfo?: SurfaceInfo
  discussionNoteActive?: boolean
  discussionNotePreference?: string
  summaryText?: string
  chunks?: Chunk[]
  extractionWarnings?: ExtractionWarning[]
  error?: string
}

interface VisualCheck {
  width: number
  iframeWidth: number
  panelViewportWidth: number
  bodyScrollWidth: number
  bodyClientWidth: number
  horizontalOverflow: boolean
  overflowNodeCount: number
  rawMarkdownLeak: boolean
  emptyCitationChips: number
}

interface RubricScore {
  extractionQuality: number
  sourceChunkQuality: number
  outputFidelity: number
  citationIntegrity: number
  renderedSidebarQuality: number
  voiceAndWordEconomy: number
  runtimeUx: number
  total: number
  pass: boolean
  hardStops: string[]
  notes: string
}

interface LiveResult {
  id: string
  surface: string
  url: string
  mode: SummaryMode
  status: 'pass' | 'fail' | 'exception'
  startedAt: string
  finishedAt: string
  elapsedMs: number
  pageOpened: boolean
  panelOpened: boolean
  summaryLength: number
  chunkCount: number
  warningCount: number
  error?: string
  capturePath?: string
  screenshotPath?: string
  visualChecks: VisualCheck[]
  score?: RubricScore
}

const DEFAULT_TARGETS: LiveTarget[] = [
  {
    id: 'wikipedia-tea',
    surface: 'Wikipedia long article',
    url: 'https://en.wikipedia.org/wiki/Tea',
  },
  {
    id: 'mdn-promise',
    surface: 'Technical docs',
    url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise',
  },
  {
    id: 'github-vscode-issue',
    surface: 'GitHub issue thread',
    url: 'https://github.com/microsoft/vscode/issues/204861',
  },
  {
    id: 'reddit-programming',
    surface: 'Reddit thread',
    url: 'https://old.reddit.com/r/programming/comments/1bvih6t/my_attempt_to_explain_the_xz_backdoor/',
  },
  {
    id: 'hacker-news-classic',
    surface: 'Hacker News discussion',
    url: 'https://news.ycombinator.com/item?id=8863',
  },
  {
    id: 'stackoverflow-branch-prediction',
    surface: 'Developer forum',
    url: 'https://stackoverflow.com/questions/11227809/why-is-processing-a-sorted-array-faster-than-processing-an-unsorted-array',
  },
  {
    id: 'home-assistant-community-thread',
    surface: 'Niche Discourse community thread',
    url: 'https://community.home-assistant.io/t/home-assistant-scaleability-for-a-larger-house/15574',
  },
  {
    id: 'cloudynights-eyepieces-topic',
    surface: 'Niche hobby forum thread',
    url: 'https://www.cloudynights.com/topic/920039-figuring-out-eyepieces/',
  },
  {
    id: 'reef2reef-thread',
    surface: 'Niche hobby forum with reactions',
    url: 'https://www.reef2reef.com/threads/more-threads-but-i-get-yelled-at-for-starting-them.1105950/',
  },
  {
    id: 'joshw-css-reset',
    surface: 'Long-form dev blog',
    url: 'https://www.joshwcomeau.com/css/custom-css-reset/',
  },
  {
    id: 'nytimes-homepage',
    surface: 'News/paywall boundary',
    url: 'https://www.nytimes.com/',
  },
  {
    id: 'public-google-doc',
    surface: 'Published Google Doc',
    url: 'https://docs.google.com/document/d/e/2PACX-1vREpa1y-pGsmPb2plWHsWEHTq8McIUaXWZeV4rbJ0YsqqOk1cbZysDdQfRyKqRKTBCI2GEQlDTkWd_b/pub',
    timeoutMs: 45_000,
  },
  {
    id: 'ja-wikipedia-tokyo',
    surface: 'Non-English page',
    url: 'https://ja.wikipedia.org/wiki/%E6%9D%B1%E4%BA%AC',
    mode: 'translate',
  },
  {
    id: 'irs-pdf',
    surface: 'PDF in Chrome',
    url: 'https://www.irs.gov/pub/irs-pdf/fw4.pdf',
    expectFailure: true,
    timeoutMs: 35_000,
  },
  {
    id: 'github-repo',
    surface: 'App-like page',
    url: 'https://github.com/vitejs/vite',
  },
]

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
const outRoot = args.get('out') || 'eval/live-results'
const limit = args.has('limit') ? Number(args.get('limit')) : DEFAULT_TARGETS.length
const widths = (args.get('widths') || '300,380,520,700')
  .split(',')
  .map(width => Number(width.trim()))
  .filter(Boolean)
const runJudge = args.get('judge') === 'true'
const timeoutMs = Number(args.get('timeout-ms') || '70_000'.replace('_', ''))
const cdpCallTimeoutMs = Number(args.get('cdp-timeout-ms') || '15_000'.replace('_', ''))
const judgeTimeoutMs = Number(args.get('judge-timeout-ms') || '45_000'.replace('_', ''))
const onlyIds = (args.get('only') || '')
  .split(',')
  .map(id => id.trim())
  .filter(Boolean)
const key = process.env.ANTHROPIC_API_KEY || ''

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80)
}

function parseTargetFile(): LiveTarget[] {
  const targetPath = args.get('targets')
  if (!targetPath) return DEFAULT_TARGETS
  return JSON.parse(readFileSync(resolve(process.cwd(), targetPath), 'utf8')) as LiveTarget[]
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

async function newPage(url: string): Promise<CdpTarget> {
  await httpText(`/json/new?${encodeURIComponent(url)}`, 'PUT')
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const target = (await targets()).find(item => item.type === 'page' && item.url.startsWith(url.slice(0, 36)))
    if (target) return target
    await sleep(250)
  }
  throw new Error(`Could not open page target for ${url}`)
}

function connect(wsUrl: string): Promise<CdpClient> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    let id = 0
    const pending = new Map<number, {
      resolve: (value: any) => void
      reject: (error: Error) => void
      timeout: ReturnType<typeof setTimeout>
    }>()

    ws.addEventListener('open', () => {
      resolve({
        call(method, params = {}) {
          return new Promise((callResolve, callReject) => {
            id += 1
            const callId = id
            const timeout = setTimeout(() => {
              pending.delete(callId)
              callReject(new Error(`CDP ${method} timed out after ${cdpCallTimeoutMs}ms`))
            }, cdpCallTimeoutMs)
            pending.set(callId, { resolve: callResolve, reject: callReject, timeout })
            try {
              ws.send(JSON.stringify({ id: callId, method, params }))
            } catch (error) {
              clearTimeout(timeout)
              pending.delete(callId)
              callReject(error instanceof Error ? error : new Error(String(error)))
            }
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
      clearTimeout(item.timeout)
      if (message.error) item.reject(new Error(JSON.stringify(message.error)))
      else item.resolve(message.result)
    })

    ws.addEventListener('error', () => reject(new Error(`Could not connect to ${wsUrl}`)))
    ws.addEventListener('close', () => {
      for (const item of pending.values()) {
        clearTimeout(item.timeout)
        item.reject(new Error(`CDP socket closed for ${wsUrl}`))
      }
      pending.clear()
    })
  })
}

async function evaluate<T>(client: CdpClient, expression: string): Promise<T> {
  const result = await client.call<{ result: { value: T } }>('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  return result.result.value
}

async function setupExtensionStorage(outDir: string) {
  if (!key) throw new Error('ANTHROPIC_API_KEY is required for live QA.')
  const panelUrl = await findExtensionPanelUrl()
  const page = await newPage(panelUrl)
  const client = await connect(page.webSocketDebuggerUrl)
  const keyJson = JSON.stringify(key)
  const state = await evaluate(client, `
    chrome.storage.local.set({ apiKey: ${keyJson}, darkMode: true, stPanelWidth: 380 }).then(() => {
      localStorage.setItem('st-qa-capture', 'true')
      return chrome.storage.local.get(['apiKey', 'darkMode', 'stPanelWidth']).then(v => ({
        hasApiKey: Boolean(v.apiKey),
        keyLength: v.apiKey ? v.apiKey.length : 0,
        darkMode: v.darkMode,
        stPanelWidth: v.stPanelWidth,
        capture: localStorage.getItem('st-qa-capture'),
      }))
    })
  `)
  client.close()
  writeFileSync(join(outDir, 'extension-storage-check.json'), JSON.stringify(state, null, 2))
}

async function findExtensionPanelUrl(): Promise<string> {
  const extensionId = args.get('extension-id')
  if (extensionId) return `chrome-extension://${extensionId}/panel/index.html`

  const target = (await targets()).find(item => item.url.startsWith('chrome-extension://') && item.url.includes('/panel/index.html'))
  if (target) return target.url

  const worker = (await targets()).find(item => item.type === 'service_worker' && item.url.startsWith('chrome-extension://'))
  if (worker) {
    const origin = worker.url.match(/^(chrome-extension:\/\/[^/]+)/)?.[1]
    if (!origin) throw new Error(`Could not parse extension origin from ${worker.url}`)
    return `${origin}/panel/index.html`
  }

  throw new Error('Could not find loaded Steeped extension. Start Chrome/Brave with --load-extension=dist first.')
}

async function cleanupTargets() {
  const current = await targets()
  const pages = current.filter(target =>
    target.type === 'page' &&
    (target.url.startsWith('http://') || target.url.startsWith('https://')),
  )
  await Promise.all(pages.map(closeTarget))
  await sleep(750)
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
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const ready = await evaluate<{ state: string; title: string; bodyLength: number }>(client, `
      ({ state: document.readyState, title: document.title, bodyLength: document.body?.innerText?.length || 0 })
    `)
    if ((ready.state === 'interactive' || ready.state === 'complete') && ready.bodyLength > 100) return ready
    await sleep(500)
  }
}

async function waitForPanelOnPage(pageClient: CdpClient) {
  const deadline = Date.now() + 12_000
  while (Date.now() < deadline) {
    const state = await evaluate<{ hasPanel: boolean; width?: string }>(pageClient, `
      (() => {
        const iframe = document.querySelector('#steeped-panel')
        return { hasPanel: Boolean(iframe), width: iframe ? getComputedStyle(iframe).width : '' }
      })()
    `)
    if (state.hasPanel) return state
    await sleep(250)
  }
  throw new Error('Panel did not open from the action command shortcut.')
}

async function embeddedPanelTarget(): Promise<CdpTarget> {
  const deadline = Date.now() + 8_000
  while (Date.now() < deadline) {
    const target = (await targets()).find(item =>
      item.type === 'iframe' &&
      item.url.startsWith('chrome-extension://') &&
      item.url.includes('/panel/index.html'),
    )
    if (target) return target
    await sleep(250)
  }
  throw new Error('Embedded panel target was not exposed over CDP.')
}

async function waitForSummary(panelClient: CdpClient, target: LiveTarget): Promise<LiveCapture> {
  const deadline = Date.now() + (target.timeoutMs || timeoutMs)
  let last: LiveCapture | null = null
  while (Date.now() < deadline) {
    last = await evaluate<LiveCapture | null>(panelClient, `
      typeof window.__steepedQaCapture === 'function' ? window.__steepedQaCapture() : null
    `) || last
    const view = last?.panel?.view
    const length = last?.summaryText?.length || 0
    if (view === 'summary' && length > 80) return last
    if (view === 'error') return last
    await sleep(500)
  }
  if (last) return last
  throw new Error('Summary timed out before QA capture became available.')
}

async function selectMode(panelClient: CdpClient, mode: SummaryMode) {
  if (mode === 'concise') return
  await evaluate(panelClient, `
    (() => {
      const button = [...document.querySelectorAll('button')].find(btn => btn.innerText.trim().toLowerCase() === ${JSON.stringify(mode)})
      if (!button) throw new Error('No mode button for ${mode}')
      button.click()
    })()
  `)
  await sleep(250)
}

async function clickSummarize(panelClient: CdpClient) {
  await evaluate(panelClient, `
    (() => {
      const button = [...document.querySelectorAll('button')].find(btn => btn.innerText.trim() === 'Summarize')
      if (!button) throw new Error('No Summarize button')
      button.click()
    })()
  `)
}

async function setPagePanelWidth(pageClient: CdpClient, width: number) {
  await evaluate(pageClient, `
    (() => {
      const width = ${width}
      const iframe = document.querySelector('#steeped-panel')
      const handle = document.querySelector('#steeped-resize')
      if (iframe instanceof HTMLElement) iframe.style.width = width + 'px'
      if (handle instanceof HTMLElement) handle.style.right = (width - 3) + 'px'
      document.documentElement.style.marginRight = width + 'px'
    })()
  `)
  await sleep(250)
}

async function visualCheck(pageClient: CdpClient, panelClient: CdpClient, width: number): Promise<VisualCheck> {
  await setPagePanelWidth(pageClient, width)
  const pageState = await evaluate<{ iframeWidth: number }>(pageClient, `
    (() => {
      const iframe = document.querySelector('#steeped-panel')
      return { iframeWidth: iframe ? Math.round(iframe.getBoundingClientRect().width) : 0 }
    })()
  `)
  const panelState = await evaluate<Omit<VisualCheck, 'width' | 'iframeWidth'>>(panelClient, `
    (() => {
      const elements = [...document.body.querySelectorAll('*')]
      const overflow = elements.filter(el => {
        const rect = el.getBoundingClientRect()
        return rect.width > 0 && (rect.right > window.innerWidth + 2 || rect.left < -2)
      })
      const text = document.body.innerText
      return {
        panelViewportWidth: window.innerWidth,
        bodyScrollWidth: document.body.scrollWidth,
        bodyClientWidth: document.body.clientWidth,
        horizontalOverflow: document.body.scrollWidth > document.body.clientWidth + 2,
        overflowNodeCount: overflow.length,
        rawMarkdownLeak: /^#{1,6}\\s/m.test(text) || /\\*\\*[^*]+\\*\\*/.test(text),
        emptyCitationChips: [...document.querySelectorAll('button')].filter(btn => /^\\d+$/.test(btn.innerText.trim()) && btn.getBoundingClientRect().width < 12).length,
      }
    })()
  `)
  return { width, iframeWidth: pageState.iframeWidth, ...panelState }
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

function citationIds(text: string): number[] {
  return [...text.matchAll(/\[(\d+)\]/g)].map(match => Number(match[1]))
}

function wordCount(text: string): number {
  return (text.match(/[A-Za-z0-9][A-Za-z0-9'%-]*/g) || []).length
}

function localHardStops(capture: LiveCapture, checks: VisualCheck[], secret: string): string[] {
  const stops: string[] = []
  const output = capture.summaryText || ''
  const parsed = parseSteepedNote(output)
  const chunks = capture.chunks || []
  const ids = new Set(chunks.map(chunk => chunk.id))
  const citations = citationIds(output)

  if (capture.panel?.view === 'error') stops.push(`runtime error: ${capture.error || 'unknown'}`)
  if (!output.trim() && !capture.error) stops.push('blank summary output')
  if (!parsed.note && !parsed.groups.length && output.trim()) stops.push('parser fallback/raw markdown output')
  if (citations.length === 0 && output.trim()) stops.push('no citations in output')
  if (citations.some(id => !ids.has(id))) stops.push('invalid citation id in output')
  if (checks.some(check => check.horizontalOverflow)) stops.push('horizontal overflow in rendered panel')
  if (checks.some(check => check.rawMarkdownLeak)) stops.push('raw markdown leaked into rendered panel')
  if (secret && JSON.stringify(capture).includes(secret)) stops.push('API key leaked into capture')
  if (
    capture.surfaceInfo &&
    capture.surfaceInfo.kind !== 'unknown' &&
    capture.surfaceInfo.kind !== 'article' &&
    capture.surfaceInfo.confidence === 'high' &&
    capture.discussionNoteActive !== true
  ) {
    stops.push('high-confidence discussion surface did not activate Discussion note')
  }
  return stops
}

function heuristicScore(result: LiveResult, capture: LiveCapture, hardStops: string[]): RubricScore {
  const output = capture.summaryText || ''
  const parsed = parseSteepedNote(output)
  const bullets = parsed.groups.flatMap(group => group.items)
  const citations = citationIds(output)
  const citedBulletCount = bullets.filter(bullet => citationIds(bullet).length > 0).length
  const checksClean = result.visualChecks.every(check => !check.horizontalOverflow && check.overflowNodeCount === 0 && !check.rawMarkdownLeak)

  const extractionQuality = result.chunkCount > 10 ? 3 : result.chunkCount > 3 ? 2 : result.chunkCount > 0 ? 1 : 0
  const sourceChunkQuality = capture.chunks?.some(chunk => chunk.text.length > 1600) ? 2 : result.chunkCount > 0 ? 3 : 0
  const outputFidelity = output ? 2 : 0
  const citationIntegrity = citations.length && citedBulletCount === bullets.length ? 3 : citations.length ? 2 : 0
  const renderedSidebarQuality = checksClean ? 3 : result.visualChecks.some(check => check.horizontalOverflow) ? 1 : 2
  const noteWords = wordCount(parsed.note || '')
  const voiceAndWordEconomy = noteWords <= 80 && bullets.length >= 3 && bullets.length <= 8 ? 3 : output ? 2 : 0
  const runtimeUx = capture.panel?.view === 'summary' && result.summaryLength > 80 && !result.error ? 3 : result.summaryLength > 0 ? 1 : 0
  const total = extractionQuality + sourceChunkQuality + outputFidelity + citationIntegrity + renderedSidebarQuality + voiceAndWordEconomy + runtimeUx

  return {
    extractionQuality,
    sourceChunkQuality,
    outputFidelity,
    citationIntegrity,
    renderedSidebarQuality,
    voiceAndWordEconomy,
    runtimeUx,
    total,
    pass: hardStops.length === 0 && total >= 17,
    hardStops,
    notes: 'Heuristic score only. Run with --judge for rubric review against chunks/output.',
  }
}

function compactSource(capture: LiveCapture): string {
  const chunks = (capture.chunks || []).map(chunk => {
    return `[${chunk.id}]\n${chunk.text}`
  })
  return [
    `Page: ${capture.page?.title || ''}`,
    `URL: ${capture.page?.url || ''}`,
    ...chunks,
  ].join('\n\n')
}

async function callJudge(capture: LiveCapture, result: LiveResult, hardStops: string[]): Promise<RubricScore | null> {
  if (!runJudge || !capture.summaryText || !key) return null
  const system = `You are grading a browser reading extension called Steeped. Return JSON only.

Score each field 0-3 using this rubric:
- extractionQuality: main page text captured, low noise, partial/paywall behavior honest
- sourceChunkQuality: chunks are readable and citations can be verified
- outputFidelity: summary is accurate and source-supported
- citationIntegrity: factual claims have valid supporting [N] citations
- renderedSidebarQuality: formatting should survive narrow sidebars; use visual check data
- voiceAndWordEconomy: compact companion note, high value per word, not robotic
- runtimeUx: stream, error behavior, and core flow

For discussion, forum, issue, Q&A, and comment-heavy pages: reward outputs that separate the root post/question from replies, preserve visible stance differences, avoid unsupported consensus claims, and do not invent missing first-page context.

A page passes when no field is 0, total >= 17, and there are no hard stops.
Use the provided chunks and visual checks. Do not assume content beyond the chunks.`

  const user = JSON.stringify({
    surface: result.surface,
    url: result.url,
    expectedFailure: result.error,
    visualChecks: result.visualChecks,
    localHardStops: hardStops,
    detectedSurface: capture.surfaceInfo,
    discussionNoteActive: capture.discussionNoteActive,
    source: compactSource(capture),
    output: capture.summaryText,
  })

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), judgeTimeoutMs)
  let res: Response
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL_ID,
        max_tokens: 900,
        temperature: 0,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    })
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }

  if (!res.ok) return null
  const body = await res.json()
  const text = (body?.content || []).filter((block: any) => block?.type === 'text').map((block: any) => block.text).join('')
  const json = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim()
  const match = json.match(/\{[\s\S]*\}/)
  try {
    const score = JSON.parse(match?.[0] || json) as RubricScore
    score.total = Number(score.total ?? (
      score.extractionQuality +
      score.sourceChunkQuality +
      score.outputFidelity +
      score.citationIntegrity +
      score.renderedSidebarQuality +
      score.voiceAndWordEconomy +
      score.runtimeUx
    ))
    score.hardStops = [...new Set([...(score.hardStops || []), ...hardStops])]
    score.pass = score.hardStops.length === 0 && score.total >= 17 && [
      score.extractionQuality,
      score.sourceChunkQuality,
      score.outputFidelity,
      score.citationIntegrity,
      score.renderedSidebarQuality,
      score.voiceAndWordEconomy,
      score.runtimeUx,
    ].every(value => value > 0)
    return score
  } catch {
    return null
  }
}

async function runOne(target: LiveTarget, outDir: string): Promise<LiveResult> {
  const started = Date.now()
  const mode = target.mode || 'concise'
  let page: CdpTarget | null = null
  let pageClient: CdpClient | null = null
  let panelClient: CdpClient | null = null
  const result: LiveResult = {
    id: target.id,
    surface: target.surface,
    url: target.url,
    mode,
    status: 'exception',
    startedAt: new Date(started).toISOString(),
    finishedAt: '',
    elapsedMs: 0,
    pageOpened: false,
    panelOpened: false,
    summaryLength: 0,
    chunkCount: 0,
    warningCount: 0,
    visualChecks: [],
  }

  try {
    process.stderr.write(`[live] ${target.id}: opening ${target.url}\n`)
    page = await newPage(target.url)
    result.pageOpened = true
    pageClient = await connect(page.webSocketDebuggerUrl)
    await pageClient.call('Page.enable')
    await pageClient.call('Page.bringToFront')
    await waitForDocument(pageClient)

    await dispatchActionShortcut(pageClient)
    await waitForPanelOnPage(pageClient)
    result.panelOpened = true

    const panel = await embeddedPanelTarget()
    panelClient = await connect(panel.webSocketDebuggerUrl)
    await evaluate(panelClient, `localStorage.setItem('st-qa-capture', 'true')`)
    await selectMode(panelClient, mode)
    await clickSummarize(panelClient)

    const capture = await waitForSummary(panelClient, target)
    result.summaryLength = capture.summaryText?.length || 0
    result.chunkCount = capture.chunks?.length || 0
    result.warningCount = capture.extractionWarnings?.length || 0
    if (capture.error) result.error = capture.error

    for (const width of widths) {
      result.visualChecks.push(await visualCheck(pageClient, panelClient, width))
    }

    const capturePath = join(outDir, `${target.id}-capture.json`)
    writeFileSync(capturePath, JSON.stringify({ id: target.id, surface: target.surface, ...capture }, null, 2))
    result.capturePath = capturePath

    const screenshotPath = join(outDir, `${target.id}-sidebar.png`)
    await setPagePanelWidth(pageClient, 380)
    await screenshot(pageClient, screenshotPath)
    if (existsSync(screenshotPath)) result.screenshotPath = screenshotPath

    const hardStops = localHardStops(capture, result.visualChecks, key)
    const judged = await callJudge(capture, result, hardStops)
    result.score = judged || heuristicScore(result, capture, hardStops)
    result.status = result.score.pass || (target.expectFailure && capture.panel?.view === 'error') ? 'pass' : 'fail'
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error)
    result.status = target.expectFailure ? 'pass' : 'exception'
  } finally {
    panelClient?.close()
    pageClient?.close()
    if (page) await closeTarget(page)
    await sleep(750)
    const finished = Date.now()
    result.finishedAt = new Date(finished).toISOString()
    result.elapsedMs = finished - started
  }

  writeFileSync(join(outDir, `${target.id}-result.json`), JSON.stringify(result, null, 2))
  return result
}

function writeReport(outDir: string, results: LiveResult[]) {
  const rows = results.map(result => {
    const score = result.score
    return `| ${result.id} | ${result.surface} | ${result.status} | ${score?.total ?? '-'} | ${result.summaryLength} | ${result.chunkCount} | ${(score?.hardStops || []).join('; ') || result.error || ''} |`
  }).join('\n')

  const report = `# Steeped Live-Web QA

Generated: ${new Date().toISOString()}

Browser target: http://${host}:${port}
Judge: ${runJudge ? MODEL_ID : 'heuristic only'}

| Target | Surface | Status | Score | Summary chars | Chunks | Notes |
| --- | --- | --- | ---: | ---: | ---: | --- |
${rows}

## Rubric Scores

${results.map(result => {
  const score = result.score
  if (!score) return `### ${result.id}\n\nNo score. Error: ${result.error || 'unknown'}\n`
  return `### ${result.id}

- Extraction: ${score.extractionQuality}/3
- Source chunks: ${score.sourceChunkQuality}/3
- Output fidelity: ${score.outputFidelity}/3
- Citations: ${score.citationIntegrity}/3
- Rendered sidebar: ${score.renderedSidebarQuality}/3
- Voice/word economy: ${score.voiceAndWordEconomy}/3
- Runtime UX: ${score.runtimeUx}/3
- Total: ${score.total}/21
- Hard stops: ${score.hardStops.length ? score.hardStops.join('; ') : 'none'}
- Notes: ${score.notes || ''}
`
}).join('\n')}
`

  writeFileSync(join(outDir, 'report.md'), report)
}

async function main() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outDir = join(process.cwd(), outRoot, stamp)
  mkdirSync(outDir, { recursive: true })

  await cleanupTargets()
  await setupExtensionStorage(outDir)

  const allTargets = parseTargetFile()
  const selected = (onlyIds.length ? allTargets.filter(target => onlyIds.includes(target.id)) : allTargets).slice(0, limit)
  const results: LiveResult[] = []
  for (const target of selected) {
    const result = await runOne(target, outDir)
    results.push(result)
    process.stderr.write(`[live] ${target.id}: ${result.status} score=${result.score?.total ?? '-'} summary=${result.summaryLength} chunks=${result.chunkCount} error=${result.error || ''}\n`)
  }

  writeFileSync(join(outDir, 'results.json'), JSON.stringify(results, null, 2))
  const captures = results
    .filter(result => result.capturePath)
    .map(result => JSON.parse(readFileSync(result.capturePath!, 'utf8')))
  writeFileSync(join(outDir, 'captures.json'), JSON.stringify(captures, null, 2))
  writeReport(outDir, results)

  const passCount = results.filter(result => result.status === 'pass').length
  console.log(`Live QA complete: ${passCount}/${results.length} pass`)
  console.log(`Artifacts: ${outDir}`)
  process.exit(passCount !== results.length ? 1 : 0)
}

main().catch(error => {
  console.error(error instanceof Error ? (error.stack || error.message) : error)
  process.exit(1)
})
