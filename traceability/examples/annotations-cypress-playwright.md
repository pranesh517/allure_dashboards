# Recording requirement / test-case ids — Cypress & Playwright

Both ecosystems' Allure adapters share the same underlying `allure-js-commons`
API shape, called from inside the test body (there are no decorators in JS).
Exact method names have shifted a little across adapter versions — check
your installed version's docs if one of these isn't found.

## Playwright (`allure-playwright`)

```js
import { allure } from "allure-playwright";

test("user can log in", async ({ page }) => {
  allure.label("requirement", "REQ-1");
  ...
});

test("invoice totals match the order", async ({ page }) => {
  allure.label("requirement", "REQ-1");
  allure.label("requirement", "REQ-4"); // covers two requirements
  ...
});
```

Test case id via a link:

```js
allure.tms("TC-100", "https://tms.example.com/browse/TC-100");
```

`allure.tms(...)` records a link with type `tms`. Requirement id via an
issue link:

```js
allure.issue("BUG-501", "https://issues.example.com/browse/BUG-501");
```

`allure.issue(...)` records a link with type `issue`.

## Cypress (`@shelex/cypress-allure-plugin`)

```js
it("user can log in", () => {
  cy.allure().label("requirement", "REQ-1");
  ...
});

it("invoice totals match the order", () => {
  cy.allure().label("requirement", "REQ-1");
  cy.allure().label("requirement", "REQ-4");
  ...
});
```

Test case id / requirement-via-issue, same idea as Playwright:

```js
cy.allure().tms("TC-100", "https://tms.example.com/browse/TC-100");
cy.allure().issue("BUG-501", "https://issues.example.com/browse/BUG-501");
```

## Config either way

- Custom `requirement` label: `requirement-annotation: requirement`
  (`requirement-source: auto`, the default, reads labels).
- Test case via `.tms(...)`: `testcase-annotation: tms`,
  `testcase-source: link` (or `auto`).
- Requirement via `.issue(...)`: `requirement-annotation: issue`,
  `requirement-source: link`.

### Built-in labels this action already understands

`allure.epic("...")`, `.feature("...")`, `.story("...")`, `.severity(...)`,
and `.tag("...")` all become labels this action's `requirement-source: tag`
(for `.tag`) or the sibling Dashboard action's grouped view (for
epic/feature/story) already read — no extra config needed for those.
