## Summary

- 

## Verification

- [ ] Targeted tests
- [ ] Type check / build appropriate to the change
- [ ] Browser or API verification appropriate to the change

## User language audit

- Which user roles can see the changed UI?
- Which internal or domain values reach this UI?
- How are unknown enum values presented without a raw fallback?
- Can raw API or diagnostic information reach the user? If diagnostics are intentionally exposed,
  where are they restricted and hidden by default?

- [ ] I inspected JSX, toast, dialog, table, tooltip, empty/error states, exports, notifications,
  accessibility labels, and download filenames touched by this change.
- [ ] I ran `pnpm ui:state-check` for user-visible UI changes.
- [ ] I did not add or enlarge a presentation-language baseline or exception.
