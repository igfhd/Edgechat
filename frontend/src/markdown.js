/**
 * Lightweight, secure Markdown and Safe HTML parser for Edgechat.
 */

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeUrl(url) {
  const trimmed = String(url || '').trim();
  if (/^#msg-\d+/i.test(trimmed)) {
    return escapeHtml(trimmed);
  }
  if (/^(https?:\/\/|mailto:|tel:|\/)/i.test(trimmed)) {
    return escapeHtml(trimmed);
  }
  return '#';
}

function sanitizeSafeHtml(html) {
  // First strip active script/iframe/object/embed/style content completely
  let clean = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '')
    .replace(/<embed\b[^>]*>/gi, '');

  // Strip all on* attributes
  clean = clean.replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');

  // Allow only safe HTML tags and remove all dangerous attributes (like onerror, onload, onclick, javascript: urls)
  const allowedTags = /^(b|strong|i|em|u|del|s|code|mark|small|sub|sup|kbd|br|p|span|details|summary|hr|table|thead|tbody|tr|th|td|ul|ol|li|blockquote|h[1-6])$/i;

  return clean.replace(/<\/?([a-z0-9]+)([^>]*)>/gi, (match, tag, attrs) => {
    const lowerTag = tag.toLowerCase();
    if (!allowedTags.test(lowerTag)) {
      return '';
    }
    if (match.startsWith('</')) {
      return `</${lowerTag}>`;
    }

    // Clean attributes: allow class, title, data-*, style (safe subset)
    const cleanAttrs = [];
    const attrRegex = /([a-z0-9_-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/gi;
    for (const attrMatch of attrs.matchAll(attrRegex)) {
      const attrName = attrMatch[1].toLowerCase();
      const attrValue = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] ?? '';

      // Block any event handlers or javascript execution
      if (attrName.startsWith('on') || /javascript:/i.test(attrValue) || /data:/i.test(attrValue)) {
        continue;
      }

      if (['class', 'title', 'data-code', 'open', 'align'].includes(attrName) || attrName.startsWith('data-')) {
        cleanAttrs.push(`${attrName}="${escapeHtml(attrValue)}"`);
      } else if (attrName === 'style') {
        // Only allow safe styling like color, font-weight, text-align
        const safeStyle = attrValue
          .split(';')
          .filter((rule) => /^(color|font-weight|font-style|text-align|background-color|padding|margin|border-radius)\s*:/i.test(rule.trim()))
          .join(';');
        if (safeStyle) {
          cleanAttrs.push(`style="${escapeHtml(safeStyle)}"`);
        }
      }
    }

    const attrString = cleanAttrs.length ? ` ${cleanAttrs.join(' ')}` : '';
    return `<${lowerTag}${attrString}>`;
  });
}

export function renderMarkdown(rawText) {
  if (!rawText) {
    return '';
  }

  let text = String(rawText);

  // 1. Extract and protect code blocks
  const codeBlocks = [];
  text = text.replace(/```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g, (_match, lang, code) => {
    const placeholder = `\x00CODEBLOCK_${codeBlocks.length}\x00`;
    const cleanLang = lang.trim() || 'code';
    const rawCode = code.replace(/\n$/, '');
    const encodedForCopy = encodeURIComponent(rawCode);
    const html = `<pre class="md-code-block"><div class="md-code-header"><span class="md-code-lang">${escapeHtml(cleanLang)}</span><button type="button" class="md-copy-btn" data-code="${encodedForCopy}">复制</button></div><code>${escapeHtml(rawCode)}</code></pre>`;
    codeBlocks.push(html);
    return placeholder;
  });

  // 2. Extract and protect inline code
  const inlineCodes = [];
  text = text.replace(/`([^`\n]+)`/g, (_match, code) => {
    const placeholder = `\x00INLINECODE_${inlineCodes.length}\x00`;
    inlineCodes.push(`<code class="md-inline-code">${escapeHtml(code)}</code>`);
    return placeholder;
  });

  // 3. Escape general HTML entities except allowed safe tags
  text = sanitizeSafeHtml(text);

  // 4. Tables
  text = text.replace(
    /(?:^|\n)(\|.+?\|\n\|[-:\s|]+?\|\n(?:\|.+?\|\n?)+)/g,
    (match, tableText) => {
      const rows = tableText.trim().split('\n').map((row) =>
        row.replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
      );
      if (rows.length < 2) return match;

      const headerRow = rows[0];
      // Row 1 is divider
      const dataRows = rows.slice(2);

      let tableHtml = '<div class="md-table-wrap"><table class="md-table"><thead><tr>';
      for (const h of headerRow) {
        tableHtml += `<th>${h}</th>`;
      }
      tableHtml += '</tr></thead><tbody>';
      for (const dRow of dataRows) {
        tableHtml += '<tr>';
        for (const cell of dRow) {
          tableHtml += `<td>${cell}</td>`;
        }
        tableHtml += '</tr>';
      }
      tableHtml += '</tbody></table></div>';
      return `\n${tableHtml}\n`;
    }
  );

  // 5. Headings
  text = text.replace(/^#### (.*?)$/gm, '<h6 class="md-heading">$1</h6>');
  text = text.replace(/^### (.*?)$/gm, '<h5 class="md-heading">$1</h5>');
  text = text.replace(/^## (.*?)$/gm, '<h4 class="md-heading">$1</h4>');
  text = text.replace(/^# (.*?)$/gm, '<h3 class="md-heading">$1</h3>');

  // 6. Horizontal Rules
  text = text.replace(/^(?:---|\*\*\*|___)$/gm, '<hr class="md-hr" />');

  // 7. Blockquotes: match consecutive lines starting with >
  text = text.replace(/(?:^|\n)((?:>[ \t]?.*(?:\n|$))+)/g, (match) => {
    const isReply = match.includes('#msg-') || match.includes('md-reply-link') || match.includes('↩');
    const quoteLines = match
      .trim()
      .split('\n')
      .map((l) => l.replace(/^>[ \t]?/, ''))
      .join('<br>');
    const extraClass = isReply ? ' md-blockquote--reply' : '';
    return `<blockquote class="md-blockquote${extraClass}">${quoteLines}</blockquote>`;
  });

  // 8. Task lists / Checkboxes
  text = text.replace(/^[-*+] \[ \] (.*?)$/gm, '<div class="md-task-item"><span class="md-checkbox"></span><span>$1</span></div>');
  text = text.replace(/^[-*+] \[[xX]\] (.*?)$/gm, '<div class="md-task-item"><span class="md-checkbox md-checkbox--checked">✓</span><span class="md-task-done">$1</span></div>');

  // 9. Unordered Lists
  text = text.replace(/(?:^|\n)(?:[-*+] (?:.+)(?:\n|$))+/g, (match) => {
    const items = match.trim().split('\n').filter((l) => /^[-*+] /.test(l)).map((l) => `<li>${l.replace(/^[-*+] /, '')}</li>`).join('');
    return `\n<ul class="md-list">${items}</ul>\n`;
  });

  // 10. Ordered Lists
  text = text.replace(/(?:^|\n)(?:\d+\. (?:.+)(?:\n|$))+/g, (match) => {
    const items = match.trim().split('\n').filter((l) => /^\d+\. /.test(l)).map((l) => `<li>${l.replace(/^\d+\. /, '')}</li>`).join('');
    return `\n<ol class="md-list md-list--ordered">${items}</ol>\n`;
  });

  // 11. Bold, Italic, Strikethrough
  text = text.replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>');
  text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/__(.*?)__/g, '<strong>$1</strong>');
  text = text.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  text = text.replace(/_([^_\n]+)_/g, '<em>$1</em>');
  text = text.replace(/~~(.*?)~~/g, '<del>$1</del>');

  // 12. Markdown Links: [title](url)
  text = text.replace(/\[([^\]]+)\]\((#[^\s)]+|https?:\/\/[^\s)]+)\)/g, (_match, title, url) => {
    const cleanUrl = sanitizeUrl(url);
    const safeText = escapeHtml(title);
    if (cleanUrl.startsWith('#msg-')) {
      const msgId = cleanUrl.replace('#msg-', '');
      return `<a class="md-link md-reply-link" href="${cleanUrl}" data-msg-id="${msgId}" title="点击跳转到该消息">${safeText}</a>`;
    }
    return `<a class="md-link" href="${cleanUrl}" target="_blank" rel="noopener noreferrer">${safeText}</a>`;
  });

  // 13. Auto-link raw URLs (not already inside an <a> tag or code)
  text = text.replace(/(^|[^"'>=])\b(https?:\/\/[^\s<]+)/gi, (_match, prefix, url) => {
    return `${prefix}<a class="md-link" href="${sanitizeUrl(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`;
  });

  // 14. Mentions: @username, @所有人, @all
  text = text.replace(/(^|[\s(（[【])@([a-zA-Z0-9_\-\u4e00-\u9fa5]+)/g, (_match, prefix, username) => {
    const isAll = username === '所有人' || username.toLowerCase() === 'all' || username.toLowerCase() === 'everyone';
    const pillClass = isAll ? 'mention-pill mention-pill--all' : 'mention-pill';
    return `${prefix}<span class="${pillClass}" data-username="${escapeHtml(username)}">@${escapeHtml(username)}</span>`;
  });

  // 15. Convert newlines to <br> for plain text paragraphs (outside blocks)
  text = text.replace(/\n\n+/g, '<br><br>');
  text = text.replace(/\n/g, '<br>');

  // Clean up unwanted leading/trailing/adjacent <br> around blockquotes and block elements
  text = text.replace(/^(?:<br>\s*)+/gi, '');
  text = text.replace(/(?:<br>\s*)+$/gi, '');
  text = text.replace(/(?:<br>\s*)+(<blockquote[^>]*>)/gi, '$1');
  text = text.replace(/(<\/blockquote>)(?:\s*<br>)+/gi, '$1');

  // 15. Restore protected inline code
  inlineCodes.forEach((html, i) => {
    text = text.replace(`\x00INLINECODE_${i}\x00`, html);
  });

  // 16. Restore protected code blocks
  codeBlocks.forEach((html, i) => {
    text = text.replace(`\x00CODEBLOCK_${i}\x00`, html);
  });

  return text.trim();
}
