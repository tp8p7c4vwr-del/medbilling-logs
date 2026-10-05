#!/usr/bin/env python3
"""App icons for Med Billing Logs, drawn in the same style and palette as MedBilling Fee Desk
(scripts/make-assets.py there): teal square, light rounded panel, white log book with teal spine, gold/orange accent."""
import os
from PIL import Image, ImageDraw
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'public', 'icons')
TEAL=(15,118,110); TEALD=(17,94,89); BG=(238,241,244); ORANGE=(234,88,12); GOLD=(245,158,11); LGOLD=(252,211,77); WHITE=(255,255,255); INK=(31,41,51); GREY=(148,163,184)
def motif(d, x, y, s):
    jw,jh=int(s*.46),int(s*.62); jx,jy=x+int(s*.10),y+int(s*.16)
    d.rounded_rectangle([jx,jy,jx+jw,jy+jh],radius=int(s*.04),fill=WHITE,outline=TEALD,width=max(2,int(s*.015)))
    d.rectangle([jx,jy,jx+int(jw*.14),jy+jh],fill=TEALD)
    for k in range(6):
        ly=jy+int(jh*(.16+.13*k)); d.line([jx+int(jw*.25),ly,jx+int(jw*.88),ly],fill=GREY,width=max(1,int(s*.012)))
    cx,cy,r=x+int(s*.66),y+int(s*.62),int(s*.22); w=max(3,int(s*.03))
    d.ellipse([cx-r,cy-r,cx+r,cy+r],fill=LGOLD,outline=ORANGE,width=max(2,int(s*.03)))
    ri=int(r*.78); d.ellipse([cx-ri,cy-ri,cx+ri,cy+ri],fill=WHITE,outline=GOLD,width=max(1,int(s*.012)))
    for a,b in ((0,-1),(1,0),(0,1),(-1,0)):
        d.line([cx+a*int(ri*.72),cy+b*int(ri*.72),cx+a*int(ri*.9),cy+b*int(ri*.9)],fill=INK,width=max(1,int(s*.014)))
    d.line([cx,cy,cx,cy-int(ri*.62)],fill=INK,width=w); d.line([cx,cy,cx+int(ri*.48),cy],fill=INK,width=w)
    k=max(2,int(s*.022)); d.ellipse([cx-k,cy-k,cx+k,cy+k],fill=ORANGE)
    bw=int(s*.06); d.rounded_rectangle([cx-bw//2,cy-r-int(s*.07),cx+bw//2,cy-r+int(s*.005)],radius=max(1,int(s*.01)),fill=ORANGE)
def icon(sz,maskable=False):
    im=Image.new('RGB',(sz,sz),TEAL); d=ImageDraw.Draw(im); pad=int(sz*(.18 if maskable else .08))
    d.rounded_rectangle([pad,pad,sz-pad,sz-pad],radius=int(sz*.12),fill=BG); motif(d,pad,pad,sz-2*pad); return im
os.makedirs(OUT,exist_ok=True)
icon(512).save(os.path.join(OUT,'icon-512.png')); icon(192).save(os.path.join(OUT,'icon-192.png'))
icon(512,True).save(os.path.join(OUT,'icon-maskable-512.png')); icon(180).save(os.path.join(OUT,'apple-touch-icon.png'))
print('icons written')
