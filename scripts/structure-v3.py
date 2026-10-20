"""Plugin-owned CPU PP-StructureV3 runtime. No GPU packages or external service."""
import argparse, json, os, sys, pathlib, contextlib, time

_engine = None
_engine_charts = False

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

def extract(source, charts):
    import tempfile
    output = []
    engine = pipeline(charts)
    page_count = 0
    with tempfile.TemporaryDirectory(prefix='structure-result-') as folder:
        for page, result in enumerate(engine.predict(input=source, use_chart_recognition=charts)):
            page_count = page + 1
            # Official JSON exporter handles numpy values and result wrappers.
            path = pathlib.Path(folder) / f'{page}.json'
            result.save_to_json(save_path=str(path))
            value = json.loads(path.read_text(encoding='utf-8'))
            value = value.get('res', value)
            blocks = value.get('parsing_res_list', [])
            for block in blocks:
                text = str(block.get('block_content') or '').strip()
                if text:
                    output.append({'page': page+1, 'type': str(block.get('block_label') or 'text'), 'text': text})
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
                    result = extract(request['input'], request.get('charts', True))
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
