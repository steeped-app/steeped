# Steeped

**Big reads, small notes.**

Steeped is a small Chrome extension that turns the current page into a short note with sources.

Bring your own Anthropic API key. No account. No Steeped server.

[Website](https://steeped.page) · [Updates](https://steeped.page/#updates) · [Privacy](https://steeped.page/privacy.html) · [Terms](https://steeped.page/terms.html)

## What It Does

- Summarizes the current page in a side panel
- Keeps source snippets attached
- Answers follow-up questions about the same page
- Saves history locally
- Exports Markdown

## How It Works

1. Open a page.
2. Open Steeped from the toolbar, right-click menu, or shortcut.
3. Choose a summary mode.
4. Read the note.
5. Check the sources.

## Privacy

Steeped has no account system and no Steeped server.

Your Anthropic API key and summary history are stored in Chrome extension storage on your device. Page text is sent directly from your browser to Anthropic only when you ask Steeped to summarize or answer a follow-up.

Do not use Steeped on pages you are not comfortable sending to Anthropic's API.

## Install

Chrome Web Store listing: coming soon.

To run it locally:

```bash
npm install
npm run build
```

Then load `dist/` as an unpacked extension in Chrome at `chrome://extensions`.

## Development

```bash
npm run typecheck
npm run test
npm run build
npm run check:public
```

## License

MIT
