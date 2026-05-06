import { useState, useEffect, useRef } from 'react'
import { parseSteepedNote } from '../../lib/note'
import { getDiscussionNoteHelp, getDiscussionNoteLabel } from '../../lib/discussion'
import type { ExtractionWarning, SurfaceInfo } from '../../lib/types'

interface Chunk { id: number; text: string }
interface ChatMessage { role: 'user' | 'assistant'; text: string }
interface ActiveCite { id: number; key: string; scope: string; context?: string }

interface Props {
  text: string
  chunks: Chunk[]
  isStreaming: boolean
  pageTitle?: string
  pageDomain?: string
  warnings?: ExtractionWarning[]
  surfaceInfo?: SurfaceInfo
  discussionNoteActive?: boolean
  onRebuildAsDiscussion?: () => void
  onRebuildAsRegular?: () => void
  chatMessages?: ChatMessage[]
  chatStreamText?: string
  isChatting?: boolean
}

// ── Main Component ───────────────────────────────────────────

export default function SummaryView({
  text, chunks, isStreaming, pageTitle, pageDomain,
  warnings = [], surfaceInfo, discussionNoteActive = false,
  onRebuildAsDiscussion, onRebuildAsRegular,
  chatMessages = [], chatStreamText = '', isChatting = false,
}: Props) {
  const [expandedCite, setExpandedCite] = useState<ActiveCite | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const userScrolledUp = useRef(false)
  const toggleCite = (cite: ActiveCite) => {
    if (expandedCite?.key === cite.key) {
      setExpandedCite(null)
      return
    }

    postSourceJump(cite.id)
    setExpandedCite(cite)
  }
  const { note, groups } = parseSteepedNote(text)
  const hasParsedSummary = Boolean(note || groups.length)

  // Only auto-scroll if the user hasn't scrolled up
  useEffect(() => {
    if ((isStreaming || isChatting) && !userScrolledUp.current) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
    }
  }, [text, chatStreamText, isStreaming, isChatting])

  // Reset scroll tracking when a new stream starts
  useEffect(() => {
    if (isStreaming || isChatting) userScrolledUp.current = false
  }, [isStreaming, isChatting])

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    userScrolledUp.current = !atBottom
  }

  return (
    <>
      {isStreaming && (
        <div className="h-[2px] bg-st-border-light shrink-0 overflow-hidden">
          <div className="h-full w-[35%] bg-st-accent rounded-sm animate-[slide_1.4s_ease-in-out_infinite]" />
        </div>
      )}

      {pageTitle && (
        <div className="pl-4 pr-5 py-3 border-b border-st-border shrink-0">
          <div className="text-[14px] font-semibold leading-snug line-clamp-2">{pageTitle}</div>
          {pageDomain && (
            <div className="flex min-w-0 flex-wrap items-center gap-2 mt-1.5">
              <span className="text-[11px] font-medium text-st-text-tertiary bg-st-bg-surface px-1.5 py-0.5 rounded">{pageDomain}</span>
              <span className="text-[11px] text-st-text-tertiary">just now</span>
              {!isStreaming && discussionNoteActive && (
                <DiscussionModeBadge surfaceInfo={surfaceInfo} />
              )}
              {!isStreaming && !discussionNoteActive && onRebuildAsDiscussion && (
                <button
                  type="button"
                  onClick={onRebuildAsDiscussion}
                  className="text-[11px] font-semibold text-st-accent hover:text-st-accent-hover transition-colors"
                >
                  Make discussion note
                </button>
              )}
              {!isStreaming && discussionNoteActive && onRebuildAsRegular && (
                <button
                  type="button"
                  onClick={onRebuildAsRegular}
                  className="text-[11px] font-semibold text-st-text-tertiary hover:text-st-text-secondary transition-colors"
                >
                  Regular note
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <div ref={scrollRef} onScroll={handleScroll} className="panel-scroll-area flex-1 overflow-y-auto pl-4 pr-5 py-4">
        {warnings.map(warning => (
          <div
            key={warning.code}
            className="mb-4 rounded-lg border border-st-border bg-st-bg-surface px-3 py-2.5 text-[12px] leading-relaxed text-st-text-secondary"
          >
            <div className="mb-1 text-[9.5px] font-bold uppercase tracking-[0.08em] text-st-text-tertiary">Partial Access</div>
            {warning.message}
          </div>
        ))}

        {/* Raw fallback while streaming, or if the model misses the expected headings. */}
        {((isStreaming && !note) || (!isStreaming && text && !hasParsedSummary)) && (
          <div className="text-[13px] leading-relaxed whitespace-pre-wrap st-rich-text">
            <RichText text={text} scope="raw" expandedCite={expandedCite} onToggle={toggleCite} />
            <CiteExpansion activeCite={expandedCite} scope="raw" chunks={chunks} />
            {isStreaming && <Cursor />}
          </div>
        )}

        {/* Note card */}
        {note && (
          <div className="bg-st-accent-faint border border-st-accent-light rounded-lg p-3 mb-5 shadow-[0_1px_0_rgba(0,0,0,0.03)]">
            <div className="text-[9.5px] font-bold uppercase tracking-[0.08em] text-st-accent mb-1.5">Note</div>
            <p className="text-[13px] font-medium leading-[1.6]">
              <RichText text={note} scope="note" expandedCite={expandedCite} onToggle={toggleCite} />
            </p>
            <CiteExpansion activeCite={expandedCite} scope="note" chunks={chunks} />
          </div>
        )}

        {/* What Matters — topic cards */}
        {groups.length > 0 && (
          <div className="space-y-3">
            <SectionLabel>What matters</SectionLabel>
            {groups.map((group, gi) => (
              <div key={gi} className="space-y-2.5">
                {group.heading && (
                  <h3 className="px-1 text-[11px] font-bold uppercase tracking-[0.05em] text-st-accent">
                    {group.heading}
                  </h3>
                )}
                <div className="space-y-2.5">
                  {group.items.map((item, ii) => (
                    <div
                      key={ii}
                      className="relative rounded-lg border border-transparent border-l-[3px] bg-st-bg-surface px-3 py-2.5 text-[13px] leading-[1.6] shadow-[0_1px_0_rgba(0,0,0,0.02)]"
                      style={{ borderLeftColor: 'var(--st-source-accent)' }}
                    >
                      <RichText text={item} scope={`matter-${gi}-item-${ii}`} expandedCite={expandedCite} onToggle={toggleCite} />
                      <CiteExpansion activeCite={expandedCite} scope={`matter-${gi}-item-${ii}`} chunks={chunks} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {isStreaming && groups.length > 0 && <Cursor />}

        {/* ── Chat Messages ────────────────────── */}
        {(chatMessages.length > 0 || isChatting) && (
          <>
            <div className="flex items-center gap-3 my-6">
              <div className="flex-1 h-px bg-st-border" />
              <span className="text-[10px] font-semibold tracking-[0.06em] uppercase text-st-text-tertiary">Follow-up</span>
              <div className="flex-1 h-px bg-st-border" />
            </div>

            {chatMessages.map((msg, i) => (
              <div key={i} className="mb-5">
                <div className={`text-[10px] font-semibold uppercase tracking-[0.04em] mb-1.5 ${
                  msg.role === 'user' ? 'text-st-text-tertiary' : 'text-st-accent'
                }`}>
                  {msg.role === 'user' ? 'You' : 'Steeped'}
                </div>
                <div className="text-[13px] leading-[1.7]">
                  {msg.role === 'assistant'
                    ? <FormattedChat text={msg.text} scopePrefix={`chat-${i}`} expandedCite={expandedCite} onToggle={toggleCite} chunks={chunks} />
                    : <span className="text-st-text-secondary">{msg.text}</span>
                  }
                </div>
              </div>
            ))}

            {isChatting && chatStreamText && (
              <div className="mb-5">
                <div className="text-[10px] font-semibold uppercase tracking-[0.04em] mb-1.5 text-st-accent">Steeped</div>
                <div className="text-[13px] leading-[1.7]">
                  <FormattedChat text={chatStreamText} scopePrefix="chat-stream" expandedCite={expandedCite} onToggle={toggleCite} chunks={chunks} />
                  <Cursor />
                </div>
              </div>
            )}

            {isChatting && !chatStreamText && (
              <div className="mb-5">
                <div className="text-[10px] font-semibold uppercase tracking-[0.04em] mb-1.5 text-st-accent">Steeped</div>
                <Cursor />
              </div>
            )}
          </>
        )}
      </div>
    </>
  )
}

// ── Small Components ─────────────────────────────────────────

function SectionLabel({ children }: { children: string }) {
  return <div className="text-[10px] font-bold tracking-[0.08em] uppercase text-st-text-tertiary mb-2.5">{children}</div>
}

function postSourceJump(chunkId: number) {
  try {
    window.parent?.postMessage({ type: 'steeped:source-jump', chunkId }, '*')
  } catch {}
}

function Cursor() {
  return <span className="inline-block w-[2px] h-[14px] bg-st-accent ml-0.5 align-text-bottom animate-pulse" />
}

function DiscussionModeBadge({ surfaceInfo }: { surfaceInfo?: SurfaceInfo }) {
  const label = getDiscussionNoteLabel(surfaceInfo)
  const help = getDiscussionNoteHelp(surfaceInfo)

  return (
    <span className="inline-flex max-w-full items-center gap-1">
      <span className="inline-flex shrink-0 items-center rounded border border-st-accent-light bg-st-accent-faint px-1.5 py-0.5 text-[10.5px] font-bold text-st-accent">
        {label}
      </span>
      <span className="relative inline-flex group">
        <button
          type="button"
          aria-label={help}
          className="inline-flex h-[16px] w-[16px] items-center justify-center rounded-full border border-st-border bg-st-bg-surface text-[10px] font-bold text-st-text-tertiary transition-colors hover:border-st-accent hover:text-st-accent"
        >
          ?
        </button>
        <span
          role="tooltip"
          className="pointer-events-none absolute right-0 top-[20px] z-20 w-[220px] max-w-[calc(100vw-40px)] rounded-md border border-st-border bg-st-bg-elevated px-2.5 py-2 text-left text-[11px] font-medium leading-snug text-st-text-secondary opacity-0 shadow-[0_8px_22px_rgba(0,0,0,0.18)] transition-opacity whitespace-normal break-words group-hover:opacity-100 group-focus-within:opacity-100"
        >
          {help}
        </span>
      </span>
    </span>
  )
}

// ── Rich Text (bold + citations) ─────────────────────────────

function RichText({ text, scope, expandedCite, onToggle }: {
  text: string; scope: string; expandedCite: ActiveCite | null; onToggle: (cite: ActiveCite) => void
}) {
  // Split on [N] citations and **bold** markers
  const parts = text.split(/(\[\d+\]|\*\*[^*]+\*\*)/)
  return (
    <span className="st-rich-text">
      {parts.map((part, i) => {
        const citeMatch = part.match(/^\[(\d+)\]$/)
        if (citeMatch) {
          const id = parseInt(citeMatch[1])
          const citeKey = `${scope}:${i}`
          const isExpanded = expandedCite?.key === citeKey
          return (
            <button
              type="button"
              key={i}
              aria-label={`${isExpanded ? 'Close' : 'Open'} source chunk ${id}`}
              aria-expanded={isExpanded}
              data-cite-key={citeKey}
              onClick={() => onToggle({ id, key: citeKey, scope, context: citationContext(parts, i) })}
              className={`inline-flex items-center justify-center text-[10px] font-semibold min-w-[17px] h-[17px] px-1 border-0 rounded cursor-pointer transition-all align-middle relative -top-px mx-0.5 select-none font-sans ${
                isExpanded
                  ? 'bg-st-accent text-st-accent-contrast'
                  : 'bg-st-accent-light text-st-accent hover:bg-st-accent hover:text-st-accent-contrast'
              }`}
            >
              {id}
            </button>
          )
        }
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={i} className="font-semibold text-st-text-primary">{part.slice(2, -2)}</strong>
        }
        return <span key={i}>{part}</span>
      })}
    </span>
  )
}

// ── Citation Expansion ───────────────────────────────────────

function CiteExpansion({ activeCite, scope, chunks }: {
  activeCite: ActiveCite | null; scope: string; chunks: Chunk[]
}) {
  if (!activeCite || activeCite.scope !== scope) return null
  const chunk = chunks.find(c => c.id === activeCite.id)
  if (!chunk) return null
  const preview = sourcePreview(chunk.text, activeCite.context)

  return (
    <div
      data-cite-expansion="true"
      data-cite-scope={scope}
      className="mt-2.5 pl-3 py-2.5 pr-3 border-l-2 rounded-r-md bg-st-accent-faint text-[12px] leading-relaxed text-st-text-secondary animate-[citeIn_0.15s_ease] st-rich-text"
      style={{ borderLeftColor: 'var(--st-source-accent)' }}
    >
      <div className="mb-1.5 text-[9px] font-bold uppercase tracking-[0.05em] text-st-source-accent">Source {activeCite.id}</div>
      <div className="italic">{preview}</div>
    </div>
  )
}

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

const SOURCE_CONTEXT_STOPWORDS = new Set([
  'about', 'after', 'also', 'because', 'between', 'chunk', 'cited', 'cites',
  'claim', 'from', 'into', 'more', 'most', 'note', 'only', 'over', 'page',
  'post', 'reply', 'same', 'says', 'source', 'than', 'that', 'their', 'there',
  'they', 'this', 'thread', 'what', 'when', 'where', 'which', 'with',
])

function citationContext(parts: string[], index: number): string {
  const before = parts.slice(0, index).join(' ')
  const after = parts.slice(index + 1).join(' ')
  return `${before.slice(-260)} ${after.slice(0, 120)}`
    .replace(/\[\d+\]/g, ' ')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function sourcePreview(text: string, context = ''): string {
  const lines = cleanSourceLines(text)
  if (!lines.length) return ''

  const selected = selectSourceExcerpt(lines, context)
  const cleaned = selected.join(' ').replace(/\s+/g, ' ').trim()

  return cleaned.length > 360 ? `${cleaned.slice(0, 360).trimEnd()}...` : cleaned
}

function cleanSourceLines(text: string): string[] {
  return text
    .replace(/\u00a0/g, ' ')
    .split(/\n+/)
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(line => line.length > 1 && !isSourceNoise(line))
    .flatMap(splitLongSourceLine)
    .filter(line => line.length > 1 && !isSourceNoise(line))
}

function isSourceNoise(line: string): boolean {
  if (SOURCE_NOISE_PATTERNS.some(pattern => pattern.test(line))) return true
  if (line.length < 34 && /^[A-Z0-9 '\-&/]+$/.test(line) && /[A-Z]/.test(line)) return true
  return false
}

function splitLongSourceLine(line: string): string[] {
  if (line.length <= 260) return [line]
  const sentences = line.split(/(?<=[.!?])\s+/).map(sentence => sentence.trim()).filter(Boolean)
  return sentences.length > 1 ? sentences : [line]
}

function selectSourceExcerpt(lines: string[], context: string): string[] {
  const keywords = sourceKeywords(context)
  if (!keywords.length) return lines.slice(0, 4)

  let bestIndex = 0
  let bestScore = 0

  for (let index = 0; index < lines.length; index += 1) {
    const windowText = lines.slice(index, index + 3).join(' ').toLowerCase()
    const score = keywords.reduce((sum, keyword) => sum + (windowText.includes(keyword) ? 1 : 0), 0)
    if (score > bestScore) {
      bestScore = score
      bestIndex = index
    }
  }

  if (bestScore === 0) return lines.slice(0, 4)
  return lines.slice(Math.max(0, bestIndex - 1), bestIndex + 4)
}

function sourceKeywords(context: string): string[] {
  const words = context
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map(word => word.replace(/^-+|-+$/g, ''))
    .filter(word => word.length >= 4 && !SOURCE_CONTEXT_STOPWORDS.has(word))

  return [...new Set(words)].slice(0, 12)
}

// ── Formatted Chat ───────────────────────────────────────────

function FormattedChat({ text, scopePrefix, expandedCite, onToggle, chunks }: {
  text: string; scopePrefix: string; expandedCite: ActiveCite | null; onToggle: (cite: ActiveCite) => void; chunks: Chunk[]
}) {
  const cleaned = text
    .replace(/^#{1,4}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1') // Strip bold in chat — keep it clean

  const blocks = cleaned.split(/\n\n+/).filter(b => b.trim())

  return (
    <>
      {blocks.map((block, bi) => {
        const lines = block.split('\n').filter(l => l.trim())
        const isList = lines.every(l => l.trim().startsWith('- '))

        if (isList) {
          return (
            <ul key={bi} className={`space-y-1.5 ${bi > 0 ? 'mt-3' : ''}`}>
              {lines.map((line, li) => (
                <li key={li} className="relative pl-4 py-0.5">
                  <span className="absolute left-0 top-[9px] w-1 h-1 rounded-full bg-st-source-accent" />
                  <RichText text={line.replace(/^-\s*/, '')} scope={`${scopePrefix}-list-${bi}-${li}`} expandedCite={expandedCite} onToggle={onToggle} />
                  <CiteExpansion activeCite={expandedCite} scope={`${scopePrefix}-list-${bi}-${li}`} chunks={chunks} />
                </li>
              ))}
            </ul>
          )
        }

        return (
          <div key={bi} className={bi > 0 ? 'mt-3' : ''}>
            <RichText text={block.replace(/\n/g, ' ')} scope={`${scopePrefix}-paragraph-${bi}`} expandedCite={expandedCite} onToggle={onToggle} />
            <CiteExpansion activeCite={expandedCite} scope={`${scopePrefix}-paragraph-${bi}`} chunks={chunks} />
          </div>
        )
      })}
    </>
  )
}
