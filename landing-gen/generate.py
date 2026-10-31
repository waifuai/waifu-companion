# -*- coding: utf-8 -*-
"""Generate the multilingual SEO landing pages (waifuai.com/<lang>/).

Reads the per-language content modules, renders one self-contained static
HTML page per language (no JS, every string baked into the DOM), and:

  * writes <lang>/index.html at the repo root
  * emits landing-gen/out/homepage-hreflang.html  (paste into index.html head)
  * emits landing-gen/out/homepage-langs.html     (paste into index.html footer)
  * adds the language URLs to sitemap.xml (idempotent)

Usage:  python landing-gen/generate.py          (run from the repo root)
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from content import LANGS, BASE, REQUIRED

ROOT = Path(__file__).resolve().parent.parent
OUT = Path(__file__).resolve().parent / "out"

CSS = """
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', sans-serif;
            background: #0a0a0f;
            color: #e0e0e0;
            min-height: 100vh;
            line-height: 1.5;
        }
        .top {
            max-width: 760px;
            margin: 0 auto;
            padding: 1.25rem 1.25rem 0;
        }
        .top a { color: #8b9bd4; text-decoration: none; font-size: .95rem; font-weight: 700; }
        .top a:hover { text-decoration: underline; }
        [dir="rtl"] .top .arrow { display: inline-block; transform: scaleX(-1); }
        .hero {
            text-align: center;
            padding: 2rem 1.25rem 1.5rem;
            max-width: 760px;
            margin: 0 auto;
        }
        .hero h1 {
            font-size: 2.2rem;
            line-height: 1.2;
            background: linear-gradient(135deg, #ff6b9d, #c084fc, #60a5fa);
            -webkit-background-clip: text;
            background-clip: text;
            -webkit-text-fill-color: transparent;
            color: #c084fc;
            margin-bottom: 0.75rem;
        }
        .hero .tagline {
            font-size: 1.05rem;
            color: #b4b4c0;
            line-height: 1.6;
            margin-bottom: 1.5rem;
        }
        .cta-primary {
            display: block;
            width: 100%;
            max-width: 420px;
            margin: 0 auto 0.85rem;
            padding: 1.05rem 1.5rem;
            border-radius: 12px;
            text-decoration: none;
            font-weight: 700;
            font-size: 1.12rem;
            color: #fff;
            background: linear-gradient(135deg, #ff6b9d, #c084fc);
            box-shadow: 0 6px 24px rgba(192,132,252,0.28);
            transition: transform 0.15s, box-shadow 0.15s;
        }
        .cta-primary:hover { transform: translateY(-2px); box-shadow: 0 10px 34px rgba(255,107,157,0.4); }
        .cta-primary .cta-sub {
            display: block;
            font-size: 0.8rem;
            font-weight: 500;
            opacity: 0.9;
            margin-top: 0.15rem;
        }
        .trust {
            text-align: center;
            font-size: 0.85rem;
            color: #7b7b8c;
            max-width: 640px;
            margin: 0 auto 1.75rem;
            padding: 0 1.25rem;
        }
        .shots {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
            gap: 1rem;
            max-width: 780px;
            margin: 0 auto 2.5rem;
            padding: 0 1.25rem;
        }
        .shots img {
            display: block;
            width: 100%;
            height: auto;
            border: 1px solid #262640;
            border-radius: 12px;
            background: #0d1326;
        }
        .features {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
            gap: 1.25rem;
            max-width: 820px;
            margin: 0 auto 2.5rem;
            padding: 0 1.25rem;
        }
        .feature {
            text-align: center;
            padding: 1.4rem 1rem;
            border: 1px solid #1a1a2e;
            border-radius: 12px;
            background: #0f0f1a;
        }
        .feature-icon { font-size: 2rem; margin-bottom: 0.5rem; }
        .feature h3 { font-size: 1rem; margin-bottom: 0.4rem; color: #fff; }
        .feature p { font-size: 0.85rem; color: #888; }
        .about, .faq {
            max-width: 720px;
            margin: 0 auto 2.5rem;
            padding: 0 1.25rem;
        }
        .about h2 {
            font-size: 1.2rem;
            color: #fff;
            margin: 1.6rem 0 0.5rem;
        }
        .about h2:first-child { margin-top: 0; }
        .about p { font-size: 0.95rem; color: #a5a5b8; line-height: 1.7; }
        .faq details {
            border: 1px solid #1a1a2e;
            border-radius: 10px;
            background: #0f0f1a;
            margin-bottom: 0.6rem;
        }
        .faq summary {
            padding: 0.9rem 1.1rem;
            cursor: pointer;
            font-weight: 600;
            font-size: 0.95rem;
            color: #e4e4ef;
            list-style: none;
        }
        .faq summary::-webkit-details-marker { display: none; }
        .faq summary::after { content: '+'; float: inline-end; color: #c084fc; font-weight: 400; }
        .faq details[open] summary::after { content: '\\2212'; }
        .faq p { padding: 0 1.1rem 1rem; font-size: 0.88rem; color: #9a9aab; line-height: 1.6; }
        .langs {
            text-align: center;
            padding: 1.75rem 1.5rem;
            border-top: 1px solid #1a1a2e;
            max-width: 720px;
            margin: 0 auto;
        }
        .langs h2 { font-size: 1rem; color: #8f8fa0; margin-bottom: 0.75rem; font-weight: 600; }
        .langs a {
            color: #60a5fa;
            text-decoration: none;
            margin: 0 0.6rem;
            font-size: 0.9rem;
            line-height: 2;
            display: inline-block;
        }
        .langs a:hover { text-decoration: underline; }
        .footer {
            text-align: center;
            padding: 1.5rem 2rem 2rem;
            color: #555;
            font-size: 0.8rem;
        }
        .footer a { color: #60a5fa; text-decoration: none; }
        .footer a:hover { text-decoration: underline; }
        @media (max-width: 480px) {
            .hero h1 { font-size: 1.7rem; }
            .hero .tagline { font-size: 0.98rem; }
            .cta-primary { font-size: 1.05rem; padding: 1rem; }
        }
        @media (prefers-reduced-motion: reduce) {
            .cta-primary { transition: none; }
            .cta-primary:hover { transform: none; }
        }
"""


def esc(s: str) -> str:
    return (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
             .replace('"', "&quot;"))


def hreflang_links(self_code: str) -> str:
    """Full cluster — identical on every page and on the homepage."""
    lines = []
    lines.append(f'    <link rel="alternate" hreflang="en" href="{BASE}">')
    for code in sorted(LANGS):
        d = LANGS[code]
        for tag in d["tags"]:
            lines.append(f'    <link rel="alternate" hreflang="{tag}" href="{BASE}{code}/">')
    lines.append(f'    <link rel="alternate" hreflang="x-default" href="{BASE}">')
    return "\n".join(lines)


def render_page(code: str) -> str:
    d = LANGS[code]
    url = f"{BASE}{code}/"
    canonical = f'    <link rel="canonical" href="{url}">'

    title = esc(d["title"])
    desc = esc(d["meta_description"])

    webapp = {
        "@context": "https://schema.org",
        "@type": "WebApplication",
        "name": "WaifuAI",
        "url": url,
        "description": d["meta_description"],
        "inLanguage": d["html_lang"],
        "applicationCategory": "EntertainmentApplication",
        "operatingSystem": "Web",
        "image": f"{BASE}assets/og-cover.jpg",
        "screenshot": f"{BASE}assets/og-cover.jpg",
        "offers": {"@type": "Offer", "price": "0", "priceCurrency": "USD"},
        "author": {"@type": "Organization", "name": "WaifuAI", "url": BASE},
    }
    faq = {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": [
            {"@type": "Question", "name": q,
             "acceptedAnswer": {"@type": "Answer", "text": a}}
            for q, a in d["faq"]
        ],
    }

    faq_html = "\n".join(
        f'        <details>\n            <summary>{esc(q)}</summary>\n'
        f'            <p>{esc(a)}</p>\n        </details>'
        for q, a in d["faq"]
    )
    feat_html = "\n".join(
        f'        <div class="feature">\n            <div class="feature-icon">{icon}</div>\n'
        f'            <h3>{esc(t)}</h3>\n            <p>{esc(x)}</p>\n        </div>'
        for icon, t, x in d["features"]
    )
    about_html = "\n".join(
        f'        <h2>{esc(h)}</h2>\n        <p>{esc(p)}</p>'
        for h, p in d["about"]
    )
    langs_html = " ".join(
        f'<a href="{BASE}{c}/" hreflang="{LANGS[c]["tags"][0]}" lang="{LANGS[c]["html_lang"]}">{esc(LANGS[c]["name"])}</a>'
        for c in sorted(LANGS) if c != code
    )

    return f"""<!DOCTYPE html>
<html lang="{d["html_lang"]}" dir="{d["dir"]}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{title}</title>
    <meta name="description" content="{desc}">
{canonical}

    <meta property="og:type" content="website">
    <meta property="og:url" content="{url}">
    <meta property="og:title" content="{title}">
    <meta property="og:description" content="{desc}">
    <meta property="og:image" content="{BASE}assets/og-cover.jpg">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:site_name" content="WaifuAI">
    <meta property="og:locale" content="{d["og_locale"]}">

    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="{title}">
    <meta name="twitter:description" content="{desc}">
    <meta name="twitter:image" content="{BASE}assets/og-cover.jpg">

    <link rel="icon" type="image/x-icon" href="/favicon.ico">
    <link rel="icon" type="image/png" href="/favicon.png">

{hreflang_links(code)}

    <script type="application/ld+json">
{json.dumps(webapp, ensure_ascii=False, indent=4)}
    </script>

    <script type="application/ld+json">
{json.dumps(faq, ensure_ascii=False, indent=4)}
    </script>

    <style>{CSS}</style>
</head>
<body>

    <nav class="top" aria-label="WaifuAI">
        <a href="/"><span class="arrow">←</span> WaifuAI</a>
    </nav>

    <section class="hero">
        <h1>{esc(d["h1"])}</h1>
        <p class="tagline">{esc(d["tagline"])}</p>

        <a class="cta-primary" href="/app/">
            {esc(d["cta"])}
            <span class="cta-sub">{esc(d["cta_sub"])}</span>
        </a>
    </section>

    <p class="trust">{esc(d["trust"])}</p>

    <section class="shots">
        <img src="/assets/og-cover.jpg" alt="{esc(d["alt_cover"])}" width="1200" height="630" loading="lazy">
        <img src="/assets/hero-app-mobile.webp" alt="{esc(d["alt_app"])}" width="800" height="1000" loading="lazy">
    </section>

    <section class="features">
{feat_html}
    </section>

    <section class="about">
{about_html}
    </section>

    <section class="faq">
{faq_html}
    </section>

    <section class="langs">
        <h2>{esc(d["other_langs"])}</h2>
        {langs_html}
    </section>

    <footer class="footer">
        <a href="/">{esc(d["back"])}</a> · WaifuAI
    </footer>

</body>
</html>
"""


def homepage_snippets() -> None:
    OUT.mkdir(exist_ok=True)
    head = hreflang_links(None)
    (OUT / "homepage-hreflang.html").write_text(head + "\n", encoding="utf-8")
    lang_items = " ".join(
        f'<a href="{BASE}{c}/" hreflang="{LANGS[c]["tags"][0]}" lang="{LANGS[c]["html_lang"]}">{esc(LANGS[c]["name"])}</a>'
        for c in sorted(LANGS)
    )
    footer = (
        '    <section class="links">\n'
        '        <p style="color:#555;font-size:.8rem;margin:0 0 .5rem;">WaifuAI in other languages:</p>\n'
        f'        {lang_items}\n'
        '    </section>\n'
    )
    (OUT / "homepage-langs.html").write_text(footer, encoding="utf-8")


def update_sitemap() -> None:
    path = ROOT / "sitemap.xml"
    text = path.read_text(encoding="utf-8")
    additions = []
    for code in sorted(LANGS):
        url = f"{BASE}{code}/"
        if url not in text:
            additions.append(
                f"  <url>\n    <loc>{url}</loc>\n"
                f"    <changefreq>monthly</changefreq>\n    <priority>0.7</priority>\n  </url>"
            )
    if additions:
        text = text.replace("</urlset>", "\n".join(additions) + "\n</urlset>")
        path.write_text(text, encoding="utf-8")
    print(f"sitemap.xml: {len(additions)} URL(s) added")


def main() -> None:
    missing = {c: [k for k in REQUIRED if k not in d] for c, d in LANGS.items()}
    bad = {c: m for c, m in missing.items() if m}
    if bad:
        raise SystemExit(f"Missing fields: {bad}")
    for code in sorted(LANGS):
        page = render_page(code)
        target = ROOT / code
        target.mkdir(exist_ok=True)
        (target / "index.html").write_text(page, encoding="utf-8")
        print(f"wrote {code}/index.html ({len(page)} bytes)")
    homepage_snippets()
    update_sitemap()


if __name__ == "__main__":
    main()
