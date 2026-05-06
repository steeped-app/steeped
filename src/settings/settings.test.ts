// @ts-expect-error Test-only static HTML read; extension tsconfig does not include Node types.
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function installSettingsDom() {
  document.body.innerHTML = `
    <div id="welcome-card"></div>
    <input id="api-key-input" />
    <button id="save-key-btn"></button>
    <button id="test-key-btn"></button>
    <span id="key-dot"></span>
    <span id="key-status-text"></span>
    <span id="key-save-status"></span>
    <input id="dark-toggle" type="checkbox" />
    <button id="remove-key-btn"></button>
    <button id="clear-history-btn"></button>
    <span id="danger-status"></span>
    <a id="repo-link"></a>
    <a id="privacy-link"></a>
    <a id="terms-link"></a>
    <a id="repo-issues-link"></a>
    <span id="shortcut-panel"></span>
    <button id="customize-shortcut-btn"></button>
    <div id="palette-grid"></div>
    <span id="theme-status"></span>
    <div id="discussion-choice-grid"></div>
    <span id="discussion-status"></span>
  `
}

function installChromeMock() {
  const set = vi.fn(async () => {})
  const get = vi.fn(async () => ({
    apiKey: '',
    darkMode: true,
    themePalette: 'graphite-brass',
    discussionNotePreference: 'more-often',
  }))
  const remove = vi.fn(async () => {})
  const create = vi.fn(async () => ({}))
  const openOptionsPage = vi.fn(async () => {})

  ;(globalThis as unknown as { chrome: unknown }).chrome = {
    storage: { local: { get, set, remove } },
    commands: { getAll: vi.fn(async () => [{ name: '_execute_action', shortcut: 'Alt+S' }]) },
    tabs: { create },
    runtime: {
      getURL: (path: string) => `chrome-extension://test/${path}`,
      openOptionsPage,
    },
  }

  return { get, set, remove, create, openOptionsPage }
}

async function flush() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('settings page', () => {
  beforeEach(() => {
    vi.resetModules()
    document.documentElement.className = ''
    document.documentElement.removeAttribute('data-st-palette')
    document.documentElement.removeAttribute('style')
    installSettingsDom()
    window.history.replaceState({}, '', '/settings/settings.html?welcome=1')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('shows first-run setup and renders all palette choices', async () => {
    installChromeMock()

    await import('./settings')
    await flush()

    expect(document.getElementById('welcome-card')?.classList.contains('visible')).toBe(true)
    expect(document.querySelectorAll('.palette-button')).toHaveLength(4)
    expect(document.querySelectorAll('.choice-button')).toHaveLength(3)
    expect(document.documentElement.dataset.stPalette).toBe('graphite-brass')
    expect(document.querySelector('.palette-button[aria-pressed="true"]')?.textContent).toContain('Graphite + Brass')
    expect(document.querySelector('.choice-button[aria-pressed="true"]')?.textContent).toContain('More often')
  })

  it('explains toolbar, right-click, and shortcut opening paths', () => {
    const cwd = (globalThis as unknown as { process: { cwd(): string } }).process.cwd()
    const html = readFileSync(`${cwd}/src/settings/settings.html`, 'utf8')

    expect(html).toContain('Ways to open')
    expect(html).toContain('Pin Steeped or right-click a page when you want a note.')
    expect(html).toContain('Toolbar icon')
    expect(html).toContain('Right-click page')
    expect(html).toContain('Open Steeped for this page')
  })

  it('saves a selected palette through chrome storage', async () => {
    const chromeMock = installChromeMock()

    await import('./settings')
    await flush()

    const mineralButton = [...document.querySelectorAll<HTMLButtonElement>('.palette-button')]
      .find(button => button.textContent?.includes('Mineral Neutral'))
    expect(mineralButton).toBeTruthy()

    mineralButton?.click()
    await flush()

    expect(chromeMock.set).toHaveBeenCalledWith({ themePalette: 'mineral-neutral' })
    expect(document.documentElement.dataset.stPalette).toBe('mineral-neutral')
  })

  it('saves discussion note preference through chrome storage', async () => {
    const chromeMock = installChromeMock()

    await import('./settings')
    await flush()

    const offButton = [...document.querySelectorAll<HTMLButtonElement>('.choice-button')]
      .find(button => button.textContent?.includes('Off'))
    expect(offButton).toBeTruthy()

    offButton?.click()
    await flush()

    expect(chromeMock.set).toHaveBeenCalledWith({ discussionNotePreference: 'off' })
    expect(document.querySelector('.choice-button[aria-pressed="true"]')?.textContent).toContain('Off')
  })
})
