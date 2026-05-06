// Steeped — Background Service Worker
// Handles: panel opening, summarize flow, follow-up chat

import {
  CHAT_PROMPT,
  MODEL_ID,
  SUMMARY_TEMPERATURE,
  buildChunkPrompt,
  buildSummarySystemPrompt,
  type SummaryMode,
} from '../lib/prompts'
import {
  DEFAULT_DISCUSSION_NOTE_PREFERENCE,
  DISCUSSION_NOTE_PREFERENCE_KEY,
  getDiscussionNotePreference,
  shouldUseDiscussionNote,
  type DiscussionNoteOverride,
} from '../lib/discussion'
import {
  DARK_MODE_STORAGE_KEY,
  DEFAULT_PALETTE_ID,
  THEME_PALETTE_STORAGE_KEY,
} from '../lib/theme'
import type { ExtractionResult } from '../lib/types'

const CONTEXT_MENU_OPEN_PAGE_ID = 'steeped-open-page'
const PANEL_SCRIPT = 'content/panel-host.js'
type PanelMessageType = 'steeped:open' | 'steeped:show'

// ── First Run ─────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async (details) => {
  registerContextMenus()

  if (details.reason !== 'install') return

  await chrome.storage.local.set({
    [DARK_MODE_STORAGE_KEY]: true,
    [THEME_PALETTE_STORAGE_KEY]: DEFAULT_PALETTE_ID,
    [DISCUSSION_NOTE_PREFERENCE_KEY]: DEFAULT_DISCUSSION_NOTE_PREFERENCE,
    firstRunOpenedAt: Date.now(),
  })

  await chrome.tabs.create({
    url: chrome.runtime.getURL('settings/settings.html?welcome=1'),
  })
})

// ── Panel Opening ──────────────────────────────────────────────

chrome.action.onClicked.addListener(async (tab: chrome.tabs.Tab) => {
  if (!tab?.id) return
  await openPanel(tab.id, 'toggle')
})

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_OPEN_PAGE_ID || !tab?.id) return
  await openPanel(tab.id, 'show')
})

function registerContextMenus() {
  chrome.contextMenus.removeAll(() => {
    if (chrome.runtime.lastError) {
      console.warn('[steeped] failed to clear context menus:', chrome.runtime.lastError.message)
      return
    }

    chrome.contextMenus.create({
      id: CONTEXT_MENU_OPEN_PAGE_ID,
      title: 'Open Steeped for this page',
      contexts: ['page', 'selection', 'link'],
      documentUrlPatterns: ['http://*/*', 'https://*/*'],
    }, () => {
      if (chrome.runtime.lastError) {
        console.warn('[steeped] failed to register context menu:', chrome.runtime.lastError.message)
      }
    })
  })
}

async function openPanel(tabId: number, mode: 'toggle' | 'show') {
  await sendPanelMessage(tabId, mode === 'show' ? 'steeped:show' : 'steeped:open')
}

async function sendPanelMessage(tabId: number, type: PanelMessageType) {
  try {
    await chrome.tabs.sendMessage(tabId, { type })
    return
  } catch {}

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [PANEL_SCRIPT],
    })
    setTimeout(async () => {
      try { await chrome.tabs.sendMessage(tabId, { type }) } catch {}
    }, 100)
  } catch {}
}

// ── Port Router ────────────────────────────────────────────────

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'steeped-summarize') handleSummarize(port)
  if (port.name === 'steeped-chat') handleChat(port)
})

// ── Summarize Flow ─────────────────────────────────────────────

function handleSummarize(port: chrome.runtime.Port) {
  const tabId = port.sender?.tab?.id
  if (!tabId) {
    port.postMessage({ type: 'error', error: 'Could not identify the active tab.' })
    return
  }

  port.onMessage.addListener(async (msg) => {
    if (msg.type !== 'start' && msg.type !== 'start-existing') return

    try {
      const { apiKey } = await chrome.storage.local.get('apiKey')
      if (!apiKey) {
        port.postMessage({ type: 'error', error: 'No API key configured.' })
        return
      }

      const extraction = msg.type === 'start-existing'
        ? normalizeExistingExtraction(msg.extraction)
        : await extractPage(tabId)

      if (!extraction.chunks.length) {
        port.postMessage({ type: 'error', error: 'Could not extract content from this page.' })
        return
      }

      if (msg.type === 'start') {
        sendSourceCache(tabId, extraction)
      }

      const { [DISCUSSION_NOTE_PREFERENCE_KEY]: storedPreference } = await chrome.storage.local.get(DISCUSSION_NOTE_PREFERENCE_KEY)
      const discussionPreference = getDiscussionNotePreference(msg.discussionNotePreference || storedPreference)
      const discussionNoteOverride = (msg.discussionNoteOverride || 'auto') as DiscussionNoteOverride
      const discussionNoteActive = shouldUseDiscussionNote(extraction.surfaceInfo, discussionPreference, discussionNoteOverride)

      port.postMessage({
        type: 'chunks',
        chunks: extraction.chunks,
        title: extraction.title,
        url: extraction.url,
        warnings: extraction.warnings || [],
        surfaceInfo: extraction.surfaceInfo,
        discussionNoteActive,
      })

      const userMessage = buildChunkPrompt(extraction)

      const systemPrompt = buildSummarySystemPrompt(
        (msg.mode || 'concise') as SummaryMode,
        msg.customInstructions,
        extraction.surfaceInfo,
        discussionNoteActive,
      )

      await streamFromApi(apiKey, systemPrompt, [{ role: 'user', content: userMessage }], port)
    } catch (err: any) {
      try { port.postMessage({ type: 'error', error: err?.message || String(err) }) } catch {}
    }
  })
}

// ── Chat Flow ──────────────────────────────────────────────────

function handleChat(port: chrome.runtime.Port) {
  port.onMessage.addListener(async (msg) => {
    if (msg.type !== 'chat') return

    try {
      const { apiKey } = await chrome.storage.local.get('apiKey')
      if (!apiKey) {
        port.postMessage({ type: 'error', error: 'No API key configured.' })
        return
      }

      // Build full conversation: chunks as first user message, summary as first assistant,
      // then chat history, then the new question
      const messages: { role: 'user' | 'assistant'; content: string }[] = [
        { role: 'user', content: msg.chunksPrompt },
        { role: 'assistant', content: msg.summaryText },
        ...msg.history,
        { role: 'user', content: msg.question },
      ]

      await streamFromApi(apiKey, CHAT_PROMPT, messages, port)
    } catch (err: any) {
      try { port.postMessage({ type: 'error', error: err?.message || String(err) }) } catch {}
    }
  })
}

// ── Extraction ─────────────────────────────────────────────────

function generateRequestId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function normalizeExistingExtraction(raw: Partial<ExtractionResult> | undefined): ExtractionResult {
  return {
    title: raw?.title || '',
    url: raw?.url || '',
    chunks: Array.isArray(raw?.chunks) ? raw.chunks : [],
    warnings: Array.isArray(raw?.warnings) ? raw.warnings : [],
    surfaceInfo: raw?.surfaceInfo,
  }
}

function extractPage(tabId: number): Promise<ExtractionResult> {
  return new Promise((resolve, reject) => {
    const requestId = generateRequestId()

    const timeout = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(handler)
      reject(new Error('Extraction timed out (15s). The page may be too complex.'))
    }, 15_000)

    const handler = (msg: any, sender: chrome.runtime.MessageSender) => {
      if (
        msg?.type === 'steeped:extracted' &&
        sender.tab?.id === tabId &&
        msg.requestId === requestId
      ) {
        chrome.runtime.onMessage.removeListener(handler)
        clearTimeout(timeout)
        resolve({
          title: msg.title,
          url: msg.url,
          chunks: msg.chunks,
          warnings: msg.warnings || [],
          surfaceInfo: msg.surfaceInfo,
        })
      }
    }

    chrome.runtime.onMessage.addListener(handler)

    // Inject a prelude that stashes the request ID on window, then run the extractor.
    chrome.scripting
      .executeScript({
        target: { tabId },
        func: (reqId: string) => {
          ;(window as unknown as { __steepedReqId?: string }).__steepedReqId = reqId
        },
        args: [requestId],
      })
      .then(() =>
        chrome.scripting.executeScript({
          target: { tabId },
          files: ['content/extractor.js'],
        })
      )
      .catch((err) => {
        chrome.runtime.onMessage.removeListener(handler)
        clearTimeout(timeout)
        reject(new Error(`Cannot access this page: ${err.message}`))
      })
  })
}

function sendSourceCache(tabId: number, extraction: ExtractionResult) {
  chrome.tabs.sendMessage(tabId, {
    type: 'steeped:source-cache',
    url: extraction.url,
    chunks: extraction.chunks,
    cachedAt: Date.now(),
  }).catch(() => {
    // The inline source card remains the fallback if the page host is gone.
  })
}

// ── Anthropic Streaming (shared by summarize + chat) ───────────

async function streamFromApi(
  apiKey: string,
  systemPrompt: string,
  messages: { role: 'user' | 'assistant'; content: string }[],
  port: chrome.runtime.Port,
) {
  const controller = new AbortController()
  const onDisconnect = () => controller.abort()
  port.onDisconnect.addListener(onDisconnect)

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: MODEL_ID,
        max_tokens: 2048,
        temperature: SUMMARY_TEMPERATURE,
        stream: true,
        system: systemPrompt,
        messages,
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      let msg = `Anthropic API error (${res.status})`
      try {
        const body = await res.json()
        msg = body?.error?.message || msg
      } catch {}

      if (res.status === 401) msg = 'Invalid API key. Check your key in settings.'
      if (res.status === 429) msg = 'Rate limited. Wait a minute and try again.'
      if (res.status === 529) msg = 'Anthropic is overloaded. Try again shortly.'

      throw new Error(msg)
    }

    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6).trim()
        if (!data || data === '[DONE]') continue

        try {
          const event = JSON.parse(data)
          if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
            port.postMessage({ type: 'delta', text: event.delta.text })
          }
        } catch {}
      }
    }

    try { port.postMessage({ type: 'done' }) } catch {}
  } catch (err) {
    // User closed the panel mid-stream — fetch was aborted, nothing to surface.
    if ((err as { name?: string })?.name === 'AbortError') return
    throw err
  } finally {
    try { port.onDisconnect.removeListener(onDisconnect) } catch {}
  }
}
