// ── Steeped Settings Page ────────────────────────────────

import { MODEL_ID } from '../lib/prompts'
import { getPanelShortcut } from '../lib/shortcut'
import {
  DEFAULT_DISCUSSION_NOTE_PREFERENCE,
  DISCUSSION_NOTE_PREFERENCE_KEY,
  getDiscussionNotePreference,
  type DiscussionNotePreference,
} from '../lib/discussion'
import {
  DARK_MODE_STORAGE_KEY,
  DEFAULT_PALETTE_ID,
  THEME_PALETTES,
  THEME_PALETTE_STORAGE_KEY,
  applyCachedTheme,
  applyPalette,
  getThemePalette,
  type ThemePaletteId,
} from '../lib/theme'

// Early dark-mode class application (sync, before render)
try {
  applyCachedTheme()
} catch {}

// External URLs. GitHub Pages is served from the custom domain steeped.page.
const REPO_URL = 'https://github.com/steeped-app/steeped'
const ISSUES_URL = 'https://github.com/steeped-app/steeped/issues'
const PRIVACY_URL = 'https://steeped.page/privacy.html'
const TERMS_URL = 'https://steeped.page/terms.html'

const welcomeCard = document.getElementById('welcome-card') as HTMLElement
const keyInput = document.getElementById('api-key-input') as HTMLInputElement
const saveBtn = document.getElementById('save-key-btn') as HTMLButtonElement
const testBtn = document.getElementById('test-key-btn') as HTMLButtonElement
const keyDot = document.getElementById('key-dot') as HTMLElement
const keyStatusText = document.getElementById('key-status-text') as HTMLElement
const keySaveStatus = document.getElementById('key-save-status') as HTMLElement
const darkToggle = document.getElementById('dark-toggle') as HTMLInputElement
const removeKeyBtn = document.getElementById('remove-key-btn') as HTMLButtonElement
const clearHistoryBtn = document.getElementById('clear-history-btn') as HTMLButtonElement
const dangerStatus = document.getElementById('danger-status') as HTMLElement
const repoLink = document.getElementById('repo-link') as HTMLAnchorElement
const privacyLink = document.getElementById('privacy-link') as HTMLAnchorElement
const termsLink = document.getElementById('terms-link') as HTMLAnchorElement
const repoIssuesLink = document.getElementById('repo-issues-link') as HTMLAnchorElement
const shortcutPanel = document.getElementById('shortcut-panel') as HTMLElement
const customizeShortcutBtn = document.getElementById('customize-shortcut-btn') as HTMLButtonElement
const paletteGrid = document.getElementById('palette-grid') as HTMLElement
const themeStatus = document.getElementById('theme-status') as HTMLElement
const discussionChoiceGrid = document.getElementById('discussion-choice-grid') as HTMLElement
const discussionStatus = document.getElementById('discussion-status') as HTMLElement

let selectedPaletteId: ThemePaletteId = DEFAULT_PALETTE_ID
let selectedDarkMode = true
let selectedDiscussionPreference: DiscussionNotePreference = DEFAULT_DISCUSSION_NOTE_PREFERENCE

const DISCUSSION_CHOICES: Array<{ id: DiscussionNotePreference; name: string; desc: string }> = [
  { id: 'auto', name: 'Auto', desc: 'Use discussion notes when the page shape is clear.' },
  { id: 'more-often', name: 'More often', desc: 'Use discussion notes on looser forum and comment signals.' },
  { id: 'off', name: 'Off', desc: 'Only use discussion notes when you rebuild manually.' },
]

// ── External Links ────────────────────────────────────────

function wireExternalLink(el: HTMLAnchorElement, url: string) {
  el.href = url
  el.target = '_blank'
  el.rel = 'noopener noreferrer'
}

wireExternalLink(repoLink, REPO_URL)
wireExternalLink(repoIssuesLink, ISSUES_URL)
wireExternalLink(privacyLink, PRIVACY_URL)
wireExternalLink(termsLink, TERMS_URL)

// ── Shortcut ──────────────────────────────────────────────

getPanelShortcut().then(s => {
  shortcutPanel.textContent = s || 'Not set'
})

customizeShortcutBtn.addEventListener('click', () => {
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }).catch(err => {
    console.warn('[steeped] failed to open chrome://extensions/shortcuts:', err)
  })
})

// ── Init ──────────────────────────────────────────────────

function renderPaletteGrid() {
  paletteGrid.replaceChildren(...THEME_PALETTES.map(palette => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'palette-button'
    button.setAttribute('aria-pressed', String(palette.id === selectedPaletteId))
    button.dataset.paletteId = palette.id

    const copy = document.createElement('span')
    const name = document.createElement('span')
    name.className = 'palette-name'
    name.textContent = palette.name
    const desc = document.createElement('span')
    desc.className = 'palette-desc'
    desc.textContent = palette.description
    copy.append(name, desc)

    const swatches = document.createElement('span')
    swatches.className = 'palette-swatches'
    for (const color of palette.swatches) {
      const swatch = document.createElement('span')
      swatch.className = 'palette-swatch'
      swatch.style.background = color
      swatches.append(swatch)
    }

    button.append(copy, swatches)
    button.addEventListener('click', () => savePalette(palette.id))
    return button
  }))
}

function renderDiscussionChoices() {
  discussionChoiceGrid.replaceChildren(...DISCUSSION_CHOICES.map(choice => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'choice-button'
    button.setAttribute('aria-pressed', String(choice.id === selectedDiscussionPreference))

    const name = document.createElement('span')
    name.className = 'choice-name'
    name.textContent = choice.name
    const desc = document.createElement('span')
    desc.className = 'choice-desc'
    desc.textContent = choice.desc
    button.append(name, desc)

    button.addEventListener('click', () => saveDiscussionPreference(choice.id))
    return button
  }))
}

async function saveDiscussionPreference(nextPreference: DiscussionNotePreference) {
  selectedDiscussionPreference = nextPreference
  renderDiscussionChoices()
  await chrome.storage.local.set({ [DISCUSSION_NOTE_PREFERENCE_KEY]: selectedDiscussionPreference })
  showStatus(discussionStatus, 'Discussion notes updated.', 'success')
}

async function savePalette(nextPaletteId: ThemePaletteId) {
  selectedPaletteId = nextPaletteId
  applyPalette(selectedPaletteId, selectedDarkMode)
  renderPaletteGrid()
  await chrome.storage.local.set({ [THEME_PALETTE_STORAGE_KEY]: selectedPaletteId })
  showStatus(themeStatus, `${getThemePalette(selectedPaletteId).name} selected.`, 'success')
}

chrome.storage.local.get(['apiKey', DARK_MODE_STORAGE_KEY, THEME_PALETTE_STORAGE_KEY, DISCUSSION_NOTE_PREFERENCE_KEY]).then(({ apiKey, darkMode, themePalette, discussionNotePreference }) => {
  if (apiKey) {
    setKeyStatus(true, apiKey)
  } else {
    setKeyStatus(false)
  }

  const nextDark = darkMode ?? true
  const nextPalette = getThemePalette(themePalette).id
  selectedDarkMode = nextDark
  selectedPaletteId = nextPalette
  darkToggle.checked = nextDark
  applyPalette(nextPalette, nextDark)
  renderPaletteGrid()
  selectedDiscussionPreference = getDiscussionNotePreference(discussionNotePreference)
  renderDiscussionChoices()

  if (new URLSearchParams(window.location.search).get('welcome') === '1' || !apiKey) {
    welcomeCard.classList.add('visible')
  }
})

function setKeyStatus(active: boolean, key?: string) {
  if (active && key) {
    keyDot.classList.remove('missing')
    keyDot.classList.add('active')
    const masked = key.slice(0, 10) + '...' + key.slice(-4)
    keyStatusText.textContent = `Key configured: ${masked}`
    keyInput.placeholder = 'Enter a new key to replace the current one'
  } else {
    keyDot.classList.remove('active')
    keyDot.classList.add('missing')
    keyStatusText.textContent = 'No key configured'
    keyInput.placeholder = 'sk-ant-api03-...'
  }
}

// ── Status Helper ─────────────────────────────────────────

function showStatus(el: HTMLElement, msg: string, type: 'success' | 'error') {
  el.textContent = msg
  el.className = `status visible ${type}`
  setTimeout(() => { el.className = 'status' }, 4000)
}

// ── Save API Key ──────────────────────────────────────────

saveBtn.addEventListener('click', async () => {
  const trimmed = keyInput.value.trim()
  if (!trimmed) {
    showStatus(keySaveStatus, 'Please enter a key.', 'error')
    return
  }
  if (!trimmed.startsWith('sk-ant-')) {
    showStatus(keySaveStatus, 'Key should start with sk-ant-', 'error')
    return
  }

  await chrome.storage.local.set({ apiKey: trimmed })
  keyInput.value = ''
  setKeyStatus(true, trimmed)
  showStatus(keySaveStatus, 'Key saved.', 'success')
})

keyInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') saveBtn.click()
})

// ── Test API Key ──────────────────────────────────────────

async function testKey(key: string): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: MODEL_ID,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    })

    if (res.ok) return { ok: true }

    if (res.status === 401) return { ok: false, message: 'Key rejected by Anthropic.' }
    if (res.status === 429) return { ok: false, message: 'Rate limited. Try again shortly.' }
    if (res.status === 529) return { ok: false, message: 'Anthropic is overloaded. Try again shortly.' }

    try {
      const body = await res.json()
      return { ok: false, message: body?.error?.message || `API error (${res.status}).` }
    } catch {
      return { ok: false, message: `API error (${res.status}).` }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error.'
    return { ok: false, message }
  }
}

testBtn.addEventListener('click', async () => {
  // Prefer the text in the input; fall back to the stored key.
  let candidate = keyInput.value.trim()
  if (!candidate) {
    const { apiKey } = await chrome.storage.local.get('apiKey')
    candidate = apiKey || ''
  }

  if (!candidate) {
    showStatus(keySaveStatus, 'Enter a key to test, or save one first.', 'error')
    return
  }
  if (!candidate.startsWith('sk-ant-')) {
    showStatus(keySaveStatus, 'Key should start with sk-ant-', 'error')
    return
  }

  testBtn.disabled = true
  const prevText = testBtn.textContent
  testBtn.textContent = 'Testing...'

  const result = await testKey(candidate)

  testBtn.disabled = false
  testBtn.textContent = prevText

  if (result.ok) {
    showStatus(keySaveStatus, 'Key works.', 'success')
  } else {
    showStatus(keySaveStatus, result.message, 'error')
  }
})

// ── Dark Mode Toggle ──────────────────────────────────────

darkToggle.addEventListener('change', () => {
  const isDark = darkToggle.checked
  selectedDarkMode = isDark
  applyPalette(selectedPaletteId, isDark)
  chrome.storage.local.set({ [DARK_MODE_STORAGE_KEY]: isDark })
})

// ── Danger Zone ───────────────────────────────────────────

removeKeyBtn.addEventListener('click', async () => {
  if (!confirm('Remove this key?')) return

  await chrome.storage.local.remove('apiKey')
  setKeyStatus(false)
  showStatus(dangerStatus, 'API key removed.', 'success')
})

clearHistoryBtn.addEventListener('click', async () => {
  if (!confirm('Delete saved summaries?')) return

  const all = await chrome.storage.local.get(null)
  const keysToRemove = Object.keys(all).filter(k => k.startsWith('st_'))
  if (keysToRemove.length > 0) {
    await chrome.storage.local.remove(keysToRemove)
  }

  showStatus(dangerStatus, `Cleared ${keysToRemove.length} items.`, 'success')
})
