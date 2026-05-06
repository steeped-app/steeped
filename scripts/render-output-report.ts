import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { parseSteepedNote } from '../src/lib/note'
import type { SummaryMode } from '../src/lib/prompts'
import type { Chunk, ExtractionWarning, SurfaceInfo } from '../src/lib/types'

interface EvalFixture {
  id: string
  title: string
  url: string
  mode: SummaryMode
  chunks: Chunk[]
  surfaceInfo?: SurfaceInfo
}

interface EvalRun {
  fixtureId: string
  variant: string
  sample: number
  mode: SummaryMode
  output: string
  score?: {
    total?: number
    citationCoverage?: number
    bulletShape?: number
    judge?: {
      fidelity: number
      readability: number
      usefulness: number
      citation_quality: number
      note_fit: number
      comment: string
    } | null
  }
}

interface LiveCapture {
  schema?: string
  id?: string
  mode?: SummaryMode
  summaryText?: string
  output?: string
  title?: string
  url?: string
  chunks?: Chunk[]
  extractionWarnings?: ExtractionWarning[]
  surfaceInfo?: SurfaceInfo
  discussionNoteActive?: boolean
  page?: {
    title?: string
    url?: string
    domain?: string
  }
  panel?: {
    width?: number
    height?: number
    darkMode?: boolean
    view?: string
  }
}

interface RenderCase {
  id: string
  variant: string
  sample?: number
  mode?: SummaryMode
  title: string
  url: string
  output: string
  chunks: Chunk[]
  warnings: ExtractionWarning[]
  surfaceInfo?: SurfaceInfo
  discussionNoteActive?: boolean
  score?: EvalRun['score']
  source: 'eval' | 'live-capture'
}

const args = new Map(
  process.argv.slice(2).map(arg => {
    const stripped = arg.replace(/^--/, '')
    const equals = stripped.indexOf('=')
    if (equals === -1) return [stripped, 'true']
    return [stripped.slice(0, equals), stripped.slice(equals + 1)]
  }),
)

const evalResultPath = args.get('eval-result') || 'eval/results/latest.json'
const fixturesPath = args.get('fixtures') || 'eval/fixtures/prompt-regression.json'
const capturePath = args.get('capture')
const variant = args.get('variant') || 'current'
const maxCases = Number(args.get('max') || '15')
const outPath = args.get('out') || 'eval/results/render-output-report.html'
const widths = (args.get('widths') || '300,380,520,700')
  .split(',')
  .map(width => Number(width.trim()))
  .filter(Boolean)

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as T
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function wordCount(value: string): number {
  return (value.match(/[A-Za-z0-9][A-Za-z0-9'%-]*/g) || []).length
}

function citations(value: string): number[] {
  return [...value.matchAll(/\[(\d+)\]/g)].map(match => Number(match[1]))
}

function maxTokenLength(value: string): number {
  return Math.max(0, ...value.split(/\s+/).map(token => token.length))
}

function richText(value: string): string {
  const parts = value.split(/(\[\d+\]|\*\*[^*]+\*\*)/)
  return parts.map(part => {
    const citeMatch = part.match(/^\[(\d+)\]$/)
    if (citeMatch) {
      return `<span class="cite">${citeMatch[1]}</span>`
    }
    if (part.startsWith('**') && part.endsWith('**')) {
      return `<strong>${escapeHtml(part.slice(2, -2))}</strong>`
    }
    return escapeHtml(part)
  }).join('')
}

function sourcePreview(id: number, chunks: Chunk[]): string {
  const chunk = chunks.find(item => item.id === id)
  if (!chunk) return ''
  const text = chunk.text.length > 420 ? `${chunk.text.slice(0, 420)}...` : chunk.text
  return `
    <div class="source">
      <div class="source-label">Source ${id}</div>
      <div class="source-text">${escapeHtml(text)}</div>
    </div>
  `
}

function renderPanel(item: RenderCase, width: number, theme: 'dark' | 'light'): string {
  const parsed = parseSteepedNote(item.output)
  const hasParsed = Boolean(parsed.note || parsed.groups.length)
  const expandId = citations(parsed.note)[0] || citations(item.output)[0]

  const body = hasParsed
    ? `
      ${item.warnings.map(warning => `
        <section class="warning">
          <div class="warning-label">Partial Access</div>
          <p>${escapeHtml(warning.message)}</p>
        </section>
      `).join('')}
      ${parsed.note ? `
        <section class="note-card">
          <div class="label">Note</div>
          <p>${richText(parsed.note)}</p>
          ${expandId && parsed.note.includes(`[${expandId}]`) ? sourcePreview(expandId, item.chunks) : ''}
        </section>
      ` : ''}
      ${parsed.groups.length ? `
        <section class="matter-stack">
          ${parsed.groups.map(group => `
            <div class="matter-card">
              ${group.heading ? `<h3>${escapeHtml(group.heading)}</h3>` : ''}
              ${group.items.map((bullet, index) => `
                <div class="bullet">
                  <span class="dot"></span>
                  <span>${richText(bullet)}</span>
                  ${!parsed.note && index === 0 && expandId && bullet.includes(`[${expandId}]`) ? sourcePreview(expandId, item.chunks) : ''}
                </div>
              `).join('')}
            </div>
          `).join('')}
        </section>
      ` : ''}
    `
    : `<pre class="raw">${escapeHtml(item.output)}</pre>`

  return `
    <article class="panel ${theme}" style="width:${width}px">
      <header>
        <div class="brand">Steeped</div>
        <div class="icons">+ &nbsp; copy &nbsp; save</div>
      </header>
      <div class="page-meta">
        <div class="page-title">${escapeHtml(item.title || 'Untitled page')}</div>
        <div class="page-domain">${escapeHtml(domain(item.url))}</div>
      </div>
      <main>${body}</main>
      <footer>
        <span>Ask about this page</span>
        <span class="send">send</span>
      </footer>
    </article>
  `
}

function domain(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url || 'local capture'
  }
}

function flagsFor(item: RenderCase): string[] {
  const parsed = parseSteepedNote(item.output)
  const bullets = parsed.groups.flatMap(group => group.items)
  const flags: string[] = []
  if (!parsed.note && !bullets.length) flags.push('parser fallback')
  if (parsed.note && wordCount(parsed.note) > 95) flags.push('long note')
  if (bullets.length > 8) flags.push('too many bullets')
  if (bullets.some(bullet => wordCount(bullet) > 30)) flags.push('long bullet')
  if (maxTokenLength(item.output) > 48) flags.push('long unbroken token')
  if (/the article discusses|the webpage discusses|it is worth noting|in conclusion|additionally/i.test(item.output)) {
    flags.push('robotic phrase')
  }
  if (/^#{1,6}\s/m.test(item.output.replace(/^## (Note|What Matters)\s*$/gm, ''))) {
    flags.push('extra markdown heading')
  }
  if (citations(item.output).some(id => !item.chunks.find(chunk => chunk.id === id))) {
    flags.push('invalid citation')
  }
  return flags
}

function metrics(item: RenderCase): string {
  const parsed = parseSteepedNote(item.output)
  const bullets = parsed.groups.flatMap(group => group.items)
  const avgBulletWords = bullets.length
    ? Math.round(bullets.reduce((sum, bullet) => sum + wordCount(bullet), 0) / bullets.length)
    : 0
  const flags = flagsFor(item)

  const scoreSummary = item.score
    ? `score ${item.score.total ?? '-'} / citations ${item.score.citationCoverage ?? '-'} / shape ${item.score.bulletShape ?? '-'}`
    : 'live capture'
  const judge = item.score?.judge
    ? `judge: fidelity ${item.score.judge.fidelity}, readability ${item.score.judge.readability}, usefulness ${item.score.judge.usefulness}, citations ${item.score.judge.citation_quality}, fit ${item.score.judge.note_fit}`
    : ''

  return `
    <div class="metrics">
      <span>${scoreSummary}</span>
      <span>note ${wordCount(parsed.note)} words</span>
      <span>${bullets.length} bullets</span>
      <span>avg bullet ${avgBulletWords} words</span>
      <span>max token ${maxTokenLength(item.output)}</span>
      ${flags.length ? flags.map(flag => `<span class="flag">${escapeHtml(flag)}</span>`).join('') : '<span class="ok">no auto flags</span>'}
      ${judge ? `<span>${escapeHtml(judge)}</span>` : ''}
    </div>
  `
}

function readCases(): RenderCase[] {
  if (capturePath) {
    const raw = readJson<LiveCapture | LiveCapture[]>(capturePath)
    const captures = Array.isArray(raw) ? raw : [raw]
    return captures.slice(0, maxCases).map((capture, index) => ({
      id: capture.id || `live-capture-${index + 1}`,
      variant: 'live-capture',
      mode: capture.mode,
      title: capture.page?.title || capture.title || 'Live capture',
      url: capture.page?.url || capture.url || '',
      output: capture.summaryText || capture.output || '',
      chunks: capture.chunks || [],
      warnings: capture.extractionWarnings || [],
      surfaceInfo: capture.surfaceInfo,
      discussionNoteActive: capture.discussionNoteActive,
      source: 'live-capture',
    }))
  }

  const result = readJson<{ generatedAt?: string; runs: EvalRun[] }>(evalResultPath)
  const fixtures = readJson<EvalFixture[]>(fixturesPath)
  const fixtureById = new Map(fixtures.map(fixture => [fixture.id, fixture]))
  const runs = result.runs.filter(run => variant === 'all' || run.variant === variant)

  return runs.slice(0, maxCases).map(run => {
    const fixture = fixtureById.get(run.fixtureId)
    return {
      id: run.fixtureId,
      variant: run.variant,
      sample: run.sample,
      mode: run.mode,
      title: fixture?.title || run.fixtureId,
      url: fixture?.url || '',
      output: run.output,
      chunks: fixture?.chunks || [],
      warnings: [],
      surfaceInfo: fixture?.surfaceInfo,
      discussionNoteActive: Boolean(fixture?.surfaceInfo && fixture.surfaceInfo.kind !== 'unknown'),
      score: run.score,
      source: 'eval',
    }
  })
}

function stylesheet(): string {
  return `
    :root { color-scheme: dark light; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #151411;
      color: #f4efe3;
      font-family: Onest, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .wrap { padding: 28px; }
    h1 { margin: 0 0 8px; font-size: 24px; letter-spacing: 0; }
    .lede { margin: 0 0 22px; max-width: 820px; color: #cfc7b4; line-height: 1.55; }
    .case {
      margin: 0 0 34px;
      border-top: 1px solid rgba(244, 239, 227, 0.18);
      padding-top: 22px;
    }
    .case h2 { margin: 0 0 8px; font-size: 16px; letter-spacing: 0; }
    .meta, .metrics {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 8px 0 14px;
      color: #cfc7b4;
      font-size: 12px;
    }
    .meta span, .metrics span {
      border: 1px solid rgba(244, 239, 227, 0.16);
      border-radius: 999px;
      padding: 4px 8px;
      background: rgba(255, 255, 255, 0.04);
    }
    .metrics .flag { border-color: #c7814f; color: #ffd6b2; }
    .metrics .ok { border-color: #2d867b; color: #a9eee6; }
    .panels {
      display: flex;
      gap: 18px;
      overflow-x: auto;
      padding: 4px 0 18px;
      align-items: flex-start;
    }
    .panel-shell { flex: 0 0 auto; }
    .width-label {
      margin-bottom: 7px;
      color: #b8af9c;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
    }
    .panel {
      flex: 0 0 auto;
      height: 760px;
      display: flex;
      flex-direction: column;
      border: 1px solid rgba(255,255,255,0.14);
      border-radius: 10px;
      overflow: hidden;
      box-shadow: 0 18px 45px rgba(0,0,0,0.28);
    }
    .panel.dark {
      --st-bg: #07101C;
      --st-bg-surface: #0B1730;
      --st-bg-elevated: #101D36;
      --st-text-primary: #F6F8F3;
      --st-text-secondary: #BAC3D2;
      --st-text-tertiary: #7F8DA0;
      --st-accent: #56C7C1;
      --st-accent-contrast: #07101C;
      --st-accent-light: #123E4C;
      --st-accent-faint: #0D2A38;
      --st-border: #24314E;
      --st-border-light: #16233D;
    }
    .panel.light {
      --st-bg: #EDEBE2;
      --st-bg-surface: #E2DFD3;
      --st-bg-elevated: #FAF8EF;
      --st-text-primary: #141717;
      --st-text-secondary: #4D5556;
      --st-text-tertiary: #7A8281;
      --st-accent: #0F766E;
      --st-accent-contrast: #FFFFFF;
      --st-accent-light: #C9EFE8;
      --st-accent-faint: #EEF8F3;
      --st-border: #CCC9BD;
      --st-border-light: #DBD8CC;
    }
    .panel {
      background: var(--st-bg);
      color: var(--st-text-primary);
    }
    .panel header, .panel footer {
      min-height: 50px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 0 16px;
      border-bottom: 1px solid var(--st-border);
      color: var(--st-text-tertiary);
      font-size: 12px;
    }
    .panel footer {
      border-bottom: 0;
      border-top: 1px solid var(--st-border);
      background: var(--st-bg);
    }
    .brand { color: var(--st-text-primary); font-weight: 800; font-size: 15px; }
    .icons { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .send {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 34px;
      height: 34px;
      border-radius: 8px;
      background: var(--st-accent);
      color: var(--st-accent-contrast);
      font-size: 10px;
      font-weight: 800;
      text-transform: uppercase;
    }
    .page-meta {
      padding: 12px 16px;
      border-bottom: 1px solid var(--st-border);
    }
    .page-title {
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      font-size: 14px;
      font-weight: 700;
      line-height: 1.35;
    }
    .page-domain {
      display: inline-block;
      margin-top: 6px;
      padding: 2px 6px;
      border-radius: 4px;
      background: var(--st-bg-surface);
      color: var(--st-text-tertiary);
      font-size: 11px;
      font-weight: 700;
      max-width: 100%;
      overflow-wrap: anywhere;
    }
    .panel main {
      flex: 1;
      overflow: auto;
      padding: 16px;
    }
    .note-card {
      margin: 0 0 20px;
      padding: 12px;
      border: 1px solid var(--st-accent-light);
      border-radius: 8px;
      background: var(--st-accent-faint);
    }
    .warning {
      margin: 0 0 16px;
      padding: 10px 12px;
      border: 1px solid var(--st-border);
      border-radius: 8px;
      background: var(--st-bg-surface);
      color: var(--st-text-secondary);
      font-size: 12px;
      line-height: 1.5;
    }
    .warning p { margin: 0; }
    .warning-label {
      margin-bottom: 4px;
      color: var(--st-text-tertiary);
      font-size: 9.5px;
      font-weight: 900;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .label, .source-label {
      margin-bottom: 6px;
      color: var(--st-accent);
      font-size: 9.5px;
      font-weight: 900;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .note-card p {
      margin: 0;
      color: var(--st-text-primary);
      font-size: 13px;
      font-weight: 600;
      line-height: 1.6;
      overflow-wrap: anywhere;
    }
    .matter-stack { display: grid; gap: 12px; }
    .matter-card {
      padding: 10px 12px;
      border-radius: 8px;
      background: var(--st-bg-surface);
    }
    .matter-card h3 {
      margin: 0 0 7px;
      color: var(--st-accent);
      font-size: 11px;
      font-weight: 900;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }
    .bullet {
      position: relative;
      padding-left: 14px;
      color: var(--st-text-primary);
      font-size: 13px;
      line-height: 1.6;
      overflow-wrap: anywhere;
    }
    .bullet + .bullet { margin-top: 8px; }
    .dot {
      position: absolute;
      left: 0;
      top: 9px;
      width: 4px;
      height: 4px;
      border-radius: 999px;
      background: var(--st-accent);
      opacity: 0.5;
    }
    strong { font-weight: 700; color: var(--st-text-primary); }
    .cite {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 17px;
      height: 17px;
      margin: 0 2px;
      padding: 0 4px;
      border-radius: 999px;
      background: var(--st-accent-light);
      color: var(--st-accent);
      font-size: 10px;
      font-weight: 800;
      vertical-align: 1px;
    }
    .source {
      margin-top: 10px;
      padding: 10px 12px;
      border-left: 2px solid var(--st-accent);
      border-radius: 0 6px 6px 0;
      background: var(--st-accent-faint);
      color: var(--st-text-secondary);
      font-size: 12px;
      line-height: 1.45;
      overflow-wrap: anywhere;
    }
    .source-text { font-style: italic; }
    .raw {
      margin: 0;
      white-space: pre-wrap;
      color: var(--st-text-primary);
      font: inherit;
      font-size: 13px;
      line-height: 1.6;
      overflow-wrap: anywhere;
    }
  `
}

function renderHtml(cases: RenderCase[]): string {
  const generatedAt = new Date().toISOString()
  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Steeped Rendered Output Report</title>
      <style>${stylesheet()}</style>
    </head>
    <body>
      <div class="wrap">
        <h1>Steeped Rendered Output Report</h1>
        <p class="lede">
          Generated ${escapeHtml(generatedAt)}. This report checks the note as a rendered side-panel object:
          compact note, source chips, source expansion, wrapping, and the feeling of useful calm at narrow widths.
        </p>
        ${cases.map(item => `
          <section class="case">
            <h2>${escapeHtml(item.title)}</h2>
            <div class="meta">
              <span>${escapeHtml(item.id)}</span>
              <span>${escapeHtml(item.variant)}${item.sample ? ` sample ${item.sample}` : ''}</span>
              <span>${escapeHtml(item.mode || 'unknown mode')}</span>
              ${item.surfaceInfo ? `<span>${escapeHtml(item.surfaceInfo.label)} / ${escapeHtml(item.surfaceInfo.confidence)}</span>` : ''}
              ${item.discussionNoteActive ? '<span>Discussion note</span>' : ''}
              <span>${escapeHtml(item.url || 'no url')}</span>
            </div>
            ${metrics(item)}
            <div class="panels">
              ${widths.flatMap(width => (['dark', 'light'] as const).map(theme => `
                <div class="panel-shell">
                  <div class="width-label">${width}px / ${theme}</div>
                  ${renderPanel(item, width, theme)}
                </div>
              `)).join('')}
            </div>
          </section>
        `).join('')}
      </div>
    </body>
  </html>`
}

const cases = readCases()
if (!cases.length) {
  throw new Error(`No cases found for variant "${variant}".`)
}

const absoluteOut = resolve(process.cwd(), outPath)
mkdirSync(dirname(absoluteOut), { recursive: true })
writeFileSync(absoluteOut, renderHtml(cases))
console.log(`Wrote ${absoluteOut}`)
