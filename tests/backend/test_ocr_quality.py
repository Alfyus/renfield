"""Unit tests for the shared OCR-quality heuristics (utils/ocr_quality.py).

Covers both consumers: the ingest pipeline's binary ``is_text_garbled`` gate
and the Paperless audit's 1..5 ``score_ocr_quality``. The headline case is the
false-positive regression: well-formatted invoices (column padding, dotted
leaders) must score 5, not be docked for "Repeated characters" — that bug
falsely flagged 15/26 documents in the real audit corpus.
"""
import pytest

from utils.ocr_quality import is_text_garbled, score_ocr_quality

pytestmark = pytest.mark.unit


class TestIsTextGarbled:
    def test_normal_prose_not_garbled(self):
        text = "Dies ist ein ganz normaler deutscher Text mit vielen Leerzeichen darin."
        assert is_text_garbled(text) is False

    def test_no_space_mojibake_is_garbled(self):
        # ~260 chars, zero spaces => well under the 3% threshold.
        assert is_text_garbled("UmschauMarktplatzWiesbaden" * 10) is True

    def test_short_text_never_garbled(self):
        # Under the 50-char floor we don't judge.
        assert is_text_garbled("NoSpacesHere") is False

    def test_empty_not_garbled(self):
        assert is_text_garbled("") is False


class TestScoreOcrQuality:
    def test_clean_text_scores_five(self):
        text = (
            "Sehr geehrte Damen und Herren,\n\n"
            "hiermit senden wir Ihnen die Rechnung.\n\n"
            "Mit freundlichen Gruessen"
        )
        score, issues = score_ocr_quality(text)
        assert score == 5
        assert issues == "OK"

    def test_empty_scores_one(self):
        score, issues = score_ocr_quality("")
        assert score == 1
        assert "minimal" in issues.lower() or "no" in issues.lower()

    def test_minimal_scores_one(self):
        score, _ = score_ocr_quality("abc")
        assert score == 1

    def test_space_aligned_invoice_scores_five(self):
        """A column-aligned invoice (runs of >=6 spaces) is clean — score 5.

        This is the corpus shape that the old ``(.)\\1{5,}`` rule wrongly
        docked: aligned columns contain long space runs, but spaces count as
        text so neither the repeated-char nor the special-char rule fires.
        """
        text = (
            "Position      Menge      Einzelpreis      Gesamt\n"
            "Webhosting          1          12,00 EUR          12,00 EUR\n"
            "Domain .de          1           5,00 EUR           5,00 EUR\n"
            "Summe netto                                       17,00 EUR\n"
        )
        score, issues = score_ocr_quality(text)
        assert score == 5, issues
        assert issues == "OK"

    @pytest.mark.parametrize(
        "text",
        [
            # Column-aligned invoice line items: runs of >=6 spaces.
            "Position      Menge      Einzelpreis      Gesamt\n"
            "Webhosting          1          12,00 EUR          12,00 EUR\n",
            # Table-of-contents dotted leaders embedded in real prose.
            "Das Inhaltsverzeichnis dieses Dokuments listet alle Abschnitte.\n"
            "Einleitung und Vorwort des Autors ............................ 1\n"
            "Der ausfuehrliche Hauptteil mit allen Details .............. 5\n",
            # Form with underscore fill-in fields among normal labels.
            "Bitte tragen Sie hier Ihre vollstaendigen Daten leserlich ein.\n"
            "Name und Vorname der antragstellenden Person: ____________________\n"
            "Vollstaendige Anschrift inklusive Postleitzahl: ________________\n",
            # Section rule of equals signs surrounded by content.
            "Rechnung Nummer 2301 vom dritten Juni zweitausendsechsundzwanzig\n"
            "==================================\n"
            "Der faellige Betrag belaeuft sich auf achtzehn Euro insgesamt.\n",
        ],
    )
    def test_ordinary_formatting_not_flagged_as_repeated(self, text):
        """The false-positive regression: punctuation/whitespace runs are
        normal formatting and must NOT be scored as 'Repeated characters'.

        (Orthogonal rules like high-special-char ratio may still apply to
        punctuation-dense fragments — this test only asserts the repeated-char
        rule no longer false-positives on formatting runs.)
        """
        _, issues = score_ocr_quality(text)
        assert "repeated" not in issues.lower(), issues

    def test_genuine_stuck_glyph_is_flagged(self):
        """A long run of the SAME alphanumeric char IS a real OCR artifact."""
        text = "Normal readable text here, and then llllllllll appears mid-sentence."
        score, issues = score_ocr_quality(text)
        assert "repeated" in issues.lower()
        assert score < 5

    def test_garbled_no_spaces_flagged(self):
        text = "abcdefghijklmnopqrstuvwxyz" * 10
        score, issues = score_ocr_quality(text)
        assert score < 5
        assert "spaces" in issues.lower() or "garbled" in issues.lower()

    def test_high_special_char_ratio_flagged(self):
        text = "!!@@##$$%%^^&&**(()){{}}||\\//~~``" * 5
        score, issues = score_ocr_quality(text)
        assert score < 5
        assert "special" in issues.lower()

    def test_fragmented_short_lines_flagged(self):
        text = "\n".join(["ab cd ef"] * 20)
        score, issues = score_ocr_quality(text)
        assert score < 5
        assert "fragmented" in issues.lower() or "short" in issues.lower()

    def test_score_never_below_one(self):
        score, _ = score_ocr_quality("!@#$%^" * 50)
        assert score >= 1
