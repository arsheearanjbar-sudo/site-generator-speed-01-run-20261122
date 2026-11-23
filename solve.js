// makefun-site 1.0.0 compatible static site builder, written from scratch
// from the makefun-site README alone. Dependency-free ES module.
//
// run(input) takes { site, templates, files } and returns the output tree:
// a JSON object mapping each written path to that file's text, byte for byte.

const ESC_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const ESC_TEST_RE = /[&<>"']/;
const ESC_RE = /[&<>"']/g;
function esc(s) {
  return ESC_TEST_RE.test(s) ? s.replace(ESC_RE, (c) => ESC_MAP[c]) : s;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// A slug: NFKD, combining marks dropped, A-Z lowered, each run of
// characters other than a-z and 0-9 one "-", none at either end, cut to 64
// characters with a "-" left at the cut dropped, "untitled" when empty.
function slugify(text, cache) {
  let s = cache.get(text);
  if (s !== undefined) return s;
  let t = text.normalize("NFKD").replace(/\p{M}/gu, "");
  t = t.replace(/[A-Z]/g, (c) => c.toLowerCase());
  t = t.replace(/[^a-z0-9]+/g, "-");
  if (t.charCodeAt(0) === 45) t = t.replace(/^-+/, "");
  if (t.charCodeAt(t.length - 1) === 45) t = t.replace(/-+$/, "");
  if (t.length > 64) t = t.slice(0, 64).replace(/-+$/, "");
  if (t === "") t = "untitled";
  cache.set(text, t);
  return t;
}

function dateLong(ds) {
  if (!ds) return "";
  return `${+ds.slice(8, 10)} ${MONTHS[+ds.slice(5, 7) - 1]} ${ds.slice(0, 4)}`;
}

function hasOwn(o, k) {
  return Object.prototype.hasOwnProperty.call(o, k);
}

// ---------------------------------------------------------------------------
// Front matter
// ---------------------------------------------------------------------------

const FM_KEYS = new Set(["title", "summary", "date", "tags", "draft", "layout", "slug"]);
const FM_LINE_RE = /^([a-z_]+): ?(.*)$/;
const BLANK_RE = /^[ \t]*$/;
const TRAIL_WS_RE = /[ \t]+$/;

function parseQuoted(value) {
  // value opens on '"'. Returns the string, or null when it is not a
  // well-formed quoted string (only \" and \\ escapes, no other quote).
  let out = "";
  let i = 1;
  const n = value.length;
  while (i < n) {
    const ch = value[i];
    if (ch === '"') {
      if (i === n - 1) return out;
      return null;
    }
    if (ch === "\\") {
      const nx = value[i + 1];
      if (nx === '"' || nx === "\\") {
        out += nx;
        i += 2;
        continue;
      }
      return null;
    }
    out += ch;
    i++;
  }
  return null;
}

function validDate(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const y = +m[1];
  const mo = +m[2];
  const d = +m[3];
  if (y < 1970 || y > 2099) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

// Returns { tags } or { reason }.
function parseTags(value) {
  if (value.length < 2 || value[0] !== "[" || value[value.length - 1] !== "]") {
    return { reason: "not a list [a, b]" };
  }
  const inner = value.slice(1, -1);
  if (inner === "") return { tags: [] };
  const parts = inner.split(",");
  const tags = [];
  for (let p of parts) {
    p = p.trim();
    if (p === "" || p.includes('"') || p.includes("[") || p.includes("]")) {
      return { reason: 'an empty tag, or one holding " [ or ]' };
    }
    tags.push(p);
  }
  return { tags };
}

function parseFrontMatter(content) {
  const lines = content.split("\n");
  if (lines[0] !== "---") return { error: "no front matter" };
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") {
      end = i;
      break;
    }
  }
  if (end < 0) return { error: "the front matter is not closed" };
  const fm = {};
  for (let i = 1; i < end; i++) {
    const line = lines[i];
    if (BLANK_RE.test(line)) continue;
    if (line.charCodeAt(0) === 35) continue; // '#': a comment
    const m = FM_LINE_RE.exec(line);
    if (!m) return { error: `line ${i + 1} is not "key: value"` };
    const key = m[1];
    if (!FM_KEYS.has(key)) return { error: `unknown key "${key}"` };
    if (key in fm) return { error: `key "${key}" is given twice` };
    const value = m[2].replace(TRAIL_WS_RE, "");
    if (value === "") return { error: `key "${key}" has no value` };
    if (key === "title" || key === "summary") {
      if (value[0] === '"') {
        const s = parseQuoted(value);
        if (s === null) return { error: `key "${key}": a quoted string is not closed` };
        fm[key] = s;
      } else if (value[0] === "[") {
        return { error: `key "${key}": a bare string opens on [` };
      } else {
        fm[key] = value;
      }
    } else if (key === "date") {
      if (!validDate(value)) {
        return { error: `key "${key}": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)` };
      }
      fm[key] = value;
    } else if (key === "tags") {
      const r = parseTags(value);
      if (r.reason) return { error: `key "${key}": ${r.reason}` };
      fm[key] = r.tags;
    } else if (key === "draft") {
      if (value === "true") fm[key] = true;
      else if (value === "false") fm[key] = false;
      else return { error: `key "${key}": true or false` };
    } else if (key === "layout") {
      if (!/^[a-z0-9-]+$/.test(value)) return { error: `key "${key}": not a template name` };
      fm[key] = value;
    } else if (key === "slug") {
      if (value.length > 64 || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(value)) {
        return { error: `key "${key}": not a slug` };
      }
      fm[key] = value;
    }
  }
  if (!("title" in fm)) return { error: "no title" };
  return { fm, body: lines.slice(end + 1).join("\n") };
}

// ---------------------------------------------------------------------------
// Inline Markdown
// ---------------------------------------------------------------------------

const ESCAPABLE = new Set(["\\", "`", "*", "_", "[", "]", "(", ")", "#", "+", "-", ".", "!", ">"]);

function isEscapedAt(s, j) {
  let k = j - 1;
  let count = 0;
  while (k >= 0 && s[k] === "\\") {
    count++;
    k--;
  }
  return count % 2 === 1;
}

function findCodeClose(s, from) {
  let k = from;
  while (true) {
    k = s.indexOf("`", k);
    if (k < 0) return -1;
    if (!isEscapedAt(s, k)) return k;
    k++;
  }
}

function findStrongClose(s, from) {
  // The closer is the first "**" not escaped at or after `from`. When it
  // sits right at `from` there is no character between the markers, so
  // there is no strong here at all.
  let k = from;
  while (true) {
    k = s.indexOf("**", k);
    if (k < 0) return -1;
    if (isEscapedAt(s, k)) {
      k++;
      continue;
    }
    if (k === from) return -1;
    return k;
  }
}

function findEmClose(s, from) {
  // The closer is the next "*" not escaped, with at least one character
  // between, that is the last star of a run of unescaped stars whose
  // length is odd: stars pair up into strong markers, and only a lone
  // star left over at the end of an odd run can close emphasis.
  let k = from;
  while (true) {
    k = s.indexOf("*", k);
    if (k < 0) return -1;
    if (k >= from + 1 && !isEscapedAt(s, k) && s[k + 1] !== "*") {
      let run = 1;
      let j = k - 1;
      while (j >= 0 && s[j] === "*" && !isEscapedAt(s, j)) {
        run++;
        j--;
      }
      if (run % 2 === 1) return k;
    }
    k++;
  }
}

function normalizePath(dir, rel) {
  const parts = dir === "" ? [] : dir.split("/");
  const segs = rel.split("/");
  for (const seg of segs) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (parts.length) parts.pop();
      continue;
    }
    parts.push(seg);
  }
  return parts.join("/");
}

const SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const WS_RE = /\s/;

function resolveHref(target, mctx) {
  if (SCHEME_RE.test(target)) return target;
  if (target[0] === "/" || target[0] === "#") return target;
  const hashIdx = target.indexOf("#");
  const pathPart = hashIdx < 0 ? target : target.slice(0, hashIdx);
  const frag = hashIdx < 0 ? "" : target.slice(hashIdx);
  const resolved = normalizePath(mctx.srcDir, pathPart);
  const pageUrl = mctx.pageUrlBySource.get(resolved);
  if (pageUrl !== undefined) return pageUrl + frag;
  if (mctx.staticPaths.has(resolved)) return mctx.base + "/" + resolved + frag;
  mctx.broken.add(`broken-link ${mctx.sourcePath} -> ${target}`);
  return target;
}

function renderInline(text, mctx) {
  const n = text.length;
  const out = [];
  let i = 0;
  let plainStart = 0;
  while (i < n) {
    const c = text[i];
    if (c === "\\" && i + 1 < n && ESCAPABLE.has(text[i + 1])) {
      if (i > plainStart) out.push(esc(text.slice(plainStart, i)));
      out.push(esc(text[i + 1]));
      i += 2;
      plainStart = i;
      continue;
    }
    if (c === "`") {
      const k = findCodeClose(text, i + 1);
      if (k > i + 1) {
        if (i > plainStart) out.push(esc(text.slice(plainStart, i)));
        out.push("<code>" + esc(text.slice(i + 1, k)) + "</code>");
        i = k + 1;
        plainStart = i;
        continue;
      }
      i++;
      continue;
    }
    if (c === "*" && text[i + 1] === "*") {
      const k = findStrongClose(text, i + 2);
      if (k >= i + 3) {
        if (i > plainStart) out.push(esc(text.slice(plainStart, i)));
        out.push("<strong>" + renderInline(text.slice(i + 2, k), mctx) + "</strong>");
        i = k + 2;
        plainStart = i;
        continue;
      }
      i += 2;
      continue;
    }
    if (c === "*") {
      const k = findEmClose(text, i + 1);
      if (k >= i + 2) {
        if (i > plainStart) out.push(esc(text.slice(plainStart, i)));
        out.push("<em>" + renderInline(text.slice(i + 1, k), mctx) + "</em>");
        i = k + 1;
        plainStart = i;
        continue;
      }
      i++;
      continue;
    }
    if (c === "[") {
      const link = tryLink(text, i, mctx);
      if (link) {
        if (i > plainStart) out.push(esc(text.slice(plainStart, i)));
        out.push(link.html);
        i = link.end;
        plainStart = i;
        continue;
      }
      i++;
      continue;
    }
    i++;
  }
  if (n > plainStart) out.push(esc(text.slice(plainStart, n)));
  return out.join("");
}

function tryLink(s, i, mctx) {
  let j = i + 1;
  while (true) {
    j = s.indexOf("]", j);
    if (j < 0) return null;
    if (!isEscapedAt(s, j)) break;
    j++;
  }
  if (s[j + 1] !== "(") return null;
  const k = s.indexOf(")", j + 2);
  if (k < 0) return null;
  const target = s.slice(j + 2, k);
  if (target === "" || WS_RE.test(target)) return null;
  const textHtml = renderInline(s.slice(i + 1, j), mctx);
  const href = resolveHref(target, mctx);
  return { html: `<a href="${esc(href)}">${textHtml}</a>`, end: k + 1 };
}

// ---------------------------------------------------------------------------
// Block Markdown
// ---------------------------------------------------------------------------

const FENCE_OPEN_RE = /^```([A-Za-z0-9_+\-]*)[ \t]*$/;
const FENCE_CLOSE_RE = /^```[ \t]*$/;
const HEADING_RE = /^(#{1,6})[ \t]+(.*)$/;
const HR_RE = /^(---|\*\*\*)[ \t]*$/;
const ORDERED_RE = /^(\d+)\. /;
const TRIM_RE = /^[ \t]+|[ \t]+$/g;

function trimWs(s) {
  return s.replace(TRIM_RE, "");
}

function matchListItem(line) {
  if (line.startsWith("- ") || line.startsWith("* ")) {
    return { kind: 0, text: line.slice(2) };
  }
  const m = ORDERED_RE.exec(line);
  if (m) return { kind: 1, num: parseInt(m[1], 10), text: line.slice(m[0].length) };
  return null;
}

function isRealHeading(line) {
  const m = HEADING_RE.exec(line);
  return m !== null && m[2].replace(TRAIL_WS_RE, "") !== "";
}

function renderMarkdown(body, mctx) {
  const lines = body.split("\n");
  const n = lines.length;
  const out = [];
  const toc = [];
  let excerpt = "";
  let excerptSet = false;
  let i = 0;
  while (i < n) {
    const line = lines[i];
    if (BLANK_RE.test(line)) {
      i++;
      continue;
    }
    const fence = FENCE_OPEN_RE.exec(line);
    if (fence) {
      const lang = fence[1];
      out.push(lang ? `<pre><code class="language-${lang}">` : "<pre><code>");
      i++;
      while (i < n && !FENCE_CLOSE_RE.test(lines[i])) {
        out.push(esc(lines[i]));
        out.push("\n");
        i++;
      }
      if (i < n) i++;
      out.push("</code></pre>\n");
      continue;
    }
    const hm = HEADING_RE.exec(line);
    if (hm) {
      const text = hm[2].replace(TRAIL_WS_RE, "");
      if (text !== "") {
        const level = hm[1].length;
        const id = uniqueSlug(slugify(text, mctx.slugCache), mctx.headingIds);
        const inner = renderInline(text, mctx);
        out.push(`<h${level} id="${id}">${inner}</h${level}>\n`);
        if (level === 2 || level === 3) toc.push({ level, id, html: inner });
        i++;
        continue;
      }
    }
    if (HR_RE.test(line)) {
      out.push("<hr>\n");
      i++;
      continue;
    }
    if (line.charCodeAt(0) === 62) {
      // '>' blockquote
      const buf = [];
      while (i < n && lines[i].charCodeAt(0) === 62) {
        let t = lines[i].slice(1);
        if (t.charCodeAt(0) === 32) t = t.slice(1);
        t = trimWs(t);
        if (t !== "") buf.push(t);
        i++;
      }
      if (buf.length) {
        out.push("<blockquote>\n<p>" + renderInline(buf.join("\n"), mctx) + "</p>\n</blockquote>\n");
      } else {
        out.push("<blockquote>\n</blockquote>\n");
      }
      continue;
    }
    const li = matchListItem(line);
    if (li) {
      const kind = li.kind;
      const firstNum = li.num;
      const items = [li.text];
      i++;
      while (i < n) {
        const l = lines[i];
        const it = matchListItem(l);
        if (it && it.kind === kind) {
          items.push(it.text);
          i++;
          continue;
        }
        if (/^ {2,}\S/.test(l)) {
          items[items.length - 1] += "\n" + trimWs(l);
          i++;
          continue;
        }
        break;
      }
      if (kind === 0) {
        out.push("<ul>\n");
        for (const it of items) out.push("<li>" + renderInline(it, mctx) + "</li>\n");
        out.push("</ul>\n");
      } else {
        out.push(firstNum === 1 ? "<ol>\n" : `<ol start="${firstNum}">\n`);
        for (const it of items) out.push("<li>" + renderInline(it, mctx) + "</li>\n");
        out.push("</ol>\n");
      }
      continue;
    }
    // Paragraph: lines up to a blank line, a fence, a heading or a break.
    // A heading needs text after its markers: a bare "## " is not one,
    // so it does not end the paragraph either.
    const buf = [trimWs(line)];
    i++;
    while (i < n) {
      const l = lines[i];
      if (BLANK_RE.test(l) || FENCE_OPEN_RE.test(l) || isRealHeading(l) || HR_RE.test(l)) break;
      buf.push(trimWs(l));
      i++;
    }
    const inner = renderInline(buf.join("\n"), mctx);
    if (!excerptSet) {
      excerpt = inner;
      excerptSet = true;
    }
    out.push("<p>" + inner + "</p>\n");
  }
  return { html: out.join(""), toc, excerpt };
}

function uniqueSlug(base, taken) {
  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }
  let k = 2;
  while (taken.has(base + "-" + k)) k++;
  const s = base + "-" + k;
  taken.add(s);
  return s;
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

const PATH_RE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;

function parsePath(s) {
  const t = s.replace(/^[ \t]+|[ \t]+$/g, "");
  if (!PATH_RE.test(t)) return null;
  return t.split(".");
}

function parseTag(inner) {
  if (inner === "else") return { t: "else" };
  if (inner === "endif") return { t: "endif" };
  if (inner === "endfor") return { t: "endfor" };
  let m = /^for[ \t]+([A-Za-z_][A-Za-z0-9_]*)[ \t]+in[ \t]+(.+)$/.exec(inner);
  if (m) {
    const path = parsePath(m[2]);
    if (!path) return { error: "a path is not one" };
    return { t: "for", v: m[1], path };
  }
  m = /^if[ \t]+(?:(not)[ \t]+)?(.+)$/.exec(inner);
  if (m) {
    const path = parsePath(m[2]);
    if (!path) return { error: "a path is not one" };
    return { t: "if", path, neg: !!m[1] };
  }
  m = /^include[ \t]+"([^"]*)"$/.exec(inner);
  if (m) return { t: "include", name: m[1] };
  return { error: "a tag is none of for, if, else, endif, endfor, include" };
}

function parseTemplate(src) {
  const tokens = [];
  let textBuf = "";
  let lineClean = true;
  let i = 0;
  const n = src.length;
  const flushText = () => {
    if (textBuf) {
      tokens.push({ t: "text", s: textBuf });
      textBuf = "";
    }
  };
  while (i < n) {
    const j1 = src.indexOf("{{{", i);
    const j2 = src.indexOf("{{", i);
    const j3 = src.indexOf("{%", i);
    let j = -1;
    let kind = "";
    if (j1 >= 0 && (j2 < 0 || j1 <= j2) && (j3 < 0 || j1 < j3)) {
      j = j1;
      kind = "raw";
    } else if (j2 >= 0 && (j3 < 0 || j2 < j3)) {
      j = j2;
      kind = "var";
    } else if (j3 >= 0) {
      j = j3;
      kind = "tag";
    } else {
      break;
    }
    if (j > i) {
      const chunk = src.slice(i, j);
      textBuf += chunk;
      const li = chunk.lastIndexOf("\n");
      if (li >= 0) {
        lineClean = /^[ \t]*$/.test(chunk.slice(li + 1));
      } else {
        lineClean = lineClean && /^[ \t]*$/.test(chunk);
      }
    }
    if (kind === "raw") {
      const close = src.indexOf("}}}", j + 3);
      if (close < 0) return { error: "a {{{ is not closed" };
      const path = parsePath(src.slice(j + 3, close));
      if (!path) return { error: "a path is not one" };
      flushText();
      tokens.push({ t: "var", path, raw: true });
      lineClean = false;
      i = close + 3;
    } else if (kind === "var") {
      const close = src.indexOf("}}", j + 2);
      if (close < 0) return { error: "a {{ is not closed" };
      const path = parsePath(src.slice(j + 2, close));
      if (!path) return { error: "a path is not one" };
      flushText();
      tokens.push({ t: "var", path, raw: false });
      lineClean = false;
      i = close + 2;
    } else {
      const close = src.indexOf("%}", j + 2);
      if (close < 0) return { error: "a {% is not closed" };
      const inner = src.slice(j + 2, close).replace(/^[ \t]+|[ \t]+$/g, "");
      const node = parseTag(inner);
      if (node.error) return node;
      let k = close + 2;
      while (src[k] === " " || src[k] === "\t") k++;
      const standalone = lineClean && (k === n || src[k] === "\n");
      if (standalone) {
        const li = textBuf.lastIndexOf("\n");
        textBuf = li < 0 ? "" : textBuf.slice(0, li + 1);
        flushText();
        tokens.push(node);
        i = k < n && src[k] === "\n" ? k + 1 : k;
      } else {
        flushText();
        tokens.push(node);
        lineClean = false;
        i = close + 2;
      }
    }
  }
  if (i < n) {
    textBuf += src.slice(i);
  }
  flushText();

  // Build the tree; a for or if that is not closed, or closed out of
  // order, fails the whole template.
  const root = [];
  const stack = [{ nodes: root, kind: null, node: null }];
  for (const tok of tokens) {
    const top = stack[stack.length - 1];
    if (tok.t === "for" || tok.t === "if") {
      const node = tok.t === "for"
        ? { t: "for", v: tok.v, path: tok.path, body: [] }
        : { t: "if", path: tok.path, neg: tok.neg, then: [], els: null };
      top.nodes.push(node);
      stack.push({ nodes: node.t === "for" ? node.body : node.then, kind: tok.t, node });
    } else if (tok.t === "else") {
      if (top.kind !== "if" || top.node.els !== null) {
        return { error: "an else without an if" };
      }
      top.node.els = [];
      top.nodes = top.node.els;
    } else if (tok.t === "endfor") {
      if (top.kind !== "for") return { error: "an endfor without a for" };
      stack.pop();
    } else if (tok.t === "endif") {
      if (top.kind !== "if") return { error: "an endif without an if" };
      stack.pop();
    } else {
      top.nodes.push(tok);
    }
  }
  if (stack.length !== 1) {
    const top = stack[stack.length - 1];
    return { error: top.kind === "for" ? "a for is not closed" : "an if is not closed" };
  }
  return { nodes: root };
}

// Names a template's output depends on, transitively through includes,
// minus names bound by its own for loops. "loop" is always free: it reads
// the innermost loop's state.
function computeFreeNames(nodes, templates, bound, seen) {
  const free = new Set();
  const add = (name) => {
    if (name === "loop" || !bound.has(name)) free.add(name);
  };
  for (const node of nodes) {
    if (node.t === "var") {
      add(node.path[0]);
    } else if (node.t === "if") {
      add(node.path[0]);
      for (const n of computeFreeNames(node.then, templates, bound, seen)) free.add(n);
      if (node.els) for (const n of computeFreeNames(node.els, templates, bound, seen)) free.add(n);
    } else if (node.t === "for") {
      add(node.path[0]);
      const b2 = new Set(bound);
      b2.add(node.v);
      for (const n of computeFreeNames(node.body, templates, b2, seen)) free.add(n);
    } else if (node.t === "include") {
      if (seen.has(node.name)) continue;
      const sub = templates.get(node.name);
      if (!sub) continue;
      seen.add(node.name);
      for (const n of computeFreeNames(sub.nodes, templates, bound, seen)) {
        if (n === "loop" || !bound.has(n)) free.add(n);
      }
      seen.delete(node.name);
    }
  }
  return free;
}

function writeValue(v) {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (Array.isArray(v)) {
    let s = "";
    for (let k = 0; k < v.length; k++) {
      if (k) s += ", ";
      s += writeValue(v[k]);
    }
    return s;
  }
  return "";
}

function truthy(v) {
  if (v === undefined || v === null || v === false || v === "" || v === 0) return false;
  if (Array.isArray(v) && v.length === 0) return false;
  return true;
}

function resolveFirst(scope, name) {
  const frames = scope.frames;
  for (let i = frames.length - 1; i >= 0; i--) {
    const f = frames[i];
    if (name === "loop") return f.loop;
    if (name === f.v) return f.e;
  }
  if (name === "loop") return undefined;
  return hasOwn(scope.root, name) ? scope.root[name] : undefined;
}

function resolvePath(scope, path) {
  let v = resolveFirst(scope, path[0]);
  for (let k = 1; k < path.length; k++) {
    if (v === null || v === undefined) return undefined;
    v = hasOwn(v, path[k]) ? v[path[k]] : undefined;
    if (v === undefined) return undefined;
  }
  return v;
}

function valueId(v, rctx) {
  if (v === undefined) return "u";
  if (v === null) return "n";
  const t = typeof v;
  if (t === "string") return "s:" + v;
  if (t === "number" || t === "boolean") return t[0] + ":" + v;
  let id = rctx.idMap.get(v);
  if (id === undefined) {
    id = rctx.nextId++;
    rctx.idMap.set(v, id);
  }
  return "o" + id;
}

function renderTemplate(name, scope, rctx, depth) {
  const tpl = rctx.templates.get(name);
  if (!tpl) return "";
  let key = name + "|" + depth;
  if (tpl.freeKeys.length) {
    let parts = "";
    for (const fname of tpl.freeKeys) {
      if (fname === "loop") {
        const frames = scope.frames;
        const lp = frames.length ? frames[frames.length - 1].loop : undefined;
        parts += ",loop=" + (lp ? lp.index + "/" + lp.length : "none");
      } else {
        parts += "," + fname + "=" + valueId(resolveFirst(scope, fname), rctx);
      }
    }
    key += parts;
  }
  const hit = rctx.memo.get(key);
  if (hit !== undefined) return hit;
  const out = [];
  renderNodes(tpl.nodes, scope, out, rctx, depth);
  const s = out.join("");
  rctx.memo.set(key, s);
  return s;
}

function renderNodes(nodes, scope, out, rctx, depth) {
  for (const node of nodes) {
    if (node.t === "text") {
      out.push(node.s);
    } else if (node.t === "var") {
      const s = writeValue(resolvePath(scope, node.path));
      out.push(node.raw ? s : esc(s));
    } else if (node.t === "for") {
      const arr = resolvePath(scope, node.path);
      if (Array.isArray(arr)) {
        for (let idx = 0; idx < arr.length; idx++) {
          scope.frames.push({
            v: node.v,
            e: arr[idx],
            loop: { index: idx + 1, first: idx === 0, last: idx === arr.length - 1, length: arr.length },
          });
          renderNodes(node.body, scope, out, rctx, depth);
          scope.frames.pop();
        }
      }
    } else if (node.t === "if") {
      const v = resolvePath(scope, node.path);
      const ok = node.neg ? !truthy(v) : truthy(v);
      renderNodes(ok ? node.then : node.els || [], scope, out, rctx, depth);
    } else if (node.t === "include") {
      if (depth + 1 <= 8) out.push(renderTemplate(node.name, scope, rctx, depth + 1));
    }
  }
}

// ---------------------------------------------------------------------------
// The build
// ---------------------------------------------------------------------------

function countWords(body) {
  let count = 0;
  let inWord = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    const ws = c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f" || c === "\v";
    if (ws) inWord = false;
    else if (!inWord) {
      inWord = true;
      count++;
    }
  }
  return count;
}

export function run(input) {
  const site = input.site;
  const base = site.base_url.replace(/\/+$/, "");
  const slugCache = new Map();
  const report = new Set();
  const broken = new Set();

  // Templates, parsed in code-unit order of name. One that does not parse
  // is reported and left out, as if it were not there.
  const templates = new Map();
  for (const name of Object.keys(input.templates).sort()) {
    const parsed = parseTemplate(input.templates[name]);
    if (parsed.error) {
      report.add(`template "${name}": ${parsed.error}`);
    } else {
      templates.set(name, parsed);
    }
  }
  for (const tpl of templates.values()) {
    tpl.free = computeFreeNames(tpl.nodes, templates, new Set(), new Set());
    tpl.freeKeys = [...tpl.free].sort();
  }

  // Sources, sorted by path in code-unit order.
  const sorted = [...input.files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const kept = [];
  for (const f of sorted) {
    if (!f.path.endsWith(".md")) continue;
    const content = f.content.replace(/\r\n?/g, "\n");
    const pm = parseFrontMatter(content);
    if (pm.error) {
      report.add(`refused ${f.path}: ${pm.error}`);
      continue;
    }
    const fm = pm.fm;
    const srcDir = f.path.split("/").slice(0, -1).join("/");
    const isPost = f.path.startsWith("posts/");
    if (f.path.startsWith("tags/")) {
      report.add(`refused ${f.path}: tags/ is the generator's own`);
      continue;
    }
    if (f.path.startsWith("page/")) {
      report.add(`refused ${f.path}: page/ is the generator's own`);
      continue;
    }
    if (isPost && !("date" in fm)) {
      report.add(`refused ${f.path}: a post needs a date`);
      continue;
    }
    const layoutName = fm.layout || (isPost ? "post" : "page");
    if (!templates.has(layoutName)) {
      report.add(`refused ${f.path}: layout "${layoutName}" is no template that parses`);
      continue;
    }
    if (fm.draft === true) {
      report.add(`draft ${f.path}`);
      continue;
    }
    kept.push({ path: f.path, srcDir, dir: isPost ? "posts" : srcDir, isPost, fm, body: pm.body, layoutName });
  }

  // Permalinks, unique in each directory in source order.
  const takenByDir = new Map();
  for (const p of kept) {
    let taken = takenByDir.get(p.dir);
    if (!taken) {
      taken = new Set();
      if (p.dir === "") {
        taken.add("posts");
        taken.add("tags");
        taken.add("page");
      }
      takenByDir.set(p.dir, taken);
    }
    const baseSlug = p.fm.slug || slugify(p.fm.title, slugCache);
    let slug = baseSlug;
    let k = 2;
    while (taken.has(slug)) {
      slug = baseSlug + "-" + k;
      k++;
    }
    taken.add(slug);
    p.slug = slug;
    p.outPath = (p.dir === "" ? "" : p.dir + "/") + slug + "/index.html";
    p.url = base + "/" + (p.dir === "" ? "" : p.dir + "/") + slug + "/";
  }

  // Markdown.
  const pageUrlBySource = new Map();
  for (const p of kept) pageUrlBySource.set(p.path, p.url);
  const staticPaths = new Set();
  for (const f of sorted) {
    if (!f.path.endsWith(".md")) staticPaths.add(f.path);
  }
  for (const p of kept) {
    const mctx = {
      srcDir: p.srcDir,
      pageUrlBySource,
      staticPaths,
      base,
      broken,
      sourcePath: p.path,
      slugCache,
      headingIds: new Set(),
    };
    const md = renderMarkdown(p.body, mctx);
    p.html = md.html;
    p.toc = md.toc;
    p.excerpt = md.excerpt;
    p.readingMinutes = Math.max(1, Math.ceil(countWords(p.body) / 200));
  }

  // Collections: posts newest date first, equal dates by slug.
  const posts = kept.filter((p) => p.isPost);
  posts.sort((a, b) => {
    if (a.fm.date !== b.fm.date) return a.fm.date < b.fm.date ? 1 : -1;
    return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
  });

  // Tags.
  for (const p of kept) {
    const seen = new Map();
    for (const name of p.fm.tags || []) {
      const s = slugify(name, slugCache);
      if (!seen.has(s)) seen.set(s, { name, slug: s, url: "" });
    }
    p.tagList = [...seen.values()];
  }
  const tagMap = new Map();
  for (const post of posts) {
    for (const t of post.tagList) {
      let tag = tagMap.get(t.slug);
      if (!tag) {
        tag = { name: t.name, slug: t.slug, url: base + "/tags/" + t.slug + "/", count: 0, posts: [] };
        tagMap.set(t.slug, tag);
      }
      tag.count++;
      tag.posts.push(post);
    }
  }
  const tags = [...tagMap.values()].sort(
    (a, b) => b.count - a.count || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0),
  );
  const tagsCtx = tags.map((t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.count }));
  for (const p of kept) {
    for (const t of p.tagList) {
      const g = tagMap.get(t.slug);
      t.url = g ? g.url : "";
      // The displayed name is the global one: the first spelling found
      // walking the posts in collection order. A page-only tag keeps its
      // own spelling.
      if (g) t.name = g.name;
    }
  }

  // Cards and page objects.
  const neighbor = (p) =>
    p ? { title: p.fm.title, url: p.url, date: p.fm.date || "", date_long: p.fm.date ? dateLong(p.fm.date) : "" } : null;
  for (let i = 0; i < posts.length; i++) {
    posts[i].newer = neighbor(i > 0 ? posts[i - 1] : null);
    posts[i].older = neighbor(i < posts.length - 1 ? posts[i + 1] : null);
  }
  const makeCard = (p) => ({
    title: p.fm.title,
    url: p.url,
    date: p.fm.date || "",
    date_long: p.fm.date ? dateLong(p.fm.date) : "",
    summary: p.fm.summary || "",
    excerpt: p.excerpt,
    reading_minutes: p.readingMinutes,
    tags: p.tagList,
  });
  for (const p of kept) p.card = makeCard(p);
  for (const p of kept) {
    p.pageObj = {
      ...p.card,
      slug: p.slug,
      content: p.html,
      toc: p.toc,
      newer: p.isPost ? p.newer : null,
      older: p.isPost ? p.older : null,
      is_post: p.isPost,
    };
  }
  const recent = posts.slice(0, site.recent).map((p) => p.card);
  const siteCtx = { title: site.title, base_url: base };

  const rctx = { templates, memo: new Map(), idMap: new WeakMap(), nextId: 1 };
  const output = {};

  const renderPage = (layoutName, ctxObj) => {
    const scope = { root: ctxObj, frames: [] };
    return renderTemplate(layoutName, scope, rctx, 0);
  };

  for (const p of kept) {
    output[p.outPath] = renderPage(p.layoutName, { site: siteCtx, tags: tagsCtx, recent, page: p.pageObj });
  }

  const perPage = Math.max(1, site.per_page);
  const totalPages = Math.max(1, Math.ceil(posts.length / perPage));
  if (templates.has("index")) {
    for (let n = 1; n <= totalPages; n++) {
      const pagePosts = posts.slice((n - 1) * perPage, n * perPage).map((p) => p.card);
      const pager = {
        number: n,
        total: totalPages,
        url: n === 1 ? base + "/" : base + "/page/" + n + "/",
        newer_url: n > 1 ? (n === 2 ? base + "/" : base + "/page/" + (n - 1) + "/") : "",
        older_url: n < totalPages ? base + "/page/" + (n + 1) + "/" : "",
      };
      const outPath = n === 1 ? "index.html" : "page/" + n + "/index.html";
      output[outPath] = renderPage("index", { site: siteCtx, tags: tagsCtx, recent, posts: pagePosts, pager });
    }
  }
  if (templates.has("tag")) {
    for (const tag of tags) {
      const tagObj = {
        name: tag.name,
        slug: tag.slug,
        url: tag.url,
        count: tag.count,
        posts: tag.posts.map((p) => p.card),
      };
      output["tags/" + tag.slug + "/index.html"] = renderPage("tag", { site: siteCtx, tags: tagsCtx, recent, tag: tagObj });
    }
  }
  if (templates.has("tags")) {
    output["tags/index.html"] = renderPage("tags", { site: siteCtx, tags: tagsCtx, recent });
  }

  // Static files, unless a built page has their path.
  let staticCount = 0;
  for (const f of sorted) {
    if (f.path.endsWith(".md")) continue;
    if (f.path in output) {
      report.add(`shadowed ${f.path}: a built page has its path`);
      continue;
    }
    output[f.path] = f.content;
    staticCount++;
  }

  // The report.
  for (const line of broken) report.add(line);
  const lines = [...report].sort();
  const nPages = kept.length - posts.length;
  lines.push(`built ${nPages} pages, ${posts.length} posts, ${tags.length} tags and ${staticCount} static files`);
  output["build-report.txt"] = lines.join("\n") + "\n";
  return output;
}
