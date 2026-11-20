"""Compare structure outputs without treating typography as lost content."""
import argparse
import difflib
import json
import re
import unicodedata
from html.parser import HTMLParser

_TRANSLATE = str.maketrans({'–': '-', '—': '-', '−': '-', '‐': '-', '‑': '-', '’': "'", '‘': "'", '“': '"', '”': '"'})
_NUMBER = re.compile(r'(?<!\w)[+-]?\d+(?:[.,]\d+)*(?:%|‰)?')


def normalize(text):
    return ' '.join(unicodedata.normalize('NFKC', text).translate(_TRANSLATE).split())


def numbers(text):
    values = _NUMBER.findall(normalize(text))
    return [re.sub(r',(?=\d{3}(?:\D|$))', '', value) if re.fullmatch(r'[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?%?', value) else value for value in values]


def words(text):
    text = _NUMBER.sub(lambda match: numbers(match.group())[0], normalize(text))
    return re.findall(r'\w+', text.casefold(), flags=re.UNICODE)


def agreement(a, b):
    return difflib.SequenceMatcher(None, words(a), words(b), autojunk=False).ratio()


def same_cell(a, b):
    return numbers(a) == numbers(b) and agreement(a, b) >= 0.98


class Table(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.rows = []
        self.cell = None
        self.text = []

    def handle_starttag(self, tag, attrs):
        if tag == 'tr':
            self.rows.append([])
        elif tag in ('td', 'th'):
            if not self.rows:
                self.rows.append([])
            attributes = dict(attrs)
            self.cell = {'rowspan': attributes.get('rowspan', '1'), 'colspan': attributes.get('colspan', '1'), 'parts': []}
        elif tag == 'br' and self.cell is not None:
            self.cell['parts'].append(' ')

    def handle_endtag(self, tag):
        if tag in ('td', 'th') and self.cell is not None:
            value = self.cell
            self.rows[-1].append((value['rowspan'], value['colspan'], normalize(''.join(value['parts']))))
            self.cell = None

    def handle_data(self, data):
        self.text.append(data)
        if self.cell is not None:
            self.cell['parts'].append(data)


def compare_block(reference, candidate):
    a, b = reference.get('text', ''), candidate.get('text', '')
    structure = True
    if '<table' in a.lower() or '<table' in b.lower():
        left, right = Table(), Table()
        left.feed(a); right.feed(b)
        structure = [[cell[:2] for cell in row] for row in left.rows] == [[cell[:2] for cell in row] for row in right.rows]
        if structure:
            structure = all(same_cell(x[2], y[2]) for ar, br in zip(left.rows, right.rows) for x, y in zip(ar, br))
        a, b = ' '.join(left.text), ' '.join(right.text)
    elif reference.get('type') == 'chart':
        left = [[normalize(cell) for cell in row.split('|')] for row in a.splitlines() if row.strip()]
        right = [[normalize(cell) for cell in row.split('|')] for row in b.splitlines() if row.strip()]
        structure = [len(row) for row in left] == [len(row) for row in right]
        if structure:
            structure = all(same_cell(x, y) for ar, br in zip(left, right) for x, y in zip(ar, br))
    content_agreement = agreement(a, b)
    identity = reference.get('page') == candidate.get('page') and reference.get('type') == candidate.get('type')
    numeric = numbers(a) == numbers(b)
    return {'agreement': content_agreement, 'numbersEqual': numeric, 'relationshipsEqual': structure, 'identityEqual': identity,
            'passed': content_agreement >= 0.98 and numeric and structure and identity}


def compare(reference, candidate):
    blocks = [compare_block(a, b) for a, b in zip(reference['blocks'], candidate['blocks'])]
    same_pages = reference['pageCount'] == candidate['pageCount']
    same_count = len(reference['blocks']) == len(candidate['blocks'])
    return {'passed': same_pages and same_count and all(block['passed'] for block in blocks),
            'pagesEqual': same_pages, 'blockCountEqual': same_count, 'blocks': blocks}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('reference'); parser.add_argument('candidate')
    args = parser.parse_args()
    with open(args.reference) as source: reference = json.load(source)
    with open(args.candidate) as source: candidate = json.load(source)
    result = compare(reference, candidate)
    print(json.dumps(result, indent=2))
    raise SystemExit(0 if result['passed'] else 1)
