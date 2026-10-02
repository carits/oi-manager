# Problem reference browser regression

Run after installing the locked workspace dependencies and building contracts/shared:

```sh
pnpm exec playwright install chromium firefox
pnpm exec playwright test --config=e2e/problem-reference/playwright.config.ts
```

This suite renders the production ProblemReferenceSelector, Result and Link together with the
inline row editor and whole-list text edit mode, request client, runtime contracts and styles in React StrictMode. Next navigation and
authentication are replaced with explicit test context providers. Playwright supplies
local resolver responses; the harness opens no database and has no remote OJ fallback.
There is no additional route in the production application.

Chromium, Firefox and narrow Chromium exercise inline resolution, row completion, manual aliases,
Enter and IME behavior, stale responses, business failure and retry, whole-list text replacement,
row-local validation, unpublished metadata privacy, nested form safety, internal new-window links
and narrow-layout wrapping.
The six host configurations assert the distinct Stable policies of Contest, Assignment,
Training creation/design/runtime and Problem Lists. The Web source integration tests
separately verify that those six real business files import the shared selector.

These are component-level browser tests, not six complete authenticated business-page
save/publish workflows or a production deployment check. Full application E2E remains
in playwright.config.ts and the UI E2E workflow. Do not substitute this suite's pass count
for those wider integration results.
