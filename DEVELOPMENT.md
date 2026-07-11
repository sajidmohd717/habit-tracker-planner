# Developing Habitloom

This is a living orientation guide for people and AI assistants working on Habitloom. It describes the current product direction, architecture, and preferred workflow. Most of it is guidance rather than a permanent rulebook; update it when the product or codebase changes.

## Product direction

Habitloom helps a person compare intention with reality:

- **Habits** build consistency over time.
- **Plans** describe what the person intends to do today.
- **Tracked activities** describe what actually happened.
- The **Day** view puts planned and actual time on the same calendar without making time tracking slower.

The tracker is the highest-frequency and highest-trust part of the product. Starting the next activity ends the previous one; there is intentionally no standalone stop button. A gap should be represented honestly as rest, travel, downtime, or another activity.

Product decisions should generally favor:

1. Fast, obvious daily actions over configuration-heavy workflows.
2. Data safety and cross-device convergence over clever UI shortcuts.
3. Local-first use with optional cloud sync.
4. Useful reflection without guilt-heavy language or intrusive prompts.
5. Progressive disclosure: keep the main Day view simple and put detail lower on the page or in a focused dialog.

## Current architecture

Habitloom is a dependency-free static web app deployed through GitHub Pages.

| File | Responsibility |
| --- | --- |
| `index.html` | App structure, tabs, forms, and dialogs |
| `styles.css` | All visual and responsive styling |
| `app.js` | Local state, product behavior, rendering, and event wiring |
| `category-model.js` | Default categories and backward-compatible category migration |
| `state-merge.js` | Pure deterministic merging for tabs and devices |
| `sync.js` | Google authentication and transactional Firestore sync |
| `firebase-config.js` | Optional public Firebase web configuration |
| `tests/` | Node-based regression tests for migrations and state merging |

Scripts are loaded in dependency order near the end of `index.html`. `category-model.js` and `state-merge.js` expose browser globals and CommonJS exports so the same logic can run in the app and in Node tests.

### State shape

The persisted state is conceptually:

```js
{
  habits: [],
  tasksByDate: { "YYYY-MM-DD": [] },
  entries: [],
  categories: [],
  deleted: {
    habits: {},
    tasks: {},
    entries: {},
    categories: {}
  },
  resetAt: 0
}
```

It is stored under the historical localStorage key `one-percent-better`. Do not rename that key without an explicit migration or existing users will appear to lose their data.

Most records have an `id` and `updatedAt`. Deletions are represented by timestamped tombstones in `deleted`; removing only the visible record would allow an offline device to resurrect it later.

## Data and sync invariants

These are the areas where a seemingly small change can cause real data loss. Treat them as compatibility constraints unless a change includes a migration and new regression tests.

- At most one activity may remain running (`end === null`) after normalization or merging.
- Starting an activity closes the previous running activity at the same boundary.
- Ending an entry is monotonic during sync: a stale running copy must not reopen an entry another device already ended.
- Manual edits may change completed boundaries; the newest revision wins and adjacent entries remain continuous and non-overlapping.
- Deletion tombstones prevent stale devices from resurrecting deleted records.
- A newer account reset wins over all older state wholesale.
- Merging should be deterministic regardless of device order or merge grouping.
- Signing out must not accidentally upload an empty local state over the user's cloud account.
- Planned and tracked records remain separate data concepts even though the Day UI presents them together.

`state-merge.js` should remain pure and DOM-free. Add a regression test there before changing merge behavior.

## How state moves

```text
User action
  -> mutate in-memory state
  -> touch changed records
  -> save to localStorage
  -> dispatch "state-saved"
  -> sync.js performs a debounced Firestore transaction when signed in
  -> merge latest local and remote state
  -> adopt and re-render the converged result
```

Other tabs listen for localStorage changes and run the same merge logic. Cloud snapshots from other clients are merged rather than blindly replacing local state.

## Normal development workflow

1. Read the relevant UI, model, merge, and sync code before changing behavior.
2. Check `git status` and preserve unrelated local work.
3. Make the smallest coherent change that completes the user outcome.
4. Add or update pure regression tests when state, migration, deletion, editing, reset, or sync semantics change.
5. Run:

   ```bash
   node --check app.js
   node --check sync.js
   node --test tests/*.test.js
   git diff --check
   ```

6. Test the real interaction in a browser at desktop and narrow mobile widths. For tracker changes, specifically test switching, editing while a timer advances, and the running bar on both tabs.
7. Bump the asset query version in `index.html` when cached JavaScript or CSS changes.
8. Update `README.md` and this guide if product behavior, architecture, or workflow changed.
9. Commit a focused change, push it, then verify the deployed GitHub Pages assets and main interaction.

## Where new code should go

For the current small codebase:

- Put deterministic data transformations in a small DOM-free module with Node exports and tests.
- Keep Firebase and authentication details in `sync.js`.
- Keep backward-compatible state repair in model or migration code, not scattered through rendering functions.
- Keep device-only preferences such as calendar zoom out of synced account state.
- Reuse existing UI primitives, category colors, dialogs, and accessibility patterns before introducing another component style.

Avoid adding a framework solely to reorganize code. The app can be modularized with native ES modules first. A framework becomes worthwhile only when the product complexity, team size, or testing needs clearly justify the migration cost.

## Recommended modularization path

`app.js` is now the main scaling pressure. Split it gradually, preserving behavior after each step:

1. **State store:** loading, saving, migrations, `touch`, tombstones, and subscriptions.
2. **Date/time utilities:** local-day boundaries, formatting, overlap calculations, and timeline geometry.
3. **Feature modules:** habits, planning, tracking, and categories, each exposing explicit render and action functions.
4. **UI infrastructure:** dialogs, toasts, custom selects, tab navigation, and focus management.
5. **App coordinator:** a small entry file that initializes features and responds to adopted state.

Prefer explicit function inputs over reading the global `state` from every helper. Pure functions such as `layoutTimeline(tasks, entries, day)` are easier to test and reuse.

## Scaling strategy

### Near term

- Add a schema version and explicit migration pipeline rather than relying only on shape checks during load.
- Add tests for timeline layout, local-midnight and daylight-saving boundaries, backup import validation, and category deletion workflows.
- Add lightweight browser end-to-end tests for the main habit, plan, switch, edit, sign-out, and multi-tab flows.
- Replace remaining native `alert`, `confirm`, and `prompt` flows with accessible app dialogs where the UX benefit is meaningful.
- Add continuous integration that runs syntax checks and tests on every pull request.

### When usage grows

- Monitor serialized account size. Firestore documents have a size limit, and localStorage capacity varies by browser.
- Move away from one whole-account Firestore document before long histories approach that limit. Good options include per-day documents or collections for entries, habits, and plans.
- Introduce an explicit sync protocol or operation log only when the simpler transactional merge model becomes a measured bottleneck.
- Use the Firebase Emulator Suite for repeatable authentication and multi-client sync tests.
- Add error reporting and privacy-conscious performance telemetry before relying on user complaints to discover production failures.

Do not prematurely split storage without a migration, rollback plan, and dual-read or staged-release strategy. Sync migrations are riskier than visual refactors.

## Definition of done

A change is normally ready when:

- The intended user flow is simpler or more useful than before.
- Existing local and cloud data remain readable.
- Sync invariants and offline behavior are preserved.
- Empty, loading, error, running, and completed states have been considered.
- Keyboard and mobile interaction still work.
- Relevant automated tests pass and the browser console is clean.
- Documentation and cache versions are current.
- The deployed site has been checked after pushing.

## Handoff template

When handing work to another developer or AI assistant, include:

```text
Goal:
User problem:
Files changed or likely involved:
Data/sync behavior affected:
Decisions already made:
Tests completed:
Known edge cases or follow-ups:
Latest deployed commit:
```

For a fresh contributor, start with `README.md`, this file, `state-merge.js`, and the relevant feature section in `app.js`.
