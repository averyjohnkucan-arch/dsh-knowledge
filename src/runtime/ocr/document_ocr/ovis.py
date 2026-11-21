"""Run the optional OvisOCR2 page parser through the local llama.cpp server."""
import base64
from collections import Counter
import hashlib
import json
import mimetypes
import re
import time
import urllib.error
import urllib.request

from . import runtime
from .recovery import repeated_han

PROMPT = (runtime.ROOT / 'runtime-support/ovis-prompt.txt').read_text(encoding='utf-8').removesuffix('\n')
FIGURE = re.compile(r'<img\s+src=["\']images/bbox_(\d+)_(\d+)_(\d+)_(\d+)\.jpg["\']\s*/?>', re.I)
FENCE = re.compile(r'^[ \t]{0,3}(?P<marker>`{3,}|~{3,})[^\n]*\n.*?(?:^[ \t]{0,3}(?P=marker)[ \t]*(?=\n|$)|\Z)', re.M | re.S)
PARAGRAPH_LOOP = re.compile(r'(?:^|\n\n)([^\n<>|`$]{24,600})(?:\n\n\1){7}(?=\n\n|$)')
VERBATIM = re.compile(r'<table\b.*?(?:</table\s*>|\Z)|```.*?(?:```|\Z)', re.I | re.S)


def fingerprint():
    manifest = json.loads((runtime.ROOT / 'runtime-support/models-ovis.json').read_bytes())
    upstream = manifest['models'][1]
    return {'ocr_model': {'repository': upstream['repo'], 'revision': upstream['revision'],
                          'format': 'GGUF' if runtime.COMPACT else 'BF16 safetensors'},
            'config': {'prompt_sha256': hashlib.sha256(PROMPT.encode()).hexdigest(),
                       'max_tokens': 16384, 'temperature': 0, 'reasoning': False,
                       'page_parser': 'OvisOCR2', 'figure_coordinates': '0 through 1000',
                       'retry_repeat_penalty': 1.10, 'retry_repeat_last_n': 512 if runtime.COMPACT else None,
                       'processor_pixel_bounds': None if runtime.COMPACT else [448**2, 2880**2]}}


def render(raw):
    """Separate recognized illustration boxes from the user-visible transcription."""
    literals = [(m.start(), m.end()) for m in FENCE.finditer(raw)]
    parts, figures = [], []
    cursor = 0
    invalid = False
    for match in FIGURE.finditer(raw):
        if any(left <= match.start() < right for left, right in literals):
            continue
        left, top, right, bottom = map(int, match.groups())
        if 0 <= left < right <= 1000 and 0 <= top < bottom <= 1000:
            figures.append([left, top, right, bottom])
        else:
            invalid = True
        parts.append(raw[cursor:match.start()])
        cursor = match.end()
        preceding = raw[match.start()-1:match.start()]
        if match.start() == 0 or preceding == '\n':
            if raw.startswith('\n\n', cursor):
                cursor += 2
            elif raw.startswith('\n', cursor):
                cursor += 1
        elif preceding.isalnum() and raw[cursor:cursor+1].isalnum():
            parts.append(' ')
    parts.append(raw[cursor:])
    return ''.join(parts).strip(), figures, invalid


def loop_in(text):
    # Keep offsets in the original response while excluding literal and tabular material.
    text = VERBATIM.sub(lambda m: ' ' * len(m[0]), text)
    for match in PARAGRAPH_LOOP.finditer(text):
        paragraph = match[1]
        if sum(c.isalpha() for c in paragraph) >= 18 and len(re.findall(r'\d+(?:[.,]\d+)*', paragraph)) < 2:
            return {'kind': 'paragraph', 'offset': match.start(1), 'sample': paragraph}
    han = repeated_han(text)
    if han:
        return {'kind': 'han', 'offset': text.find(han['character'] * han['count']), **han}
    return None


def decode(path, endpoint, retry):
    from .quality_checks import assess_output

    began = time.monotonic()
    mime = mimetypes.guess_type(path.name)[0] or 'image/png'
    data = base64.b64encode(path.read_bytes()).decode('ascii')
    content = [{'type': 'image_url', 'image_url': {'url': f'data:{mime};base64,{data}'}},
               {'type': 'text', 'text': PROMPT}]
    body = {'model': runtime.MODEL_ID, 'messages': [{'role': 'user', 'content': content}], 'temperature': 0,
            'max_tokens': 16384, 'stream': True,
            'chat_template_kwargs': {'enable_thinking': False}}
    if runtime.COMPACT:
        body['cache_prompt'] = False
        if retry:
            body.update(repeat_penalty=1.10, repeat_last_n=512)
    else:
        body['mm_processor_kwargs'] = {'images_kwargs': {'min_pixels': 448**2, 'max_pixels': 2880**2}}
        if retry:
            body['repetition_penalty'] = 1.10
    request = urllib.request.Request(endpoint.rstrip('/') + '/v1/chat/completions', data=json.dumps(body).encode(),
                                     headers={'Content-Type': 'application/json'})
    pieces = []
    length = checked = 0
    finish, error, repeated = None, None, None
    try:
        with urllib.request.urlopen(request, timeout=240) as response:
            for line in response:
                if not line.startswith(b'data:'):
                    continue
                payload = line[5:].strip()
                if payload == b'[DONE]':
                    break
                event = json.loads(payload)
                if event.get('error'):
                    error = str(event['error'])
                    break
                for choice in event.get('choices', []):
                    part = choice.get('delta', {}).get('content') or ''
                    pieces.append(part)
                    length += len(part)
                    finish = choice.get('finish_reason') or finish
                if length - checked >= 128:
                    checked = length
                    repeated = loop_in(''.join(pieces))
                    if repeated:
                        finish = 'repeated_prose_abort'
                        break
                if time.monotonic() - began > 240:
                    finish = 'client_deadline'
                    break
    except (OSError, ValueError) as exc:
        error = f'{type(exc).__name__}: {exc}'
    raw = ''.join(pieces)
    text, figures, invalid_figure = render(raw)
    assessment = assess_output(text, finish, error)
    repeated = repeated or loop_in(raw)
    reasons = list(assessment['review_reasons'])
    if invalid_figure:
        reasons.append('invalid_figure_coordinates')
    if repeated:
        reasons.append('repeated_han_character_in_prose' if repeated['kind'] == 'han' else 'repeated_prose_loop')
    complete = assessment['complete_decode'] and assessment['has_meaningful_text'] and not repeated
    result = {'text': raw, 'finish_reason': finish, 'error': error, 'seconds': time.monotonic() - began}
    return {'text': text, 'complete': complete, 'attempts': [{'stage': 'ovis_loop_retry' if retry else 'ovis_page',
            'result': result, 'assessment': assessment}], 'raw_first_pass': raw, 'selected_attempt': 0,
            'inference_status': 'decoded' if complete else 'incomplete', 'review_reasons': sorted(set(reasons)),
            'repeated_prose': repeated, 'figures': figures}


def retains_prefix(prefix, candidate):
    prefix = FIGURE.sub('', prefix)
    candidate = FIGURE.sub('', candidate)
    for expression, fraction in ((r'\d[\d,.]*', 1.0), (r'[\u3400-\u9fff]|[a-z0-9]+|[^\W\d_]', .75)):
        before = Counter(re.findall(expression, prefix.casefold()))
        after = Counter(re.findall(expression, candidate.casefold()))
        if sum((before & after).values()) < fraction * sum(before.values()):
            return False
    return True


def recognize(path, endpoint, *, recover):
    first = decode(path, endpoint, False)
    loop = first['repeated_prose']
    if not recover or not loop:
        return first
    retry = decode(path, endpoint, True)
    attempts = first['attempts'] + retry['attempts']
    prefix = first['raw_first_pass'][:loop['offset']]
    if retry['complete'] and not retry['review_reasons'] and retains_prefix(prefix, retry['raw_first_pass']):
        retry.update(attempts=attempts, raw_first_pass=first['raw_first_pass'], selected_attempt=1,
                     review_reasons=['recovered_repeated_prose_verify_against_source'])
        return retry
    first.update(attempts=attempts)
    return first
