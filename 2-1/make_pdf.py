#!/usr/bin/env python3
"""스토리보드 마크다운을 제출용 PDF로 바꾼다.

사용법:  python3 make_pdf.py            (스토리보드_머물지도.md -> 스토리보드_머물지도.pdf)
         python3 make_pdf.py 입력.md 출력.pdf
필요한 것: python markdown 패키지, Google Chrome
"""
import subprocess
import sys
import tempfile
from pathlib import Path

import markdown

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
CSS = """
@page { size: A4; margin: 18mm 16mm; }
body { font-family: 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif; font-size: 10.5pt;
       line-height: 1.6; color: #22221F; }
h1 { font-size: 20pt; border-bottom: 2px solid #22221F; padding-bottom: 6px; }
h2 { font-size: 14pt; margin-top: 26px; border-bottom: 1px solid #c9c5ba; padding-bottom: 4px; }
h3 { font-size: 12pt; margin-top: 20px; color: #4f5b45; break-after: avoid; }
pre { background: #F4F1EA; border-left: 3px solid #7C8A6E; padding: 8px 10px;
      white-space: pre-wrap; word-break: break-all; font-size: 9.5pt; break-inside: avoid; }
code { font-family: 'Apple SD Gothic Neo', Menlo, monospace; }
table { border-collapse: collapse; width: 100%; font-size: 9.5pt; break-inside: avoid; }
th, td { border: 1px solid #c9c5ba; padding: 5px 7px; text-align: left; vertical-align: top; }
th { background: #F4F1EA; }
blockquote { color: #6b6b66; border-left: 3px solid #c9c5ba; margin-left: 0; padding-left: 10px; }
hr { border: 0; border-top: 1px solid #c9c5ba; margin: 22px 0; }
"""


def main() -> None:
    here = Path(__file__).resolve().parent
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else here / "스토리보드_머물지도.md"
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else src.with_suffix(".pdf")
    text = src.read_text(encoding="utf-8")
    if "✏️" in text:
        print(f"주의: 아직 채우지 않은 칸(✏️)이 {text.count('✏️')}개 남아 있습니다.")
    body = markdown.markdown(text, extensions=["tables", "fenced_code", "sane_lists"])
    html = f"<!doctype html><html lang='ko'><meta charset='utf-8'><style>{CSS}</style><body>{body}</body></html>"
    with tempfile.TemporaryDirectory() as tmp:
        page = Path(tmp) / "page.html"
        page.write_text(html, encoding="utf-8")
        subprocess.run(
            [CHROME, "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
             f"--print-to-pdf={out.resolve()}", page.as_uri()],
            check=True, capture_output=True,
        )
    print(f"만듦: {out}")


if __name__ == "__main__":
    main()
