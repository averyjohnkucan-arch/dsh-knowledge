"""Keep detected OCR words on their printed line without mixing wide columns."""
import re

def assemble_ocr_text(texts, boxes=None):
    texts = list(texts or [])
    if boxes is None or len(boxes) != len(texts):
        return '\n'.join(texts)
    lines = []
    previous = None
    for text, box in zip(texts, boxes):
        text = str(text).strip()
        if not text:
            continue
        xs, ys = [float(p[0]) for p in box], [float(p[1]) for p in box]
        x, right = min(xs), max(xs)
        y, height = (min(ys) + max(ys)) / 2, max(1., max(ys) - min(ys))
        if previous is not None:
            px, pright, py, ph = previous
            same_line = abs(y - py) <= min(height, ph) * .4 and x >= px and x - pright <= max(height, ph) * 4
            if same_line:
                sep = '' if re.search(r'[\u3400-\u9fff]$', lines[-1]) and re.match(r'[\u3400-\u9fff]', text) else ' '
                lines[-1] += sep + text
            else:
                lines.append(text)
        else:
            lines.append(text)
        previous = (x, right, y, height)
    return '\n'.join(lines).replace('\u00ad\n', '').replace('\u00ad', '')
