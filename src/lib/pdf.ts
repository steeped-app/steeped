import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { Chunk, ExtractionResult } from '../lib/types'

const MAX_PDF_BYTES = 15 * 1024 * 1024
const MAX_PDF_PAGES = 80
const MAX_PDF_TEXT_CHARS = 100_000
const PDF_CHUNK_SIZE = 1_800
const MAX_CHUNKS = 30

interface PdfTextItem {
  str?: string
  hasEOL?: boolean
}

export function isLikelyPdfUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.pathname.toLowerCase().endsWith('.pdf')
  } catch {
    return false
  }
}

export function titleFromPdfUrl(url: string, fallback = 'PDF document'): string {
  try {
    const parsed = new URL(url)
    const name = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || '').trim()
    return name || fallback
  } catch {
    return fallback
  }
}

export function chunkPdfText(text: string): Chunk[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map(paragraph => paragraph.trim())
    .filter(paragraph => paragraph.length > 15)

  const chunks: Chunk[] = []
  let current = ''
  let id = 1

  for (const paragraph of paragraphs) {
    if (current.length + paragraph.length > PDF_CHUNK_SIZE && current.length > 300) {
      chunks.push({ id: id++, text: current.trim() })
      current = ''
      if (chunks.length >= MAX_CHUNKS) break
    }

    current += `${paragraph}\n\n`

    if (current.length > PDF_CHUNK_SIZE * 2) {
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

function textItemsToPageText(items: PdfTextItem[]): string {
  let text = ''

  for (const item of items) {
    const value = item.str?.replace(/\s+/g, ' ').trim()
    if (!value) {
      if (item.hasEOL) text += '\n'
      continue
    }

    const previous = text[text.length - 1] || ''
    const needsSpace = previous && !/[\s([{/-]/.test(previous) && !/^[,.;:!?%)]/.test(value)
    text += `${needsSpace ? ' ' : ''}${value}`
    if (item.hasEOL) text += '\n'
  }

  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

async function fetchPdfData(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { credentials: 'include' })
  if (!response.ok) throw new Error(`PDF request failed: ${response.status}`)

  const contentType = response.headers.get('content-type') || ''
  if (!contentType.toLowerCase().includes('pdf') && !isLikelyPdfUrl(response.url || url)) {
    throw new Error('The page did not return a PDF file.')
  }

  const length = Number(response.headers.get('content-length') || 0)
  if (length > MAX_PDF_BYTES) {
    throw new Error('This PDF is too large for Steeped to summarize in the browser.')
  }

  const buffer = await response.arrayBuffer()
  if (buffer.byteLength > MAX_PDF_BYTES) {
    throw new Error('This PDF is too large for Steeped to summarize in the browser.')
  }

  return new Uint8Array(buffer)
}

function configurePdfWorker() {
  if (GlobalWorkerOptions.workerSrc) return
  if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
    GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('content/pdf.worker.mjs')
  }
}

export async function extractPdfFromUrl(url: string, title?: string): Promise<ExtractionResult> {
  configurePdfWorker()

  const data = await fetchPdfData(url)
  const loadingTask = getDocument({
    data,
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: true,
  } as any)

  const pdf = await loadingTask.promise
  const pageCount = Math.min(pdf.numPages, MAX_PDF_PAGES)
  const pages: string[] = []

  try {
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      const content = await page.getTextContent()
      const pageText = textItemsToPageText(content.items as PdfTextItem[])
      if (pageText) pages.push(`Page ${pageNumber}\n${pageText}`)

      if (pages.join('\n\n').length > MAX_PDF_TEXT_CHARS) break
    }
  } finally {
    await pdf.destroy()
  }

  const text = pages.join('\n\n').slice(0, MAX_PDF_TEXT_CHARS)
  const chunks = chunkPdfText(text)
  return {
    title: title || titleFromPdfUrl(url),
    url,
    chunks,
    warnings: [],
    surfaceInfo: {
      kind: 'article',
      confidence: 'medium',
      label: 'PDF document',
      reason: 'PDF text extracted directly',
      rootPostVisible: 'unknown',
      pagePosition: 'unknown',
      rankingSignals: [],
    },
  }
}
