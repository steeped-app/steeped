// Steeped — Content Extractor
// Dynamically injected by the service worker when summarization is requested.
// Extracts page content via Readability, chunks it, and sends back to the service worker.

import { Readability } from '@mozilla/readability'
import type { ExtractionWarning, SurfaceInfo, SurfaceKind, SurfacePagePosition } from '../lib/types'
import { extractPdfFromUrl, isLikelyPdfUrl } from '../lib/pdf'

export interface Chunk {
  id: number
  text: string
}

export const MAX_CHUNKS = 30
export const TARGET_CHUNK_SIZE = 2000 // chars, ~500 tokens
export const DISCUSSION_CHUNK_SIZE = 1200 // tighter citations for reply-heavy pages
export const MAX_CHUNK_SIZE = 3500
export const PARTIAL_ACCESS_MESSAGE =
  'This page looks partly locked. Steeped summarized the text your browser exposed.'
const DYNAMIC_CONTENT_WAIT_MS = 5_000

export function chunkText(text: string, targetChunkSize = TARGET_CHUNK_SIZE): Chunk[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(p => p.length > 15)

  const chunks: Chunk[] = []
  let current = ''
  let id = 1

  for (const para of paragraphs) {
    if (para.length > MAX_CHUNK_SIZE) {
      if (current.trim().length > 15) {
        chunks.push({ id: id++, text: current.trim() })
        current = ''
        if (chunks.length >= MAX_CHUNKS) break
      }

      for (const part of splitOversizedParagraph(para, targetChunkSize)) {
        chunks.push({ id: id++, text: part })
        if (chunks.length >= MAX_CHUNKS) break
      }
      if (chunks.length >= MAX_CHUNKS) break
      continue
    }

    if (current.length + para.length > targetChunkSize && current.length > 300) {
      chunks.push({ id: id++, text: current.trim() })
      current = ''
      if (chunks.length >= MAX_CHUNKS) break
    }

    current += para + '\n\n'

    if (current.length > MAX_CHUNK_SIZE) {
      chunks.push({ id: id++, text: current.trim() })
      current = ''
      if (chunks.length >= MAX_CHUNKS) break
    }
  }

  if (current.trim().length > 15 && chunks.length < MAX_CHUNKS) {
    chunks.push({ id: id++, text: current.trim() })
  }

  return chunks
}

function splitOversizedParagraph(text: string, targetChunkSize: number): string[] {
  const lines = text
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean)
  const units = lines.length > 1 ? lines : text.match(new RegExp(`.{1,${targetChunkSize}}(?:\\s+|$)`, 'g')) || [text]
  const chunks: string[] = []
  let current = ''

  for (const unit of units) {
    const separator = current ? '\n' : ''
    if (current.length + separator.length + unit.length > targetChunkSize && current.length > 300) {
      chunks.push(current.trim())
      current = ''
    }

    current += `${current ? '\n' : ''}${unit}`

    if (current.length > MAX_CHUNK_SIZE) {
      chunks.push(current.trim())
      current = ''
    }
  }

  if (current.trim().length > 15) chunks.push(current.trim())
  return chunks
}

export function detectAccessWarnings(text: string): ExtractionWarning[] {
  const normalized = text.replace(/\s+/g, ' ').toLowerCase()
  const paywallSignals = [
    /\bsubscribe (to continue|to keep reading|for full access|to read|now to read)\b/,
    /\bsign in (to continue|to read|for full access)\b/,
    /\bcreate (?:a free )?account (to continue|to read|for full access)\b/,
    /\balready (?:a )?subscriber\??\b/,
    /\bthis (?:article|story|content) is (?:for|available to) subscribers\b/,
    /\bcontinue reading (?:with|by subscribing|after subscribing)\b/,
    /\bto continue reading,? subscribe\b/,
    /\bunlock (?:this|the) (?:article|story)\b/,
    /\byou have reached your (?:free )?(?:article|monthly|metered) limit\b/,
    /\bsubscribe for unlimited access\b/,
  ]

  if (!paywallSignals.some(signal => signal.test(normalized))) return []

  return [{
    code: 'possible-paywall',
    message: PARTIAL_ACCESS_MESSAGE,
  }]
}

function countMatches(text: string, patterns: RegExp[]): number {
  return patterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0)
}

function countDomMatches(root: ParentNode, selectors: string[]): number {
  return selectors.reduce((max, selector) => {
    try {
      return Math.max(max, root.querySelectorAll(selector).length)
    } catch {
      return max
    }
  }, 0)
}

function pagePositionFromUrl(url: URL): SurfacePagePosition {
  const path = url.pathname.toLowerCase()
  const params = url.searchParams
  const pageParam = params.get('page') || params.get('p')
  const startParam = params.get('start') || params.get('offset')

  if (
    /(?:^|\/)(?:page|p)\/[2-9]\d*(?:\/|$)/.test(path) ||
    /(?:^|\/|-)page-[2-9]\d*(?:-|\/|$)/.test(path) ||
    /comment-page-[2-9]\d*/.test(path) ||
    (pageParam && Number(pageParam) > 1) ||
    (startParam && Number(startParam) > 0)
  ) {
    return 'later-page'
  }

  return 'unknown'
}

function rankingSignals(text: string, root: ParentNode): string[] {
  const normalized = text.replace(/\s+/g, ' ').toLowerCase()
  const signals = new Set<string>()

  if (/\b(upvote|upvotes|vote|votes|points?|score)\b/.test(normalized)) signals.add('votes')
  if (/\b(like|likes|liked|reaction|reactions|reputation)\b/.test(normalized)) signals.add('reactions')
  if (/\b(accepted answer|accepted solution|solution|best answer|marked as solution)\b/.test(normalized)) signals.add('accepted-answer')
  if (/\b(maintainer|moderator|admin|staff|owner|author)\b/.test(normalized)) signals.add('role-badges')

  const selectorSignals: [string, string][] = [
    ['[aria-label*="upvote" i], [aria-label*="vote" i], [data-score], .score, .js-vote-count', 'votes'],
    ['[aria-label*="like" i], [title*="like" i], .reaction, .reactions, .likes, .ipsReact', 'reactions'],
    ['.accepted-answer, .js-accepted-answer-indicator, [itemprop="acceptedAnswer"], [aria-label*="accepted" i]', 'accepted-answer'],
    ['.author, .moderator, .staff, .badge, [aria-label*="maintainer" i]', 'role-badges'],
  ]

  for (const [selector, signal] of selectorSignals) {
    try {
      if (root.querySelector(selector)) signals.add(signal)
    } catch {}
  }

  return [...signals]
}

export function detectSurfaceInfo(urlString: string, title: string, text: string, root: ParentNode = document): SurfaceInfo {
  let url: URL
  try {
    url = new URL(urlString)
  } catch {
    url = new URL('https://example.invalid/')
  }

  const host = url.hostname.replace(/^www\./, '').toLowerCase()
  const path = url.pathname.toLowerCase()
  const normalized = `${title}\n${text}`.replace(/\s+/g, ' ').toLowerCase()
  const reasons: string[] = []
  let score = 0
  let kind: SurfaceKind = 'unknown'

  const knownRules: Array<{ match: boolean; points: number; kind: SurfaceKind; reason: string }> = [
    { match: /(^|\.)reddit\.com$/.test(host) && /\/comments\//.test(path), points: 6, kind: 'discussion-thread', reason: 'Reddit comments URL' },
    { match: host === 'news.ycombinator.com' && url.searchParams.has('id'), points: 6, kind: 'discussion-thread', reason: 'Hacker News item URL' },
    { match: host === 'github.com' && /\/issues\/\d+/.test(path), points: 6, kind: 'issue-thread', reason: 'GitHub issue URL' },
    { match: host === 'github.com' && /\/discussions\/\d+/.test(path), points: 6, kind: 'discussion-thread', reason: 'GitHub discussion URL' },
    { match: /(^|\.)stackoverflow\.com$/.test(host) && /\/questions\/\d+/.test(path), points: 6, kind: 'qa-thread', reason: 'Stack Overflow question URL' },
    { match: /\/(?:t|topic|topics|thread|threads|discussion|discussions)\//.test(path), points: 3, kind: 'discussion-thread', reason: 'forum-style URL path' },
    { match: /\/questions?\//.test(path), points: 3, kind: 'qa-thread', reason: 'question-style URL path' },
  ]

  for (const rule of knownRules) {
    if (!rule.match) continue
    score += rule.points
    kind = rule.kind
    reasons.push(rule.reason)
    break
  }

  const textSignals = countMatches(normalized, [
    /\b(original poster|thread starter|topic starter|op\b|started this topic)\b/,
    /\b(repl(?:y|ies)|comment(?:s|ed)?|responded|posted|quote|quoted)\b/,
    /\b(recommended posts|popular posts|top comments|best comments)\b/,
    /\b(accepted answer|accepted solution|marked as solution|best answer)\b/,
    /\b(member|members|moderator|admin|staff|maintainer)\b/,
    /\b(likes?|reactions?|upvotes?|votes?|points?|reputation)\b/,
  ])

  if (textSignals >= 3) {
    score += 3
    reasons.push('multiple discussion words')
  } else if (textSignals >= 1) {
    score += 1
  }

  const repeatedPosts = countDomMatches(root, [
    '[itemprop="comment"]',
    '[itemprop="answer"]',
    '[data-post-id]',
    '[data-comment-id]',
    '[id^="post-"]',
    'article',
    '.comment',
    '.reply',
    '.post',
    '.message',
    '.ipsComment',
    '.bbWrapper',
    '.topic-post',
    '.cooked',
    '.js-comment',
    '.TimelineItem',
  ])

  if (repeatedPosts >= 5) {
    score += 3
    reasons.push('repeated post blocks')
  } else if (repeatedPosts >= 3) {
    score += 2
    reasons.push('repeated reply-like blocks')
  }

  if (kind === 'unknown' && /\b(article|post|story)\b/.test(normalized) && /\bcomments?\b/.test(normalized) && repeatedPosts >= 3) {
    kind = 'commented-article'
    reasons.push('article with visible comments')
  }

  if (kind === 'unknown' && score >= 3) kind = textSignals >= 2 ? 'discussion-thread' : 'unknown'

  const pagePosition = pagePositionFromUrl(url)
  const rootPostVisible = pagePosition === 'later-page'
    ? false
    : /\b(original poster|thread starter|topic starter|asked|question|issue opened|opened this issue|post #?1)\b/.test(normalized)
      ? true
      : 'unknown'

  const confidence = score >= 6 ? 'high' : score >= 3 ? 'medium' : 'low'
  const signals = rankingSignals(text, root)
  const label = kind === 'issue-thread'
    ? 'Issue thread'
    : kind === 'qa-thread'
      ? 'Q&A thread'
      : kind === 'commented-article'
        ? 'Comment discussion'
        : 'Discussion'

  if (kind === 'unknown') {
    return {
      kind: 'unknown',
      confidence: 'low',
      label: 'Regular page',
      reason: reasons[0] || 'No discussion structure detected',
      rootPostVisible,
      pagePosition,
      rankingSignals: signals,
    }
  }

  return {
    kind,
    confidence,
    label,
    reason: reasons.slice(0, 3).join('; ') || 'Discussion structure detected',
    rootPostVisible,
    pagePosition,
    rankingSignals: signals,
  }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function isGitHubPage(): boolean {
  return window.location.hostname === 'github.com'
}

function isRedditPage(): boolean {
  const host = window.location.hostname.replace(/^www\./, '').toLowerCase()
  return host === 'reddit.com' || host.endsWith('.reddit.com')
}

function hasRedditThreadDom(): boolean {
  return Boolean(document.querySelector('shreddit-post, shreddit-comment, .thing.link, .commentarea .thing.comment'))
}

function isGitHubIssueLikePage(): boolean {
  return isGitHubPage() && /\/(?:issues|discussions)\/\d+/.test(window.location.pathname)
}

function hasGitHubIssueContent(): boolean {
  if (!isGitHubIssueLikePage()) return true
  const issueText = [
    '[data-testid="issue-viewer-issue-container"]',
    '[data-testid="issue-body"]',
    '[data-testid="markdown-body"]',
    '.markdown-body',
  ]
    .map(selector => (document.querySelector(selector) as HTMLElement | null)?.innerText?.trim() || '')
    .find(text => text.length > 40)

  return Boolean(issueText)
}

async function waitForDynamicContent() {
  if (!isGitHubPage()) return

  const deadline = Date.now() + DYNAMIC_CONTENT_WAIT_MS
  let lastLength = -1
  let stableTicks = 0

  while (Date.now() < deadline) {
    const length = document.body?.innerText?.length || 0
    const stable = Math.abs(length - lastLength) < 80
    stableTicks = stable ? stableTicks + 1 : 0
    lastLength = length

    if (hasGitHubIssueContent() && stableTicks >= 2) return
    await sleep(300)
  }
}

const NOISY_VISIBLE_TEXT_LINES = [
  /^skip to main content$/i,
  /^skip to (?:last reply|top)$/i,
  /^existing user\? sign in sign up$/i,
  /^sign (?:in|up)$/i,
  /^log in$/i,
  /^register$/i,
  /^advertise on reddit$/i,
  /^open (?:chat|inbox)$/i,
  /^create (?:post|community|custom feed)$/i,
  /^expand user menu$/i,
  /^go to (?:.+)$/i,
  /^search in (?:.+)$/i,
  /^search (?:forums|community|this topic|this thread)?$/i,
  /^post as a separate comment$/i,
  /^home$/i,
  /^forums$/i,
  /^topics$/i,
  /^categories$/i,
  /^all categories$/i,
  /^tags$/i,
  /^all tags$/i,
  /^reply to this topic$/i,
  /^start new topic$/i,
  /^jump to last$/i,
  /^next$/i,
  /^previous$/i,
  /^followers?$/i,
]

function cleanVisibleText(text: string): string {
  return text
    .replace(/\u00a0/g, ' ')
    .split(/\n+/)
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(line => line.length > 0 && !NOISY_VISIBLE_TEXT_LINES.some(pattern => pattern.test(line)))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function getElementText(element: Element, removeNestedSelector?: string): string {
  const clone = element.cloneNode(true) as HTMLElement

  clone.querySelectorAll('script, style, noscript, nav, header, footer, aside, faceplate-tracker').forEach(node => node.remove())
  if (removeNestedSelector) {
    clone.querySelectorAll(removeNestedSelector).forEach(node => node.remove())
  }

  return cleanVisibleText(clone.innerText || clone.textContent || '')
}

function getRedditThreadText(): string {
  const parts: string[] = []
  const seen = new Set<string>()

  const appendText = (text: string) => {
    const cleaned = cleanVisibleText(text)
    if (cleaned.length < 25 || seen.has(cleaned)) return
    seen.add(cleaned)
    parts.push(cleaned)
  }

  const postSelectors = [
    'shreddit-post',
    '.thing.link > .entry',
    '[data-testid="post-container"]',
    '[data-testid="post-content"]',
    '[data-test-id="post-content"]',
    'main article:first-of-type',
  ]

  const commentSelectors = [
    'shreddit-comment',
    '.commentarea .thing.comment > .entry',
    '[data-testid="comment"]',
    '[data-test-id="comment"]',
    '[data-comment-id]',
    '[id^="t1_"]',
  ]

  for (const selector of postSelectors) {
    const post = document.querySelector(selector)
    if (!post) continue
    appendText(getElementText(post))
    if (parts.length > 0) break
  }

  for (const selector of commentSelectors) {
    const comments = [...document.querySelectorAll(selector)].slice(0, 80)
    if (comments.length === 0) continue

    for (const comment of comments) {
      appendText(getElementText(comment, selector))
    }
    break
  }

  if (parts.join('\n\n').length > 120) return parts.join('\n\n')

  const mainText = getElementText(document.querySelector('main') || document.body)
  return mainText.length > 200 ? mainText : cleanVisibleText(document.body.innerText || document.body.textContent || '')
}

function getStructuredThreadText(): string {
  const selectors = [
    'article[data-post-id]',
    '[data-post-id]',
    '.topic-post',
    '.ipsComment',
    '.cPost',
    'article.message',
    '.message',
    '[id^="post-"]',
    '[itemprop="comment"]',
    '[data-comment-id]',
  ]
  const title = cleanVisibleText((document.querySelector('h1') as HTMLElement | null)?.innerText || document.title || '')

  for (const selector of selectors) {
    let nodes: Element[] = []
    try {
      nodes = [...document.querySelectorAll(selector)].slice(0, 100)
    } catch {
      continue
    }
    if (nodes.length < 2) continue

    const posts = nodes
      .map(node => getElementText(node))
      .filter(text => text.length > 45)

    if (posts.length < 2) continue
    const text = [title, ...posts].filter(Boolean).join('\n\n')
    if (text.length > 250) return text
  }

  return ''
}

export function getPrimaryVisibleText(): string {
  if ((isRedditPage() && /\/comments\//.test(window.location.pathname)) || hasRedditThreadDom()) {
    return getRedditThreadText()
  }

  if (isGitHubPage()) {
    const mainText = cleanVisibleText((document.querySelector('main') as HTMLElement | null)?.innerText || '')
    if (mainText && mainText.length > 200) return mainText
  }

  const structuredThreadText = getStructuredThreadText()
  if (structuredThreadText.length > 200) return structuredThreadText

  return cleanVisibleText(document.body.innerText || '')
}

async function extract(): Promise<{ title: string; url: string; chunks: Chunk[]; warnings: ExtractionWarning[]; surfaceInfo: SurfaceInfo }> {
  await waitForDynamicContent()

  const title = document.title
  const url = window.location.href

  if (isLikelyPdfUrl(url)) {
    try {
      const pdfExtraction = await extractPdfFromUrl(url, title)
      if (pdfExtraction.chunks.length) {
        return {
          title: pdfExtraction.title,
          url: pdfExtraction.url,
          chunks: pdfExtraction.chunks,
          warnings: pdfExtraction.warnings || [],
          surfaceInfo: pdfExtraction.surfaceInfo || detectSurfaceInfo(url, title, '', document),
        }
      }
    } catch {
      // Fall back to the visible PDF viewer text below. If Chrome exposes no
      // text there either, the service worker will show the standard extraction
      // error.
    }
  }

  const bodyText = getPrimaryVisibleText()
  const fullBodyText = document.body.innerText || ''
  const surfaceInfo = detectSurfaceInfo(url, title, bodyText, document)
  let textContent = ''

  // Try Readability — best for article-like pages (blogs, docs, news)
  try {
    const doc = document.cloneNode(true) as Document
    const article = new Readability(doc).parse()
    const extracted = article?.textContent?.trim() || ''

    // Use Readability only if it captured a meaningful share of the visible content.
    // On forums/Reddit/GitHub issues, Readability strips comments — the most valuable part.
    // If it got less than 40% of the page text, fall back to innerText.
    if (
      surfaceInfo.confidence !== 'high' &&
      extracted.length > 200 &&
      extracted.length > bodyText.length * 0.4
    ) {
      textContent = extracted
    }
  } catch {
    // Fallback below covers pages Readability cannot parse.
  }

  // Fallback: full visible text (includes comments, threads, etc.)
  if (!textContent) {
    textContent = bodyText
  }

  // Truncate very large pages (~100K chars ≈ 25K tokens)
  if (textContent.length > 100_000) {
    textContent = textContent.slice(0, 100_000)
  }

  const chunkSize = surfaceInfo.kind === 'unknown' || surfaceInfo.kind === 'article'
    ? TARGET_CHUNK_SIZE
    : DISCUSSION_CHUNK_SIZE
  const chunks = chunkText(textContent, chunkSize)
  const warnings = detectAccessWarnings(fullBodyText)
  return { title, url, chunks, warnings, surfaceInfo }
}

// Execute immediately and report results — only when loaded as a content script.
// Unit tests import this module without a chrome runtime; skip the side effect there.
if (typeof chrome !== 'undefined' && chrome?.runtime?.id) {
  // The service worker injects a prelude that sets window.__steepedReqId before loading
  // this script — we echo it back so concurrent requests don't cross their streams.
  const requestId = (window as unknown as { __steepedReqId?: string }).__steepedReqId
  extract().then(result => {
    chrome.runtime.sendMessage({
      type: 'steeped:extracted',
      requestId,
      title: result.title,
      url: result.url,
      chunks: result.chunks,
      warnings: result.warnings,
      surfaceInfo: result.surfaceInfo,
    })
  })
}
