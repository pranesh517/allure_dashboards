import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, safeHref } from '../site-template/assets/js/escape.js';

test('escapeHtml neutralizes all five special characters', () => {
  assert.equal(escapeHtml(`<script>alert("x") & 'y'</script>`), '&lt;script&gt;alert(&quot;x&quot;) &amp; &#39;y&#39;&lt;/script&gt;');
});

test('escapeHtml coerces non-string input', () => {
  assert.equal(escapeHtml(42), '42');
  assert.equal(escapeHtml(null), 'null');
});

test('safeHref allows http and https', () => {
  assert.equal(safeHref('https://example.com/x'), 'https://example.com/x');
  assert.equal(safeHref('http://example.com/x'), 'http://example.com/x');
});

test('safeHref rejects javascript: and data: schemes', () => {
  assert.equal(safeHref('javascript:alert(1)'), null);
  assert.equal(safeHref('data:text/html,<script>alert(1)</script>'), null);
});

test('safeHref rejects a javascript: scheme even split across whitespace/newlines (WHATWG strips them)', () => {
  assert.equal(safeHref('java\tscript:alert(1)'), null);
  assert.equal(safeHref('\n javascript:alert(1)'), null);
});

test('safeHref resolves a bare relative path against the given base instead of throwing', () => {
  assert.equal(safeHref('/foo', 'https://example.com/'), 'https://example.com/foo');
});
