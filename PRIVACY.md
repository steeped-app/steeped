# Privacy Policy for Steeped

Last updated: May 5, 2026

## Summary
Steeped is built to stay small. It does not require an account, does not use a Steeped server, and keeps settings and history in your browser.

## What Steeped collects
Steeped itself does not collect personal information through a Steeped server because Steeped does not operate one.

## What data is processed
When you use Steeped, the extension may process:
- the content of the page you choose to summarize
- your summary preferences and settings
- your Anthropic API key
- locally stored summary history and exports

## Where data is stored
Steeped stores the following locally in `chrome.storage.local`:
- Anthropic API key
- settings and preferences
- local summary history
- panel UI state

## Where data is sent
When you ask for a summary or follow-up response, relevant page text and prompt data are sent directly from your browser to Anthropic's API.

Steeped does not route that data through a Steeped server.

## Website analytics
The Steeped browser extension itself does **not** use analytics, telemetry, or any form of usage tracking. Nothing about how you use the extension is collected or transmitted to us.

The public-facing website at steeped.page (where this privacy policy and the product landing page are hosted) uses **Cloudflare Web Analytics**, a privacy-preserving analytics service that does not use cookies, does not fingerprint visitors, does not collect IP addresses or personal information, and does not track visitors across sites. It only reports aggregate page view counts to help us understand overall traffic to the website.

## Email updates
If you sign up for updates on the website, we collect the email address you enter and the signup source. Newsletter data is handled by Loops, our email service provider, and is separate from the Steeped extension.

You can unsubscribe from any update email.

## Third parties
Steeped uses third-party services and libraries, including:
- Anthropic API, for language model responses
- Google Chrome / Chrome Web Store infrastructure
- GitHub Pages, for hosting the public website and this privacy policy
- Cloudflare, for DNS, email routing (`hello@steeped.page`), and the privacy-preserving website analytics described above
- Loops, for optional email updates from the website

Your use of Anthropic's API is also subject to Anthropic's terms and privacy practices.

## API keys
Your Anthropic API key is stored locally in your browser through Chrome extension storage. That key is not encrypted by a Steeped-managed key service because Steeped does not run a server.

You are responsible for keeping access to your browser profile and device secure.

## History and deletion
Steeped may save summary history locally so you can revisit prior results. You can delete local history inside the extension or by clearing extension data in Chrome.

Uninstalling the extension should remove its local extension data, subject to Chrome's platform behavior.

## Permissions
Steeped requests only the permissions needed for core functionality:
- `activeTab` to read the current page when you ask Steeped to summarize
- `storage` to save your settings and history locally
- `scripting` to inject extraction logic when needed
- `contextMenus` to add a right-click command that opens Steeped for the current page

## No account system
Steeped does not require you to create an account and does not maintain user profiles on a Steeped server.

## Security
Steeped is built to reduce unnecessary data handling, but no software can guarantee perfect security. Do not summarize content you are not comfortable sending to Anthropic's API.

## Children
Steeped is not directed to children.

## Changes
This policy may be updated as the product evolves. Material changes should be reflected by updating the date at the top of this policy.

## Contact
For support or privacy questions, email hello@steeped.page.
