#!/usr/bin/env python3
"""Read the rendered PDFs and write back the page number of every chapter.

Chapter headings are matched at the START of a line only, so a cross
reference inside body text ("lihat Bab 6. Fitur Deposit") can never be
mistaken for the heading itself. Role manuals get toc-pages.json; the
beginner manual has its list inline, so its entries are rewritten in place.
"""
import json
import re
import subprocess
import sys
import pathlib

HERE = pathlib.Path(__file__).parent
PDFS = pathlib.Path('/tmp/pdf')

ROLE_DOCS = {
    'admin': 'Panduan_Admin_Intoch',
    'manager': 'Panduan_Manager_Intoch',
    'staff': 'Panduan_Staff_Intoch',
    'finance': 'Panduan_Finance_Intoch',
}
BASIC = 'Panduan_Dasar_Intoch_Staf_Baru'


def pages_of(base):
    out = subprocess.run(['pdftotext', '-layout', str(PDFS / (base + '.pdf')), '-'],
                         capture_output=True, text=True).stdout
    return out.split('\f')


def find(pages, chapter):
    """First page (after the cover and the table of contents) whose text has
    the chapter title at the start of a line."""
    for i, page in enumerate(pages, 1):
        if i <= 2:
            continue
        for line in page.replace(' ', ' ').splitlines():
            if line.strip().startswith(chapter):
                return i
    return None


def role_chapters():
    js = ("const {DOCS}=require('./build-roles.js');"
          "console.log(JSON.stringify(Object.fromEntries("
          "Object.entries(DOCS).map(([k,v])=>[k,v.chapters]))))")
    out = subprocess.run(['node', '-e', js], cwd=HERE, capture_output=True, text=True).stdout
    return json.loads(out or '{}')


def refresh_roles():
    chapters = role_chapters()
    if not chapters:
        sys.exit('could not read DOCS from build-roles.js')
    out = {}
    for key, base in ROLE_DOCS.items():
        pages = pages_of(base)
        out[key] = {ch: p for ch in chapters[key] if (p := find(pages, ch))}
    (HERE / 'toc-pages.json').write_text(json.dumps(out, indent=2, ensure_ascii=False))
    return out


def refresh_basic():
    src = (HERE / 'build-basic.js').read_text()
    block = re.search(r'const tocEntries = \[(.*?)\];', src, re.S)
    labels = re.findall(r"\['(.*?)', '\d+'\]", block.group(1))
    pages = pages_of(BASIC)
    rows = []
    for label in labels:
        page = find(pages, label)
        rows.append("  ['%s', '%s']," % (label, page if page else ''))
    new = 'const tocEntries = [\n' + '\n'.join(rows) + '\n];'
    (HERE / 'build-basic.js').write_text(src[:block.start()] + new + src[block.end():])
    return dict(zip(labels, [find(pages, l) for l in labels]))


if __name__ == '__main__':
    result = {'roles': refresh_roles(), 'basic': refresh_basic()}
    print(json.dumps(result, indent=2, ensure_ascii=False))
