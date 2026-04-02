# Debugging instructions (reference for the assistant)

When the user asks to debug an issue **and points to this document**, follow this workflow in order.

## 1. Check if the last change broke it

- Review **recent git changes** (`git diff`, `git log`, or the files touched in the last task) and relate them to the broken behavior.
- **Hypothesize** how that diff could cause the symptom before adding logs or wider refactors.
- Prefer a **minimal revert or targeted fix** over stacking unrelated changes.

## 2. Enable console logging to trace it

- Add **`console.log` / `console.debug`** (or grouped `console.group` where helpful) at the **narrowest** useful points: entry/exit of the suspected function, branch taken, key state (ids, flags, **no secrets or PII**).
- Log **before and after** critical calls (e.g. navigation, Firestore, state updates) so traces show ordering.
- Use a **consistent prefix** (e.g. `[debug:featureName]`) so logs are easy to filter in DevTools.
- If the project is already using another trace mechanism (e.g. session NDJSON ingest), you may use that **instead of** or **alongside** console logs—**unless** the user explicitly wants console-only tracing.

## 3. When fixed, remove console logging

- After the user **confirms** the fix (or verification is clearly done), **delete all** temporary `console.*` (and any other **debug-only** logging added for this investigation).
- Do **not** leave “just in case” logs; production code should stay clean unless the user asks for permanent observability.

## Optional reminders

- **Reproduce first**: confirm steps and environment (build, route, account role) match what the user sees.
- **One hypothesis at a time**: avoid mixing multiple speculative fixes; validate with logs, then adjust.
- **Scope**: fix only what the evidence supports; avoid drive-by refactors in the same PR unless requested.

---

*To use: e.g. “Debug X and follow `docs/debugging-instructions.md`.”*
