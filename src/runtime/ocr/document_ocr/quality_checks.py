"""Conservative output diagnostics; never cancel decoding or discard raw output.

Call assess_output separately for each independently generated region. These checks
identify malformed output and review candidates, not OCR correctness/confidence.
The only offered repair is a missing final outer table close; it is never applied
implicitly. structural_errors and review_reasons always describe the raw output.
"""
from html.parser import HTMLParser
import re


_GROUNDING = re.compile(r"<\|(ref|det)\|>.*?<\|/\1\|>", re.S)
_SPECIAL = re.compile(r"<\|(?:/?(?:ref|det)|grounding|endoftext)\|>")
_TRACKED = {"table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption", "colgroup"}
_PRESENTATIONAL = {"p", "div", "br", "span", "b", "i", "strong", "em", "u", "s",
    "del", "ins", "sub", "sup", "ul", "ol", "li", "pre", "code", "a", "img",
    "blockquote", "hr", "font", "center", "small", "big", "h1", "h2", "h3",
    "h4", "h5", "h6", "html", "body"}
_PARENTS = {
    "table": {None, "td", "th"},
    "thead": {"table"}, "tbody": {"table"}, "tfoot": {"table"},
    "tr": {"table", "thead", "tbody", "tfoot"},
    "td": {"tr"}, "th": {"tr"},
    "caption": {"table"}, "colgroup": {"table"},
}


def _meaningful(value):
    return any(character.isalnum() for character in value)


class _Structure(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.errors = []
        self.parts = []
        self.prose = []
        self.table_count = 0
        self.row_count = 0
        self.closed_rows = 0
        self.cells = []
        self.active_cells = []

    def _error(self, code):
        if code not in self.errors:
            self.errors.append(code)

    def handle_starttag(self, tag, attrs):
        if tag == "col":
            if not self.stack or self.stack[-1] not in {"table", "colgroup"}:
                self._error("invalid_parent:col")
            return
        if tag not in _TRACKED:
            if tag not in _PRESENTATIONAL:
                # HTMLParser otherwise swallows math such as x<A_n and y>B_n
                # as an unknown start tag. Keep its exact source syntax.
                self.handle_data(self.get_starttag_text() or ("<" + tag + ">"))
                return
            if tag in {"p", "div", "br", "li", "h1", "h2", "h3", "h4", "h5", "h6"}:
                self.parts.append("\n")
                if "table" not in self.stack:
                    self.prose.append("\n")
            return
        parent = self.stack[-1] if self.stack else None
        if parent not in _PARENTS[tag]:
            self._error(f"invalid_parent:{tag}")
        self.stack.append(tag)
        self.parts.append(" ")
        if tag == "table":
            self.table_count += 1
            self.prose.append("\n[TABLE_BOUNDARY]\n")
        elif tag == "tr":
            self.row_count += 1
        elif tag in {"td", "th"}:
            self.cells.append([])
            self.active_cells.append(len(self.cells) - 1)

    def handle_startendtag(self, tag, attrs):
        if tag in _TRACKED:
            self._error(f"self_closing_structural_tag:{tag}")
            self.handle_starttag(tag, attrs)
            self.handle_endtag(tag)
        else:
            self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag):
        if tag not in _TRACKED:
            if tag not in _PRESENTATIONAL and tag != "col":
                self.handle_data("</" + tag + ">")
            return
        self.parts.append(" ")
        if not self.stack:
            self._error(f"unexpected_close:{tag}")
            return
        if self.stack[-1] != tag:
            self._error(f"misnested_close:{tag}")
            # Do not use HTML's implicit repair or a later region to hide the error.
            return
        self.stack.pop()
        if tag in {"td", "th"}:
            self.active_cells.pop()
        elif tag == "tr":
            self.closed_rows += 1
        elif tag == "table":
            self.prose.append("\n[TABLE_BOUNDARY]\n")

    def handle_data(self, data):
        self.parts.append(data)
        if self.active_cells:
            self.cells[self.active_cells[-1]].append(data)
        if "table" not in self.stack:
            self.prose.append(data)
        elif _meaningful(data) and not any(tag in {"td", "th", "caption"} for tag in self.stack):
            self._error("text_outside_table_cell_or_caption")


def _parse(text):
    parser = _Structure()
    try:
        parser.feed(_SPECIAL.sub("", _GROUNDING.sub("", text)))
        parser.close()
    except (AssertionError, ValueError) as exc:
        parser._error("html_parse_error:" + type(exc).__name__)
    return parser


def _long_prose_repeat(text, minimum_distinct_words=4):
    """Warn on >=6 consecutive blocks and >=72 words; numeric/table data exempt.

    Candidate periods come from repeated four-token anchors, keeping the check
    small for ordinary prose. Table boundaries prevent matching across tables.
    """
    for prose in text.split("[TABLE_BOUNDARY]"):
        words = re.findall(r"\w+(?:['’\-]\w+)*", prose.lower())
        positions = {}
        for index in range(max(0, len(words) - 3)):
            anchor = tuple(words[index:index + 4])
            prior = positions.setdefault(anchor, [])
            # Period at most64 words; earlier anchors cannot be relevant.
            while prior and index - prior[0] > 64:
                prior.pop(0)
            for start in prior:
                period = index - start
                if period < 3 or start + 6 * period > len(words):
                    continue
                unit = words[start:index]
                alphabetic = {word for word in unit if any(c.isalpha() for c in word)}
                if len(alphabetic) < minimum_distinct_words:
                    continue
                count = 1
                while words[start + count * period:start + (count + 1) * period] == unit:
                    count += 1
                if count >= 6 and count * period >= 72:
                    return {"unit_words": period, "consecutive_repetitions": count,
                            "repeated_words": count * period}
            prior.append(index)
    return None


def assess_output(text, finish_reason, error=None):
    """Return source-independent diagnostics and an optional unapplied repair.

    complete_decode means only a normal stop without request error. Empty output
    must be reconciled with a separate source blank-page guard. Raw structural
    errors remain reported even when a conservative repair candidate is offered.
    """
    if not isinstance(text, str):
        raise TypeError("text must be a string")
    parser = _parse(text)
    unclosed = [f"unclosed_tag:{tag}" for tag in dict.fromkeys(parser.stack)]
    structural_errors = list(dict.fromkeys(parser.errors + unclosed))
    meaningful_text = re.sub(r"\s+", " ", "".join(parser.parts)).strip()
    nonempty_cells = sum(_meaningful("".join(cell)) for cell in parser.cells)
    complete_decode = finish_reason == "stop" and error is None
    reasons = []
    if error is not None:
        reasons.append("request_error")
    if finish_reason != "stop":
        reasons.append("incomplete_decode")
    if structural_errors:
        reasons.append("malformed_table_structure")
    if not _meaningful(meaningful_text):
        reasons.append("no_meaningful_text_requires_source_check")
    if parser.table_count and not nonempty_cells:
        reasons.append("empty_table_requires_source_check")
    repetition = _long_prose_repeat("".join(parser.prose))
    if repetition:
        reasons.append("long_repeated_prose_requires_source_check")
    result = {
        "raw_text": text, "complete_decode": complete_decode,
        "structural_errors": structural_errors, "review_reasons": reasons,
        "meaningful_text": meaningful_text,
        "has_meaningful_text": _meaningful(meaningful_text),
        "table_count": parser.table_count, "table_cells": len(parser.cells),
        "nonempty_table_cells": nonempty_cells,
        "repetition_warning": repetition, "repair_labels": [],
        "repair_applied": False,
    }
    # No missing cells/rows, misnesting, multiple/nested tables, trailing prose,
    # truncated decode or nonwhitespace text outside cells may be repaired.
    if (complete_decode and not parser.errors and parser.stack == ["table"]
            and parser.table_count == 1 and parser.closed_rows == parser.row_count
            and parser.closed_rows > 0 and parser.cells):
        repaired = text.rstrip() + "</table>" + text[len(text.rstrip()):]
        candidate = _parse(repaired)
        candidate_text = re.sub(r"\s+", " ", "".join(candidate.parts)).strip()
        if not candidate.errors and not candidate.stack and candidate_text == meaningful_text:
            result["repaired_text"] = repaired
            result["repair_labels"] = ["append_single_missing_outer_table_close"]
            result["repaired_structural_errors"] = []
    return result
