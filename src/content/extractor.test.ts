import { afterEach, describe, it, expect } from 'vitest'
import {
  chunkText,
  detectAccessWarnings,
  detectSurfaceInfo,
  getPrimaryVisibleText,
  MAX_CHUNKS,
  MAX_CHUNK_SIZE,
} from './extractor'

afterEach(() => {
  document.body.innerHTML = ''
  window.history.replaceState({}, '', '/')
})

describe('chunkText', () => {
  it('returns an empty array for empty input', () => {
    expect(chunkText('')).toEqual([])
  })

  it('drops paragraphs shorter than 15 chars', () => {
    const text = 'short\n\nstill\n\nthis paragraph has more than fifteen characters.'
    const chunks = chunkText(text)
    expect(chunks).toHaveLength(1)
    expect(chunks[0].text).toContain('fifteen characters')
    expect(chunks[0].text).not.toContain('short')
  })

  it('numbers chunks starting at 1', () => {
    const para = 'This is a paragraph with enough length to survive filtering.'
    const text = Array.from({ length: 10 }, () => para).join('\n\n')
    const chunks = chunkText(text)
    expect(chunks[0].id).toBe(1)
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i].id).toBe(i + 1)
    }
  })

  it('splits long text into multiple chunks near TARGET_CHUNK_SIZE', () => {
    const para = 'x'.repeat(500) + ' end.'
    const text = Array.from({ length: 20 }, () => para).join('\n\n')
    const chunks = chunkText(text)
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(MAX_CHUNK_SIZE + 500)
    }
  })

  it('caps total chunks at MAX_CHUNKS', () => {
    // Huge document that should exceed the cap.
    const para = 'y'.repeat(3000) + ' tail.'
    const text = Array.from({ length: MAX_CHUNKS * 3 }, () => para).join('\n\n')
    const chunks = chunkText(text)
    expect(chunks.length).toBeLessThanOrEqual(MAX_CHUNKS)
  })

  it('handles input with no paragraph breaks by emitting a single chunk', () => {
    const text = 'one long run of text with no paragraph breaks but definitely more than fifteen chars.'
    const chunks = chunkText(text)
    expect(chunks).toHaveLength(1)
    expect(chunks[0].text).toContain('one long run')
  })

  it('splits oversized line-heavy text into source-sized chunks', () => {
    const text = Array.from({ length: 120 }, (_, index) =>
      `#${index + 1} Posted by member${index + 1} with a detailed forum reply about eyepieces, setup tradeoffs, and practical limits.`,
    ).join('\n')

    const chunks = chunkText(text, 700)

    expect(chunks.length).toBeGreaterThan(3)
    expect(chunks.every(chunk => chunk.text.length <= MAX_CHUNK_SIZE)).toBe(true)
  })

  it('trims whitespace on each chunk', () => {
    const text = '   padded paragraph with enough length.   \n\n   another padded one here.   '
    const chunks = chunkText(text)
    for (const c of chunks) {
      expect(c.text).toBe(c.text.trim())
    }
  })
})

describe('detectAccessWarnings', () => {
  it('flags pages that appear partly locked', () => {
    const warnings = detectAccessWarnings('Subscribe to continue reading this article. Already a subscriber? Sign in.')
    expect(warnings).toEqual([{
      code: 'possible-paywall',
      message: expect.stringContaining('partly locked'),
    }])
  })

  it('does not flag ordinary subscription calls without a reading gate', () => {
    const warnings = detectAccessWarnings('Subscribe to our newsletter for weekly updates. The full article continues below.')
    expect(warnings).toEqual([])
  })
})

describe('detectSurfaceInfo', () => {
  it('detects known issue threads with high confidence', () => {
    const surface = detectSurfaceInfo(
      'https://github.com/example/project/issues/42',
      'Blank panel after login',
      'Original poster opened this issue. Maintainer reply: fixed in 1.8.2. Comments include reactions and quotes.',
      document,
    )

    expect(surface.kind).toBe('issue-thread')
    expect(surface.confidence).toBe('high')
    expect(surface.rankingSignals).toContain('reactions')
  })

  it('detects generic forum paths without a domain whitelist', () => {
    document.body.innerHTML = `
      <article data-post-id="1">Thread starter: my sourdough starter smells odd.</article>
      <article data-post-id="2">Reply: feed it twice.</article>
      <article data-post-id="3">Reply: check water temperature.</article>
      <article data-post-id="4">Reply: this got five likes.</article>
    `

    const surface = detectSurfaceInfo(
      'https://forum.example.test/t/sourdough-starter-smell/123',
      'Sourdough starter smell',
      document.body.innerText,
      document,
    )

    expect(surface.kind).toBe('discussion-thread')
    expect(surface.confidence).toBe('high')
    expect(surface.rootPostVisible).toBe(true)
  })

  it('marks later forum pages as missing root context', () => {
    const surface = detectSurfaceInfo(
      'https://community.example.test/topic/bike-fit/page-3',
      'Bike fit thread',
      'Replies quote each other and discuss previous posts. Likes and reactions appear below comments.',
      document,
    )

    expect(surface.pagePosition).toBe('later-page')
    expect(surface.rootPostVisible).toBe(false)
  })

  it('leaves ordinary articles as unknown low-confidence surfaces', () => {
    const surface = detectSurfaceInfo(
      'https://example.test/essay',
      'An essay about tea',
      'A long article explains harvesting, processing, oxidation, and trade routes.',
      document,
    )

    expect(surface.kind).toBe('unknown')
    expect(surface.confidence).toBe('low')
  })
})

describe('getPrimaryVisibleText', () => {
  it('prefers Reddit post and comment text over page navigation chrome', () => {
    window.history.replaceState({}, '', '/r/macapps/comments/1jyadpj/what_happened_to_henrik_ruscon/')
    document.body.innerHTML = `
      <nav>
        Skip to main content
        Advertise on Reddit
        Open chat
        Create post
      </nav>
      <main>
        <shreddit-post>
          <h1>What happened to Henrik Ruscon?</h1>
          <p>The developer has been completely missing for months. Does anyone have any information?</p>
        </shreddit-post>
        <shreddit-comment>
          <p>Afaik he had a BIG family emergency, which required him to take a much longer hiatus than planned.</p>
        </shreddit-comment>
        <shreddit-comment>
          <p>Damn, I wish him well. Klack is so well done.</p>
        </shreddit-comment>
      </main>
      <aside>
        COMMUNITY BOOKMARKS
        PROMOTED
      </aside>
    `

    const text = getPrimaryVisibleText()

    expect(text).toContain('What happened to Henrik Ruscon?')
    expect(text).toContain('BIG family emergency')
    expect(text).toContain('Klack is so well done')
    expect(text).not.toContain('Skip to main content')
    expect(text).not.toContain('Advertise on Reddit')
    expect(text).not.toContain('COMMUNITY BOOKMARKS')
  })

  it('extracts old Reddit entries without the subscription header blob', () => {
    window.history.replaceState({}, '', '/r/programming/comments/example/thread_title/')
    document.body.innerHTML = `
      <div id="header">jump to contentmy subredditsedit subscriptionspopular-all-users</div>
      <div class="thing link">
        <div class="entry">
          <p class="title">My attempt to explain the xz backdoor</p>
          <div class="usertext-body">Original post links to a technical write-up.</div>
        </div>
      </div>
      <div class="commentarea">
        <div class="thing comment">
          <div class="entry">
            <p class="tagline">CommandSpaceOption 2 years ago</p>
            <div class="usertext-body">Russ Cox published the most detailed account of the attack.</div>
          </div>
        </div>
      </div>
    `

    const text = getPrimaryVisibleText()

    expect(text).toContain('My attempt to explain the xz backdoor')
    expect(text).toContain('Russ Cox published')
    expect(text).not.toContain('jump to contentmy subreddits')
  })

  it('prefers structured forum posts over global forum navigation', () => {
    window.history.replaceState({}, '', '/topic/figuring-out-eyepieces/')
    document.body.innerHTML = `
      <nav>Existing user? Sign In Sign Up Home Forums Browse Activity</nav>
      <h1>Figuring out Eyepieces</h1>
      <article data-post-id="1">
        <span>JulietAlpha14</span>
        <p>I have a Celestron 9.25 EdgeHD and need help choosing eyepieces.</p>
      </article>
      <article data-post-id="2">
        <span>VeteranObserver</span>
        <p>A 10mm eyepiece is already high power at 235x, so skip the Barlow for now.</p>
      </article>
      <article data-post-id="3">
        <span>AnotherObserver</span>
        <p>Buy one eyepiece at a time until your preferences become clearer.</p>
      </article>
    `

    const text = getPrimaryVisibleText()

    expect(text).toContain('Figuring out Eyepieces')
    expect(text).toContain('skip the Barlow')
    expect(text).not.toContain('Existing user? Sign In Sign Up')
  })
})
