"""Shared OCR-quality heuristics.

Two consumers, two questions — kept in one module so the definition of
"garbled" can never drift between them again:

* ``is_text_garbled`` — the binary gate the *ingest* pipeline uses to decide
  whether to throw away an embedded PDF text layer and re-run full-page OCR
  (``DocumentProcessor``). Space-ratio only; deliberately narrow so a clean
  text layer is never needlessly re-rasterized.
* ``score_ocr_quality`` — the 1..5 advisory score the *Paperless audit* shows
  per document. Multi-signal, tuned for already-OCR'd content, and
  intentionally does NOT penalize ordinary table formatting.

Both read the same ``rag_ocr_space_threshold``.
"""
from __future__ import annotations

import logging

from utils.config import settings

logger = logging.getLogger(__name__)

# Below this we don't judge — too little signal either way.
_MIN_JUDGEABLE_CHARS = 50

# NB: there is intentionally NO "repeated characters" rule. The original
# ``(.)\1{5,}`` heuristic was a net negative: measured against the real audit
# corpus it produced ~19 flags and ZERO confirmed OCR defects — first on column
# padding / dotted leaders, then (even restricted to long same-alphanumeric
# runs) on legitimate content: redaction masks (``XXXXXXXX``) and zero-padded
# numbers (``00000000``). Genuine garbled OCR is caught by the space-ratio,
# special-char-ratio, and fragmentation signals below, which co-fire on real
# failures; an isolated same-char run is not a reliable predictor on its own.


def is_text_garbled(text: str) -> bool:
    """True if an embedded text layer looks mojibake'd (too few spaces).

    PDFs with a broken text layer run words together
    ('UmschauMarktplatz13Wiesbaden'); normal prose is ~15-25% spaces. Below
    ``rag_ocr_space_threshold`` (default 3%) the ingest pipeline re-runs
    full-page OCR. Short inputs (<50 chars) are never judged garbled.
    """
    if not text or len(text) < _MIN_JUDGEABLE_CHARS:
        return False
    space_ratio = text.count(" ") / len(text)
    garbled = space_ratio < settings.rag_ocr_space_threshold
    if garbled:
        logger.warning(
            "Garbled embedded text detected (space ratio=%.1f%% < threshold=%.1f%%) "
            "— re-running with force_full_page_ocr",
            space_ratio * 100,
            settings.rag_ocr_space_threshold * 100,
        )
    return garbled


def score_ocr_quality(text: str) -> tuple[int, str]:
    """Rate already-OCR'd document content 1 (worst) .. 5 (clean).

    Returns ``(score, reason)`` where ``reason`` is "OK" or a "; "-joined list
    of detected issues; each issue costs one point (floor 1). Calibrated for
    Paperless content, NOT raw PDF text layers.
    """
    if not text or len(text.strip()) < 20:
        return 1, "No/minimal OCR text"

    issues: list[str] = []
    n = len(text)

    # Garbled mojibake: words run together, almost no spaces.
    if text.count(" ") / n < settings.rag_ocr_space_threshold:
        issues.append("Very few spaces (garbled)")

    # Mostly non-text (symbols/control chars) => bad recognition.
    alnum_or_space = sum(c.isalnum() or c.isspace() for c in text)
    if alnum_or_space / n < 0.6:
        issues.append("High special char ratio")

    # Many very short lines => fragmented OCR.
    lines = [ln for ln in text.split("\n") if ln.strip()]
    if lines:
        avg_line_len = sum(len(ln) for ln in lines) / len(lines)
        if avg_line_len < 10 and len(lines) > 5:
            issues.append("Fragmented text (very short lines)")

    return max(1, 5 - len(issues)), "; ".join(issues) or "OK"
