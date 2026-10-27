<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## TRACE product and UI guidelines

- TRACE means **Tamper-proof Record Archive for Cryptographic Evidence**.
- Do not ship generic AI-generated-looking UI. Avoid decorative gradients, glows, orbital illustrations, placeholder metrics, fake activity, generic marketing slogans, and card grids that do not serve an investigator task.
- Use a restrained, legible evidence-workbench visual language: clear hierarchy, quiet colors, compact data tables where appropriate, precise status labels, and honest empty/error states.
- Show only data backed by the application. Do not imply that storage, ledger, or security controls are healthy unless they have actually been checked.
- Every visible control must have a real destination or behavior; label API documentation as documentation, not as an upload action.
