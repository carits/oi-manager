# Problem reference browser regression

Run after installing the locked workspace dependencies and building contracts/shared:

```sh
pnpm exec playwright install chromium firefox
pnpm exec playwright test --config=e2e/problem-reference/playwright.config.ts
```

This suite renders the production ProblemReferenceSelector, Result, Link, Batch dialog,
request client, runtime contracts and styles in React StrictMode. Next navigation and
authentication are replaced with explicit test context providers. Playwright supplies
local resolver responses; the harness opens no database and has no remote OJ fallback.
There is no additional route in the production application.

Chromium, Firefox and narrow Chromium exercise live lookup, explicit addition, Enter and
IME behavior, stale responses, cancellation, disabled/unmounted/context changes, business
failure and partial receipts, current duplicate detection, batch limits, nested form
safety, internal new-window links, storage failures and wrapping/overlay geometry.
The six host configurations assert the distinct Stable policies of Contest, Assignment,
Training creation/design/runtime and Problem Lists. The Web source integration tests
separately verify that those six real business files import the shared selector.

These are component-level browser tests, not six complete authenticated business-page
save/publish workflows or a production deployment check. Full application E2E remains
in playwright.config.ts and the UI E2E workflow. Do not substitute this suite's pass count
for those wider integration results.
