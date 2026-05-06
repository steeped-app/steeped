import { describe, it, expect } from 'vitest'
import { toMarkdown } from './markdown'

describe('toMarkdown', () => {
  it('renders title, URL, and summary without chat', () => {
    const md = toMarkdown(
      'Example Article',
      'https://example.com/post',
      '## TL;DR\nShort.\n',
      [],
    )
    expect(md).toContain('# Example Article')
    expect(md).toContain('> https://example.com/post')
    expect(md).toContain('## TL;DR')
    expect(md).toContain('Short.')
    expect(md).toContain('*Exported from Steeped*')
    expect(md).not.toContain('## Follow-up')
  })

  it('includes a Follow-up section when chat messages exist', () => {
    const md = toMarkdown('Title', 'https://x.test', 'Summary body', [
      { role: 'user', text: 'What is the main point?' },
      { role: 'assistant', text: 'The main point is X.' },
    ])
    expect(md).toContain('## Follow-up')
    expect(md).toContain('**You:** What is the main point?')
    expect(md).toContain('The main point is X.')
  })

  it('prefixes user turns with **You:** and leaves assistant turns plain', () => {
    const md = toMarkdown('T', 'https://x.test', 'S', [
      { role: 'user', text: 'Q1' },
      { role: 'assistant', text: 'A1' },
      { role: 'user', text: 'Q2' },
      { role: 'assistant', text: 'A2' },
    ])
    expect(md).toMatch(/\*\*You:\*\* Q1/)
    expect(md).toMatch(/A1/)
    expect(md).toMatch(/\*\*You:\*\* Q2/)
  })

  it('preserves unicode in title and summary', () => {
    const md = toMarkdown(
      '東京の気候',
      'https://ja.wikipedia.org/wiki/東京',
      '## TL;DR\n東京は温暖湿潤気候である。',
      [],
    )
    expect(md).toContain('# 東京の気候')
    expect(md).toContain('東京は温暖湿潤気候である')
  })

  it('handles very long URLs without truncation', () => {
    const longUrl = 'https://example.com/' + 'a'.repeat(500)
    const md = toMarkdown('T', longUrl, 'S', [])
    expect(md).toContain(longUrl)
  })
})
