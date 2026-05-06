import { describe, expect, it } from 'vitest'
import { chunkPdfText, isLikelyPdfUrl, titleFromPdfUrl } from './pdf'

describe('PDF extraction helpers', () => {
  it('recognizes PDF URLs without treating ordinary pages as PDFs', () => {
    expect(isLikelyPdfUrl('https://www.irs.gov/pub/irs-pdf/fw4.pdf')).toBe(true)
    expect(isLikelyPdfUrl('https://example.com/report.PDF?download=1')).toBe(true)
    expect(isLikelyPdfUrl('https://example.com/articles/pdf-support')).toBe(false)
  })

  it('derives a readable title from the PDF URL', () => {
    expect(titleFromPdfUrl('https://example.com/files/My%20Report.pdf')).toBe('My Report.pdf')
    expect(titleFromPdfUrl('not a url', 'Fallback')).toBe('Fallback')
  })

  it('chunks extracted PDF pages into numbered sources', () => {
    const page = 'Page 1\n' + Array.from({ length: 40 }, (_, i) =>
      `Line ${i + 1} explains withholding, filing status, worksheet steps, and employee certificate details.`,
    ).join('\n')

    const chunks = chunkPdfText([page, page, page].join('\n\n'))

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0].id).toBe(1)
    expect(chunks.every(chunk => chunk.text.includes('withholding'))).toBe(true)
  })
})
