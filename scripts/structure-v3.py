"""Plugin-owned CPU PP-StructureV3 runtime. No GPU packages or external service."""
import argparse, json, os, sys, pathlib, contextlib, time

_engine = None
_engine_charts = False
_layout = None

def pipeline(charts=True):
    global _engine, _engine_charts
    if _engine is not None and (_engine_charts or not charts): return _engine
    os.environ['CUDA_VISIBLE_DEVICES'] = ''
    os.environ['HIP_VISIBLE_DEVICES'] = ''
    from paddleocr import PPStructureV3
    _engine = PPStructureV3(device='cpu', lang='en', enable_mkldnn=os.environ.get('DSH_STRUCTURE_MKLDNN') == '1',
        cpu_threads=int(os.environ.get('DSH_STRUCTURE_CPU_THREADS', '8')),
        text_detection_model_name='PP-OCRv5_mobile_det',
        text_recognition_model_name='en_PP-OCRv5_mobile_rec',
        use_doc_orientation_classify=False, use_doc_unwarping=False,
        use_textline_orientation=False, use_formula_recognition=False,
        use_seal_recognition=False, use_table_recognition=True,
        use_chart_recognition=charts)
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
    """Use the same layout model and PDF rasterizer; skip OCR on text-only pages.

    Caption enrichment needs tables/charts only. Ordinary text is already
    extracted by the regular parser / accelerated OCR before this stage.
    """
    if not tables_only:
        yield None, source, True
        return
    labels = {'table', 'chart'} if charts else {'table'}
    for page, result in enumerate(layout_pipeline().predict(input=source)):
        selected = any(box.get('label') in labels for box in result['boxes'])
        # Original page pixels and page order are retained, including blank pages.
        yield page, result['input_img'] if selected else None, selected

def extract(source, charts, tables_only=False):
    import tempfile
    output = []
    page_count = 0
    with tempfile.TemporaryDirectory(prefix='structure-result-') as folder:
        for source_page, image, selected in structure_inputs(source, charts, tables_only):
            if source_page is not None:
                page_count = source_page + 1
            if not selected:
                continue
            for page, result in enumerate(pipeline(charts).predict(input=image, use_chart_recognition=charts)):
                page_number = source_page + 1 if source_page is not None else page + 1
                page_count = max(page_count, page_number)
                # Official JSON exporter handles numpy values and result wrappers.
                path = pathlib.Path(folder) / 'page.json'
                result.save_to_json(save_path=str(path))
                value = json.loads(path.read_text(encoding='utf-8'))
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
