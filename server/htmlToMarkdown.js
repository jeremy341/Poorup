// Converts the small, trusted HTML fragments this server renders (the About
// page and the rules book) into Markdown for /about.md, /rules.md and
// /llms-full.txt. It is not a general HTML parser: it knows the tags those
// fragments use, turns structure into Markdown, and drops every other tag, so
// the output carries text and never markup.

const ENTITIES = Object.freeze({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " });
const BLOCK_TAG = /<\/?(?:p|div|section|article|aside|header|footer|main|details|ul|ol|table|tr|blockquote|figure|dl|dt|dd)\b[^>]*>/gi;
const DROPPED_ELEMENT = /<(script|style|noscript|svg|nav|template)\b[\s\S]*?<\/\1>/gi;
const HIDDEN_ELEMENT = /<([a-z][a-z0-9]*)\b[^>]*\baria-hidden="true"[^>]*>[\s\S]*?<\/\1>/gi;

export function decodeEntities(value) {
  return String(value ?? "").replace(/&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (match, body) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    const named = ENTITIES[body.toLowerCase()];
    return named ?? match;
  });
}

// Inline markup: links, bold, and every remaining tag removed. Keeps line breaks
// so block callers can decide where paragraphs end.
function phrasing(html) {
  return decodeEntities(
    html
      .replace(/<a\b[^>]*?\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_match, href, inner) => {
        const text = phrasing(inner).replace(/\s+/g, " ").trim();
        if (!text) return "";
        // Padded so neighbouring links and spans do not run together.
        if (!href || href.startsWith("#")) return ` ${text} `;
        return ` [${text}](${href}) `;
      })
      .replace(/<(strong|b)\b[^>]*>/gi, "**")
      .replace(/<\/(strong|b)>/gi, "**")
      .replace(/\*\*\s*\*\*/g, "")
      .replace(/<\/?(?:span|small|i|em|label|abbr|code)\b[^>]*>/gi, " ")
      .replace(/<[^>]+>/g, "")
  );
}

// One block of inline text on a single line (list items, headings, summaries).
function inline(html) {
  return phrasing(html.replace(/<br\s*\/?>/gi, " ").replace(BLOCK_TAG, " ")).replace(/\s+/g, " ").trim();
}

function tidy(markdown) {
  const text = markdown
    .split("\n")
    .map(line => line.replace(/[ \t]+/g, " ").replace(/ +([.,;:!?)])/g, "$1").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text ? `${text}\n` : "";
}

export function htmlToMarkdown(html, { drop = [] } = {}) {
  let source = String(html ?? "");
  for (const pattern of [DROPPED_ELEMENT, HIDDEN_ELEMENT, ...drop]) source = source.replace(pattern, "");
  source = source.replace(/<img\b[^>]*>/gi, tag => {
    const alt = /\salt="([^"]*)"/i.exec(tag)?.[1] ?? "";
    return alt ? ` ${decodeEntities(alt)} ` : "";
  });
  source = source.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_match, level, inner) => `\n\n${"#".repeat(Number(level))} ${inline(inner)}\n\n`);
  source = source.replace(/<summary\b[^>]*>([\s\S]*?)<\/summary>/gi, (_match, inner) => `\n\n### ${inline(inner)}\n\n`);
  source = source.replace(/<ol\b[^>]*>([\s\S]*?)<\/ol>/gi, (_match, inner) => {
    let number = 0;
    const items = inner.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_item, body) => {
      number += 1;
      return `\n${number}. ${inline(body)}`;
    });
    return `\n\n${items}\n\n`;
  });
  source = source.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_match, body) => `\n- ${inline(body)}`);
  source = source.replace(BLOCK_TAG, "\n\n").replace(/<br\s*\/?>/gi, "\n");
  return tidy(phrasing(source));
}
