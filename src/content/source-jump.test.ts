import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SOURCE_CUE_ATTR,
  SOURCE_JUMP_CACHE_TTL_MS,
  buildLocatorSnippets,
  cleanSourceLines,
  drawSourceCue,
  findSourceTarget,
  jumpToSourceChunk,
  nearestScrollableAncestor,
  normalizeForSourceMatch,
  sourceCacheMatchesCurrentPage,
} from './source-jump'

beforeEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  if (!Element.prototype.scrollIntoView) {
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: () => {},
    })
  }
  vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {})
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({ matches: false })),
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('source jump text matching', () => {
  it('normalizes whitespace, curly quotes, and non-breaking spaces', () => {
    expect(normalizeForSourceMatch('One\u00a0 “quoted”\n\nline')).toBe('One "quoted" line')
  })

  it('removes common forum/navigation noise before building snippets', () => {
    const lines = cleanSourceLines(`Existing user? Sign In Sign Up
Home
Followers
A 10mm eyepiece is already high power at 235x, so skip the Barlow for now.
Buy one eyepiece at a time until your preferences become clearer.`)

    expect(lines.join(' ')).toContain('skip the Barlow')
    expect(lines.join(' ')).not.toContain('Existing user')
    expect(lines.join(' ')).not.toContain('Followers')
  })

  it('generates useful exact-match snippets from source chunks', () => {
    const snippets = buildLocatorSnippets(`The planning department finished a six-month pilot that moved permit review notes into a shared source ledger. Staff attributed most of the gain to fewer duplicate document requests.`)

    expect(snippets.length).toBeGreaterThan(0)
    expect(snippets.some(snippet => snippet.includes('six-month pilot'))).toBe(true)
    expect(snippets.every(snippet => snippet.length >= 72)).toBe(true)
  })

  it('finds a visible paragraph containing a candidate snippet', () => {
    document.body.innerHTML = `
      <main>
        <p>The planning department finished a six-month pilot that moved permit review notes into a shared source ledger. Staff attributed most of the gain to fewer duplicate document requests.</p>
      </main>
    `

    const target = findSourceTarget(document, 'The planning department finished a six-month pilot that moved permit review notes into a shared source ledger.')
    expect(target?.tagName).toBe('P')
  })

  it('skips hidden elements and Steeped chrome', () => {
    document.body.innerHTML = `
      <div id="steeped-panel">
        <p>The planning department finished a six-month pilot that moved permit review notes into a shared source ledger.</p>
      </div>
      <p hidden>The planning department finished a six-month pilot that moved permit review notes into a shared source ledger.</p>
      <article>
        <p>The planning department finished a six-month pilot that moved permit review notes into a shared source ledger. Staff attributed most of the gain to fewer duplicate document requests.</p>
      </article>
    `

    const target = findSourceTarget(document, 'The planning department finished a six-month pilot that moved permit review notes into a shared source ledger.')
    expect(target?.closest('#steeped-panel')).toBeNull()
    expect(target?.hidden).toBe(false)
    expect(target?.tagName).toBe('P')
  })

  it('falls back to block text when a snippet spans nested nodes', () => {
    document.body.innerHTML = `
      <p><span>The planning department finished a six-month pilot that moved </span><strong>permit review notes into a shared source ledger.</strong></p>
    `

    const target = findSourceTarget(document, 'The planning department finished a six-month pilot that moved permit review notes into a shared source ledger.')
    expect(target?.tagName).toBe('P')
  })

  it('returns a quiet miss instead of throwing when no strong match exists', () => {
    document.body.innerHTML = '<p>Different visible page text.</p>'
    const result = jumpToSourceChunk(1, {
      url: 'https://example.test/read',
      cachedAt: Date.now(),
      chunks: [{ id: 1, text: 'The planning department finished a six-month pilot that moved permit review notes into a shared source ledger.' }],
    }, { currentUrl: 'https://example.test/read' })

    expect(result).toEqual({ ok: false, reason: 'not-found' })
  })

  it('uses instant scrolling when reduced motion is preferred', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({ matches: true })),
    })
    document.body.innerHTML = `
      <p>The planning department finished a six-month pilot that moved permit review notes into a shared source ledger. Staff attributed most of the gain to fewer duplicate document requests.</p>
    `

    const result = jumpToSourceChunk(1, {
      url: 'https://example.test/read',
      cachedAt: Date.now(),
      chunks: [{ id: 1, text: 'The planning department finished a six-month pilot that moved permit review notes into a shared source ledger.' }],
    }, { currentUrl: 'https://example.test/read', cueDurationMs: 10 })

    expect(result.ok).toBe(true)
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }))
  })
})

describe('source jump cache and cue behavior', () => {
  it('validates cache URL with hash ignored and TTL enforced', () => {
    const cache = {
      url: 'https://example.test/read#source',
      cachedAt: 1000,
      chunks: [{ id: 1, text: 'chunk' }],
    }

    expect(sourceCacheMatchesCurrentPage(cache, 'https://example.test/read#later', 1000 + SOURCE_JUMP_CACHE_TTL_MS - 1)).toBe(true)
    expect(sourceCacheMatchesCurrentPage(cache, 'https://example.test/other', 1000)).toBe(false)
    expect(sourceCacheMatchesCurrentPage(cache, 'https://example.test/read', 1000 + SOURCE_JUMP_CACHE_TTL_MS + 1)).toBe(false)
  })

  it('detects the nearest nested scroll container', () => {
    document.body.innerHTML = '<div id="scroll"><p id="target">Readable source text lives here.</p></div>'
    const scroll = document.getElementById('scroll') as HTMLElement
    const target = document.getElementById('target') as HTMLElement

    scroll.style.overflowY = 'auto'
    Object.defineProperty(scroll, 'scrollHeight', { configurable: true, value: 1000 })
    Object.defineProperty(scroll, 'clientHeight', { configurable: true, value: 240 })

    expect(nearestScrollableAncestor(target)).toBe(scroll)
  })

  it('creates only one temporary cue and removes it after the timeout', () => {
    vi.useFakeTimers()
    document.body.innerHTML = '<p id="target">Readable source text lives here.</p>'
    const target = document.getElementById('target') as HTMLElement

    drawSourceCue(target, 1, 50)
    drawSourceCue(target, 2, 50)

    expect(document.querySelectorAll(`[${SOURCE_CUE_ATTR}="true"]`)).toHaveLength(1)
    expect(document.querySelector(`[${SOURCE_CUE_ATTR}="true"]`)?.getAttribute('data-steeped-source-id')).toBe('2')

    vi.advanceTimersByTime(400)
    expect(document.querySelectorAll(`[${SOURCE_CUE_ATTR}="true"]`)).toHaveLength(0)
  })
})
