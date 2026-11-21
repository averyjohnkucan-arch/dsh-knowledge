"""Recognize implausible character repetition in OCR output."""
import re


def repeated_han(text):
    """Flag long identical Han characters in prose while preserving the source transcription."""
    prose = re.sub(r"<table\b.*?</table>", "", text, flags=re.I | re.S)
    for match in re.finditer(r"([\u3400-\u9fff])\1{15,}", prose):
        char = match.group(1)
        if char not in "〇零一":
            return {"character": char, "count": len(match.group())}
    return None
