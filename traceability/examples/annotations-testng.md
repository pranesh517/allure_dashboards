# Recording requirement / test-case ids — Java / TestNG (`allure-testng`)

TestNG/allure-java has no built-in `@Requirement` annotation. The
straightforward way to record a custom label like `requirement` is the
runtime `Allure` API, called at the top of the test method (repeatable for a
test covering several requirements):

```java
import io.qameta.allure.Allure;

@Test
public void userCanLogIn() {
    Allure.label("requirement", "REQ-1");
    ...
}

@Test
public void invoiceTotalsMatchTheOrder() {
    Allure.label("requirement", "REQ-1");
    Allure.label("requirement", "REQ-4");
    ...
}
```

Matches this action's config: `requirement-annotation: requirement` (the
default `requirement-source: auto` reads labels).

If your team prefers an annotation, `allure-java`'s `@Link` supports a
repeatable custom `@Links` container and can double as a requirement
reference:

```java
import io.qameta.allure.Link;
import io.qameta.allure.Links;

@Links({
    @Link(name = "REQ-1", type = "requirement"),
    @Link(name = "REQ-4", type = "requirement")
})
@Test
public void invoiceTotalsMatchTheOrder() { ... }
```

Matches: `requirement-annotation: requirement`, `requirement-source: link`
(note the link's `type` is what's matched here, not `label`).

### Test case id via `@TmsLink`

```java
import io.qameta.allure.TmsLink;

@TmsLink("TC-100")
@Test
public void userCanLogIn() { ... }
```

`@TmsLink` records a link with type `tms`. Matches:
`testcase-annotation: tms`, `testcase-source: link` (or `auto`).

### Requirement id via `@Issue`

```java
import io.qameta.allure.Issue;

@Issue("BUG-501")
@Test
public void checkoutFailsOnSafari() { ... }
```

`@Issue` records a link with type `issue`. Matches:
`requirement-annotation: issue`, `requirement-source: link`.

### Built-in labels this action already understands

`@Epic("...")`, `@Feature("...")`, `@Story("...")`, `@Severity(...)`, and
`@Tag("...")` all become labels this action's `requirement-source: tag`
(for `@Tag`) or the sibling Dashboard action's grouped view (for
epic/feature/story) already read — no extra config needed for those.
