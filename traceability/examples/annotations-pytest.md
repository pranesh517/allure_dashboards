# Recording requirement / test-case ids — pytest (`allure-pytest`)

A custom label like `requirement` has no dedicated decorator, so set it with
the generic one. It's repeatable, so stack it for a test covering several
requirements:

```python
import allure

@allure.label("requirement", "REQ-1")
def test_user_can_log_in():
    ...

@allure.label("requirement", "REQ-1")
@allure.label("requirement", "REQ-4")
def test_invoice_totals_match_the_order():
    ...
```

Matches this action's config: `requirement-annotation: requirement` (the
default `requirement-source: auto` reads labels).

When the id isn't known until the test runs (e.g. parametrized), use the
dynamic form inside the test body instead of a decorator:

```python
def test_something(requirement_id):
    allure.dynamic.label("requirement", requirement_id)
    ...
```

### Test case id via a link instead of a label

`@allure.testcase(url, name)` records a link with type `test_case` (not
`tms` — that's the Java adapter's link type for the same idea):

```python
@allure.testcase("https://tms.example.com/browse/TC-100", "TC-100")
def test_user_can_log_in():
    ...
```

Matches: `testcase-annotation: test_case`, `testcase-source: link` (or leave
`testcase-source: auto`, which checks labels and links).

### Requirement id via an issue link instead of a custom label

If you'd rather track requirements as linked issues:

```python
@allure.issue("https://issues.example.com/browse/BUG-501", "BUG-501")
def test_checkout_fails_on_safari():
    ...
```

Matches: `requirement-annotation: issue`, `requirement-source: link`.

### Built-in labels this action already understands

`@allure.epic("...")`, `@allure.feature("...")`, `@allure.story("...")`,
`@allure.severity(...)`, and `@allure.tag(...)` all become labels this
action's `requirement-source: tag` (for `tag`) or the sibling Dashboard
action's grouped view (for epic/feature/story) already read — no extra
config needed for those.
