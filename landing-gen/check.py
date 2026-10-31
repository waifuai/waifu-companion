# -*- coding: utf-8 -*-
"""Static verification for the generated landing pages.

Checks per page: parse, html lang/dir, canonical, og tags, charset/viewport,
JSON-LD validity, FAQ JSON-LD <-> visible FAQ parity, image assets exist,
hreflang cluster identity/reciprocity/resolvability, no placeholder leakage.
Plus sitemap coverage and (once edited in) homepage cluster + footer links.

Usage:  python landing-gen/check.py
"""
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from content import LANGS, BASE

ROOT = Path(__file__).resolve().parent.parent

FAILS = []
WARNS = []


def fail(msg):
    FAILS.append(msg)


def warn(msg):
    WARNS.append(msg)


class HeadParser(HTMLParser):
    """Collect links, canonical, meta, JSON-LD, and visible text markers."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.links = []          # (rel, hreflang, href)
        self.metas = []          # (name/property, content)
        self.jsonlds = []
        self.summaries = []
        self.images = []
        self.html_attrs = {}
        self._in_json = 0
        self._json_buf = []
        self._in_summary = False
        self._buf = []
        self._in_faq = False
        self._depth = 0

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "html":
            self.html_attrs = a
        elif tag == "link" and a.get("rel"):
            self.links.append((a["rel"], a.get("hreflang"), a.get("href")))
        elif tag == "meta":
            key = a.get("property") or a.get("name")
            if key:
                self.metas.append((key, a.get("content")))
        elif tag == "script" and a.get("type") == "application/ld+json":
            self._in_json += 1
            self._json_buf.append([])
        elif tag == "img":
            self.images.append((a.get("src"), a.get("alt")))
        elif tag == "section" and "faq" in (a.get("class") or ""):
            self._in_faq = True
        elif tag == "summary" and self._in_faq:
            self._in_summary = True
            self._buf = []

    def handle_endtag(self, tag):
        if tag == "script" and self._in_json:
            self._in_json -= 1
        elif tag == "summary" and self._in_summary:
            self.summaries.append("".join(self._buf).strip())
            self._in_summary = False
        elif tag == "section" and self._in_faq:
            self._in_faq = False

    def handle_data(self, data):
        if self._in_json:
            self._json_buf[-1].append(data)
        if self._in_summary:
            self._buf.append(data)


def check_page(code):
    d = LANGS[code]
    path = ROOT / code / "index.html"
    if not path.exists():
        fail(f"{code}: page missing")
        return None
    raw = path.read_text(encoding="utf-8")
    p = HeadParser()
    p.feed(raw)

    if p.html_attrs.get("lang") != d["html_lang"]:
        fail(f"{code}: html lang={p.html_attrs.get('lang')!r} expected {d['html_lang']!r}")
    if p.html_attrs.get("dir") != d["dir"]:
        fail(f"{code}: html dir={p.html_attrs.get('dir')!r} expected {d['dir']!r}")

    canonical = [h for rel, _, h in p.links if rel == "canonical"]
    if canonical != [f"{BASE}{code}/"]:
        fail(f"{code}: canonical {canonical!r}")

    metas = dict(p.metas)
    if metas.get("og:locale") != d["og_locale"]:
        fail(f"{code}: og:locale {metas.get('og:locale')!r}")
    if metas.get("og:url") != f"{BASE}{code}/":
        fail(f"{code}: og:url {metas.get('og:url')!r}")
    if not metas.get("description"):
        fail(f"{code}: meta description missing")
    if "charset" not in raw.lower()[:600]:
        fail(f"{code}: charset missing")
    if 'name="viewport"' not in raw:
        fail(f"{code}: viewport missing")
    if "googletagmanager.com/gtag/js?id=G-MJCT26J1BK" not in raw:
        fail(f"{code}: GA gtag.js missing")
    if "gtag('config','G-MJCT26J1BK')" not in raw:
        fail(f"{code}: GA config missing")
    if "cta_click" not in raw:
        fail(f"{code}: CTA click event missing")
    # live Sprites embed, forced to the page's language
    if 'id="stage"' not in raw:
        fail(f"{code}: sprites stage missing")
    if "window.WaifuSpritesEmbed = true" not in raw:
        fail(f"{code}: sprites embed flag missing")
    if "window.WaifuSpritesSource = 'landing'" not in raw:
        fail(f"{code}: landing app_source missing")
    if "/homepage-sprites/i18n/i18n.js" not in raw:
        fail(f"{code}: sprites i18n runtime missing")
    if f"WaifuI18n.setLocale('{code}', {{ persist: false }});" not in raw:
        fail(f"{code}: forced stage locale missing or wrong")

    # hreflang: the page must declare the full cluster
    declared = {(rel, hl, href) for rel, hl, href in p.links if rel == "alternate" and hl}
    if not any(hl == "x-default" for _, hl, _ in declared):
        fail(f"{code}: x-default missing")
    if not any(hl == "en" and href == BASE for _, hl, href in declared):
        fail(f"{code}: en -> {BASE} missing")
    for tag in d["tags"]:
        if not any(hl == tag and href == f"{BASE}{code}/" for _, hl, href in declared):
            fail(f"{code}: self hreflang {tag} missing")
    # no stray self-tag mismatch: html lang tag must be among declared tags
    if not any(hl == d["html_lang"] for _, hl, _ in declared):
        warn(f"{code}: html lang {d['html_lang']} not in hreflang set")

    # JSON-LD
    docs = []
    for buf in p._json_buf:
        text = "".join(buf).strip()
        if not text:
            continue
        try:
            docs.append(json.loads(text))
        except json.JSONDecodeError as e:
            fail(f"{code}: JSON-LD parse error: {e}")
    types = {doc.get("@type") for doc in docs}
    if "WebApplication" not in types or "FAQPage" not in types:
        fail(f"{code}: JSON-LD types {types}")
    faq_doc = next((x for x in docs if x.get("@type") == "FAQPage"), None)
    if faq_doc:
        schema_qs = [q["name"] for q in faq_doc["mainEntity"]]
        if schema_qs != p.summaries:
            fail(f"{code}: JSON-LD questions != visible summaries "
                 f"({len(schema_qs)} vs {len(p.summaries)})")
    else:
        fail(f"{code}: FAQPage JSON-LD missing")

    # images resolve to real assets
    for src, alt in p.images:
        if not src or src.startswith("http"):
            continue
        asset = ROOT / src.lstrip("/")
        if not asset.exists():
            fail(f"{code}: image not found: {src}")
        if not alt:
            fail(f"{code}: image without alt: {src}")

    # placeholder / leakage checks
    for needle in ("{{", "None", "undefined", "TODO"):
        if needle in raw:
            fail(f"{code}: placeholder {needle!r} in page")
    if d["dir"] == "rtl" and 'dir="rtl"' not in raw[:200]:
        fail(f"{code}: RTL not set on html element")

    t = d["title"]
    if len(t) > 70:
        warn(f"{code}: title is {len(t)} chars")
    md = d["meta_description"]
    if not (60 <= len(md) <= 170):
        warn(f"{code}: meta description {len(md)} chars")
    return declared


def main():
    all_declared = {}
    for code in sorted(LANGS):
        declared = check_page(code)
        if declared:
            all_declared[code] = declared

    if len(all_declared) != len(LANGS):
        fail(f"only {len(all_declared)}/{len(LANGS)} pages parseable")

    # cluster identity: every page declares the same set
    sets = {c: {(hl, h) for _, hl, h in dec} for c, dec in all_declared.items()}
    first = next(iter(sets))
    for c, s in sets.items():
        if s != sets[first]:
            diff = s ^ sets[first]
            fail(f"{c}: hreflang set differs from {first}: {sorted(diff)[:4]}")

    # reciprocity/resolvability: every target is homepage or a generated page
    for hl, href in sorted(sets[first]):
        if hl == "x-default" or hl == "en":
            continue
        m = re.match(re.escape(BASE) + r"([a-z]+)/$", href)
        if not m:
            fail(f"hreflang target not a language page: {href}")
            continue
        target = m.group(1)
        if target not in LANGS:
            fail(f"hreflang target unknown: {href}")
        elif hl not in LANGS[target]["tags"]:
            fail(f"hreflang {hl} -> /{target}/ but {target} does not claim {hl}")

    # every language reachable from the cluster
    claimed = {re.match(re.escape(BASE) + r"([a-z]+)/$", h).group(1)
               for _, h in sets[first] if h.startswith(BASE) and h != BASE}
    missing = set(LANGS) - claimed
    if missing:
        fail(f"languages missing from cluster: {sorted(missing)}")

    # sitemap coverage
    sm = (ROOT / "sitemap.xml").read_text(encoding="utf-8")
    for code in sorted(LANGS):
        if f"{BASE}{code}/" not in sm:
            fail(f"sitemap: {code}/ missing")

    # homepage (checks activate once the cluster/footer are pasted in)
    hp = ROOT / "index.html"
    hraw = hp.read_text(encoding="utf-8")
    if 'hreflang="x-default"' in hraw:
        hp_links = re.findall(r'<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"', hraw)
        got = {(hl, h) for hl, h in hp_links}
        if got != sets[first]:
            diff = got ^ sets[first]
            fail(f"homepage: hreflang cluster differs from pages: {sorted(diff)[:4]}")
    else:
        warn("homepage: hreflang cluster not yet added")
    for code in sorted(LANGS):
        if f'href="{BASE}{code}/"' not in hraw and f'href="/{code}/"' not in hraw:
            fail(f"homepage: no footer link to /{code}/")

    for w in WARNS:
        print(f"WARN  {w}")
    for f in FAILS:
        print(f"FAIL  {f}")
    print(f"\n{len(FAILS)} failure(s), {len(WARNS)} warning(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
