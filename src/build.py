"""Build ../index.html from app.html + balham.json + leaflet.css. Run: python3 -I build.py"""
import os
here=os.path.dirname(os.path.abspath(__file__))
r=lambda f:open(os.path.join(here,f),encoding='utf-8').read()
s=r('app.html').replace('/*LEAFLETCSS*/',r('leaflet.css')).replace('__MAPDATA__',r('balham.json').strip())
open(os.path.join(here,'..','index.html'),'w',encoding='utf-8').write(s)
print('built', len(s.encode()), 'bytes')
