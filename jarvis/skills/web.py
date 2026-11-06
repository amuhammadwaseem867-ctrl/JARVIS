"""Web search and page reading.

With Claude, both run on Anthropic's servers (the API's web search and web
fetch tools): nothing to install and no extra key. Web search is billed per
search on your Anthropic account; ``JARVIS_MAX_WEB_SEARCHES`` caps how many it
may run for one request.

With the free providers (Groq, Gemini, Ollama) those server tools don't exist,
so JARVIS does it itself: ``web_search`` asks DuckDuckGo (free, no key) and
``web_fetch`` downloads a page and turns it into plain text. Standard library
only, nothing to install.
"""

from __future__ import annotations

import ipaddress
import re
import socket
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from typing import TYPE_CHECKING

from ..tools import ToolRegistry
from ._http import USER_AGENT

if TYPE_CHECKING:
    from . import SkillsConfig

WEB_SEARCH = "web_search_20260209"
WEB_FETCH = "web_fetch_20260209"

SEARCH_URL = "https://html.duckduckgo.com/html/"
# A browser-like agent: DuckDuckGo's HTML page refuses obvious bots.
BROWSER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0 Safari/537.36"
)
MAX_PAGE_CHARS = 12000


def register(registry: ToolRegistry, config: "SkillsConfig", server: bool = True) -> None:
    if server:
        registry.add_server_tool(
            {"type": WEB_SEARCH, "name": "web_search", "max_uses": config.max_web_searches}
        )
        # Fetch only reads URLs that already appear in the conversation (from
        # the user or from search results), so it can't wander off on its own.
        registry.add_server_tool(
            {"type": WEB_FETCH, "name": "web_fetch", "max_uses": 5, "max_content_tokens": 20000}
        )
        return

    @registry.tool(
        description=(
            "Search the web (DuckDuckGo). Returns the top results with title, URL "
            "and a snippet. Use it for anything recent or anything you're unsure "
            "of, then read a promising page with web_fetch if the snippets aren't enough."
        ),
        parameters={"query": {"type": "string", "description": "What to search for"}},
    )
    def web_search(query: str) -> list[dict[str, str]] | str:
        results = search(query)
        return results or f"No results found for '{query}'."

    @registry.tool(
        description=(
            "Read a web page and return its main text (cut to about 12,000 "
            "characters). Use a URL from the user or from web_search results."
        ),
        parameters={"url": {"type": "string", "description": "Full http(s) URL"}},
    )
    def web_fetch(url: str) -> str:
        return fetch_text(url)


# ------------------------------------------------------------------ search


class _ResultParser(HTMLParser):
    """Pulls results out of DuckDuckGo's plain HTML results page."""

    def __init__(self) -> None:
        super().__init__()
        self.results: list[dict[str, str]] = []
        self._field: str | None = None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        cls = a.get("class") or ""
        if tag == "a" and "result__a" in cls:
            self.results.append({"title": "", "url": _real_url(a.get("href", "")), "snippet": ""})
            self._field = "title"
        elif "result__snippet" in cls and self.results:
            self._field = "snippet"

    def handle_endtag(self, tag):
        if tag in ("a", "td", "div") and self._field:
            self._field = None

    def handle_data(self, data):
        if self._field and self.results:
            self.results[-1][self._field] += data


def _real_url(href: str) -> str:
    """DuckDuckGo wraps links as //duckduckgo.com/l/?uddg=<real url>."""
    if href.startswith("//"):
        href = "https:" + href
    parsed = urllib.parse.urlparse(href)
    if "duckduckgo.com" in parsed.netloc and parsed.path.startswith("/l/"):
        target = urllib.parse.parse_qs(parsed.query).get("uddg")
        if target:
            return target[0]
    return href


def parse_results(html: str, limit: int = 6) -> list[dict[str, str]]:
    parser = _ResultParser()
    parser.feed(html)
    out = []
    for r in parser.results:
        r = {k: " ".join(v.split()) for k, v in r.items()}
        # Skip ads (they point back at duckduckgo.com/y.js).
        if r["url"].startswith("http") and "duckduckgo.com/y.js" not in r["url"]:
            out.append(r)
        if len(out) >= limit:
            break
    return out


def search(query: str, limit: int = 6) -> list[dict[str, str]]:
    data = urllib.parse.urlencode({"q": query}).encode()
    req = urllib.request.Request(
        SEARCH_URL, data=data, headers={"User-Agent": BROWSER_AGENT}, method="POST"
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        html = resp.read().decode("utf-8", "replace")
    return parse_results(html, limit)


# ------------------------------------------------------------------- fetch


class _TextParser(HTMLParser):
    SKIP = {"script", "style", "noscript", "svg", "head", "nav", "footer", "form", "iframe"}
    BLOCK = {"p", "br", "div", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6",
             "section", "article", "header", "pre", "blockquote", "table"}

    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []
        self.title = ""
        self._skip = 0
        self._in_title = False

    def handle_starttag(self, tag, attrs):
        if tag == "title":
            self._in_title = True
        if tag in self.SKIP:
            self._skip += 1
        elif tag in self.BLOCK:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False
        if tag in self.SKIP and self._skip:
            self._skip -= 1
        elif tag in self.BLOCK:
            self.parts.append("\n")

    def handle_data(self, data):
        if self._in_title:
            self.title += data
        elif not self._skip:
            self.parts.append(data)


def html_to_text(html: str) -> tuple[str, str]:
    parser = _TextParser()
    parser.feed(html)
    text = "".join(parser.parts)
    lines = [" ".join(line.split()) for line in text.splitlines()]
    text = "\n".join(line for line in lines if line)
    return " ".join(parser.title.split()), text


def _check_public(url: str) -> None:
    """Refuse URLs that point at this computer or the home network."""
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ValueError("only full http:// or https:// URLs can be read")
    try:
        infos = socket.getaddrinfo(parsed.hostname, None)
    except socket.gaierror:
        raise ValueError(f"can't find the site '{parsed.hostname}'") from None
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if not ip.is_global:
            raise ValueError("that address is on this computer or the local network; not reading it")


class _SafeRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        _check_public(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetch_text(url: str, max_chars: int = MAX_PAGE_CHARS) -> str:
    _check_public(url)
    opener = urllib.request.build_opener(_SafeRedirects)
    req = urllib.request.Request(url, headers={"User-Agent": BROWSER_AGENT})
    with opener.open(req, timeout=20) as resp:
        ctype = resp.headers.get("Content-Type", "")
        raw = resp.read(2_000_000)
        charset = resp.headers.get_content_charset() or "utf-8"
    body = raw.decode(charset, "replace")
    if "html" in ctype or re.search(r"<html|<body", body[:2000], re.I):
        title, text = html_to_text(body)
    elif ctype.startswith("text/") or "json" in ctype or "xml" in ctype:
        title, text = "", body
    else:
        raise ValueError(f"that page isn't text ({ctype or 'unknown type'})")
    if len(text) > max_chars:
        text = text[:max_chars] + "\n[... cut off]"
    head = f"{title}\n{url}\n\n" if title else f"{url}\n\n"
    return head + (text or "(the page has no readable text)")


__all__ = ["register", "search", "fetch_text", "parse_results", "html_to_text", "USER_AGENT"]
