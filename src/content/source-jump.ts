import type { Chunk } from '../lib/types'

export interface SourceJumpCache {
  url: string
  chunks: Chunk[]
  cachedAt: number
}

export interface SourceJumpResult {
  ok: boolean
  reason?: 'stale-cache' | 'url-mismatch' | 'missing-chunk' | 'no-snippet' | 'not-found'
}

export const SOURCE_JUMP_CACHE_TTL_MS = 10 * 60 * 1000
export const SOURCE_CUE_ATTR = 'data-steeped-source-cue'
const PANEL_ID = 'steeped-panel'
const HANDLE_ID = 'steeped-resize'
const MIN_SNIPPET_LENGTH = 72
const MAX_SNIPPET_LENGTH = 240
const CUE_DURATION_MS = 2200

const READABLE_SELECTOR = [
  'p',
  'li',
  'blockquote',
  'pre',
  'td',
  'th',
  'article',
  'section',
  '[role="article"]',
  '[itemprop="comment"]',
  '[itemprop="answer"]',
  '[data-post-id]',
  '[data-comment-id]',
  '[id^="post-"]',
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
].join(',')

const SOURCE_NOISE_PATTERNS = [
  /^skip to /i,
  /^existing user\?/i,
  /^(home|forums|topics|categories|tags|browse|activity|media|calendar|market|upgrade|sponsors)$/i,
  /^(log in|register|sign in|sign up|search|share|reply|quote|report)$/i,
  /^(followers?|views?|likes?|link|links|new posts|unanswered threads|today's posts|trending)$/i,
  /^page \d+ of \d+$/i,
  /^(next|previous|jump to last)$/i,
  /^#?\d+$/,
  /^posted\b/i,
  /^loc:/i,
  /^(joined|messages|reaction score|location|member|active member|well-known member)$/i,
]

export function normalizeForSourceMatch(value: string): string {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizeUrlForSourceJump(value: string): string {
  try {
    const url = new URL(value)
    url.hash = ''
    return url.toString()
  } catch {
    return value.split('#')[0]
  }
}

export function sourceCacheMatchesCurrentPage(
  cache: SourceJumpCache | null,
  currentUrl = window.location.href,
  now = Date.now(),
): boolean {
  if (!cache) return false
  if (now - cache.cachedAt > SOURCE_JUMP_CACHE_TTL_MS) return false
  return normalizeUrlForSourceJump(cache.url) === normalizeUrlForSourceJump(currentUrl)
}

export function cleanSourceLines(text: string): string[] {
  return text
    .replace(/\u00a0/g, ' ')
    .split(/\n+/)
    .map(line => normalizeForSourceMatch(line))
    .filter(line => line.length > 1 && !isSourceNoise(line))
    .flatMap(splitLongSourceLine)
    .filter(line => line.length > 1 && !isSourceNoise(line))
}

export function buildLocatorSnippets(text: string): string[] {
  const lines = cleanSourceLines(text)
  const joined = normalizeForSourceMatch(lines.join(' '))
  const candidates = [
    ...lines,
    ...joined.split(/(?<=[.!?])\s+/),
    ...slidingTextWindows(joined),
  ]

  const useful = candidates
    .map(candidate => trimSnippet(normalizeForSourceMatch(candidate)))
    .filter(candidate => candidate.length >= MIN_SNIPPET_LENGTH)
    .filter(hasUsefulLocatorText)

  return [...new Set(useful)]
    .sort((a, b) => b.length - a.length)
    .slice(0, 14)
}

export function findSourceTarget(root: ParentNode, chunkText: string): HTMLElement | null {
  const snippets = buildLocatorSnippets(chunkText)
  if (!snippets.length) return null

  return findTextNodeTarget(root, snippets) || findBlockTarget(root, snippets)
}

export function jumpToSourceChunk(
  chunkId: number,
  cache: SourceJumpCache | null,
  options: { currentUrl?: string; now?: number; cueDurationMs?: number } = {},
): SourceJumpResult {
  if (!cache) return { ok: false, reason: 'stale-cache' }
  const now = options.now ?? Date.now()
  if (now - cache.cachedAt > SOURCE_JUMP_CACHE_TTL_MS) return { ok: false, reason: 'stale-cache' }
  if (!sourceCacheMatchesCurrentPage(cache, options.currentUrl ?? window.location.href, now)) {
    return { ok: false, reason: 'url-mismatch' }
  }

  const chunk = cache.chunks.find(item => item.id === chunkId)
  if (!chunk) return { ok: false, reason: 'missing-chunk' }
  if (!buildLocatorSnippets(chunk.text).length) return { ok: false, reason: 'no-snippet' }

  const target = findSourceTarget(document, chunk.text)
  if (!target) return { ok: false, reason: 'not-found' }

  scrollTargetIntoView(target)
  window.setTimeout(() => drawSourceCue(target, chunkId, options.cueDurationMs), prefersReducedMotion() ? 0 : 180)
  return { ok: true }
}

export function nearestScrollableAncestor(element: HTMLElement): HTMLElement | null {
  let current = element.parentElement
  while (current && current !== document.body && current !== document.documentElement) {
    const style = window.getComputedStyle(current)
    const overflow = `${style.overflowY} ${style.overflow}`
    const canScroll = /(auto|scroll|overlay)/.test(overflow) && current.scrollHeight > current.clientHeight + 1
    if (canScroll) return current
    current = current.parentElement
  }
  return null
}

export function drawSourceCue(target: HTMLElement, chunkId: number, durationMs = CUE_DURATION_MS): HTMLElement {
  removeSourceCues()

  const rect = target.getBoundingClientRect()
  const overlay = document.createElement('div')
  overlay.setAttribute(SOURCE_CUE_ATTR, 'true')
  overlay.setAttribute('data-steeped-source-id', String(chunkId))

  Object.assign(overlay.style, {
    position: 'fixed',
    pointerEvents: 'none',
    top: `${Math.max(8, rect.top - 6)}px`,
    left: `${Math.max(8, rect.left - 8)}px`,
    width: `${Math.max(120, rect.width + 16)}px`,
    height: `${Math.max(36, rect.height + 12)}px`,
    borderLeft: '4px solid rgba(66, 111, 100, 0.92)',
    borderRadius: '8px',
    background: 'rgba(66, 111, 100, 0.13)',
    boxShadow: '0 0 0 1px rgba(66, 111, 100, 0.24), 0 10px 28px rgba(0, 0, 0, 0.12)',
    zIndex: '2147483645',
    opacity: '1',
    transition: 'opacity 260ms ease',
  })

  const label = document.createElement('div')
  label.textContent = `Source ${chunkId}`
  Object.assign(label.style, {
    position: 'absolute',
    top: '-24px',
    left: '-4px',
    padding: '3px 7px',
    borderRadius: '6px',
    background: 'rgba(11, 27, 44, 0.92)',
    color: '#f4f1e8',
    font: '600 11px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    letterSpacing: '0',
    boxShadow: '0 6px 18px rgba(0, 0, 0, 0.16)',
    whiteSpace: 'nowrap',
  })
  overlay.appendChild(label)

  document.documentElement.appendChild(overlay)
  window.setTimeout(() => {
    overlay.style.opacity = '0'
    window.setTimeout(() => overlay.remove(), 280)
  }, durationMs)

  return overlay
}

export function removeSourceCues() {
  document.querySelectorAll(`[${SOURCE_CUE_ATTR}="true"]`).forEach(node => node.remove())
}

function isSourceNoise(line: string): boolean {
  if (SOURCE_NOISE_PATTERNS.some(pattern => pattern.test(line))) return true
  if (line.length < 34 && /^[A-Z0-9 '\-&/]+$/.test(line) && /[A-Z]/.test(line)) return true
  return false
}

function splitLongSourceLine(line: string): string[] {
  if (line.length <= MAX_SNIPPET_LENGTH) return [line]
  const sentences = line.split(/(?<=[.!?])\s+/).map(sentence => sentence.trim()).filter(Boolean)
  return sentences.length > 1 ? sentences : [line]
}

function slidingTextWindows(text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const windows: string[] = []
  for (let start = 0; start < words.length; start += 14) {
    const windowText = words.slice(start, start + 34).join(' ')
    if (windowText.length >= MIN_SNIPPET_LENGTH) windows.push(windowText)
  }
  return windows
}

function trimSnippet(snippet: string): string {
  if (snippet.length <= MAX_SNIPPET_LENGTH) return snippet
  const trimmed = snippet.slice(0, MAX_SNIPPET_LENGTH)
  const lastSpace = trimmed.lastIndexOf(' ')
  return lastSpace > MIN_SNIPPET_LENGTH ? trimmed.slice(0, lastSpace) : trimmed
}

function hasUsefulLocatorText(snippet: string): boolean {
  const usefulChars = snippet.match(/[\p{L}\p{N}]/gu)?.length || 0
  return usefulChars >= Math.min(40, Math.floor(snippet.length * 0.45))
}

function findTextNodeTarget(root: ParentNode, snippets: string[]): HTMLElement | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  while (node) {
    const parent = node.parentElement
    if (parent && isSearchableElement(parent)) {
      const text = normalizeForSourceMatch(node.textContent || '')
      if (snippets.some(snippet => text.includes(snippet))) {
        return readableAncestor(parent)
      }
    }
    node = walker.nextNode()
  }
  return null
}

function findBlockTarget(root: ParentNode, snippets: string[]): HTMLElement | null {
  const elements = Array.from(root.querySelectorAll<HTMLElement>(READABLE_SELECTOR))
  let fallback: HTMLElement | null = null

  for (const element of elements) {
    if (!isSearchableElement(element)) continue
    const text = normalizeForSourceMatch(element.innerText || element.textContent || '')
    if (snippets.some(snippet => text.includes(snippet))) {
      if (isPreferredReadableElement(element)) return element
      fallback = fallback || readableAncestor(element)
    }
  }

  return fallback
}

function isSearchableElement(element: HTMLElement): boolean {
  if (element.closest(`#${PANEL_ID}, #${HANDLE_ID}, [${SOURCE_CUE_ATTR}="true"]`)) return false
  if (element.closest('script, style, noscript, template')) return false

  let current: HTMLElement | null = element
  while (current && current !== document.documentElement) {
    if (current.hidden || current.getAttribute('aria-hidden') === 'true') return false
    const style = window.getComputedStyle(current)
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false
    current = current.parentElement
  }

  return true
}

function readableAncestor(element: HTMLElement): HTMLElement {
  return element.closest<HTMLElement>(READABLE_SELECTOR) || element
}

function isPreferredReadableElement(element: HTMLElement): boolean {
  return Boolean(element.matches('p, li, blockquote, pre, td, th, [itemprop="comment"], [itemprop="answer"], [data-post-id], [data-comment-id], [id^="post-"], .comment, .reply, .post, .message, .ipsComment, .bbWrapper, .topic-post, .cooked, .js-comment, .TimelineItem'))
}

function scrollTargetIntoView(target: HTMLElement) {
  const behavior: ScrollBehavior = prefersReducedMotion() ? 'auto' : 'smooth'
  const scroller = nearestScrollableAncestor(target)

  if (scroller) {
    const targetRect = target.getBoundingClientRect()
    const scrollerRect = scroller.getBoundingClientRect()
    const top = targetRect.top - scrollerRect.top + scroller.scrollTop - (scroller.clientHeight / 2) + (targetRect.height / 2)
    scroller.scrollTo({ top: Math.max(0, top), behavior })
    return
  }

  target.scrollIntoView({ block: 'center', inline: 'nearest', behavior })
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false
}
