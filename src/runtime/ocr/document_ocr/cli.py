"""Arguments shared by local document conversions."""
import argparse
from pathlib import Path


def conversion_parser():
    p = argparse.ArgumentParser(prog="ocr", description="Convert PDFs and images to Markdown using local OvisOCR2.",
                                epilog="Managed by Knowledge base Settings.")
    p.add_argument("inputs", type=Path, nargs="+", metavar="INPUT", help="PDF, image, or directory of documents")
    out = p.add_mutually_exclusive_group()
    out.add_argument("-o", "--output", type=Path, help="single Markdown output, default SOURCE.md")
    out.add_argument("--output-dir", type=Path, help="write one Markdown file per input into this directory")
    p.add_argument("--evidence-dir", type=Path, help="parent for document evidence, default beside the output")
    p.add_argument("--report", type=Path, help="write batch counts and elapsed time as JSON")
    replace = p.add_mutually_exclusive_group()
    replace.add_argument("--force", action="store_true", help="replace Markdown after a fresh run")
    replace.add_argument("--resume", action="store_true", help="reuse matching completed pages and keep prior runs")
    p.add_argument("--ocr-only", action="store_true", help="rasterize every PDF page, including typeset prose")
    p.add_argument("--workers", type=int, choices=range(1, 33), metavar="1–32", default=16,
                   help="number of pages processed concurrently (default: 16)")
    p.add_argument("--dpi", type=int, choices=range(72, 401), metavar="72–400", default=200, help="PDF rasterization DPI")
    p.add_argument("--password-file", type=Path, help="read an encrypted PDF's password from a file")
    p.add_argument("--endpoint", help="use a running local OvisOCR2 server, e.g. http://127.0.0.1:31087")
    p.add_argument("--profile", choices=("adaptive", "full", "direct"), default="adaptive",
                   help="adaptive recovery, full recognition, or one grounded pass (default: adaptive)")
    return p
