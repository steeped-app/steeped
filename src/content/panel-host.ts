// Steeped — Panel Host (Content Script)
// Manages the panel iframe: toggle (hide/show, preserves state), page shift, resize.

import {
  SOURCE_JUMP_CACHE_TTL_MS,
  jumpToSourceChunk,
  normalizeUrlForSourceJump,
  type SourceJumpCache,
} from './source-jump'

;(() => {
  const PANEL_ID = 'steeped-panel'
  const HANDLE_ID = 'steeped-resize'
  const DEFAULT_WIDTH = 380
  const MIN_WIDTH = 300
  const MAX_WIDTH = 700
  const ANIM_MS = 220
  const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)'

  let visible = false
  let currentWidth = DEFAULT_WIDTH
  let sourceCache: SourceJumpCache | null = null

  function getPanel(): HTMLIFrameElement | null {
    return document.getElementById(PANEL_ID) as HTMLIFrameElement | null
  }

  function getHandle(): HTMLElement | null {
    return document.getElementById(HANDLE_ID)
  }

  // ── Toggle ────────────────────────────────────────────────

  async function toggle() {
    const iframe = getPanel()
    if (!iframe) {
      await createPanel()
      return
    }
    visible ? hide() : show()
  }

  async function open() {
    const iframe = getPanel()
    if (!iframe) {
      await createPanel()
      return
    }
    show()
  }

  // ── Create (first open) ──────────────────────────────────

  async function createPanel() {
    const stored = await chrome.storage.local.get(['stPanelWidth', 'darkMode'])
    currentWidth = stored.stPanelWidth || DEFAULT_WIDTH
    const isDark = stored.darkMode ?? true

    // Iframe
    const iframe = document.createElement('iframe')
    iframe.id = PANEL_ID
    iframe.src = chrome.runtime.getURL('panel/index.html')
    iframe.setAttribute('allow', '')

    Object.assign(iframe.style, {
      position: 'fixed',
      top: '0',
      right: '0',
      width: `${currentWidth}px`,
      height: '100vh',
      border: 'none',
      zIndex: '2147483646',
      boxShadow: '-1px 0 12px rgba(0,0,0,0.18), -4px 0 32px rgba(0,0,0,0.16)',
      background: isDark ? '#07101C' : '#EDEBE2',
      colorScheme: isDark ? 'dark' : 'light',
      transform: 'translateX(100%)',
      transition: `transform ${ANIM_MS}ms ${EASE}`,
    })

    // Resize handle
    const handle = document.createElement('div')
    handle.id = HANDLE_ID
    Object.assign(handle.style, {
      position: 'fixed',
      top: '0',
      right: `${currentWidth - 3}px`,
      width: '6px',
      height: '100vh',
      cursor: 'col-resize',
      zIndex: '2147483647',
      background: 'transparent',
      transform: 'translateX(100%)',
      transition: `transform ${ANIM_MS}ms ${EASE}, right ${ANIM_MS}ms ${EASE}`,
    })

    handle.addEventListener('mouseenter', () => {
      handle.style.background = isDark ? 'rgba(86,199,193,0.18)' : 'rgba(15,118,110,0.12)'
    })
    handle.addEventListener('mouseleave', () => {
      handle.style.background = 'transparent'
    })
    setupResize(handle, iframe)

    document.documentElement.appendChild(iframe)
    document.documentElement.appendChild(handle)

    // Slide in + page shift
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        iframe.style.transform = 'translateX(0)'
        handle.style.transform = 'translateX(0)'
        setPageShift(currentWidth)
      })
    })

    visible = true
  }

  // ── Show / Hide (preserves iframe state) ─────────────────

  function show() {
    const iframe = getPanel()
    const handle = getHandle()
    if (iframe) {
      iframe.style.transition = `transform ${ANIM_MS}ms ${EASE}`
      iframe.style.transform = 'translateX(0)'
    }
    if (handle) {
      handle.style.transition = `transform ${ANIM_MS}ms ${EASE}, right ${ANIM_MS}ms ${EASE}`
      handle.style.transform = 'translateX(0)'
    }
    setPageShift(currentWidth)
    visible = true
  }

  function hide() {
    const iframe = getPanel()
    const handle = getHandle()
    if (iframe) iframe.style.transform = 'translateX(100%)'
    if (handle) handle.style.transform = 'translateX(100%)'
    setPageShift(0)
    visible = false
  }

  // ── Page Shift ───────────────────────────────────────────

  function setPageShift(width: number) {
    const el = document.documentElement
    el.style.transition = `margin-right ${ANIM_MS}ms ${EASE}`
    el.style.marginRight = width > 0 ? `${width}px` : ''
    if (width === 0) {
      setTimeout(() => { el.style.transition = '' }, ANIM_MS)
    }
  }

  // ── Resize ───────────────────────────────────────────────

  function setupResize(handle: HTMLElement, iframe: HTMLIFrameElement) {
    handle.addEventListener('mousedown', (e: MouseEvent) => {
      e.preventDefault()

      // Overlay to capture mouse during drag
      const overlay = document.createElement('div')
      Object.assign(overlay.style, {
        position: 'fixed', top: '0', left: '0',
        width: '100vw', height: '100vh',
        zIndex: '2147483647', cursor: 'col-resize',
      })
      document.documentElement.appendChild(overlay)

      const startX = e.clientX
      const startWidth = currentWidth

      // Disable transitions during drag for instant feedback
      iframe.style.transition = 'none'
      handle.style.transition = 'none'
      document.documentElement.style.transition = 'none'

      const onMove = (e: MouseEvent) => {
        const newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth + (startX - e.clientX)))
        currentWidth = newWidth
        iframe.style.width = `${newWidth}px`
        handle.style.right = `${newWidth - 3}px`
        document.documentElement.style.marginRight = `${newWidth}px`
      }

      const onUp = () => {
        overlay.remove()
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        // Restore transitions
        iframe.style.transition = `transform ${ANIM_MS}ms ${EASE}`
        handle.style.transition = `transform ${ANIM_MS}ms ${EASE}, right ${ANIM_MS}ms ${EASE}`
        document.documentElement.style.transition = ''
        chrome.storage.local.set({ stPanelWidth: currentWidth })
      }

      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    })
  }

  // ── Messages ─────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg: { type: string; url?: string; chunks?: SourceJumpCache['chunks']; cachedAt?: number }) => {
    if (msg?.type === 'steeped:open') toggle()
    if (msg?.type === 'steeped:show') open()
    if (msg?.type === 'steeped:close') hide()
    if (msg?.type === 'steeped:source-cache') {
      if (!msg.url || !Array.isArray(msg.chunks)) return
      const cachedAt = Number.isFinite(msg.cachedAt) ? Number(msg.cachedAt) : Date.now()
      sourceCache = { url: msg.url, chunks: msg.chunks, cachedAt }
    }
  })

  window.addEventListener('message', (event: MessageEvent) => {
    const iframe = getPanel()
    if (event.data?.type === 'steeped:close-panel' && event.source === iframe?.contentWindow) hide()
    if (event.data?.type === 'steeped:source-jump' && event.source === iframe?.contentWindow) {
      handleSourceJump(event.data?.chunkId)
    }
  })

  function handleSourceJump(chunkId: unknown) {
    if (!Number.isInteger(chunkId)) return
    if (!sourceCache) return

    const currentUrl = normalizeUrlForSourceJump(window.location.href)
    const cachedUrl = normalizeUrlForSourceJump(sourceCache.url)
    if (currentUrl !== cachedUrl || Date.now() - sourceCache.cachedAt > SOURCE_JUMP_CACHE_TTL_MS) {
      sourceCache = null
      return
    }

    jumpToSourceChunk(chunkId as number, sourceCache)
  }
})()
