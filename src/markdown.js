// Lightweight, safe Markdown → HTML renderer for chat replies.
//
// Security model:
//  - All raw text is HTML-escaped before being placed into the output.
//  - Code spans and links are extracted as placeholders pre-escape so we can
//    preserve URL characters and prevent inner content from being mangled by
//    emphasis rules. Their inner text is escaped when restored.
//  - Link URLs are whitelisted to http(s), mailto, anchor (#), and root-relative (/).
//
// Supported subset (sufficient for LLM chat output):
//   - Headings: # … ###### (shifted to <h3>+ so they fit inside a chat bubble)
//   - Paragraphs with blank-line separation
//   - Unordered lists (-, *, •) and ordered lists (1. / 1))
//   - Blockquotes (>)
//   - Fenced code blocks (```)
//   - Inline: **bold**, __bold__, *italic*, _italic_, `code`, [text](url)
//   - Horizontal rule (---, ***, ___)
//   - Hard line break on lines that end with two spaces.

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function isSafeUrl(url) {
  return /^(https?:\/\/|mailto:|#|\/)/i.test(String(url || "").trim());
}

function renderInline(raw) {
  const slots = [];
  const slot = (html) => {
    slots.push(html);
    return `\x00\x00${slots.length - 1}\x00\x00`;
  };

  // 1. Protect inline code spans first so emphasis rules can't touch them.
  let s = String(raw).replace(/`([^`\n]+)`/g, (_, code) =>
    slot(`<code class="md-code-inline">${escapeHtml(code)}</code>`),
  );

  // 2. Protect links so URL characters survive escaping.
  s = s.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (m, txt, url) => {
    if (!isSafeUrl(url)) return m;
    return slot(
      `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(txt)}</a>`,
    );
  });

  // 3. Escape the rest.
  s = escapeHtml(s);

  // 4. Hard line break (two trailing spaces — already collapsed when joined, so
  //    we map an explicit "  \n" sentinel produced upstream).
  s = s.replace(/  BR  /g, "<br>");

  // 5. Bold then italic. Order matters: bold's `**` would otherwise be eaten by italic.
  s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__([^_\n]+)__/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, "$1<em>$2</em>");
  s = s.replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, "$1<em>$2</em>");

  // 6. Restore protected slots.
  s = s.replace(/\x00\x00(\d+)\x00\x00/g, (_, n) => slots[+n]);
  return s;
}

export function renderMarkdown(src) {
  if (src == null) return "";
  const text = String(src).replace(/\r\n/g, "\n");
  const lines = text.split("\n").map((l) => {
    // Encode hard line breaks (two trailing spaces) into a sentinel that
    // survives paragraph joining and is reinstated as <br> in renderInline.
    return /[ \t]{2,}$/.test(l) ? l.replace(/[ \t]{2,}$/, "  BR  ") : l;
  });
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    if (!t) { i++; continue; }

    // Fenced code block
    if (/^```/.test(t)) {
      const langMatch = /^```\s*([\w-]+)?\s*$/.exec(t);
      const lang = langMatch ? (langMatch[1] || "") : "";
      i++;
      const buf = [];
      while (i < lines.length && !/^```\s*$/.test(lines[i].trim())) {
        buf.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // skip closing fence
      const cls = lang ? ` class="md-code md-code--${escapeHtml(lang)}"` : ' class="md-code"';
      out.push(`<pre class="md-pre"><code${cls}>${escapeHtml(buf.join("\n"))}</code></pre>`);
      continue;
    }

    // Heading (#, ##, … ######). Optional trailing #s allowed.
    const h = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(t);
    if (h) {
      // Shift levels down by 2 so a `#` heading still fits below the chat
      // bubble's H2 ("Stel een vraag"). Cap at h6.
      const level = Math.min(h[1].length + 2, 6);
      out.push(`<h${level} class="md-h md-h${level}">${renderInline(h[2])}</h${level}>`);
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(?:-\s?){3,}$|^(?:\*\s?){3,}$|^(?:_\s?){3,}$/.test(t)) {
      out.push(`<hr class="md-hr">`);
      i++;
      continue;
    }

    // Unordered list
    if (/^[-*•]\s+/.test(t)) {
      const items = [];
      while (i < lines.length && /^[-*•]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*•]\s+/, ""));
        i++;
        while (
          i < lines.length &&
          lines[i].trim() &&
          !/^[-*•]\s+/.test(lines[i].trim()) &&
          !/^\d+[.)]\s+/.test(lines[i].trim()) &&
          /^\s+/.test(lines[i])
        ) {
          items[items.length - 1] += " " + lines[i].trim();
          i++;
        }
      }
      out.push(`<ul class="md-ul">${items.map((x) => `<li>${renderInline(x)}</li>`).join("")}</ul>`);
      continue;
    }

    // Ordered list
    if (/^\d+[.)]\s+/.test(t)) {
      const items = [];
      while (i < lines.length && /^\d+[.)]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+[.)]\s+/, ""));
        i++;
        while (
          i < lines.length &&
          lines[i].trim() &&
          !/^[-*•]\s+/.test(lines[i].trim()) &&
          !/^\d+[.)]\s+/.test(lines[i].trim()) &&
          /^\s+/.test(lines[i])
        ) {
          items[items.length - 1] += " " + lines[i].trim();
          i++;
        }
      }
      out.push(`<ol class="md-ol">${items.map((x) => `<li>${renderInline(x)}</li>`).join("")}</ol>`);
      continue;
    }

    // Blockquote
    if (/^>\s?/.test(t)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        buf.push(lines[i].trim().replace(/^>\s?/, ""));
        i++;
      }
      out.push(`<blockquote class="md-quote">${renderInline(buf.join(" "))}</blockquote>`);
      continue;
    }

    // Paragraph — accumulate until blank line or a new block-level signal.
    const para = [];
    while (i < lines.length) {
      const lt = lines[i].trim();
      if (!lt) { i++; break; }
      if (/^```/.test(lt)) break;
      if (/^#{1,6}\s+/.test(lt)) break;
      if (/^[-*•]\s+/.test(lt)) break;
      if (/^\d+[.)]\s+/.test(lt)) break;
      if (/^>\s?/.test(lt)) break;
      if (/^(?:-\s?){3,}$|^(?:\*\s?){3,}$|^(?:_\s?){3,}$/.test(lt)) break;
      para.push(lines[i].trimEnd());
      i++;
    }
    if (para.length) {
      out.push(`<p class="md-p">${renderInline(para.join(" "))}</p>`);
    }
  }
  return out.join("");
}
