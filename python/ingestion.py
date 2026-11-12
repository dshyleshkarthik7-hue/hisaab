"""Official-source ingestion with human validation gate.

Fetches public pages from ITD / RBI / CBIC when network is available,
stores candidate snapshots, and only promotes them after explicit approval.
Never silently changes active tax or rate rules.
"""
from __future__ import annotations
import hashlib
import json
import os
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DATA_DIR = Path(os.environ.get("HISAAB_DATA_DIR", Path(__file__).resolve().parent / "data"))
CANDIDATES = DATA_DIR / "candidates"
APPROVED = DATA_DIR / "approved"
SOURCES = {
    "income_tax": {
        "url": "https://www.incometax.gov.in/",
        "label": "Income Tax Department",
        "cadence": "On official notification",
    },
    "rbi": {
        "url": "https://www.rbi.org.in/",
        "label": "Reserve Bank of India",
        "cadence": "After policy announcements",
    },
    "cbic_gst": {
        "url": "https://cbic-gst.gov.in/",
        "label": "CBIC GST",
        "cadence": "On official notification",
    },
    "sebi": {
        "url": "https://www.sebi.gov.in/",
        "label": "SEBI",
        "cadence": "Weekly education monitor",
    },
}


def _ensure_dirs() -> None:
    CANDIDATES.mkdir(parents=True, exist_ok=True)
    APPROVED.mkdir(parents=True, exist_ok=True)


def fetch_source(source_id: str, timeout: float = 12.0) -> dict[str, Any]:
    if source_id not in SOURCES:
        raise ValueError(f"Unknown source: {source_id}")
    meta = SOURCES[source_id]
    req = urllib.request.Request(
        meta["url"],
        headers={"User-Agent": "HisaabIngestion/3.0 (+https://localhost; educational-monitor)"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read()
            status = resp.status
            ctype = resp.headers.get("Content-Type", "")
    except Exception as exc:
        return {
            "source_id": source_id,
            "status": "fetch_failed",
            "error": str(exc),
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            **meta,
        }
    digest = hashlib.sha256(body).hexdigest()
    # Store only metadata + hash + truncated text sample (privacy / size)
    sample = body[:4000].decode("utf-8", errors="replace")
    record = {
        "source_id": source_id,
        "status": "candidate",
        "http_status": status,
        "content_type": ctype,
        "sha256": digest,
        "bytes": len(body),
        "sample": sample,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "approved": False,
        **meta,
    }
    _ensure_dirs()
    path = CANDIDATES / f"{source_id}_{digest[:12]}.json"
    path.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
    record["candidate_path"] = str(path)
    return record


def list_candidates() -> list[dict[str, Any]]:
    _ensure_dirs()
    out = []
    for p in sorted(CANDIDATES.glob("*.json")):
        try:
            out.append(json.loads(p.read_text(encoding="utf-8")))
        except Exception:
            continue
    return out


def approve_candidate(filename: str, reviewer: str = "operator") -> dict[str, Any]:
    _ensure_dirs()
    src = CANDIDATES / filename
    if not src.is_file():
        raise FileNotFoundError(filename)
    data = json.loads(src.read_text(encoding="utf-8"))
    data["approved"] = True
    data["approved_at"] = datetime.now(timezone.utc).isoformat()
    data["approved_by"] = reviewer
    data["status"] = "approved"
    dest = APPROVED / filename
    dest.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return data


def monitor_all() -> list[dict[str, Any]]:
    """Fetch all configured sources into the candidate queue."""
    results = []
    for sid in SOURCES:
        results.append(fetch_source(sid))
    return results


def status_summary() -> dict[str, Any]:
    _ensure_dirs()
    return {
        "sources": list(SOURCES.keys()),
        "candidates": len(list(CANDIDATES.glob("*.json"))),
        "approved": len(list(APPROVED.glob("*.json"))),
        "note": "Candidates never affect live tax/rate rules until approved and mapped into tax_engine / data_service.",
    }
