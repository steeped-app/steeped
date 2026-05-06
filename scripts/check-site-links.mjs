#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const docsDir = path.join(root, 'docs')
const args = new Set(process.argv.slice(2))
const checkExternal = !args.has('--local-only')
const htmlFiles = fs
  .readdirSync(docsDir)
  .filter((file) => file.endsWith('.html'))
  .sort()

const refs = new Map()

function addRef(value, file) {
  if (!value || value.startsWith('data:') || value.startsWith('javascript:')) {
    return
  }

  const normalized = value.trim()

  if (!refs.has(normalized)) {
    refs.set(normalized, new Set())
  }

  refs.get(normalized).add(file)
}

for (const file of htmlFiles) {
  const html = fs.readFileSync(path.join(docsDir, file), 'utf8')
  const matches = html.matchAll(/\b(?:href|src|content)=["']([^"']+)["']/g)

  for (const match of matches) {
    const value = match[1]

    if (/^(https?:|mailto:|#|\/|\.\/|\.\.\/)/.test(value)) {
      addRef(value, file)
    }
  }
}

function htmlForPath(urlPath) {
  if (urlPath === '/' || urlPath === '') {
    return 'index.html'
  }

  return decodeURIComponent(urlPath.replace(/^\//, ''))
}

function hasAnchor(filePath, hash) {
  if (!hash) {
    return true
  }

  const id = decodeURIComponent(hash.replace(/^#/, ''))
  const html = fs.readFileSync(filePath, 'utf8')
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`\\bid=["']${escaped}["']`).test(html)
}

function checkLocal(ref) {
  const withoutQuery = ref.split('?')[0]
  const [rawPath, rawHash = ''] = withoutQuery.split('#')
  const isRootRelative = rawPath.startsWith('/')
  const localPath = isRootRelative ? htmlForPath(rawPath) : rawPath
  const resolved = path.resolve(docsDir, localPath)

  if (!resolved.startsWith(docsDir)) {
    return { ok: false, detail: 'escapes docs directory' }
  }

  if (!fs.existsSync(resolved)) {
    return { ok: false, detail: `missing ${path.relative(root, resolved)}` }
  }

  if (rawHash && resolved.endsWith('.html') && !hasAnchor(resolved, rawHash)) {
    return { ok: false, detail: `missing anchor ${rawHash}` }
  }

  return { ok: true, detail: path.relative(root, resolved) }
}

async function checkRemote(ref) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10000)

  try {
    let response = await fetch(ref, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
    })

    if (response.status === 405 || response.status === 403) {
      response = await fetch(ref, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
      })
    }

    return {
      ok: response.ok,
      detail: `${response.status} ${response.url}`,
    }
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    }
  } finally {
    clearTimeout(timer)
  }
}

let failures = 0

for (const [ref, files] of refs) {
  const from = [...files].join(', ')
  let result

  if (ref.startsWith('mailto:')) {
    result = { ok: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(ref.slice(7)), detail: ref }
  } else if (ref.startsWith('http://') || ref.startsWith('https://')) {
    if (!checkExternal) {
      result = { ok: true, detail: 'external skipped' }
    } else {
      result = await checkRemote(ref)
    }
  } else if (ref.startsWith('#')) {
    result = hasAnchor(path.join(docsDir, from.split(', ')[0]), ref)
      ? { ok: true, detail: ref }
      : { ok: false, detail: `missing anchor ${ref}` }
  } else {
    result = checkLocal(ref)
  }

  const status = result.ok ? 'OK' : 'FAIL'
  console.log(`${status} ${ref} (${from}) -> ${result.detail}`)

  if (!result.ok) {
    failures += 1
  }
}

if (failures) {
  process.exit(1)
}
