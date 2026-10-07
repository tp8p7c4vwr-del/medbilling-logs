#!/usr/bin/env python3
"""Inspect an exported MedBilling Logs zip: AES-256 method, no-password extraction fails, password extraction works,
inner file valid and contains the expected strings. Prints JSON. Usage: inspect_zip.py ZIP PASSWORD needle1,needle2"""
import json, subprocess, sys, tempfile, os, zipfile
zp, pw, needles = sys.argv[1], sys.argv[2], [n for n in sys.argv[3].split('|') if n]
out = {'zip': os.path.basename(zp)}
slt = subprocess.run(['7z', 'l', '-slt', zp], capture_output=True, text=True).stdout
out['methods'] = sorted({l.split('=', 1)[1].strip() for l in slt.splitlines() if l.startswith('Method =')})
out['encrypted_flags'] = sorted({l.split('=', 1)[1].strip() for l in slt.splitlines() if l.startswith('Encrypted =')})
out['entries'] = [l.split('=', 1)[1].strip() for l in slt.splitlines() if l.startswith('Path =')][1:]
with tempfile.TemporaryDirectory() as d:
    r = subprocess.run(['7z', 'x', '-y', '-pWRONG-password-xyz', '-o' + d + '/bad', zp], capture_output=True, text=True)
    out['wrong_pw_fails'] = r.returncode != 0
    r = subprocess.run(['7z', 't', '-p', zp], capture_output=True, text=True, input='')
    out['no_pw_fails'] = r.returncode != 0
    r = subprocess.run(['7z', 'x', '-y', '-p' + pw, '-o' + d + '/ok', zp], capture_output=True, text=True)
    out['right_pw_ok'] = r.returncode == 0
    texts = {}
    for f in os.listdir(d + '/ok') if os.path.isdir(d + '/ok') else []:
        p = os.path.join(d, 'ok', f); ext = f.rsplit('.', 1)[-1].lower(); t = ''
        try:
            if ext == 'pdf':
                head = open(p, 'rb').read(5); out['pdf_header'] = head.decode('latin1')
                t = subprocess.run(['pdftotext', '-layout', p, '-'], capture_output=True, text=True).stdout
                out['pdf_pages'] = subprocess.run(['pdfinfo', p], capture_output=True, text=True).stdout.count('Pages:')
            elif ext == 'docx':
                import docx; doc = docx.Document(p)
                t = '\n'.join([x.text for x in doc.paragraphs] + [c.text for tb in doc.tables for row in tb.rows for c in row.cells])
            elif ext == 'xlsx':
                import openpyxl; wb = openpyxl.load_workbook(p); out['sheets'] = wb.sheetnames
                t = '\n'.join(str(c.value) for ws in wb for row in ws.iter_rows() for c in row if c.value is not None)
            elif ext == 'csv':
                t = open(p, encoding='utf-8-sig').read(); out['csv_rows'] = len(t.strip().splitlines())
            out['valid_' + ext] = True
        except Exception as e:
            out['valid_' + ext] = False; out['error'] = repr(e)
        texts[f] = t
    alltext = '\n'.join(texts.values())
    out['needles_found'] = {n: (n in alltext) for n in needles}
print(json.dumps(out))
