# Allure Dashboard Action

A GitHub Action that turns raw [Allure](https://allurereport.org/) test results into a
creative, trend-aware static dashboard — published to GitHub Pages straight from your
workflow with GitHub Actions (no `gh-pages` branch).
Drop it into any workflow that produces an `allure-results/` directory (pytest, JUnit,
TestNG, Cypress, Playwright, RSpec, …) — no server, no database, no build step.

![Dashboard screenshot](docs/screenshot-light.png)

Unlike the default `allure generate` HTML report, this dashboard is built to be looked
at every day: pass-rate and duration trend lines across builds, a flaky-test tracker
with per-run history strips, suite/severity breakdowns, failure categorization, and a
searchable, filterable test explorer — light and dark mode included.

## Quick start

```yaml
- name: Run tests
  run: pytest --alluredir=allure-results

- name: Generate Allure dashboard
  uses: pranesh517/allure_dashboards@v1
  with:
    allure-results-path: allure-results

- uses: actions/upload-pages-artifact@v3
  with:
    path: allure-dashboard

- uses: actions/deploy-pages@v4
```

That's the minimum. For trend charts and flaky-test detection across builds (the
interesting part), you need to persist the `data/` directory between runs — see a
complete workflow for your stack (they use `actions/cache`; the last one keeps history
in a release asset instead — [details below](#persisting-history-across-runs)):

- [examples/pytest-workflow.yml](examples/pytest-workflow.yml) — Python / pytest / allure-pytest
- [examples/testng-workflow.yml](examples/testng-workflow.yml) — Java / TestNG / Maven / allure-testng
- [examples/cypress-workflow.yml](examples/cypress-workflow.yml) — Node.js / Cypress / cypress-allure-plugin
- [examples/basic-workflow.yml](examples/basic-workflow.yml) — generic template + minimum-pass-rate gate
- [examples/durable-history-workflow.yml](examples/durable-history-workflow.yml) — same, but keeps history in a release asset so it never expires

The action itself doesn't care which of these produced `allure-results/` — Allure's
raw-results JSON is one language-agnostic format shared by every official adapter
(`allure-java`, `allure-js`, `allure-python`, `allure-dotnet`, `allure-ruby`), so
anything that writes that format works, not just what's listed above.

Full permissions your job needs for the Pages deploy:

```yaml
permissions:
  contents: read
  pages: write
  id-token: write
```

### Deploying: GitHub Actions, not a branch

The dashboard is deployed by the workflow itself with `actions/upload-pages-artifact`
and `actions/deploy-pages`. Nothing is committed to a `gh-pages` (or any other)
branch, so there's no generated-site history in your repo, no push token to manage,
and nothing to keep in sync.

One-time repository setup: **Settings → Pages → Build and deployment → Source**,
choose **GitHub Actions** — not "Deploy from a branch". If it's left on a branch
source, the workflow's deploy step won't publish anything.

Give the deploy job the `github-pages` environment (as every example does) so the
page URL shows up on the run:

```yaml
environment:
  name: github-pages
  url: ${{ steps.deployment.outputs.page_url }}
```

That environment's default protection rules only allow deployments from the
repository's default branch, so run the deploy on pushes to that branch (as the
examples do) rather than on pull requests.

If you're moving off an existing `gh-pages` setup: switch the Pages source to
GitHub Actions as above, add the two deploy steps and the permissions from this
section, and then delete the old `gh-pages` branch and any workflow step that
pushed to it (for example `peaceiris/actions-gh-pages`).

## How it works

1. Your test framework's Allure adapter writes raw `*-result.json` files (and
   optionally `categories.json`) to `allure-results/` — this is the same input
   `allure generate` consumes, produced *before* that step, not its HTML output.
2. This action's `src/process.mjs` reads those files directly (zero npm
   dependencies — nothing to `npm install` on your runner) and aggregates them:
   status counts, suite/severity breakdowns, failure categorization, slowest
   tests (the "Slowest tests" and "All tests" tables are paginated, so every
   test in the run is reachable however large the suite is), and — by diffing each test's `historyId` against what you pass via
   `history-path` — flaky-test detection.
3. It copies the static dashboard (`site-template/`) into `output-path` alongside
   the generated `data/*.json`, ready to upload as a Pages artifact.

Nothing here requires Java or the `allure` CLI — this reads the raw JSON Allure
adapters already produce, it doesn't wrap `allure generate`.

### Persisting history across runs

Every workflow run starts on a clean runner, so the action only sees the results
of the current run. Trend graphs, flaky detection and the run picker all come
from **history you carry between runs** — the action doesn't store it for you.
The loop is:

1. **Restore** last run's `data/` directory to a folder (e.g. `dashboard-history`).
2. **Run the action** with `history-path: dashboard-history`. It merges the new
   run into that history and writes the updated site, including `data/`, to
   `output-path`.
3. **Save** the updated `allure-dashboard/data` back to wherever step 1 restores from.

`data/` is the whole state: `history.json` (per-run rollups for the trend
lines), `flaky-history.json`, `runs/<run-id>.json` (each run's full test list,
for the run picker) and `attachments/<run-id>/` (that run's screenshots and
logs). The action keeps the latest `max-history` runs (default `100`) and drops
older ones, snapshots and attachments together, so what you save stays bounded.
If your runs carry a lot of screenshots, lower `max-history` — the saved
history grows with `max-history` × the attachment size per run.

Where to keep it between runs is your call. Two ways, both with a complete
workflow to copy:

**`actions/cache` — the default; nothing to set up.**
[basic](examples/basic-workflow.yml), [pytest](examples/pytest-workflow.yml),
[TestNG](examples/testng-workflow.yml) and [Cypress](examples/cypress-workflow.yml)
all use it. Each run saves under a fresh key (`…-<branch>-<run_id>`, so the
post-job save always fires) and restores the newest key with the same branch
prefix. The trade-offs:

- Entries **expire after 7 days without use** — a quiet week or a holiday resets
  your trend graphs and flaky history to empty.
- The repo has a **10 GB cache quota**; when it fills, the oldest entries are
  evicted, which can also reset history.
- History is **per branch** (the branch name is in the key). A pull request
  branch starts empty, and it can't write history back for `main`.

That's fine for a project that runs tests every day or two. If a reset would
hurt, use the next option.

**A release asset — durable; nothing expires.**
[examples/durable-history-workflow.yml](examples/durable-history-workflow.yml)
stores `data/` as a single `history.tgz` on a release tagged
`dashboard-history`, using the `gh` CLI that's already on GitHub's runners:

```yaml
permissions:
  contents: write            # to create / update the release
# ...
- name: Restore dashboard history
  env: { GH_TOKEN: "${{ github.token }}" }
  run: |
    mkdir -p dashboard-history
    if gh release view dashboard-history >/dev/null 2>&1; then
      gh release download dashboard-history --pattern history.tgz --dir "$RUNNER_TEMP" --clobber
      tar -xzf "$RUNNER_TEMP/history.tgz" -C dashboard-history
    fi
# ... run the action with history-path: dashboard-history ...
- name: Save dashboard history
  if: github.ref == 'refs/heads/main' && github.event_name != 'pull_request'
  env: { GH_TOKEN: "${{ github.token }}" }
  run: |
    tar -czf "$RUNNER_TEMP/history.tgz" -C allure-dashboard/data .
    gh release view dashboard-history >/dev/null 2>&1 || gh release create dashboard-history \
      --title "Allure dashboard history" --notes "Machine-managed - do not delete." --latest=false
    gh release upload dashboard-history "$RUNNER_TEMP/history.tgz" --clobber
```

It isn't a branch — nothing is committed to your repo, and the page is still
deployed by GitHub Actions. It does create one extra tag (`dashboard-history`)
and a release in your Releases list, marked not-latest. Only `main` saves, so
pull request runs read the real history but never overwrite it. A release asset
can be up to 2 GiB. And if the release exists but the download fails, the job
fails rather than quietly starting from empty history, which the next save
would then make permanent.

### Flaky detection

A test is flagged flaky when its status flips between consecutive observations
for the same `historyId` (Allure's stable per-test identity, derived from its
full name + parameters) — passed→failed, broken→passed, etc., skipped excluded.
Observations are also recorded when the *same* run contains multiple result
files for one `historyId` (a retry within one run), so retries surface as
flakiness too. If you see more tests flagged than expected, check whether
`allure-results/` was cleared before the run (`pytest --clean-alluredir` or
equivalent) — leftover files from a previous local run count as extra
observations.

### Test steps and screenshots

Click any row in the "All tests" table to expand it. If your Allure adapter
recorded `steps` (nested step name/status/duration) and `attachments`
(screenshots, page sources, logs, ...) on a result — most do, e.g.
`allure-pytest`'s `@allure.step`, `allure-cypress`'s command logging, or an
explicit `allure.attachment()`/`Allure.addAttachment()` call — they show up in
that expanded row: the step tree with per-step status, image attachments as
click-to-zoom thumbnails, and everything else as a download link. Attachment
files themselves live next to the `*-result.json` files in `allure-results/`
and are referenced by filename, not inlined — this action copies each one it
finds into `data/attachments/<run-id>/` so the dashboard can serve it; nothing
shows up here if `allure-results-path` only contains the result JSON without
those attachment files alongside it.

A screenshot taken on failure is often captured in a teardown hook, not the
test body itself — `@AfterMethod` (TestNG), `afterEach` (Cypress,
Playwright), RSpec's `after`, and so on. Allure records those separately from
the test's own `*-result.json`, as `befores`/`afters` on a `*-container.json`
that links back to the test by uuid — this action reads those too and shows
them in a "Setup & teardown" section on the expanded row, tagged Before/After,
so a hook-captured screenshot is visible regardless of which framework's
adapter wrote it.

### Epics, stories, tags and other metadata

Every label on a result is kept — not just `epic`/`feature`/`story`/`tag` but
also `owner`, `layer`, `package`, `host`, `framework`, and any custom label
your adapter writes (a label can repeat, e.g. several `@Tag`s on one test).
Epic, feature, story and tag values show as colored chips under each test's
name and can be searched from the box above the table. Expanding a row also
lists all of that test's metadata: labels, parameters, links (http/https only),
description, start/finish time, stage, known/muted flags, and its
full-name/test-case/history IDs.

"All tests" has two views, switched with the **List / Grouped** toggle. List is
the flat, paginated table. Grouped classifies the same tests, with the search
box and status filters still applying:

- **Behaviors (Epic › Feature › Story)** — the default when the run has those
  labels; expand an epic to drill into its features, then stories, then tests.
- **Any single label** — group by Tag, Owner, Suite, Severity, Layer, or
  whichever labels are present in the run.

Each group shows its test count, pass rate and a status bar, with failing
groups first; tests with no value for the label land under "Unassigned". A
test with several values (two tags, two stories) appears under each of them.
Groups are paginated, and a group's tests load 50 at a time. Runs recorded
before labels were captured only offer grouping by Suite and Severity.

### Browsing previous runs

The dashboard isn't just "latest run + trend lines" — every run's full detail
(not just its rollup counts) is kept as `data/runs/<run-id>.json`, up to
`max-history` runs, and the run picker in the header lets you jump back to any
of them and see that run's suites, categories, flaky tests, and full test list,
not just its pass rate.

### Requirements traceability matrix (optional)

A separate, optional companion action lives in this repo at
[`traceability/`](traceability/README.md): which requirements/epics/features
are covered by which tests, requirements with zero tests, and tests with no
requirement id ("orphan tests"), as its own static Pages site. It's referenced
as its own workflow step — `pranesh517/allure_dashboards/traceability@v2` —
so it's entirely opt-in and doesn't change anything about this action unless
you add it. Run both together and they link to each other: a test in the
matrix opens straight to that test in this dashboard (`dashboard-url` on the
traceability step), and this dashboard's header gets a "↗ Traceability" link
back (`traceability-url` on this action's step, above) — set one without the
other and you get a one-way link, which is easy to miss, so set both. See
[traceability/README.md](traceability/README.md) for inputs, how annotations
map to Allure labels/links, and
[traceability/examples/with-dashboard-workflow.yml](traceability/examples/with-dashboard-workflow.yml)
for the complete two-action workflow.

## Inputs

| Name | Required | Default | Description |
|---|---|---|---|
| `allure-results-path` | yes | — | Path to the raw `allure-results/` directory. |
| `output-path` | no | `allure-dashboard` | Where to write the generated site. |
| `history-path` | no | *(none)* | Path to a previous run's `data/` directory to merge trend/flaky history from. |
| `run-id` | no | `github.run_id` | Unique id for this run (the history key). |
| `run-label` | no | `github.run_number` | Human label shown on the dashboard. |
| `max-history` | no | `100` | Max runs kept in trend history. |
| `dashboard-title` | no | `Allure Dashboard` | Title shown on the dashboard. |
| `traceability-url` | no | *(none)* | Base URL of an [Allure Traceability Matrix](traceability/README.md) site generated from the same run. When set, shows a "↗ Traceability" link in the dashboard header. Leave empty if you're not using that action — nothing else changes. |

## Outputs

| Name | Description |
|---|---|
| `total`, `passed`, `failed`, `broken`, `skipped` | Counts for this run. |
| `pass-rate` | Pass rate percentage (0–100). |
| `flaky-count` | Number of tests flagged flaky this run. |
| `site-path` | Path to the generated site (same as `output-path`). |

Use these to gate the build (`if: steps.dashboard.outputs.pass-rate < 80`) or post
a summary — see the examples.

## Local development

```bash
node src/process.mjs \
  --results examples/sample-allure-results/run1 \
  --output /tmp/dash-out \
  --site-template site-template \
  --run-id local-1 --run-label "Local run"

npx serve /tmp/dash-out   # or: python3 -m http.server -d /tmp/dash-out
```

`.github/workflows/test-action.yml` runs the action against the bundled two-run
fixture (`examples/sample-allure-results/`) on every push and PR, asserts the
output, and republishes the result as this repo's own live GitHub Pages demo on
`main` — so the demo you see is exactly what running the action produces, not a
hand-crafted mockup.

## License

MIT — see [LICENSE](LICENSE).
