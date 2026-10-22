"""Plugin-owned PP-StructureV3 with qualified, explicit device backends."""
import argparse, json, os, sys, pathlib, contextlib, time

_engine = None
_engine_charts = False
_layout = None

@contextlib.contextmanager
def reference_precision(device):
    if device == 'cpu':
        yield
        return
    # PaddleX 3.7 automatically chooses BF16 for the chart decoder on CUDA.
    # Keep the CPU reference's FP32 weights: BF16 changes generated chart values.
    import paddlex.inference.models.doc_vlm.predictor as doc_vlm
    original = doc_vlm.is_bfloat16_available
    doc_vlm.is_bfloat16_available = lambda device: False
    try:
        yield
    finally:
        doc_vlm.is_bfloat16_available = original

def pipeline(charts=True):
    global _engine, _engine_charts
    if _engine is not None and (_engine_charts or not charts): return _engine
    device = os.environ.get('DSH_STRUCTURE_DEVICE', 'cpu')
    if device not in ('cpu', 'gpu:0'): raise ValueError('Unsupported structure device')
    if device == 'cpu': os.environ['CUDA_VISIBLE_DEVICES'] = ''
    else: os.environ['NVIDIA_TF32_OVERRIDE'] = '0'
    os.environ['HIP_VISIBLE_DEVICES'] = ''
    from paddleocr import PPStructureV3
    with reference_precision(device):
        _engine = PPStructureV3(device=device, lang='en', enable_mkldnn=os.environ.get('DSH_STRUCTURE_MKLDNN') == '1',
            cpu_threads=int(os.environ.get('DSH_STRUCTURE_CPU_THREADS', '8')),
            text_detection_model_name='PP-OCRv5_mobile_det',
            text_recognition_model_name='en_PP-OCRv5_mobile_rec',
            use_doc_orientation_classify=False, use_doc_unwarping=False,
            use_textline_orientation=False, use_formula_recognition=False,
            use_seal_recognition=False, use_table_recognition=True,
            use_chart_recognition=charts)
    if device == 'cpu' and charts:
        from structure_cpu_threads import install_chart_threads
        install_chart_threads(_engine.paddlex_pipeline._pipeline.chart_recognition_model, device,
            int(os.environ.get('DSH_STRUCTURE_CHART_THREADS', '0')))
    layout_model = os.environ.get('DSH_STRUCTURE_LAYOUT_MODEL')
    if layout_model:
        from structure_openvino import install_layout_runner
        install_layout_runner(_engine, layout_model, os.environ.get('DSH_STRUCTURE_LAYOUT_DEVICE', 'CPU'),
            os.environ.get('DSH_STRUCTURE_LAYOUT_CACHE'))
    _engine_charts = charts
    return _engine

def layout_pipeline():
    global _layout
    if _layout is None:
        from paddleocr import LayoutDetection
        _layout = LayoutDetection(model_name='PP-DocLayout_plus-L', device='cpu',
            enable_mkldnn=os.environ.get('DSH_STRUCTURE_MKLDNN') == '1',
            cpu_threads=int(os.environ.get('DSH_STRUCTURE_CPU_THREADS', '8')))
    return _layout

def structure_inputs(source, charts, tables_only):
    """Detect each page once using the full pipeline's exact layout settings."""
    if not tables_only:
        yield None, source, True, None
        return
    labels = {'table', 'chart'} if charts else {'table'}
    detector = pipeline(charts).paddlex_pipeline.layout_det_model
    reference = getattr(detector, '_dsh_reference_runner', None)
    screening = {'threshold': 0.25} if reference is not None else {}
    for page, result in enumerate(detector(input=source, **screening)):
        selected = any(box.get('label') in labels for box in result['boxes'])
        reference = getattr(detector, '_dsh_reference_runner', None)
        if selected and reference is not None:
            # Small accelerator coordinate differences can change crop pixels,
            # which can substantially change table structure or generated values.
            # Accelerate page screening; retain reference boxes for rich content.
            accelerated = detector.runner
            detector.runner = reference
            try:
                result = next(iter(detector(input=[result['input_img']])))
                selected = any(box.get('label') in labels for box in result['boxes'])
            finally:
                detector.runner = accelerated
        yield page, result['input_img'] if selected else None, selected, result


def predict_page(image, charts, layout=None, chart_results=None):
    engine = pipeline(charts)
    if layout is None:
        yield from engine.predict(input=image, use_chart_recognition=charts)
        return
    # Pinned PaddleX 3.7 uses a single-device wrapper. Preprocessing is disabled,
    # so the cached detector result refers to these exact original page pixels.
    internal = engine.paddlex_pipeline._pipeline
    detector = internal.layout_det_model
    def cached(images, **kwargs):
        if len(images) != 1:
            raise RuntimeError('Expected one page for cached structure layout')
        yield layout
    original_chart = getattr(internal, 'chart_recognition_model', None)
    def cached_charts(input, **kwargs):
        if len(input) != len(chart_results):
            raise RuntimeError('Cached chart count does not match original page crops')
        yield from chart_results
    internal.layout_det_model = cached
    if chart_results is not None:
        internal.chart_recognition_model = cached_charts
    try:
        yield from engine.predict(input=image, use_chart_recognition=charts)
    finally:
        internal.layout_det_model = detector
        if chart_results is not None:
            internal.chart_recognition_model = original_chart

def extract(source, charts, tables_only=False):
    output = []
    page_count = 0
    pages = structure_inputs(source, charts, tables_only)
    cached_charts = {}
    if charts and tables_only and isinstance(source, list) and len(source) > 1 and os.environ.get('DSH_STRUCTURE_CHART_BATCH') == '2':
        from structure_chart_batch import batch_chart_results
        pages = list(pages)
        cached_charts = batch_chart_results(pages, pipeline(charts).paddlex_pipeline._pipeline.chart_recognition_model)
    for source_page, image, selected, layout in pages:
        if source_page is not None:
            page_count = source_page + 1
        if not selected:
            continue
        # Enrichment discards ordinary OCR text. With one chart and no tables,
        # only the chart decoder contributes retained content; there is no
        # relative chart ordering to reconstruct through the full parser.
        if charts and tables_only and source_page is not None and os.environ.get('DSH_STRUCTURE_CHART_DIRECT') == '1':
            chart_boxes = [box for box in layout['boxes'] if box['label'] == 'chart']
            if len(chart_boxes) == 1 and not any(box['label'] == 'table' for box in layout['boxes']):
                results = cached_charts.get(source_page)
                if results is None:
                    x0, y0, x1, y1 = chart_boxes[0]['coordinate']
                    crop = image[int(y0):int(y1), int(x0):int(x1), :]
                    model = pipeline(charts).paddlex_pipeline._pipeline.chart_recognition_model
                    results = list(model(input=[{'image': crop}]))
                if len(results) != 1:
                    raise RuntimeError('Single-chart decoder returned incomplete results')
                text = str(results[0]['result'] or '').strip()
                if text:
                    output.append({'page': source_page + 1, 'type': 'chart', 'text': text})
                continue
        predictions = predict_page(image, charts, layout, cached_charts[source_page]) if source_page in cached_charts else predict_page(image, charts, layout)
        for page, result in enumerate(predictions):
            page_number = source_page + 1 if source_page is not None else page + 1
            page_count = max(page_count, page_number)
            # Use the official in-memory exporter; no per-page JSON write/read.
            value = result.json
            value = value.get('res', value)
            blocks = value.get('parsing_res_list', [])
            for block in blocks:
                label = str(block.get('block_label') or 'text')
                if tables_only and label not in ('table', 'chart'):
                    continue
                text = str(block.get('block_content') or '').strip()
                if text:
                    output.append({'page': page_number, 'type': label, 'text': text})
    return {'blocks': output, 'pageCount': page_count}

def extract_range(source, charts, start_page, page_limit):
    """Process a bounded PDF range with the reference renderer and page numbering.

    The scheduler can move the next range to a different device. Only these
    pages are rendered; the source stays shared and no intermediate PDFs exist.
    """
    if type(start_page) is not int or type(page_limit) is not int or start_page < 0 or not 1 <= page_limit <= 8:
        raise ValueError('Invalid structure page range')
    detector = pipeline(charts).paddlex_pipeline.layout_det_model
    reader = detector.batch_sampler.pdf_reader
    from paddlex.inference.utils.io.readers import pdfium_lock
    images = []
    doc = reader.load(source)
    with pdfium_lock:
        try:
            count = len(doc)
            if not 1 <= count <= 10000 or start_page >= count:
                raise ValueError('Structure page range is outside the PDF')
            end_page = min(count, start_page + page_limit)
            for index in range(start_page, end_page):
                page = doc[index]
                try:
                    images.append(reader._backend._render_page(page, page_index=index + 1))
                finally:
                    page.close()
        finally:
            doc.close()
    result = extract(images, charts, True)
    if result['pageCount'] != len(images):
        raise RuntimeError('Structure range did not process every page')
    for block in result['blocks']:
        block['page'] += start_page
    return {**result, 'pageCount': count, 'pageStart': start_page, 'pageEnd': end_page}

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--input')
    parser.add_argument('--output')
    parser.add_argument('--prepare', action='store_true')
    parser.add_argument('--no-charts', action='store_true')
    parser.add_argument('--worker', action='store_true')
    args = parser.parse_args()
    if args.worker:
        for line in sys.stdin:
            request = None
            try:
                request = json.loads(line)
                started = time.perf_counter()
                with contextlib.redirect_stdout(sys.stderr):
                    if 'startPage' in request:
                        if not request.get('tablesOnly', False):
                            raise ValueError('Page ranges require structure enrichment mode')
                        result = extract_range(request['input'], request.get('charts', True), request['startPage'], request.get('pageLimit', 1))
                    else:
                        result = extract(request['input'], request.get('charts', True), request.get('tablesOnly', False))
                    pathlib.Path(request['output']).write_text(json.dumps(result, ensure_ascii=False), encoding='utf-8')
                response = {'id': request['id'], 'ok': True, 'seconds': time.perf_counter() - started}
            except Exception as error:
                response = {'id': request.get('id') if isinstance(request, dict) else None, 'ok': False, 'error': str(error)[:1000]}
            print('DSH_STRUCTURE_RESULT ' + json.dumps(response), flush=True)
    elif args.prepare:
        # Download every selected model and verify that the complete pipeline constructs.
        import tempfile
        from PIL import Image, ImageDraw, ImageFont
        with tempfile.TemporaryDirectory(prefix='structure-smoke-') as folder:
            image = Image.new('RGB', (1200, 400), 'white')
            ImageDraw.Draw(image).text((60, 100), 'CPU PIPELINE READY 417', font=ImageFont.load_default(size=48), fill='black')
            path = pathlib.Path(folder) / 'smoke.png'
            image.save(path)
            result = extract(str(path), True)
            if not any('417' in block['text'] for block in result['blocks']): raise RuntimeError('PP-StructureV3 CPU inference self-test failed')
        print('DSH_STRUCTURE_READY', flush=True)
    else:
        if not args.input or not args.output: parser.error('input and output required')
        blocks = extract(args.input, not args.no_charts)
        pathlib.Path(args.output).write_text(json.dumps(blocks, ensure_ascii=False), encoding='utf-8')
