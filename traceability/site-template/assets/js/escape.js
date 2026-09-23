// Pure, DOM-free — importable by the browser (as a module) and by node:test
// alike. All label/title/annotation values in this report come from test
// data, which is untrusted input, so every one of them goes through
// escapeHtml before landing in a template string.

export function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Only ever render http(s) links — a `javascript:` or `data:` URL in test
// data (a link's `url`, or a dashboard-url built from it) must not become a
// clickable href.
export function safeHref(url, base) {
  try {
    const u = new URL(url, base || 'http://localhost/');
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}
