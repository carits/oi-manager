# Problem list editor browser regression

Run after installing the locked workspace dependencies and building contracts/shared:

```sh
pnpm exec playwright install chromium firefox
pnpm exec playwright test --config=e2e/problem-reference/playwright.config.ts
```

This suite renders the production `ProblemListEditor` and `ProblemReferenceLink` with the
real request client, runtime contracts and production styles in React StrictMode. Navigation and
authentication are replaced with explicit test context providers. Playwright supplies local
resolver responses; the harness opens no database and has no remote OJ fallback.

The editor is intentionally list-first rather than search-first. The browser contract covers:

- clicking `+ 添加一道题目` creates a draft row immediately;
- platform + problem number changes resolve automatically in the background;
- there is no search-result field, search button, retry-search button or per-row completion button;
- alias changes do not trigger identity resolution;
- Enter supports continuous row entry;
- IME composition and stale responses cannot publish unfinished identities;
- unavailable/unpublished rows remain editable without leaking hidden metadata;
- text editing happens in the same area using `平台 | 题号 | 别名`;
- unchanged identities are reused when only aliases change;
- valid text rows remain accepted when another row has an identity error;
- narrow layouts stay within the viewport and no nested form/dialog is introduced.

The host configurations assert the distinct data-readiness policies used by Contest, Assignment,
Training and Problem Lists without exposing those implementation concepts in normal user-facing
messages. Real-page integration tests separately verify the Training setup entry point.

These are component-level browser tests, not complete authenticated save/publish workflows or a
production deployment check. Full application E2E remains in the main Playwright configuration and
the UI E2E workflow.
