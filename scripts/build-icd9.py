#!/usr/bin/env python3
"""Build the compact ICD-9 suggestion list for Med Billing Logs from MedBilling Fee Desk's bundled data.
Source: ../delara-medbilling/public/data/icd9.json (Alberta Health diagnostic codes, ICD-9 supplement) and meta.json.
Output: public/data/icd9-AB.json = {"meta": {...credit...}, "codes": [[code, label], ...]}.
Labels follow Fee Desk's display: sub-codes that read only "Unspecified" or "Ovary" get the parent category as a prefix.
Separate from build-codes.py so fee-code files are not regenerated. Reads Fee Desk's data only; never writes there."""
import json, os, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, '..', 'delara-medbilling', 'public', 'data'))
OUT = os.path.join(ROOT, 'public', 'data', 'icd9-AB.json')
icd = json.load(open(os.path.join(SRC, 'icd9.json'))); m = json.load(open(os.path.join(SRC, 'meta.json')))['icd9']
by = {i['code']: i for i in icd}
def label(i):
    c, d = i['code'], i['desc']
    if '.' not in c or len(d) > 40: return d
    p = by.get(c.split('.')[0])
    if not p and len(c.split('.')[1]) > 1: p = by.get(c[:-1])
    dup = p and any((k := by.get(p['code'] + '.' + x)) and p['desc'][:30].lower() == k['desc'][:30].lower() for x in '0123456789')
    return p['desc'] + ': ' + d if p and p['desc'] and not dup and p['desc'].lower() not in d.lower() else d
codes = [[i['code'], label(i)] for i in icd if i.get('code') and i.get('desc')]
meta = {'id': 'AB', 'system': 'ICD-9', 'name': m['name'], 'asOf': m['asOf'], 'url': m['dataset'],
        'credit': f"Diagnostic codes: Alberta Health, {m['name']} (as of {m['asOf']}). Contains information licensed under the Open Government Licence – Alberta. Data via MedBilling Fee Desk."}
json.dump({'meta': meta, 'codes': codes}, open(OUT, 'w'), ensure_ascii=False, separators=(',', ':'))
print('icd9-AB:', len(codes), 'codes,', os.path.getsize(OUT), 'bytes')
