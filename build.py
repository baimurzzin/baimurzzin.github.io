#!/usr/bin/env python3
"""Render content.toml into index.html (en) + ru/index.html + kk/index.html.

Structure mirrors the table of contents:
    chapters            → 1, 2, 3, 4
    chapters.sections   → 1.1, 4.2 …
    sections.items      → 4.1a, 4.1b …  (lettered only when a section has >1)

Pure stdlib, no dependencies. Run with `make site` or `python3 build.py`.
"""

from __future__ import annotations

import html
import re
import string
import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).parent
LANGS = ["en", "ru", "kk"]
DEFAULT = "en"
OUTDIR = {"en": ".", "ru": "ru", "kk": "kk"}
LANG_LABEL = {"en": "EN", "ru": "RU", "kk": "KK"}
LANG_NAME = {"en": "English", "ru": "Русский", "kk": "Қазақша"}

warnings: list[str] = []


# ── helpers ──────────────────────────────────────────────────────────────────

def t(field, lang: str) -> str:
    """Pick a translation, falling back to the default language."""
    if field is None:
        return ""
    if isinstance(field, str):
        return field
    value = field.get(lang) or field.get(DEFAULT) or ""
    return re.sub(r"\s+", " ", value).strip()


def e(text: str) -> str:
    return html.escape(text, quote=True)


def prefix_for(lang: str) -> str:
    return "" if OUTDIR[lang] == "." else "../"


def page_url(target: str, current: str) -> str:
    up = prefix_for(current)
    if OUTDIR[target] == ".":
        return up or "./"
    return f"{up}{OUTDIR[target]}/"


def asset(path: str, lang: str) -> str:
    return prefix_for(lang) + path


def resolve_href(href: str, lang: str) -> str:
    if "{lang}" not in href:
        return href
    # per-language file (the PDF) — fall back to the default language if that
    # language's file does not exist yet
    candidate = href.replace("{lang}", lang)
    if not (ROOT / candidate).exists():
        fallback = href.replace("{lang}", DEFAULT)
        if (ROOT / fallback).exists():
            if lang != DEFAULT:
                warnings.append(f"{candidate} missing → {lang} page links to {fallback}")
            candidate = fallback
        else:
            warnings.append(f"{candidate} missing and no {DEFAULT} fallback exists")
    return asset(candidate, lang)


def live(items: list[dict]) -> list[dict]:
    """Drop drafts — slots that hold a place in the structure but have no text yet."""
    return [i for i in items if not i.get("draft")]


def has_content(section: dict) -> bool:
    """A section whose every item is still a draft is skipped entirely: no
    heading, no TOC row, no number. It reappears the moment it has text."""
    if section["type"] in ("entries", "links"):
        return bool(live(section.get("items", [])))
    if section["type"] == "list":
        return bool(section.get("items") or section.get("groups"))
    if section["type"] == "kv":
        return bool(section.get("rows"))
    if section["type"] == "text":
        return bool(section.get("paragraphs"))
    return True


def sections_of(chapter: dict) -> list[dict]:
    return [s for s in chapter.get("sections", []) if has_content(s)]


# ── numbering ────────────────────────────────────────────────────────────────

def outline(data: dict) -> list[dict]:
    """Walk the content into a flat outline: number, anchor, label, depth."""
    nodes = []
    for ci, chapter in enumerate(data["chapters"], start=1):
        nodes.append({
            "num": str(ci),
            "anchor": chapter["id"],
            "field": chapter["title"],
            "depth": 1,
            "node": chapter,
        })
        for si, section in enumerate(sections_of(chapter), start=1):
            num = f"{ci}.{si}"
            nodes.append({
                "num": num,
                "anchor": section["id"],
                "field": section["title"],
                "depth": 2,
                "node": section,
            })
            items = live(section.get("items", []))
            # lettered leaves only where the outline actually branches
            if (section.get("type") == "entries" and len(items) > 1
                    and section.get("toc_items", True)):
                letter = 0
                for ii, item in enumerate(items):
                    # an entry with roles contributes one row per role: the
                    # shared heading is a grouping, not a destination
                    targets = [item] if item.get("toc") else (item.get("roles") or [item])
                    for tgt in targets:
                        nodes.append({
                            "num": num + string.ascii_lowercase[letter],
                            "anchor": tgt.get("id") or f"{section['id']}-{ii + 1}",
                            "field": tgt.get("toc") or tgt.get("title") or tgt.get("heading"),
                            "depth": 3,
                            "node": tgt,
                        })
                        letter += 1
    return nodes


def anchors_for(section: dict) -> dict[int, str]:
    """Anchor id per visible item index, matching what outline() assigned."""
    items = live(section.get("items", []))
    return {
        i: (item.get("id") or f"{section['id']}-{i + 1}")
        for i, item in enumerate(items)
    }


# ── section renderers ────────────────────────────────────────────────────────

ACCENT_RE = None
ACCENT_OF: dict[str, str] = {}


def load_accents(data: dict) -> None:
    """[accents] in content.toml maps a proper noun to a colour name. Every
    spelling is listed on its own — the ru and kk pages carry their own."""
    global ACCENT_RE, ACCENT_OF
    ACCENT_OF = {e(k): v for k, v in (data.get("accents") or {}).items()}
    if not ACCENT_OF:
        ACCENT_RE = None
        return
    # longest first, so "Astana, Kazakhstan" wins over a bare "Astana"
    keys = sorted(ACCENT_OF, key=len, reverse=True)
    ACCENT_RE = re.compile("|".join(re.escape(k) for k in keys))


def accent(escaped: str) -> str:
    if not ACCENT_RE:
        return escaped
    return ACCENT_RE.sub(
        lambda m: f'<span class="ac ac-{ACCENT_OF[m.group(0)]}">{m.group(0)}</span>',
        escaped,
    )


def inline(text: str) -> str:
    """Escape, tint the names listed in [accents], then honour the one bit of
    markup content.toml is allowed: **bold**. The source stays plain text."""
    return re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", accent(e(text)))


def render_text(sec: dict, lang: str) -> str:
    return "\n".join(
        f"<p>{inline(t(par, lang))}</p>" for par in sec.get("paragraphs", [])
    )


def list_label(item, lang: str) -> str:
    text = inline(t(item, lang))
    # grey out a trailing "(year)" without needing markup in content.toml
    text = re.sub(r"\((\d{4})\)$", r'<span class="date">(\1)</span>', text)
    award = t(item.get("award"), lang) if isinstance(item, dict) else ""
    if award:
        # the result is carried in its own field so `medal` can tint it
        # without any language having to spell the colour out
        cls = "medal m-" + item["medal"] if item.get("medal") else "medal"
        text += f' — <span class="{cls}">{inline(award)}</span>'
    return text


def render_kv(sec: dict, lang: str) -> str:
    out = ['<dl class="kv">']
    for row in sec.get("rows", []):
        out.append(
            f"  <dt>{e(t(row.get('key'), lang))}</dt>"
            f"<dd>{e(t(row.get('value'), lang))}</dd>"
        )
    out.append("</dl>")
    return "\n".join(out)


def render_links(sec: dict, lang: str) -> str:
    out = ['<ul class="links">']
    for link in sec.get("items", []):
        href = resolve_href(link["href"], lang)
        cls = f' class="lk lk-{e(link["tint"])}"' if link.get("tint") else ""
        out.append(f'  <li><a href="{e(href)}"{cls}>{e(t(link["label"], lang))}</a></li>')
    out.append("</ul>")
    return "\n".join(out)


def render_entries(sec: dict, lang: str) -> str:
    anchors = anchors_for(sec)
    out = []
    for i, item in enumerate(live(sec.get("items", []))):
        out.append(f'<div class="entry" id="{e(anchors[i])}">')
        out.append(f"  <h4>{inline(t(item.get('heading'), lang))}</h4>")
        place, dates = t(item.get("place"), lang), t(item.get("dates"), lang)
        if place or dates:
            out.append(
                '  <p class="meta">'
                f'<span class="role">{e(place)}</span>'
                f"<span>{e(dates)}</span></p>"
            )
        for b in item.get("bullets", []):
            if b is item.get("bullets", [])[0]:
                out.append("  <ul>")
            out.append(f"    <li>{inline(t(b, lang))}</li>")
        if item.get("bullets"):
            out.append("  </ul>")

        # several posts held at the same place: one heading, a block each
        for role in item.get("roles", []):
            out.append(f'  <div class="role-block" id="{e(role["id"])}">')
            out.append(
                '    <p class="role-line">'
                f'<span class="name">{inline(t(role.get("title"), lang))}</span>'
                f'<span>{e(t(role.get("dates"), lang))}</span></p>'
            )
            if role.get("bullets"):
                out.append("    <ul>")
                for b in role["bullets"]:
                    out.append(f"      <li>{inline(t(b, lang))}</li>")
                out.append("    </ul>")
            out.append("  </div>")
        out.append("</div>")
    return "\n".join(out)


def render_list_items(items, lang: str, space_on_code_change: bool = False) -> list[str]:
    out = []
    prev_code = None
    for item in items:
        subs = item.get("sub", []) if isinstance(item, dict) else []
        label = list_label(item, lang)
        cls = ""
        if space_on_code_change:
            # a blank line whenever the course code changes (CSCI → ECON → …)
            code = t(item, lang).split(" ", 1)[0]
            if prev_code is not None and code != prev_code:
                cls = ' class="gap"'
            prev_code = code
        if not subs:
            out.append(f"  <li{cls}>{label}</li>")
            continue
        # a line that carries its own smaller history: folded away until the
        # pointer (or the keyboard) rests on it
        out.append(f'  <li class="has-sub{cls[8:-1] if cls else ""}">')
        out.append(
            '    <span class="lead" tabindex="0" role="button" aria-expanded="false">'
            f'<span class="label">{label}</span>'
            '<span class="cue" aria-hidden="true"></span></span>'
        )
        out.append('    <div class="sub-wrap"><ul>')
        for sub in subs:
            out.append(f"      <li>{list_label(sub, lang)}</li>")
        out.append("    </ul></div>")
        out.append("  </li>")
    return out


def render_list(sec: dict, lang: str) -> str:
    groups = sec.get("groups")
    if groups:
        # each group is its own column, so related codes stay together
        out = ['<div class="cols">']
        for g in groups:
            out.append('<ul class="plain">')
            out += render_list_items(g.get("items", []), lang,
                                     g.get("space_on_code_change", False))
            out.append("</ul>")
        out.append("</div>")
        return "\n".join(out)

    cls = "plain cols" if sec.get("columns") else "plain"
    out = [f'<ul class="{cls}">']
    out += render_list_items(sec.get("items", []), lang)
    out.append("</ul>")
    return "\n".join(out)


RENDERERS = {
    "kv": render_kv,
    "links": render_links,
    "entries": render_entries,
    "list": render_list,
    "text": render_text,
}


# ── page ─────────────────────────────────────────────────────────────────────

def render_toc(nodes: list[dict], lang: str) -> str:
    rows = []
    for n in nodes:
        rows.append(
            f'      <li class="d{n["depth"]}">'
            f'<a href="#{e(n["anchor"])}">'
            f'<span class="n">{n["num"]}</span> '
            f'<span class="l">{e(t(n["field"], lang))}</span></a></li>'
        )
    return "\n".join(rows)


def render_chapter(chapter: dict, nums: dict[int, str], lang: str) -> str:
    """nums maps id(section) → its number; the chapter's own number is nums[0]."""
    out = []
    is_header = chapter.get("header")
    tag = "h1" if is_header else "h2"

    out.append(f'<section class="chapter" id="{e(chapter["id"])}">')
    if is_header:
        out.append('  <div class="head">')
        out.append(
            f'    <{tag}><span class="n">{nums["self"]}</span> '
            f"{e(t(chapter['title'], lang))}</{tag}>"
        )
        if chapter.get("subtitle"):
            out.append(f'    <p class="subtitle">[{e(t(chapter["subtitle"], lang))}]</p>')
        out.append("  </div>")
    else:
        out.append(
            f'  <{tag}><span class="n">{nums["self"]}</span> '
            f"{e(t(chapter['title'], lang))}</{tag}>"
        )

    for section in sections_of(chapter):
        num = nums[section["id"]]
        out.append(f'  <section class="sub" id="{e(section["id"])}">')
        out.append(
            f'    <h3><span class="n">{num}</span> '
            f"{e(t(section['title'], lang))}</h3>"
        )
        body = RENDERERS[section["type"]](section, lang)
        out.append("\n".join("    " + line for line in body.splitlines()))
        out.append("  </section>")

    out.append("</section>")
    return "\n".join(out)


def render_page(data: dict, lang: str) -> str:
    site = data["site"]
    title = t(site["title"], lang)
    nodes = outline(data)

    nav_items = []
    for l in LANGS:
        if l == lang:
            inner = f'<span aria-current="page">{LANG_LABEL[l]}</span>'
        else:
            inner = (
                f'<a href="{page_url(l, lang)}" hreflang="{l}" lang="{l}" '
                f'title="{e(LANG_NAME[l])}">{LANG_LABEL[l]}</a>'
            )
        nav_items.append(f"        <li>{inner}</li>")
    nav = "\n".join(nav_items)

    numbering = {}
    for ci, chapter in enumerate(data["chapters"], start=1):
        nums = {"self": str(ci)}
        for si, section in enumerate(sections_of(chapter), start=1):
            nums[section["id"]] = f"{ci}.{si}"
        numbering[chapter["id"]] = nums

    body = "\n\n".join(
        render_chapter(ch, numbering[ch["id"]], lang) for ch in data["chapters"]
    )

    alternates = "\n".join(
        f'<link rel="alternate" hreflang="{l}" href="{page_url(l, lang)}">' for l in LANGS
    ) + f'\n<link rel="alternate" hreflang="x-default" href="{page_url(DEFAULT, lang)}">'

    labels = site.get("ui", {})

    # the only third-party request on the page, and only if it is configured
    endpoint = site.get("goatcounter", "")
    counter = (
        f'<script data-goatcounter="{e(endpoint)}" async src="//gc.zgo.at/count.js"></script>'
        if endpoint else ""
    )

    return f"""<!doctype html>
<html lang="{lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{e(title)}</title>
<meta name="description" content="{e(t(site['description'], lang))}">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#fbfbf9" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#101211" media="(prefers-color-scheme: dark)">
{alternates}
<link rel="stylesheet" href="{asset('fonts/press-start-2p.css', lang)}">
<link rel="stylesheet" href="{asset('style.css', lang)}">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><text y='13' font-size='13' font-family='monospace'>R</text></svg>">
<!-- generated from content.toml by build.py — do not edit by hand -->
<script>
// Applied before first paint so a chosen theme never flashes the other one.
try {{
  var th = localStorage.getItem('theme');
  if (th === 'light' || th === 'dark') document.documentElement.setAttribute('data-theme', th);
}} catch (e) {{}}
</script>
</head>
<body>

<canvas id="bg" aria-hidden="true"></canvas>

<header class="bar">
  <div class="bar-inner">
    <nav class="langs" aria-label="language">
      <ul>
{nav}
      </ul>
    </nav>
    <div class="controls">
      <button type="button" id="font-btn" class="ctl ctl-btn"
              aria-label="{e(t(labels.get('font'), lang) or 'font')}">
        <svg class="icon icon-a-round" viewBox="0 0 7 7" aria-hidden="true">
          <!-- smooth 'A' — shown while the pixel face is on -->
          <path d="M3.5 1c-.52 0-.94.32-1.11.82L1 6h1.06l.46-1.4h1.96L4.94 6H6L4.61 1.82C4.44 1.32 4.02 1 3.5 1zm0 1.15.63 1.62H2.87z"/>
        </svg>
        <svg class="icon icon-a-pixel" viewBox="0 0 7 7" aria-hidden="true">
          <!-- pixel 'A' — shown while the smooth face is on -->
          <path d="M2 1h3v1H2zM1 2h1v5H1zM5 2h1v5H5zM2 4h3v1H2z"/>
        </svg>
      </button>
      <button type="button" id="bg-btn" class="ctl ctl-btn"
              aria-label="{e(t(labels.get('background'), lang) or 'background')}" aria-pressed="true">
        <canvas id="bg-icon" width="13" height="13" aria-hidden="true"></canvas>
      </button>
      <button type="button" id="theme-btn" class="ctl ctl-btn"
              aria-label="{e(t(labels.get('theme'), lang) or 'theme')}">
        <svg class="icon icon-sun" viewBox="0 0 9 9" aria-hidden="true">
          <!-- pixel sun -->
          <path d="M3 3h3v3H3zM4 0h1v2H4zM4 7h1v2H4zM0 4h2v1H0zM7 4h2v1H7zM1 1h1v1H1zM7 1h1v1H7zM1 7h1v1H1zM7 7h1v1H7z"/>
        </svg>
        <svg class="icon icon-moon" viewBox="0 0 9 9" aria-hidden="true">
          <!-- pixel crescent -->
          <path d="M3 1h3v1H3zM2 2h1v1H2zM1 3h1v3H1zM2 6h1v1H2zM3 7h3v1H3zM6 6h1v1H6zM4 2h3v1H4zM3 3h2v3H3zM4 6h3v1H4z" fill-opacity="0"/>
          <path d="M5 0a4.5 4.5 0 1 0 3 8 5 5 0 0 1-3-8z"/>
        </svg>
      </button>
    </div>
  </div>
</header>

<div class="layout">

<nav class="toc" id="toc" aria-label="{e(t(site['toc_title'], lang))}">
  <details id="toc-details">
    <summary>{e(t(site['toc_title'], lang))}</summary>
    <ul>
{render_toc(nodes, lang)}
    </ul>
  </details>
</nav>

<main>

{body}

</main>
</div>

<script src="{asset('site.js', lang)}"></script>
{counter}
</body>
</html>
"""


def main() -> int:
    data = tomllib.loads((ROOT / "content.toml").read_text(encoding="utf-8"))
    load_accents(data)

    for chapter in data["chapters"]:
        for section in chapter.get("sections", []):
            for item in section.get("items", []):
                if isinstance(item, dict) and item.get("draft"):
                    warnings.append(
                        f"draft (not published): {t(item.get('heading'), DEFAULT)}"
                    )

    for lang in LANGS:
        out = ROOT / OUTDIR[lang] / "index.html"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(render_page(data, lang), encoding="utf-8")
        print(f"wrote {out.relative_to(ROOT)}")

    for w in dict.fromkeys(warnings):
        print(f"  note: {w}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
