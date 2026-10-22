"""Batch recognition only when single-line preprocessing produces equal widths."""
from dataclasses import replace

class WidthStableRecognizer:
    def __init__(self, recognizer):
        self.recognizer = recognizer

    def __call__(self, args):
        images = args.img if isinstance(args.img, list) else [args.img]
        if not images:
            return self.recognizer(args)
        height, minimum = self.recognizer.rec_image_shape[1:]
        groups = {}
        for index, image in enumerate(images):
            # Match RapidOCR's batch-one width, including its floor rounding.
            width = int(height * max(minimum / height, image.shape[1] / float(image.shape[0])))
            groups.setdefault(width, []).append(index)
        texts, scores, words = [None] * len(images), [None] * len(images), [None] * len(images)
        elapsed = 0
        for indices in groups.values():
            result = self.recognizer(replace(args, img=[images[index] for index in indices]))
            elapsed += result.elapse
            for offset, index in enumerate(indices):
                texts[index], scores[index], words[index] = result.txts[offset], result.scores[offset], result.word_results[offset]
        return replace(result, imgs=images, txts=tuple(texts), scores=scores, word_results=tuple(words), elapse=elapsed)
