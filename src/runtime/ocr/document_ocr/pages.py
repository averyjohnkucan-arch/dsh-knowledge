"""Read source documents in page order and retain lossless working views."""

from dataclasses import dataclass
import hashlib
import math
from pathlib import Path
import re
import shutil
import statistics

from PIL import Image, ImageOps
from . import ruled


IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".webp", ".bmp", ".gif", ".ppm", ".pgm", ".jp2"}
SUPPORTED = IMAGE_SUFFIXES | {".pdf"}
MAX_RENDER_PIXELS = 48_000_000


def sha_file(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


@dataclass
class Page:
    number: int
    image: Path | None
    text: str | None
    details: dict


def visible_horizontal_text(page):
    for span in page.get_texttrace():
        color = span["color"]
        components = (color,) if isinstance(color, (int, float)) else color
        if (span["type"] != 0 or span["opacity"] < .98 or span["dir"] != (1, 0)
                or not components or max(components) > .72 or span.get("bidi_lvl", 0)):
            return False
    return True


def native_prose(page, operations=None):
    """Use visible, horizontal, single-column typeset text on text-only pages."""
    import pymupdf
    if operations is None:
        operations = {op[0] for op in page.get_bboxlog()}
    if (page.first_annot or page.first_widget or page.rotation
            or operations != {"fill-text"} or not visible_horizontal_text(page)):
        return None
    blocks = page.get_text("dict", sort=True, flags=pymupdf.TEXT_PRESERVE_WHITESPACE)["blocks"]
    content, sizes, lines = [], [], []
    for block in blocks:
        paragraph = []
        for line in block.get("lines", []):
            spans = line["spans"]
            value = "".join(s["text"] for s in spans).strip()
            if not value:
                continue
            # Superscripts, font switches within a word, and symbol fonts often
            # encode formulas whose layout carries meaning in the Markdown.
            if (any(s["flags"] & 1 or "symbol" in s["font"].lower() for s in spans)
                    or len({(s["font"], round(s["size"], 1)) for s in spans}) > 1
                    or any(c in value for c in "∫∑√∏∂∮")):
                return None
            box = line["bbox"]
            if (line["dir"] != (1, 0) or "\ufffd" in value or not value.isprintable()
                    or re.search(r"\S {4,}\S", value)
                    or box[0] < -1 or box[1] < -1 or box[2] > page.rect.width + 1
                    or box[3] > page.rect.height + 1):
                return None
            for prev, current in zip(spans, spans[1:]):
                if current["bbox"][0] - prev["bbox"][2] > max(10, current["size"]):
                    return None
            center = (box[1] + box[3]) / 2
            lines.append((center, box[3]-box[1], box[0], box[2]))
            size = max(s["size"] for s in spans)
            sizes.append(size)
            paragraph.append((value, size))
        if paragraph:
            content.append(paragraph)
    if not content or sum(len(v) for block in content for v, _ in block) < 20:
        return None
    ordered = sorted(lines)
    for first, second in zip(ordered, ordered[1:]):
        if second[0] - first[0] < .55 * min(first[1], second[1]):
            return None
    # Disjoint horizontal runs can indicate columns with staggered baselines.
    if max(line[2] for line in lines) > min(line[3] for line in lines):
        return None
    typical = statistics.median(sizes)
    paragraphs = []
    for block in content:
        if len(block) == 1 and block[0][1] >= 1.3 * typical and len(block[0][0]) <= 140:
            paragraphs.append("# " + block[0][0])
        else:
            paragraphs.append("\n".join(value for value, _ in block))
    return "\n\n".join(paragraphs) + "\n"


def prepare(source, folder, *, ocr_only, password, dpi):
    folder.mkdir(parents=True, exist_ok=True)
    with source.open("rb") as stream:
        is_pdf = source.suffix.lower() == ".pdf" or stream.read(5) == b"%PDF-"
    if is_pdf:
        import pymupdf
        with pymupdf.open(source) as pdf:
            if pdf.needs_pass and not pdf.authenticate(password or ""):
                raise ValueError(f"{source.name} requires a valid --password-file.")
            if not len(pdf):
                raise ValueError(f"{source.name} has no pages.")
            for index, page in enumerate(pdf):
                number = index + 1
                operations = set() if ocr_only else {op[0] for op in page.get_bboxlog()}
                if not ocr_only and not operations and not page.first_annot and not page.first_widget:
                    yield Page(number, None, "", {"method": "native_pdf", "structure": "blank",
                                                  "pymupdf": pymupdf.__version__})
                    continue
                text = None if ocr_only else native_prose(page, operations)
                structure = "prose"
                if text is None and not ocr_only:
                    if operations == {"stroke-path", "fill-text"} and visible_horizontal_text(page):
                        text = ruled.extract(page, operations)
                        structure = "ruled_table"
                if text is not None:
                    yield Page(number, None, text, {"method": "native_pdf", "structure": structure,
                                                    "pymupdf": pymupdf.__version__})
                    continue
                rect = page.rect
                area = rect.width * rect.height
                if area <= 0:
                    raise ValueError(f"{source.name} page {number} has invalid dimensions.")
                scale = min(dpi / 72, math.sqrt(MAX_RENDER_PIXELS / area))
                image = folder / f"{number:05}.png"
                pix = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), colorspace=pymupdf.csRGB, alpha=False)
                pix.save(str(image))
                yield Page(number, image, None, {"method": "deepseek_ocr2", "dpi": round(scale * 72, 3),
                                                   "pixels": [pix.width, pix.height], "pymupdf": pymupdf.__version__})
        return
    with Image.open(source) as frames:
        for index in range(getattr(frames, "n_frames", 1)):
            frames.seek(index)
            number = index + 1
            if (index == 0 and getattr(frames, "n_frames", 1) == 1 and frames.format in ("JPEG", "PNG")
                    and frames.mode in ("L", "RGB") and "transparency" not in frames.info
                    and frames.getexif().get(274, 1) == 1):
                image = folder / (f"{number:05}" + (".jpg" if frames.format == "JPEG" else ".png"))
                shutil.copyfile(source, image)
                size = frames.size
            else:
                frame = ImageOps.exif_transpose(frames).convert("RGBA")
                canvas = Image.new("RGB", frame.size, "white")
                canvas.paste(frame, mask=frame.getchannel("A"))
                image = folder / f"{number:05}.png"
                canvas.save(image)
                size = canvas.size
            yield Page(number, image, None, {"method": "deepseek_ocr2", "pixels": list(size), "frame": number})
