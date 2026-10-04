import assert from 'node:assert/strict';
import test from 'node:test';
import { renderMarkdown } from '../frontend/src/markdown.js';

test('renderMarkdown - basic typography (bold, italic, del, headings)', () => {
  const md = '**粗体** *斜体* ~~删除线~~';
  const html = renderMarkdown(md);
  assert.match(html, /<strong>粗体<\/strong>/);
  assert.match(html, /<em>斜体<\/em>/);
  assert.match(html, /<del>删除线<\/del>/);

  const headingMd = '# 标题一\n## 标题二';
  const headingHtml = renderMarkdown(headingMd);
  assert.match(headingHtml, /<h3 class="md-heading">标题一<\/h3>/);
  assert.match(headingHtml, /<h4 class="md-heading">标题二<\/h4>/);
});

test('renderMarkdown - code blocks and inline code', () => {
  const md = '这是 `const a = 1;` 行内代码。\n```js\nfunction test() {\n  return true;\n}\n```';
  const html = renderMarkdown(md);
  assert.match(html, /<code class="md-inline-code">const a = 1;<\/code>/);
  assert.match(html, /<pre class="md-code-block">/);
  assert.match(html, /<span class="md-code-lang">js<\/span>/);
  assert.match(html, /function test\(\)/);
});

test('renderMarkdown - lists, blockquotes and tables', () => {
  const listMd = '- 苹果\n- 香蕉\n- 橙子';
  const listHtml = renderMarkdown(listMd);
  assert.match(listHtml, /<ul class="md-list"><li>苹果<\/li><li>香蕉<\/li><li>橙子<\/li><\/ul>/);

  const quoteMd = '> 这是引用消息';
  const quoteHtml = renderMarkdown(quoteMd);
  assert.match(quoteHtml, /<blockquote class="md-blockquote">这是引用消息<\/blockquote>/);

  const tableMd = '| 姓名 | 年龄 |\n|---|---|\n| 张三 | 18 |';
  const tableHtml = renderMarkdown(tableMd);
  assert.match(tableHtml, /<table class="md-table">/);
  assert.match(tableHtml, /<th>姓名<\/th>/);
  assert.match(tableHtml, /<td>张三<\/td>/);
});

test('renderMarkdown - markdown links and auto-links', () => {
  const linkMd = '欢迎访问 [官网](https://example.com) 或者直接访问 https://github.com';
  const linkHtml = renderMarkdown(linkMd);
  assert.match(linkHtml, /<a class="md-link" href="https:\/\/example.com" target="_blank" rel="noopener noreferrer">官网<\/a>/);
  assert.match(linkHtml, /<a class="md-link" href="https:\/\/github.com" target="_blank" rel="noopener noreferrer">https:\/\/github.com<\/a>/);
});

test('renderMarkdown - XSS protection and safe HTML whitelist', () => {
  // Dangerous elements are stripped or escaped
  const dangerousMd = '<script>alert("xss")</script><img src="x" onerror="alert(1)" /><iframe src="https://evil.com"></iframe>';
  const safeHtml = renderMarkdown(dangerousMd);
  assert.doesNotMatch(safeHtml, /<script>/i);
  assert.doesNotMatch(safeHtml, /onerror=/i);
  assert.doesNotMatch(safeHtml, /<iframe/i);

  // Safe tags are allowed
  const safeTagsMd = '<b>加粗HTML</b> <mark>高亮</mark> <u>下划线</u>';
  const renderedSafeTags = renderMarkdown(safeTagsMd);
  assert.match(renderedSafeTags, /<b>加粗HTML<\/b>/);
  assert.match(renderedSafeTags, /<mark>高亮<\/mark>/);
  assert.match(renderedSafeTags, /<u>下划线<\/u>/);
});

test('renderMarkdown - link titles are HTML-escaped to block injection', () => {
  // HTML in link title text must be escaped, not rendered
  const boldTitle = '[<b>bold</b>](https://example.com)';
  const boldHtml = renderMarkdown(boldTitle);
  assert.doesNotMatch(boldHtml, />bold<\/b></);
  assert.match(boldHtml, /&lt;b&gt;bold&lt;\/b&gt;/);
  assert.match(boldHtml, /class="md-link"/);

  // Attribute injection into the title is neutralized (quotes escaped)
  const attrTitle = '[hover="x"](https://example.com)';
  const attrHtml = renderMarkdown(attrTitle);
  assert.doesNotMatch(attrHtml, /onmouseover=/i);
  assert.match(attrHtml, /hover=&quot;x&quot;/);

  // Event handlers anywhere in the string are stripped
  const attackTitle = '[x" onclick="alert(1)](https://example.com)';
  const html = renderMarkdown(attackTitle);
  assert.doesNotMatch(html, /onclick=/i);

  // javascript: URLs never become clickable links
  const javascriptUrl = '[链接](javascript:alert(1))';
  const jsHtml = renderMarkdown(javascriptUrl);
  assert.doesNotMatch(jsHtml, /<a [^>]*href="javascript:/i);

  // Message reply links still work
  const messageLink = '[查看消息](#msg-42)';
  const msgHtml = renderMarkdown(messageLink);
  assert.match(msgHtml, /data-msg-id="42"/);
  assert.match(msgHtml, /md-reply-link/);

  // Plain autolinks still work
  const autoLink = '访问 https://example.com/path?q=1 了解更多';
  const autoHtml = renderMarkdown(autoLink);
  assert.match(autoHtml, /<a class="md-link" href="https:\/\/example\.com\/path\?q=1"/);
});
