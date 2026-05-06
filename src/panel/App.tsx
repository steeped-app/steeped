import { useState, useEffect, useRef, useCallback } from 'react'
import ApiKeySetup from './components/ApiKeySetup'
import SummaryView from './components/SummaryView'
import HistoryView from './components/HistoryView'
import { saveEntry, updateEntry, getEntry, getIndex } from '../lib/storage'
import { toMarkdown, downloadMarkdown } from '../lib/markdown'
import { getPanelShortcut } from '../lib/shortcut'
import { buildChunkPrompt, type SummaryMode } from '../lib/prompts'
import {
  canOfferDiscussionNote,
  DEFAULT_DISCUSSION_NOTE_PREFERENCE,
  DISCUSSION_NOTE_PREFERENCE_KEY,
  getDiscussionNotePreference,
  type DiscussionNoteOverride,
  type DiscussionNotePreference,
} from '../lib/discussion'
import {
  DARK_MODE_STORAGE_KEY,
  DEFAULT_PALETTE_ID,
  THEME_PALETTE_STORAGE_KEY,
  applyPalette,
  getThemePalette,
  type ThemePaletteId,
} from '../lib/theme'
import type { Chunk, ExtractionWarning } from '../lib/types'
import type { SurfaceInfo } from '../lib/types'

interface ChatMessage { role: 'user' | 'assistant'; text: string }

type View = 'setup' | 'ready' | 'loading' | 'summary' | 'error' | 'chatting' | 'history'
interface SummaryRunOptions {
  discussionNoteOverride?: DiscussionNoteOverride
  reuseCurrent?: boolean
}
type QaWindow = Window & {
  __steepedQaCapture?: () => unknown
}

const MODES: { key: SummaryMode; label: string }[] = [
  { key: 'concise', label: 'Concise' },
  { key: 'detailed', label: 'Detailed' },
  { key: 'simplify', label: 'Simplify' },
  { key: 'translate', label: 'Translate' },
]

async function openSettingsDirect() {
  try {
    await chrome.runtime.openOptionsPage()
  } catch (e1) {
    console.warn('[steeped] openOptionsPage failed, falling back:', e1)
    try {
      await chrome.tabs.create({ url: chrome.runtime.getURL('settings/settings.html') })
    } catch (e2) {
      console.error('[steeped] tabs.create fallback also failed:', e2)
    }
  }
}

export default function App() {
  const [view, setView] = useState<View>('setup')
  const [prevView, setPrevView] = useState<View>('ready')
  const [summaryText, setSummaryText] = useState('')
  const [chunks, setChunks] = useState<Chunk[]>([])
  const [extractionWarnings, setExtractionWarnings] = useState<ExtractionWarning[]>([])
  const [surfaceInfo, setSurfaceInfo] = useState<SurfaceInfo | undefined>()
  const [discussionNoteActive, setDiscussionNoteActive] = useState(false)
  const [discussionNotePreference, setDiscussionNotePreference] = useState<DiscussionNotePreference>(DEFAULT_DISCUSSION_NOTE_PREFERENCE)
  const [chunksPrompt, setChunksPrompt] = useState('')
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatStreamText, setChatStreamText] = useState('')
  const [error, setError] = useState('')
  const [pageTitle, setPageTitle] = useState('')
  const [pageUrl, setPageUrl] = useState('')
  const [pageDomain, setPageDomain] = useState('')
  const [entryId, setEntryId] = useState<string | null>(null)
  const [summaryMode, setSummaryMode] = useState<SummaryMode>('concise')
  const [customInstructions, setCustomInstructions] = useState('')
  const [showCustom, setShowCustom] = useState(false)
  const [isDark, setIsDark] = useState(true)
  const [themePalette, setThemePalette] = useState<ThemePaletteId>(DEFAULT_PALETTE_ID)
  const [copied, setCopied] = useState(false)
  const [shortcut, setShortcut] = useState('')
  const [hasSavedNotes, setHasSavedNotes] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const portRef = useRef<chrome.runtime.Port | null>(null)
  const iconUrl = chrome.runtime.getURL('icons/icon48.png')

  // Init: check API key + dark mode preference + shortcut
  useEffect(() => {
    chrome.storage.local.get(['apiKey', DARK_MODE_STORAGE_KEY, THEME_PALETTE_STORAGE_KEY, DISCUSSION_NOTE_PREFERENCE_KEY]).then(({ apiKey, darkMode, themePalette, discussionNotePreference }) => {
      if (apiKey) setView('ready')
      const nextDark = darkMode ?? true
      const nextPalette = getThemePalette(themePalette).id
      setIsDark(nextDark)
      setThemePalette(nextPalette)
      setDiscussionNotePreference(getDiscussionNotePreference(discussionNotePreference))
      applyPalette(nextPalette, nextDark)
    })
    getPanelShortcut().then(setShortcut)
    getIndex().then(index => setHasSavedNotes(index.length > 0))
  }, [])

  useEffect(() => {
    const handleThemeStorageChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName !== 'local') return
      if (!changes[DARK_MODE_STORAGE_KEY] && !changes[THEME_PALETTE_STORAGE_KEY] && !changes[DISCUSSION_NOTE_PREFERENCE_KEY]) return

      if (changes[DISCUSSION_NOTE_PREFERENCE_KEY]) {
        setDiscussionNotePreference(getDiscussionNotePreference(changes[DISCUSSION_NOTE_PREFERENCE_KEY].newValue))
      }

      const nextDark = changes[DARK_MODE_STORAGE_KEY]?.newValue ?? isDark
      const nextPalette = getThemePalette(changes[THEME_PALETTE_STORAGE_KEY]?.newValue ?? themePalette).id
      setIsDark(nextDark)
      setThemePalette(nextPalette)
      applyPalette(nextPalette, nextDark)
    }

    chrome.storage.onChanged.addListener(handleThemeStorageChange)
    return () => chrome.storage.onChanged.removeListener(handleThemeStorageChange)
  }, [isDark, themePalette])

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'steeped:focus') inputRef.current?.focus()
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  useEffect(() => {
    const qaWindow = window as QaWindow
    if (localStorage.getItem('st-qa-capture') !== 'true') {
      delete qaWindow.__steepedQaCapture
      return
    }

    qaWindow.__steepedQaCapture = () => ({
      schema: 'steeped-live-capture-v1',
      capturedAt: new Date().toISOString(),
      panel: {
        width: window.innerWidth,
        height: window.innerHeight,
        darkMode: isDark,
        themePalette,
        view,
        hasSavedNotes,
      },
      page: {
        title: pageTitle,
        url: pageUrl,
        domain: pageDomain,
      },
      mode: summaryMode,
      surfaceInfo,
      discussionNoteActive,
      discussionNotePreference,
      summaryText,
      chunks,
      extractionWarnings,
      error,
      chatMessages,
      chatStreamText,
    })

    return () => {
      delete qaWindow.__steepedQaCapture
    }
  }, [
    chatMessages,
    chatStreamText,
    chunks,
    extractionWarnings,
    error,
    hasSavedNotes,
    discussionNoteActive,
    discussionNotePreference,
    isDark,
    pageDomain,
    pageTitle,
    pageUrl,
    summaryMode,
    summaryText,
    surfaceInfo,
    themePalette,
    view,
  ])

  const toggleDark = () => {
    const next = !isDark
    setIsDark(next)
    applyPalette(themePalette, next)
    chrome.storage.local.set({ [DARK_MODE_STORAGE_KEY]: next })
  }

  // ── Summarize ────────────────────────────────────────────

  const handleSummarize = useCallback((options: SummaryRunOptions = {}) => {
    const reuseCurrent = Boolean(options.reuseCurrent && chunks.length > 0)
    setView('loading')
    setSummaryText('')
    if (!reuseCurrent) {
      setChunks([])
      setExtractionWarnings([])
      setChunksPrompt('')
      setSurfaceInfo(undefined)
      setDiscussionNoteActive(false)
    }
    setChatMessages([])
    setChatStreamText('')
    setError('')
    if (!reuseCurrent) setEntryId(null)

    const port = chrome.runtime.connect({ name: 'steeped-summarize' })
    portRef.current = port
    port.postMessage({
      type: reuseCurrent ? 'start-existing' : 'start',
      mode: summaryMode,
      customInstructions: customInstructions.trim() || undefined,
      discussionNotePreference,
      discussionNoteOverride: options.discussionNoteOverride || 'auto',
      extraction: reuseCurrent
        ? {
            title: pageTitle,
            url: pageUrl,
            chunks,
            warnings: extractionWarnings,
            surfaceInfo,
          }
        : undefined,
    })

    let _title = reuseCurrent ? pageTitle : ''
    let _url = reuseCurrent ? pageUrl : ''
    let _domain = reuseCurrent ? pageDomain : ''
    let _chunks: Chunk[] = reuseCurrent ? chunks : []
    let _prompt = ''
    let _warnings: ExtractionWarning[] = reuseCurrent ? extractionWarnings : []
    let _surfaceInfo: SurfaceInfo | undefined = reuseCurrent ? surfaceInfo : undefined
    let _discussionNoteActive = reuseCurrent ? discussionNoteActive : false

    port.onMessage.addListener((msg) => {
      switch (msg.type) {
        case 'chunks':
          _chunks = msg.chunks
          _warnings = msg.warnings || []
          _title = msg.title || ''
          _url = msg.url || ''
          _surfaceInfo = msg.surfaceInfo
          _discussionNoteActive = Boolean(msg.discussionNoteActive)
          try { _domain = new URL(msg.url).hostname } catch {}
          _prompt = buildChunkPrompt({ title: _title, url: _url, chunks: _chunks, surfaceInfo: _surfaceInfo })
          setChunks(_chunks)
          setExtractionWarnings(_warnings)
          setSurfaceInfo(_surfaceInfo)
          setDiscussionNoteActive(_discussionNoteActive)
          setPageTitle(_title)
          setPageUrl(_url)
          setPageDomain(_domain)
          setChunksPrompt(_prompt)
          break
        case 'delta':
          setSummaryText(prev => prev + msg.text)
          break
        case 'done':
          setView('summary')
          port.disconnect()
          portRef.current = null
          setSummaryText(prev => {
            if (reuseCurrent && entryId) {
              updateEntry(entryId, {
                summaryText: prev,
                chatMessages: [],
                chunks: _chunks,
                warnings: _warnings,
                surfaceInfo: _surfaceInfo,
                discussionNoteActive: _discussionNoteActive,
              })
            } else {
              saveEntry(_url, _title, _domain, prev, _chunks, [], _warnings, _surfaceInfo, _discussionNoteActive).then(id => {
                setEntryId(id)
                setHasSavedNotes(true)
              })
            }
            return prev
          })
          break
        case 'error':
          setError(msg.error)
          setView('error')
          port.disconnect()
          portRef.current = null
          break
      }
    })

    port.onDisconnect.addListener(() => { portRef.current = null })
  }, [
    chunks,
    customInstructions,
    discussionNoteActive,
    discussionNotePreference,
    entryId,
    extractionWarnings,
    pageDomain,
    pageTitle,
    pageUrl,
    summaryMode,
    surfaceInfo,
  ])

  // ── Chat ─────────────────────────────────────────────────

  const handleChat = useCallback((question: string) => {
    const trimmed = question.trim()
    if (!trimmed || !chunksPrompt) return

    const updatedHistory = [...chatMessages, { role: 'user' as const, text: trimmed }]
    setChatMessages(updatedHistory)
    setChatStreamText('')
    setView('chatting')

    const port = chrome.runtime.connect({ name: 'steeped-chat' })
    portRef.current = port
    port.postMessage({
      type: 'chat',
      chunksPrompt,
      summaryText,
      history: chatMessages.map(m => ({ role: m.role, content: m.text })),
      question: trimmed,
    })

    let accumulated = ''
    port.onMessage.addListener((msg) => {
      switch (msg.type) {
        case 'delta':
          accumulated += msg.text
          setChatStreamText(accumulated)
          break
        case 'done': {
          const finalMessages = [...updatedHistory, { role: 'assistant' as const, text: accumulated }]
          setChatMessages(finalMessages)
          setChatStreamText('')
          setView('summary')
          port.disconnect()
          portRef.current = null
          if (entryId) updateEntry(entryId, { chatMessages: finalMessages })
          break
        }
        case 'error':
          setChatMessages(prev => [...prev, { role: 'assistant', text: `Error: ${msg.error}` }])
          setChatStreamText('')
          setView('summary')
          port.disconnect()
          portRef.current = null
          break
      }
    })
    port.onDisconnect.addListener(() => { portRef.current = null })
  }, [chatMessages, chunksPrompt, summaryText, entryId])

  // ── History ──────────────────────────────────────────────

  const handleShowHistory = () => { setPrevView(view); setView('history') }

  const handleRestoreEntry = async (id: string) => {
    const entry = await getEntry(id)
    if (!entry) return
    setSummaryText(entry.summaryText)
    setChunks(entry.chunks)
    setExtractionWarnings(entry.warnings || [])
    setSurfaceInfo(entry.surfaceInfo)
    setDiscussionNoteActive(Boolean(entry.discussionNoteActive))
    setChatMessages(entry.chatMessages)
    setPageTitle(entry.title)
    setPageUrl(entry.url)
    setPageDomain(entry.domain)
    setEntryId(entry.id)
    setHasSavedNotes(true)
    setError('')
    setChatStreamText('')
    setChunksPrompt(buildChunkPrompt({ title: entry.title, url: entry.url, chunks: entry.chunks, surfaceInfo: entry.surfaceInfo }))
    setView('summary')
  }

  const handleExport = () => {
    const md = toMarkdown(pageTitle, pageUrl, summaryText, chatMessages)
    const safeName = pageTitle.replace(/[\\/:*?"<>|]/g, '').trim().replace(/\s+/g, '-').slice(0, 60)
    downloadMarkdown(`steeped-${safeName || 'export'}.md`, md)
  }

  const handleCopy = async () => {
    const md = toMarkdown(pageTitle, pageUrl, summaryText, chatMessages)
    await navigator.clipboard.writeText(md)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const handleClose = () => {
    portRef.current?.disconnect()
    window.parent.postMessage({ type: 'steeped:close-panel' }, '*')
  }

  const handleChatSubmit = () => {
    const val = inputRef.current?.value?.trim()
    if (!val) return
    inputRef.current!.value = ''
    handleChat(val)
  }

  const chatEnabled = view === 'summary' || view === 'chatting'
  const showHeader = view !== 'history'
  const canRebuildSummary = view === 'summary' && chunks.length > 0
  const showFirstUseHint = view === 'ready' && !hasSavedNotes
  const handleRebuildAsDiscussion = () => handleSummarize({ reuseCurrent: true, discussionNoteOverride: 'discussion' })
  const handleRebuildAsRegular = () => handleSummarize({ reuseCurrent: true, discussionNoteOverride: 'regular' })
  const showDiscussionRebuild = canRebuildSummary && !discussionNoteActive && canOfferDiscussionNote(surfaceInfo)

  return (
    <div className="h-full flex flex-col bg-st-bg text-st-text-primary font-sans antialiased transition-colors">
      {/* Header */}
      {showHeader && (
        <header className="panel-header flex items-center justify-between pl-4 pr-5 py-2.5 border-b border-st-border shrink-0">
          <div className="panel-brand flex min-w-0 items-center gap-0">
            <img src={iconUrl} alt="" className="w-[28px] h-[28px] rounded-[7px] shrink-0" />
            <span className="panel-brand-title text-[15px] font-bold ml-2 truncate">Steeped</span>
          </div>
          <div className="panel-actions flex min-w-0 shrink-0 items-center gap-0.5">
            {(view === 'summary' || view === 'chatting') && (
              <button onClick={() => setView('ready')} className="icon-btn panel-action-secondary" title="New summary">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
            )}
            {(view === 'summary' || view === 'chatting') && (
              <button onClick={handleCopy} className="icon-btn panel-action-tertiary" title={copied ? 'Copied!' : 'Copy to clipboard'}>
                {copied ? (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--st-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                )}
              </button>
            )}
            {(view === 'summary' || view === 'chatting') && (
              <button onClick={handleExport} className="icon-btn panel-action-tertiary" title="Export to Markdown">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              </button>
            )}
            {view !== 'setup' && (
              <button onClick={handleShowHistory} className="icon-btn panel-action-secondary" title="History">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                </svg>
              </button>
            )}
            {/* Dark mode toggle */}
            <button onClick={toggleDark} className="icon-btn panel-action-tertiary" title={isDark ? 'Light mode' : 'Dark mode'}>
              {isDark ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                </svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              )}
            </button>
            <button onClick={openSettingsDirect} className="icon-btn" title="Settings">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            </button>
            <button onClick={handleClose} className="icon-btn" title="Close panel">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </header>
      )}

      {/* ── Views ────────────────────────────────── */}

      {view === 'setup' && <ApiKeySetup onSaved={() => setView('ready')} />}

      {view === 'ready' && (
        <div className="flex-1 flex flex-col items-center justify-center px-6">
          <img src={iconUrl} alt="" className="w-[44px] h-[44px] rounded-[11px] mb-4" />
          <p className="text-[12px] text-st-text-tertiary mb-5">Big reads, small notes.</p>

          {/* Mode selector */}
          <div className="flex gap-1 mb-5">
            {MODES.map(m => (
              <button
                key={m.key}
                onClick={() => setSummaryMode(m.key)}
                className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors ${
                  summaryMode === m.key
                    ? 'bg-st-accent text-st-accent-contrast'
                    : 'bg-st-bg-surface text-st-text-secondary hover:text-st-text-primary'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          <button
            onClick={() => handleSummarize()}
            className="px-7 py-2.5 text-sm font-semibold bg-st-accent text-st-accent-contrast rounded-[10px] hover:bg-st-accent-hover transition-all hover:-translate-y-px hover:shadow-[0_4px_14px_rgba(86,199,193,0.18)] mb-3.5"
          >
            Summarize
          </button>
          {shortcut && (
            <p className="text-xs text-st-text-tertiary mb-2">
              or press{' '}
              <kbd className="inline-block px-1.5 py-0.5 text-[11px] font-medium bg-st-bg-surface border border-st-border rounded text-st-text-secondary">{shortcut}</kbd>
            </p>
          )}
          {!shortcut && <div className="mb-2" />}
          {showFirstUseHint ? (
            <p className="text-[11px] text-st-text-tertiary mb-5 text-center">
              Tip: you can right-click a page to open Steeped.
            </p>
          ) : (
            <div className="mb-5" />
          )}

          {/* Custom instructions toggle */}
          <button
            onClick={() => setShowCustom(!showCustom)}
            className="text-[11px] font-medium text-st-text-tertiary hover:text-st-text-secondary transition-colors flex items-center gap-1"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              className={`transition-transform ${showCustom ? 'rotate-90' : ''}`}
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
            Guide it
          </button>
          {showCustom && (
            <textarea
              value={customInstructions}
              onChange={(e) => setCustomInstructions(e.target.value)}
              placeholder="Focus on risks, names, or what changed..."
              rows={3}
              className="mt-2 w-full max-w-[280px] px-3 py-2 text-[12px] font-sans bg-st-bg-elevated border border-st-border rounded-lg text-st-text-primary placeholder:text-st-text-tertiary outline-none resize-none transition-colors focus:border-st-accent focus:ring-[3px] focus:ring-st-accent-faint"
            />
          )}
        </div>
      )}

      {(view === 'loading' || view === 'summary' || view === 'chatting') && (
        <SummaryView
          text={summaryText}
          chunks={chunks}
          isStreaming={view === 'loading'}
          pageTitle={pageTitle}
          pageDomain={pageDomain}
          warnings={extractionWarnings}
          surfaceInfo={surfaceInfo}
          discussionNoteActive={discussionNoteActive}
          onRebuildAsDiscussion={showDiscussionRebuild ? handleRebuildAsDiscussion : undefined}
          onRebuildAsRegular={canRebuildSummary && discussionNoteActive ? handleRebuildAsRegular : undefined}
          chatMessages={chatMessages}
          chatStreamText={view === 'chatting' ? chatStreamText : ''}
          isChatting={view === 'chatting'}
        />
      )}

      {view === 'error' && (
        <div className="flex-1 flex flex-col px-4 pt-4">
          <div className="p-3 bg-st-error-bg border border-st-error-border rounded-lg">
            <div className="text-[13px] font-semibold text-st-error mb-1">That did not work</div>
            <div className="text-[12px] text-st-error-text leading-relaxed">{error}</div>
          </div>
          <button onClick={() => setView('ready')} className="mt-4 text-[13px] font-medium text-st-accent hover:text-st-accent-hover">
            Try again
          </button>
        </div>
      )}

      {view === 'history' && (
        <HistoryView
          onBack={() => setView(prevView === 'history' ? 'ready' : prevView)}
          onRestore={handleRestoreEntry}
        />
      )}

      {/* ── Chat Input ─────────────────────────── */}
      {showHeader && (
        <div className="flex items-center gap-2 pl-4 pr-5 py-3 border-t border-st-border shrink-0">
          <input
            ref={inputRef}
            type="text"
            placeholder={chatEnabled ? 'Ask about this page' : 'Summarize first'}
            disabled={!chatEnabled}
            onKeyDown={(e) => e.key === 'Enter' && chatEnabled && handleChatSubmit()}
            className="flex-1 px-3 py-2 text-[13px] font-sans bg-st-bg-elevated border border-st-border rounded-lg text-st-text-primary placeholder:text-st-text-tertiary outline-none disabled:opacity-40 transition-colors focus:border-st-accent focus:ring-[3px] focus:ring-st-accent-faint"
          />
          <button
            onClick={handleChatSubmit}
            disabled={!chatEnabled}
            className="w-[34px] h-[34px] flex items-center justify-center bg-st-accent text-st-accent-contrast rounded-lg shrink-0 transition-colors hover:bg-st-accent-hover disabled:opacity-40"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      )}
    </div>
  )
}
