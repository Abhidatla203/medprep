#!/usr/bin/env python3
"""
medprep_harvest.py — Polite, provenance-first harvester for publicly published
university examination question papers.

DESIGN PRINCIPLES
-----------------
1. Adding a university is a YAML entry, never new code.
2. robots.txt is authoritative. If it says no, we don't.
3. raw/ is immutable and content-addressed. Nothing overwrites, nothing dedupes wrong.
4. Provenance is captured before parsing, not after.
5. Every inferred metadata field carries a confidence and the rule that produced it.
6. Re-runs are cheap (conditional GET) and safe (idempotent).

SCOPE
-----
Intended for official university examination portals that publish past papers
publicly. Third-party aggregator sites are marked `manual_review` in the registry
and are skipped unless explicitly enabled per-source, because a curated
cross-university collection is a compilation with its own rights attached.

INSTALL
-------
    pip install requests beautifulsoup4 pyyaml pypdf tenacity

USAGE
-----
    python medprep_harvest.py init                      # write sources.yaml
    python medprep_harvest.py list
    python medprep_harvest.py crawl --source rguhs --dry-run
    python medprep_harvest.py crawl --source rguhs --max-files 50
    python medprep_harvest.py probe                     # OCR triage
    python medprep_harvest.py report

CONTACT HEADER
--------------
Set MEDPREP_CONTACT to an email you actually monitor. Site admins who can see
who you are and how to reach you almost never block you. Anonymous scrapers
get blocked.
"""

from __future__ import annotations

import argparse
import dataclasses
import hashlib
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.robotparser
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, Iterator, List, Optional, Tuple

try:
    import requests
    from bs4 import BeautifulSoup
    import yaml
except ImportError as exc:  # pragma: no cover
    sys.exit(f"Missing dependency: {exc}. Run: pip install requests beautifulsoup4 pyyaml pypdf tenacity")

CRAWLER_VERSION = "medprep-harvest/1.0.0"
DEFAULT_CONTACT = os.environ.get("MEDPREP_CONTACT", "set-MEDPREP_CONTACT-env-var@example.org")
USER_AGENT = f"{CRAWLER_VERSION} (+medprep research harvester; contact: {DEFAULT_CONTACT})"

ROOT = Path(os.environ.get("MEDPREP_DATA", "./medprep_data")).resolve()
RAW = ROOT / "raw"
MANIFEST = ROOT / "manifest.jsonl"
STATE = ROOT / "state.json"
LOG = ROOT / "harvest.log"
REGISTRY = Path("./sources.yaml")

MIN_DELAY_SECONDS = 2.0          # never faster than this, regardless of robots.txt
MAX_RETRIES = 4
TIMEOUT = 45
MAX_BYTES = 80 * 1024 * 1024     # 80MB sanity cap per file


# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

def log(level: str, msg: str) -> None:
    line = f"{datetime.now(timezone.utc).isoformat()} [{level}] {msg}"
    print(line, flush=True)
    LOG.parent.mkdir(parents=True, exist_ok=True)
    with LOG.open("a", encoding="utf-8") as fh:
        fh.write(line + "\n")


# ---------------------------------------------------------------------------
# Source registry
# ---------------------------------------------------------------------------

DEFAULT_REGISTRY = """\
# MedPrep source registry
# ------------------------------------------------------------------
# status:
#   active         -> will be crawled
#   manual_review  -> skipped; requires --force-source and a human decision
#   blocked        -> robots.txt or ToS disallows; documented, never crawled
#   unverified     -> URL not yet confirmed to serve papers; verify by hand first
#
# adapter:
#   link_harvest   -> crawl seed pages, follow index links to depth, collect PDFs
#   folder_enum    -> enumerate a URL template over a parameter list
#
# Verify every seed URL in a browser before setting status: active.
# Portals move. A 404 is a registry bug, not a crawler bug.

defaults:
  course: MBBS
  delay_seconds: 3.0
  file_pattern: '\\.pdf($|\\?)'
  max_depth: 2

sources:

  - key: rguhs
    name: Rajiv Gandhi University of Health Sciences
    status: unverified
    adapter: link_harvest
    homepage: https://rguhs.karnataka.gov.in/
    seeds:
      - https://rguhs.karnataka.gov.in/stud_qp_dwnld/
    notes: >
      Official student question-paper download portal. Verify whether it is a
      static link listing or a POST-driven form. If it is form-driven, the
      link_harvest adapter will find nothing: switch to folder_enum with the
      observed query parameters, or record it as manual-download.

  - key: kuhs
    name: Kerala University of Health Sciences
    status: unverified
    adapter: folder_enum
    homepage: http://www2.kuhs.ac.in/
    url_template: 'http://www2.kuhs.ac.in/kuhs_new/index.php?id=14&folder={folder}'
    folders:
      - MODERN%20MEDICINE/UG/MBBS
    notes: >
      Folder-parameterised listing pages. Confirm the exact folder string for
      MBBS by navigating the site; the BAMS path uses AYURVEDA/UG/BAMS, so the
      MBBS equivalent is likely but not confirmed to follow the same shape.

  - key: muhs
    name: Maharashtra University of Health Sciences
    status: unverified
    adapter: link_harvest
    homepage: https://muhs.ac.in/
    seeds: []
    notes: Locate the official examination / question-paper section and add seeds.

  - key: ntruhs
    name: Dr. NTR University of Health Sciences
    status: unverified
    adapter: link_harvest
    homepage: https://ntruhs.ap.nic.in/
    seeds: []

  - key: tnmgrmu
    name: Tamil Nadu Dr. M.G.R. Medical University
    status: unverified
    adapter: link_harvest
    homepage: https://www.tnmgrmu.ac.in/
    seeds: []

  - key: wbuhs
    name: West Bengal University of Health Sciences
    status: unverified
    adapter: link_harvest
    homepage: https://www.wbuhs.ac.in/
    seeds: []

  - key: knruhs
    name: Kaloji Narayana Rao University of Health Sciences
    status: unverified
    adapter: link_harvest
    homepage: https://knruhs.telangana.gov.in/
    seeds: []

  # ---- Aggregators: deliberate human decision required -------------------
  - key: firstranker
    name: FirstRanker (third-party aggregator)
    status: manual_review
    adapter: link_harvest
    homepage: https://firstranker.com/
    seeds: []
    notes: >
      Large curated cross-university collection. The collection itself is a
      compilation with its own rights independent of the underlying papers.
      Do not bulk-harvest. If a specific paper is unobtainable from its issuing
      university, source it individually and record provenance accordingly.
"""


@dataclass
class Source:
    key: str
    name: str
    status: str
    adapter: str
    homepage: str = ""
    seeds: List[str] = field(default_factory=list)
    url_template: str = ""
    folders: List[str] = field(default_factory=list)
    course: str = "MBBS"
    delay_seconds: float = 3.0
    file_pattern: str = r"\.pdf($|\?)"
    max_depth: int = 2
    notes: str = ""


def load_registry(path: Path = REGISTRY) -> List[Source]:
    if not path.exists():
        sys.exit(f"No registry at {path}. Run: python medprep_harvest.py init")
    raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    defaults = raw.get("defaults", {}) or {}
    out: List[Source] = []
    for entry in raw.get("sources", []) or []:
        merged = {**defaults, **entry}
        known = {f.name for f in dataclasses.fields(Source)}
        out.append(Source(**{k: v for k, v in merged.items() if k in known}))
    return out


# ---------------------------------------------------------------------------
# robots.txt gate
# ---------------------------------------------------------------------------

class RobotsGate:
    """One parser per host, cached. Fail closed on ambiguity."""

    def __init__(self, session: requests.Session):
        self.session = session
        self._cache: Dict[str, Optional[urllib.robotparser.RobotFileParser]] = {}
        self._delays: Dict[str, float] = {}

    def _parser(self, url: str) -> Optional[urllib.robotparser.RobotFileParser]:
        host = urllib.parse.urlsplit(url)._replace(path="", query="", fragment="").geturl()
        if host in self._cache:
            return self._cache[host]
        rp = urllib.robotparser.RobotFileParser()
        robots_url = urllib.parse.urljoin(host + "/", "robots.txt")
        try:
            resp = self.session.get(robots_url, timeout=TIMEOUT)
            if resp.status_code == 200:
                rp.parse(resp.text.splitlines())
                log("INFO", f"robots.txt loaded for {host}")
            elif resp.status_code in (401, 403):
                # Explicitly protected robots.txt: treat whole site as disallowed.
                rp = None
                log("WARN", f"robots.txt returned {resp.status_code} for {host}; treating as disallow")
            else:
                rp.parse([])  # 404 == no restrictions
                log("INFO", f"no robots.txt at {host} ({resp.status_code}); proceeding politely")
        except requests.RequestException as exc:
            rp = None
            log("WARN", f"robots.txt fetch failed for {host}: {exc}; treating as disallow")
        self._cache[host] = rp
        if rp is not None:
            try:
                cd = rp.crawl_delay(USER_AGENT) or rp.crawl_delay("*")
                if cd:
                    self._delays[host] = float(cd)
                    log("INFO", f"crawl-delay {cd}s declared by {host}")
            except Exception:
                pass
        return rp

    def allowed(self, url: str) -> bool:
        rp = self._parser(url)
        if rp is None:
            return False
        return rp.can_fetch(USER_AGENT, url)

    def delay_for(self, url: str, floor: float) -> float:
        host = urllib.parse.urlsplit(url)._replace(path="", query="", fragment="").geturl()
        return max(MIN_DELAY_SECONDS, floor, self._delays.get(host, 0.0))


# ---------------------------------------------------------------------------
# Rate-limited fetcher
# ---------------------------------------------------------------------------

class Fetcher:
    def __init__(self, gate: RobotsGate, session: requests.Session, state: Dict[str, Any]):
        self.gate = gate
        self.session = session
        self.state = state
        self._last_hit: Dict[str, float] = defaultdict(float)

    def _wait(self, url: str, floor: float) -> None:
        host = urllib.parse.urlsplit(url).netloc
        delay = self.gate.delay_for(url, floor)
        elapsed = time.monotonic() - self._last_hit[host]
        if elapsed < delay:
            time.sleep(delay - elapsed)
        self._last_hit[host] = time.monotonic()

    def get(self, url: str, floor: float, stream: bool = False) -> Optional[requests.Response]:
        if not self.gate.allowed(url):
            log("SKIP", f"robots.txt disallows {url}")
            return None

        cached = self.state.get("http_cache", {}).get(url, {})
        headers: Dict[str, str] = {}
        if cached.get("etag"):
            headers["If-None-Match"] = cached["etag"]
        if cached.get("last_modified"):
            headers["If-Modified-Since"] = cached["last_modified"]

        backoff = 3.0
        for attempt in range(1, MAX_RETRIES + 1):
            self._wait(url, floor)
            try:
                resp = self.session.get(url, headers=headers, timeout=TIMEOUT, stream=stream)
            except requests.RequestException as exc:
                log("WARN", f"attempt {attempt} failed for {url}: {exc}")
                time.sleep(backoff)
                backoff *= 2
                continue

            if resp.status_code == 304:
                log("CACHE", f"unchanged: {url}")
                return None
            if resp.status_code == 429 or 500 <= resp.status_code < 600:
                retry_after = float(resp.headers.get("Retry-After", backoff))
                log("WARN", f"{resp.status_code} on {url}; backing off {retry_after}s")
                time.sleep(min(retry_after, 120))
                backoff *= 2
                continue
            if resp.status_code != 200:
                log("WARN", f"{resp.status_code} on {url}; giving up")
                return None

            self.state.setdefault("http_cache", {})[url] = {
                "etag": resp.headers.get("ETag"),
                "last_modified": resp.headers.get("Last-Modified"),
                "seen_at": datetime.now(timezone.utc).isoformat(),
            }
            return resp

        log("ERROR", f"exhausted retries for {url}")
        return None


# ---------------------------------------------------------------------------
# Metadata inference
# ---------------------------------------------------------------------------

SUBJECT_LEXICON: Dict[str, List[str]] = {
    "Anatomy": ["anatomy", "human anatomy"],
    "Physiology": ["physiology"],
    "Biochemistry": ["biochemistry", "bio chemistry", "bio-chemistry"],
    "Pathology": ["pathology"],
    "Pharmacology": ["pharmacology"],
    "Microbiology": ["microbiology"],
    "Forensic Medicine": ["forensic", "fmt", "toxicology"],
    "Community Medicine": ["community medicine", "psm", "preventive and social"],
    "General Medicine": ["general medicine", "medicine paper"],
    "General Surgery": ["general surgery", "surgery paper"],
    "Obstetrics & Gynaecology": ["obstetric", "gynaec", "gynec", "obg"],
    "Paediatrics": ["paediatric", "pediatric"],
    "Ophthalmology": ["ophthalmolog", "ophthal"],
    "ENT": ["oto rhino", "otorhino", "ent ", "laryngolog"],
    "Orthopaedics": ["orthopaedic", "orthopedic"],
    "Dermatology": ["dermatolog", "skin and"],
    "Psychiatry": ["psychiatr"],
    "Anaesthesiology": ["anaesthes", "anesthes"],
    "Radiology": ["radiolog"],
    "Respiratory Medicine": ["respiratory", "tuberculosis", "pulmonar"],
}

PHASE_BY_SUBJECT: Dict[str, str] = {
    "Anatomy": "Phase I", "Physiology": "Phase I", "Biochemistry": "Phase I",
    "Pathology": "Phase II", "Pharmacology": "Phase II", "Microbiology": "Phase II",
    "Forensic Medicine": "Phase II",
    "Community Medicine": "Phase III Part 1", "Ophthalmology": "Phase III Part 1",
    "ENT": "Phase III Part 1", "Dermatology": "Phase III Part 1",
    "Psychiatry": "Phase III Part 1", "Respiratory Medicine": "Phase III Part 1",
    "General Medicine": "Phase III Part 2", "General Surgery": "Phase III Part 2",
    "Obstetrics & Gynaecology": "Phase III Part 2", "Paediatrics": "Phase III Part 2",
    "Orthopaedics": "Phase III Part 2",
}

TERMS = {
    "winter": "Winter", "summer": "Summer", "supplementary": "Supplementary",
    "supply": "Supplementary", "regular": "Regular", "annual": "Annual",
    "jan": "January", "feb": "February", "mar": "March", "apr": "April",
    "may": "May", "jun": "June", "jul": "July", "aug": "August",
    "sep": "September", "oct": "October", "nov": "November", "dec": "December",
}


@dataclass
class Inferred:
    value: Optional[str] = None
    confidence: float = 0.0
    rule: str = "none"

    def as_dict(self) -> Dict[str, Any]:
        return {"value": self.value, "confidence": round(self.confidence, 2), "rule": self.rule}


def infer_year(text: str) -> Inferred:
    years = [int(y) for y in re.findall(r"(?<!\d)(19[89]\d|20[0-4]\d)(?!\d)", text)]
    plausible = [y for y in years if 1990 <= y <= datetime.now().year + 1]
    if not plausible:
        return Inferred()
    # Latest plausible year is usually the exam year; URLs often carry other numbers.
    conf = 0.85 if len(set(plausible)) == 1 else 0.55
    return Inferred(str(max(plausible)), conf, "regex:4-digit-year")


def infer_subject(text: str) -> Inferred:
    low = text.lower()
    hits = [(s, k) for s, keys in SUBJECT_LEXICON.items() for k in keys if k in low]
    if not hits:
        return Inferred()
    if len({s for s, _ in hits}) > 1:
        # Longest keyword wins, but flag the ambiguity with lower confidence.
        best = max(hits, key=lambda h: len(h[1]))
        return Inferred(best[0], 0.45, f"lexicon:ambiguous:{best[1]}")
    return Inferred(hits[0][0], 0.9, f"lexicon:{hits[0][1]}")


def infer_paper(text: str) -> Inferred:
    low = text.lower()
    m = re.search(r"paper\s*[-_ ]?(i{1,3}v?|iv|[1-4])\b", low)
    if m:
        token = m.group(1)
        roman = {"i": "I", "ii": "II", "iii": "III", "iv": "IV"}
        val = roman.get(token, token.upper())
        return Inferred(f"Paper {val}", 0.85, "regex:paper-token")
    if re.search(r"\bp[- ]?ii\b", low):
        return Inferred("Paper II", 0.6, "regex:p-ii-shorthand")
    if re.search(r"\bp[- ]?i\b", low):
        return Inferred("Paper I", 0.6, "regex:p-i-shorthand")
    return Inferred()


def infer_term(text: str) -> Inferred:
    low = text.lower()
    for key, val in TERMS.items():
        if re.search(rf"\b{key}", low):
            return Inferred(val, 0.7, f"lexicon:term:{key}")
    return Inferred()


def infer_phase(subject: Optional[str]) -> Inferred:
    if subject and subject in PHASE_BY_SUBJECT:
        return Inferred(PHASE_BY_SUBJECT[subject], 0.75, "map:subject->phase")
    return Inferred()


def infer_all(link_text: str, url: str) -> Dict[str, Any]:
    """Link text is usually richer than the URL; try it first, fall back to URL."""
    blob_text = link_text or ""
    blob_url = urllib.parse.unquote(url)

    def pick(fn) -> Inferred:
        a = fn(blob_text)
        if a.value and a.confidence >= 0.6:
            return a
        b = fn(blob_url)
        if b.value and (not a.value or b.confidence > a.confidence):
            b.rule += "|from-url"
            return b
        return a

    subject = pick(infer_subject)
    return {
        "year": pick(infer_year).as_dict(),
        "subject": subject.as_dict(),
        "paper": pick(infer_paper).as_dict(),
        "term": pick(infer_term).as_dict(),
        "phase": infer_phase(subject.value).as_dict(),
    }


# ---------------------------------------------------------------------------
# Manifest
# ---------------------------------------------------------------------------

def load_manifest_hashes() -> Dict[str, Dict[str, Any]]:
    seen: Dict[str, Dict[str, Any]] = {}
    if MANIFEST.exists():
        with MANIFEST.open(encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                    seen[rec["sha256"]] = rec
                except json.JSONDecodeError:
                    continue
    return seen


def append_manifest(record: Dict[str, Any]) -> None:
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    with MANIFEST.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(record, ensure_ascii=False) + "\n")


def load_state() -> Dict[str, Any]:
    if STATE.exists():
        try:
            return json.loads(STATE.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            pass
    return {}


def save_state(state: Dict[str, Any]) -> None:
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(state, indent=2), encoding="utf-8")


# ---------------------------------------------------------------------------
# Adapters: discover candidate file URLs
# ---------------------------------------------------------------------------

def _same_site(a: str, b: str) -> bool:
    return urllib.parse.urlsplit(a).netloc == urllib.parse.urlsplit(b).netloc


def adapter_link_harvest(src: Source, fetcher: Fetcher) -> Iterator[Tuple[str, str, str]]:
    """Breadth-first over seed pages; yields (file_url, link_text, found_on_page)."""
    pattern = re.compile(src.file_pattern, re.I)
    visited: set = set()
    queue: List[Tuple[str, int]] = [(s, 0) for s in src.seeds]

    while queue:
        page_url, depth = queue.pop(0)
        if page_url in visited or depth > src.max_depth:
            continue
        visited.add(page_url)

        resp = fetcher.get(page_url, src.delay_seconds)
        if resp is None:
            continue
        ctype = resp.headers.get("Content-Type", "")
        if "html" not in ctype.lower():
            continue

        soup = BeautifulSoup(resp.text, "html.parser")
        for anchor in soup.find_all("a", href=True):
            href = anchor["href"].strip()
            if href.lower().startswith(("mailto:", "javascript:", "#", "tel:")):
                continue
            absolute = urllib.parse.urljoin(page_url, href)
            text = " ".join(anchor.get_text(" ", strip=True).split())
            if pattern.search(absolute):
                yield absolute, text, page_url
            elif depth < src.max_depth and _same_site(absolute, page_url) and absolute not in visited:
                queue.append((absolute, depth + 1))


def adapter_folder_enum(src: Source, fetcher: Fetcher) -> Iterator[Tuple[str, str, str]]:
    """Expand a URL template over folder values, then link-harvest each result."""
    if not src.url_template:
        log("ERROR", f"{src.key}: folder_enum requires url_template")
        return
    expanded = Source(**{**dataclasses.asdict(src),
                         "adapter": "link_harvest",
                         "seeds": [src.url_template.format(folder=f) for f in (src.folders or [""])]})
    yield from adapter_link_harvest(expanded, fetcher)


ADAPTERS = {"link_harvest": adapter_link_harvest, "folder_enum": adapter_folder_enum}


# ---------------------------------------------------------------------------
# Download
# ---------------------------------------------------------------------------

def download(src: Source, file_url: str, link_text: str, found_on: str,
             fetcher: Fetcher, seen: Dict[str, Dict[str, Any]], dry_run: bool) -> Optional[str]:
    if dry_run:
        meta = infer_all(link_text, file_url)
        log("DRY", f"{src.key} | {meta['subject']['value']} | {meta['year']['value']} | {file_url}")
        return None

    resp = fetcher.get(file_url, src.delay_seconds, stream=True)
    if resp is None:
        return None

    chunks: List[bytes] = []
    total = 0
    digest = hashlib.sha256()
    for chunk in resp.iter_content(65536):
        if not chunk:
            continue
        total += len(chunk)
        if total > MAX_BYTES:
            log("WARN", f"exceeds size cap, discarding: {file_url}")
            return None
        digest.update(chunk)
        chunks.append(chunk)
    sha = digest.hexdigest()

    if sha in seen:
        log("DUP", f"already held ({sha[:12]}) via {seen[sha].get('source_url')}")
        return sha

    payload = b"".join(chunks)
    if not payload.startswith(b"%PDF") and file_url.lower().endswith(".pdf"):
        log("WARN", f"not a PDF despite extension, discarding: {file_url}")
        return None

    meta = infer_all(link_text, file_url)
    year = meta["year"]["value"] or "unknown_year"
    dest_dir = RAW / src.key / src.course / year
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / f"{sha}.pdf"
    dest.write_bytes(payload)
    os.chmod(dest, 0o444)  # immutable raw

    record = {
        "sha256": sha,
        "stored_path": str(dest.relative_to(ROOT)),
        "size_bytes": total,
        "source_key": src.key,
        "institution": src.name,
        "course": src.course,
        "source_url": file_url,
        "found_on_page": found_on,
        "link_text": link_text,
        "http_content_type": resp.headers.get("Content-Type"),
        "http_last_modified": resp.headers.get("Last-Modified"),
        "http_etag": resp.headers.get("ETag"),
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "crawler_version": CRAWLER_VERSION,
        "inferred": meta,
        "review_status": "pending",
        "needs_ocr": None,
        "text_chars_per_page": None,
    }
    append_manifest(record)
    seen[sha] = record
    log("SAVE", f"{src.key} | {meta['subject']['value']} {meta['year']['value']} | {dest.name}")
    return sha


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

def cmd_init(_: argparse.Namespace) -> None:
    if REGISTRY.exists():
        sys.exit(f"{REGISTRY} already exists; refusing to overwrite.")
    REGISTRY.write_text(DEFAULT_REGISTRY, encoding="utf-8")
    ROOT.mkdir(parents=True, exist_ok=True)
    print(f"Wrote {REGISTRY}")
    print(f"Data root: {ROOT}")
    print("\nNext: open sources.yaml, verify each seed URL in a browser,")
    print("then flip verified entries to status: active.")


def cmd_list(_: argparse.Namespace) -> None:
    rows = load_registry()
    width = max(len(s.key) for s in rows) + 2
    print(f"{'KEY':<{width}}{'STATUS':<16}{'ADAPTER':<16}{'SEEDS':<7}NAME")
    print("-" * 100)
    for s in sorted(rows, key=lambda r: (r.status, r.key)):
        n = len(s.seeds) if s.adapter == "link_harvest" else len(s.folders)
        print(f"{s.key:<{width}}{s.status:<16}{s.adapter:<16}{n:<7}{s.name}")


def cmd_crawl(args: argparse.Namespace) -> None:
    sources = load_registry()
    if args.source:
        sources = [s for s in sources if s.key in args.source]
        if not sources:
            sys.exit("No matching source key.")

    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT, "Accept": "*/*"})
    state = load_state()
    gate = RobotsGate(session)
    fetcher = Fetcher(gate, session, state)
    seen = load_manifest_hashes()
    log("INFO", f"{len(seen)} files already in manifest")

    saved = 0
    try:
        for src in sources:
            if src.status == "blocked":
                log("SKIP", f"{src.key}: marked blocked in registry")
                continue
            if src.status == "manual_review" and not args.force_source:
                log("SKIP", f"{src.key}: manual_review — use --force-source to override deliberately")
                continue
            if src.status == "unverified" and not args.allow_unverified:
                log("SKIP", f"{src.key}: unverified — verify seeds, or pass --allow-unverified")
                continue
            if not src.seeds and not src.folders:
                log("SKIP", f"{src.key}: no seeds configured")
                continue

            adapter = ADAPTERS.get(src.adapter)
            if adapter is None:
                log("ERROR", f"{src.key}: unknown adapter {src.adapter}")
                continue

            log("INFO", f"=== {src.key} ({src.name}) via {src.adapter} ===")
            for file_url, link_text, found_on in adapter(src, fetcher):
                if args.max_files and saved >= args.max_files:
                    log("INFO", f"reached --max-files {args.max_files}")
                    return
                if download(src, file_url, link_text, found_on, fetcher, seen, args.dry_run):
                    saved += 1
    except KeyboardInterrupt:
        log("INFO", "interrupted; state saved, safe to resume")
    finally:
        save_state(state)
        log("INFO", f"run complete: {saved} new files")


def cmd_probe(_: argparse.Namespace) -> None:
    """OCR triage: how much extractable text does each PDF actually have?"""
    try:
        from pypdf import PdfReader
    except ImportError:
        sys.exit("pip install pypdf")

    records = [json.loads(l) for l in MANIFEST.read_text(encoding="utf-8").splitlines() if l.strip()]
    updated, need_ocr = 0, 0
    out: List[Dict[str, Any]] = []

    for rec in records:
        if rec.get("needs_ocr") is not None:
            out.append(rec)
            continue
        path = ROOT / rec["stored_path"]
        if not path.exists():
            rec["needs_ocr"] = "missing_file"
            out.append(rec)
            continue
        try:
            reader = PdfReader(str(path))
            pages = len(reader.pages)
            chars = sum(len((p.extract_text() or "")) for p in reader.pages[:10])
            per_page = chars / max(1, min(pages, 10))
            rec["pages"] = pages
            rec["text_chars_per_page"] = round(per_page, 1)
            rec["needs_ocr"] = per_page < 100
        except Exception as exc:
            rec["needs_ocr"] = "error"
            rec["probe_error"] = str(exc)
        if rec["needs_ocr"] is True:
            need_ocr += 1
        updated += 1
        out.append(rec)

    with MANIFEST.open("w", encoding="utf-8") as fh:
        for rec in out:
            fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
    print(f"Probed {updated} files. {need_ocr} need OCR.")


def cmd_report(_: argparse.Namespace) -> None:
    if not MANIFEST.exists():
        sys.exit("No manifest yet.")
    records = [json.loads(l) for l in MANIFEST.read_text(encoding="utf-8").splitlines() if l.strip()]
    if not records:
        sys.exit("Manifest empty.")

    by_source: Dict[str, int] = defaultdict(int)
    by_year: Dict[str, int] = defaultdict(int)
    by_subject: Dict[str, int] = defaultdict(int)
    low_conf = 0
    ocr = 0
    total_bytes = 0

    for r in records:
        by_source[r["source_key"]] += 1
        inf = r.get("inferred", {})
        by_year[inf.get("year", {}).get("value") or "unknown"] += 1
        by_subject[inf.get("subject", {}).get("value") or "unknown"] += 1
        confs = [v.get("confidence", 0) for v in inf.values() if isinstance(v, dict)]
        if confs and min(confs) < 0.6:
            low_conf += 1
        if r.get("needs_ocr") is True:
            ocr += 1
        total_bytes += r.get("size_bytes", 0)

    print(f"\nTotal papers: {len(records)}   ({total_bytes / 1e6:.1f} MB)")
    print(f"Need OCR: {ocr}")
    print(f"Need metadata review (any field < 0.6 confidence): {low_conf}\n")

    for title, data in (("By institution", by_source), ("By year", by_year), ("By subject", by_subject)):
        print(title)
        for k, v in sorted(data.items(), key=lambda kv: (-kv[1], str(kv[0]))):
            print(f"  {str(k):<32} {v}")
        print()

    print("Coverage gaps (subject x year with no paper):")
    pairs = {(r.get("inferred", {}).get("subject", {}).get("value"),
              r.get("inferred", {}).get("year", {}).get("value")) for r in records}
    subjects = sorted({s for s, _ in pairs if s})
    years = sorted({y for _, y in pairs if y})
    gaps = [(s, y) for s in subjects for y in years if (s, y) not in pairs]
    for s, y in gaps[:40]:
        print(f"  {s} — {y}")
    if len(gaps) > 40:
        print(f"  ... and {len(gaps) - 40} more")


def main() -> None:
    ap = argparse.ArgumentParser(description="MedPrep question-paper harvester")
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("init", help="write a starter sources.yaml").set_defaults(fn=cmd_init)
    sub.add_parser("list", help="show registry status").set_defaults(fn=cmd_list)

    c = sub.add_parser("crawl", help="harvest papers")
    c.add_argument("--source", nargs="*", help="source keys; default all active")
    c.add_argument("--dry-run", action="store_true", help="discover and infer, download nothing")
    c.add_argument("--max-files", type=int, default=0)
    c.add_argument("--allow-unverified", action="store_true")
    c.add_argument("--force-source", action="store_true", help="include manual_review sources")
    c.set_defaults(fn=cmd_crawl)

    sub.add_parser("probe", help="OCR triage over downloaded PDFs").set_defaults(fn=cmd_probe)
    sub.add_parser("report", help="coverage and review-load summary").set_defaults(fn=cmd_report)

    args = ap.parse_args()
    ROOT.mkdir(parents=True, exist_ok=True)
    args.fn(args)


if __name__ == "__main__":
    main()
