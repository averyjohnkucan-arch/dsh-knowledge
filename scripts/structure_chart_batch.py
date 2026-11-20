"""Batch qualified CUDA chart crops while preserving page/result association."""

def batch_chart_results(pages, model):
    inputs, owners = [], []
    for page, image, selected, layout in pages:
        if not selected:
            continue
        for box in layout['boxes']:
            if box['label'] == 'chart':
                x0, y0, x1, y1 = box['coordinate']
                # Match PaddleX PP-StructureV3's exact crop operation.
                crop = image[int(y0):int(y1), int(x0):int(x1), :]
                inputs.append({'image': crop})
                owners.append(page)
    if len(inputs) < 2:
        return {}
    original = model.batch_sampler.batch_size
    model.batch_sampler.batch_size = 2
    try:
        results = list(model(input=inputs))
    finally:
        model.batch_sampler.batch_size = original
    if len(results) != len(owners):
        raise RuntimeError('Batched chart inference returned incomplete results')
    grouped = {}
    for page, result in zip(owners, results):
        grouped.setdefault(page, []).append(result)
    return grouped
