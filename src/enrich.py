"""Merge OSM tags (osm_nodes.json / osm_ways.json from the OSM API) into balham.json pubs."""
import json, os
here=os.path.dirname(os.path.abspath(__file__))
d=json.load(open(os.path.join(here,'balham.json')))
tags={}
for f in ('osm_nodes.json','osm_ways.json'):
    p=os.path.join(here,f)
    if os.path.exists(p):
        for e in json.load(open(p))['elements']: tags[str(e['id'])]=e.get('tags',{})
for p in d['pubs']:
    t=tags.get(p['osm'],{})
    addr=' '.join(x for x in [t.get('addr:housenumber'),t.get('addr:street')] if x)
    if t.get('addr:postcode'): addr=(addr+', ' if addr else '')+t['addr:postcode']
    p['addr']=addr or None
    p['hours']=t.get('opening_hours')
    p['web']=t.get('website') or t.get('contact:website')
    p['garden']=(t.get('beer_garden') or t.get('outdoor_seating'))=='yes'
    p['food']=t.get('food')=='yes'
    p['brand']=t.get('operator') or t.get('brand')
json.dump(d,open(os.path.join(here,'balham.json'),'w'),separators=(',',':'))
print(sum(1 for p in d['pubs'] if p['hours']),'with hours;',sum(1 for p in d['pubs'] if p['addr']),'with address')
