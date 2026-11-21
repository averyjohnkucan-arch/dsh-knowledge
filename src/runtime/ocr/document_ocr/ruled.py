"""Extract visible PDF text from a single, fully ruled rectangular table."""
from bisect import bisect_right
from collections import defaultdict
from html import escape
import unicodedata


def grid_edges(page):
    horizontal, vertical = defaultdict(list), defaultdict(list)
    for path in page.get_drawings():
        if (path["type"] != "s" or path.get("layer") or path.get("stroke_opacity", 0) < .98
                or path.get("dashes") not in (None, "[] 0") or not 0 <= path["width"] <= 3
                or not path["color"] or max(path["color"]) > .72):
            return None
        for item in path["items"]:
            if item[0] == "re":
                x0, y0, x1, y1 = (round(v, 3) for v in item[1])
                horizontal[y0].append((x0, x1))
                horizontal[y1].append((x0, x1))
                vertical[x0].append((y0, y1))
                vertical[x1].append((y0, y1))
            elif item[0] == "l" and not path.get("closePath"):
                x0, y0 = (round(v, 3) for v in item[1])
                x1, y1 = (round(v, 3) for v in item[2])
                if y0 == y1 and x0 != x1:
                    horizontal[y0].append(tuple(sorted((x0, x1))))
                elif x0 == x1 and y0 != y1:
                    vertical[x0].append(tuple(sorted((y0, y1))))
                else:
                    return None
            else:
                return None
    xs, ys = sorted(vertical), sorted(horizontal)
    if not (3 <= len(xs) <= 128 and 3 <= len(ys) <= 256 and (len(xs)-1)*(len(ys)-1) <= 8192):
        return None
    for coords, segments in ((xs, horizontal), (ys, vertical)):
        if any(b-a < 4 for a, b in zip(coords, coords[1:])):
            return None
        for ranges in segments.values():
            last = coords[0]
            for a, b in sorted(ranges):
                if a > last + .4 or a < coords[0] - .4 or b > coords[-1] + .4:
                    return None
                last = max(last, b)
            if last < coords[-1] - .4:
                return None
    return xs, ys


def lines(words, *, inside):
    """Join words on one baseline, rejecting overlaps or ambiguous outside columns."""
    result, band = [], []
    for word in sorted(words, key=lambda w: ((w[1] + w[3]) / 2, w[0])):
        height = word[3] - word[1]
        if band and abs((word[1]+word[3]-band[0][1]-band[0][3])/2) > .35*min(height, band[0][3]-band[0][1]):
            result.append(band)
            band = []
        band.append(word)
    if band:
        result.append(band)
    text = []
    for row in result:
        ordered = sorted(row, key=lambda w: w[0])
        for left, right in zip(ordered, ordered[1:]):
            gap = right[0] - left[2]
            if gap < -.25 or (not inside and gap > 2.5*(right[3]-right[1])):
                return None
        text.append(" ".join(w[4] for w in ordered))
    return text


def extract(page, operations):
    if ("stroke-path" not in operations or "fill-text" not in operations
            or operations - {"stroke-path", "fill-text"} or page.rotation or page.first_widget or page.first_annot):
        return None
    edges = grid_edges(page)
    if edges is None:
        return None
    xs, ys = edges
    if xs[0] < 0 or ys[0] < 0 or xs[-1] > page.rect.width or ys[-1] > page.rect.height:
        return None
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            if line["dir"] != (1, 0) or any(s["flags"] & 1 or "symbol" in s["font"].lower() for s in line["spans"]):
                return None
    before, after, cells = [], [], defaultdict(list)
    for w in page.get_text("words"):
        x0, y0, x1, y1, value = w[:5]
        if (not value.isprintable() or any(c == "\ufffd" or unicodedata.category(c) == "Co" for c in value)
                or x0 < 0 or y0 < 0 or x1 > page.rect.width or y1 > page.rect.height):
            return None
        if y1 <= ys[0]:
            before.append(w)
        elif y0 >= ys[-1]:
            after.append(w)
        else:
            col = bisect_right(xs, (x0+x1)/2)-1
            row = bisect_right(ys, (y0+y1)/2)-1
            if (not 0 <= row < len(ys)-1 or not 0 <= col < len(xs)-1
                    or x0 < xs[col] or x1 > xs[col+1] or y0 < ys[row] or y1 > ys[row+1]):
                return None
            cells[row, col].append(w)
    if (len(cells) < (len(xs)-1)*(len(ys)-1)*.25
            or len({r for r,c in cells}) < 2 or len({c for r,c in cells}) < 2):
        return None
    intro, ending = lines(before, inside=False), lines(after, inside=False)
    if intro is None or ending is None:
        return None
    table = ["<table>"]
    for row in range(len(ys)-1):
        rendered = []
        for col in range(len(xs)-1):
            value = lines(cells[row, col], inside=True)
            if value is None:
                return None
            rendered.append("<td>" + "<br>".join(escape(line) for line in value) + "</td>")
        table.append("<tr>" + "".join(rendered) + "</tr>")
    table.append("</table>")
    sections = ["\n".join(intro), "\n".join(table), "\n".join(ending)]
    return "\n\n".join(s for s in sections if s) + "\n"
