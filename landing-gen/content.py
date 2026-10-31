# -*- coding: utf-8 -*-
"""Merge all landing page content tiers.

One entry per shipped interface language (33 dictionaries minus English = 32
pages; English searchers are served by the existing homepage, which acts as
`en` + `x-default` in the hreflang cluster).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from langs_tier1 import LANGS as T1
from langs_tier2 import LANGS as T2
from langs_tier3a import LANGS as T3A
from langs_tier3b import LANGS as T3B

LANGS = {}
LANGS.update(T1)
LANGS.update(T2)
LANGS.update(T3A)
LANGS.update(T3B)

BASE = "https://waifuai.com/"
REQUIRED = ("name", "html_lang", "tags", "dir", "og_locale", "title",
            "meta_description", "h1", "tagline", "cta", "cta_sub", "trust",
            "features", "about", "faq", "other_langs", "back",
            "alt_cover", "alt_app")
