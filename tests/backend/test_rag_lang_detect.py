"""detect_document_language — language routing for post_document_ingest.

Renfield stores no per-document language, so the Schicht A + KG extraction
hooks otherwise always run under settings.default_language. This resolves the
language from the field text (langdetect) and clamps to languages that have
prompt variants ({de, en}), falling back to the given default otherwise.
"""
from __future__ import annotations

import pytest

from services.rag_service import detect_document_language

EN = (
    "This is a fairly long English paragraph about an invoice and the payment "
    "obligation it describes, with enough words for reliable detection."
)
DE = (
    "Dies ist ein hinreichend langer deutscher Absatz über eine Rechnung und "
    "die darin beschriebene Zahlungsverpflichtung mit genügend Wörtern."
)
FR = (
    "Ceci est un paragraphe français suffisamment long concernant une facture "
    "et l'obligation de paiement qu'elle décrit, avec assez de mots."
)


class TestDetectDocumentLanguage:
    def test_english_detected(self):
        assert detect_document_language(EN, "de") == "en"

    def test_german_detected(self):
        assert detect_document_language(DE, "en") == "de"

    def test_unsupported_language_falls_back_to_default(self):
        # French has no prompt variant → clamp to the caller's default.
        assert detect_document_language(FR, "de") == "de"

    @pytest.mark.parametrize("text", ["", "   ", "kurz", "Rechnung 2026"])
    def test_short_or_empty_text_uses_default(self, text):
        assert detect_document_language(text, "de") == "de"
        assert detect_document_language(text, "en") == "en"

    def test_none_text_uses_default(self):
        assert detect_document_language(None, "de") == "de"  # type: ignore[arg-type]
