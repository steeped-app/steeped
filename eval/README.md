# Steeped Prompt Eval

Automated regression checks for the extension output prompt.

The goal is not to prove the model is perfect. The goal is to catch prompt
changes that make Steeped less like itself:

- big reads become short notes
- sources stay attached
- bullets remain readable in the side panel
- page text cannot override the system prompt
- translations preserve names, numbers, and practical instructions

## Hard Limit

This eval uses synthetic source fixtures. The Anthropic calls are real and the
outputs are real, but the inputs are not live websites.

This does **not** validate:

- Chrome extension runtime behavior
- Mozilla Readability behavior on real pages
- fallback extraction on Reddit, GitHub issues, Hacker News, or forums
- paywalls
- SPAs
- PDFs
- source chunk quality from actual browser DOMs

Use this as a prompt regression gate. Use `design/TEST-PLAN.md` for launch QA.

## Run

```bash
npm run eval:prompts
```

Runs deterministic scoring for the legacy prompt and the current production
prompt. Requires `ANTHROPIC_API_KEY`.

```bash
npm run eval:prompts:judge
```

Adds a model-judge pass for fidelity, readability, usefulness, citation quality,
and note fit.

Optional arguments:

```bash
npm run eval:prompts:judge -- --samples=2
npm run eval:prompts:judge -- --variant=current --samples=2
npm run eval:prompts:judge -- --variant=experimental --samples=1
```

## Fixtures

Fixtures live in `eval/fixtures/prompt-regression.json`.

Current coverage:

- civic/news-style article
- technical release notes
- forum troubleshooting thread
- mixed-evidence research summary
- prompt-injection page text
- Spanish public notice in translate mode

Runtime outputs are written to `eval/results/`, which is gitignored.

## Rendered Output Report

Text scores are not enough. Render the outputs into side-panel widths and inspect
the actual note shape:

```bash
npm run qa:render-output -- --variant=current
```

This writes `eval/results/render-output-report.html`.

Useful variants:

```bash
npm run qa:render-output -- --variant=all --max=36 --out=eval/results/render-output-all.html
npm run qa:render-output -- --capture=eval/live-results/<capture>.json --out=eval/live-results/<capture>-render.html
```

For a live extension run, enable capture in the panel DevTools console:

```js
localStorage.setItem('st-qa-capture', 'true')
location.reload()
```

After a summary finishes:

```js
copy(JSON.stringify(window.__steepedQaCapture(), null, 2))
```

Check for:

- horizontal overflow at 300, 380, 520, and 700px
- raw Markdown leakage
- long URLs/code-ish tokens breaking layout
- citation chips and source expansion readability
- note voice that feels compact, human, and useful

Live captures are local, gitignored artifacts. Do not share captures from
private, paid, logged-in, copyrighted, or user-generated pages.
