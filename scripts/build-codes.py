#!/usr/bin/env python3
"""Build compact fee-code lists for MedBilling Logs from MedBilling Fee Desk's bundled data.
Source: ../delara-medbilling/public/data (codes.json = Alberta SOMB; data/prov/*.json = live provinces).
Only jurisdictions marked live in Fee Desk's index.json are used. Held jurisdictions (BC, ON, QC, PE, NB, NS)
are refused: the build fails if any of them would be bundled.
Output: public/data/codes-<ID>.json = {"meta": {...credit...}, "codes": [[code, description, feeLabel], ...]}
and public/data/codes-index.json. Fee labels follow Fee Desk's display (units as printed, no conversion)."""
import json, os, re, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, '..', 'delara-medbilling', 'public', 'data'))
OUT = os.path.join(ROOT, 'public', 'data')
HELD = {'BC', 'ON', 'QC', 'PE', 'NB', 'NS'}
# held but still listed (no data) so a user's saved province setting and typed codes keep working
SHOW_HELD = {'NS': ('Nova Scotia', 'Code lookup unavailable until permission is granted; type codes manually and confirm them in the official MSI Physician’s Manual.')}
TXT = {'BR': 'By report', 'FS': 'F/S (included)', 'NC': 'No charge', 'IC': 'Independent consideration'}
def die(m): sys.exit('build-codes: ' + m)
def money(v): return '${:,.2f}'.format(v)
def amt(v): return money(v) if isinstance(v, (int, float)) else TXT.get(v, str(v))

def fee_label(r, m):
    fm = m.get('feeModel')
    if fm == 'msu':
        if r.get('u'):
            u = r['u']; return 'Independent consideration' if u == 'IC' else (f'{u} units' if re.fullmatch(r'[\d.]+(\s*\+\s*MU?)?', u) else u)
        return f"Anaes. units {r['an']}" if r.get('an') else 'See schedule'
    if m.get('pick'):
        for k in m['pick'].get(m.get('defaultSkill'), []) or list(m['pick'].values())[0]:
            if r.get(k) is not None: return amt(r[k]) + (f" ({m['colNames'].get(k, k)})" if m.get('colNames') else '')
        return 'See schedule'
    if r.get('fp') is not None or r.get('sp') is not None:
        return ' · '.join(x for x in (f"FP {amt(r['fp'])}" if r.get('fp') is not None else '', f"Spec. {amt(r['sp'])}" if r.get('sp') is not None else '') if x)
    if r.get('f') is not None: return amt(r['f'])
    if r.get('an') is not None: return f"{r['an']} anaes. units"
    return 'See schedule'

os.makedirs(OUT, exist_ok=True)
for n in os.listdir(OUT):
    if n.startswith('codes-'): os.remove(os.path.join(OUT, n))
idx = json.load(open(os.path.join(SRC, 'prov', 'index.json')))
lst = []
# Alberta (SOMB)
ab = json.load(open(os.path.join(SRC, 'codes.json'))); am = json.load(open(os.path.join(SRC, 'meta.json')))
codes = [[c['display'] if c.get('display') else c['code'], c['desc'], (money(c['base']) + ' base') if isinstance(c.get('base'), (int, float)) else 'See schedule', c['code']] for c in ab]
eff = am['sombEffective']
meta = {'id': 'AB', 'name': 'Alberta', 'title': 'Schedule of Medical Benefits (SOMB)', 'effective': eff,
        'credit': f'Source: Alberta Health, Schedule of Medical Benefits (SOMB), effective {eff}. Contains information licensed under the Open Government Licence – Alberta. Fees shown are SOMB base rates; modifiers and fee skills are not applied.',
        'url': am['albertaCa']}
json.dump({'meta': meta, 'codes': codes}, open(os.path.join(OUT, 'codes-AB.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
lst.append({'id': 'AB', 'name': 'Alberta', 'n': len(codes), 'title': meta['title'], 'eff': 'Effective ' + eff, 'credit': meta['credit']})
for j in idx['list']:
    if j['id'] == 'AB' or j.get('status') != 'live': continue
    if j['id'] in HELD and j['id'] not in SHOW_HELD: die(f"held jurisdiction {j['id']} is marked live in Fee Desk's index.json")
    if j['id'] in HELD: continue
    d = json.load(open(os.path.join(SRC, 'prov', j['file']))); m = d['meta']; secs = d['secs']
    spec = set(m.get('specSecs') or [])
    best = {}
    for r in d['rows']:
        sname = secs[r['s']] if isinstance(r['s'], int) else r['s']
        rank = 0 if sname == m.get('defaultSkill') else (1 if sname not in spec else 2)
        if r['c'] not in best or rank < best[r['c']][0]: best[r['c']] = (rank, r)
    codes = [[c, r['d'], fee_label(r, m), c] for c, (_, r) in best.items()]
    credit = m.get('credit') or ''
    if not credit:
        credit = f"Source: {m.get('publisher', j['name'])}, {m.get('title', '')}. " + (m.get('licence', {}).get('text', '') if isinstance(m.get('licence'), dict) else '')
    meta = {'id': j['id'], 'name': j['name'], 'title': m.get('title'), 'effective': m.get('effective'), 'effectiveLabel': m.get('effectiveLabel'), 'credit': credit.strip(), 'url': m.get('landing') or m.get('pdf')}
    json.dump({'meta': meta, 'codes': codes}, open(os.path.join(OUT, f"codes-{j['id']}.json"), 'w'), ensure_ascii=False, separators=(',', ':'))
    lst.append({'id': j['id'], 'name': j['name'], 'n': len(codes), 'title': meta['title'], 'eff': meta.get('effectiveLabel') or '', 'credit': meta['credit']})
for n in os.listdir(OUT):
    if n.split('.')[0].replace('codes-', '').upper() in HELD: die('held data file present: ' + n)
for hid, (hname, hnote) in SHOW_HELD.items():
    lst.append({'id': hid, 'name': hname, 'held': True, 'n': 0, 'title': 'Approval pending', 'eff': '', 'credit': hnote})
json.dump({'list': lst}, open(os.path.join(OUT, 'codes-index.json'), 'w'), ensure_ascii=False, indent=1)
print('codes:', ', '.join(f"{x['id']} {x['n']}" for x in lst), '| held excluded:', ','.join(sorted(HELD)))
