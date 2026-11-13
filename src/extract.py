"""Cut a Balham-sized piece out of the Geofabrik Greater London shapefiles.
Usage: python3 -I extract.py <dir-with-shp-files> <out.json>
"""
import struct, sys, json, math, os

SHP_DIR, OUT = sys.argv[1], sys.argv[2]
MILE = 1609.344
RADIUS = 1.0 * MILE
CLIP = RADIUS + 700  # draw a margin beyond the ring

def read_dbf(path):
    with open(path, 'rb') as f:
        hdr = f.read(32)
        n, hlen, rlen = struct.unpack('<IHH', hdr[4:12])
        fields = []
        while True:
            d = f.read(32)
            if d[0] == 0x0D:
                break
            name = d[:11].split(b'\0')[0].decode()
            fields.append((name, d[16]))
        f.seek(hlen)
        for _ in range(n):
            rec = f.read(rlen)
            out, pos = {}, 1
            for name, ln in fields:
                out[name] = rec[pos:pos+ln].decode('utf-8', 'replace').strip()
                pos += ln
            yield out

def read_shp(path):
    with open(path, 'rb') as f:
        f.seek(100)
        while True:
            h = f.read(8)
            if len(h) < 8:
                return
            _, clen = struct.unpack('>II', h)
            body = f.read(clen * 2)
            st = struct.unpack('<i', body[:4])[0]
            if st == 0:
                yield None
            elif st == 1:
                yield ('pt', struct.unpack('<2d', body[4:20]))
            elif st in (3, 5):
                bbox = struct.unpack('<4d', body[4:36])
                np_, npts = struct.unpack('<2i', body[36:44])
                parts = list(struct.unpack('<%di' % np_, body[44:44+4*np_]))
                off = 44 + 4*np_
                pts = struct.unpack('<%dd' % (2*npts), body[off:off+16*npts])
                pts = [(pts[2*i], pts[2*i+1]) for i in range(npts)]
                parts.append(npts)
                yield ('line' if st == 3 else 'poly', bbox, [pts[parts[i]:parts[i+1]] for i in range(np_)])
            else:
                yield None

def layer(name):
    base = os.path.join(SHP_DIR, name)
    return zip(read_shp(base + '.shp'), read_dbf(base + '.dbf'))

# --- find Balham station
st = None
for g, r in layer('gis_osm_transport_free_1'):
    if g and r.get('name', '').lower().startswith('balham') and r['fclass'] in ('railway_station',):
        st = g[1]; break
if not st:
    for g, r in layer('gis_osm_transport_free_1'):
        if g and 'balham' in r.get('name', '').lower():
            st = g[1]; print('fallback station', r); break
LNG0, LAT0 = st
KX = math.cos(math.radians(LAT0)) * 111320.0
KY = 110540.0
xy = lambda p: ((p[0]-LNG0)*KX, (p[1]-LAT0)*KY)
dist = lambda p: math.hypot(*xy(p))

def bbox_near(b):
    x1, y1 = xy((b[0], b[1])); x2, y2 = xy((b[2], b[3]))
    return not (x2 < -CLIP or x1 > CLIP or y2 < -CLIP or y1 > CLIP)

def dp(pts, tol):
    if len(pts) < 3: return pts
    P = [xy(p) for p in pts]
    keep = [False]*len(pts); keep[0] = keep[-1] = True
    stack = [(0, len(pts)-1)]
    while stack:
        a, b = stack.pop()
        (ax, ay), (bx, by) = P[a], P[b]
        dx, dy = bx-ax, by-ay; L = math.hypot(dx, dy)
        md, mi = 0, -1
        for i in range(a+1, b):
            d = abs(dy*(P[i][0]-ax) - dx*(P[i][1]-ay)) / L if L > 1e-6 else math.hypot(P[i][0]-ax, P[i][1]-ay)
            if d > md: md, mi = d, i
        if md > tol:
            keep[mi] = True; stack += [(a, mi), (mi, b)]
    return [p for p, k in zip(pts, keep) if k]

def enc(pts):
    """delta-encoded ints at 1e5 (lat,lng order)"""
    out, pl, pg = [], 0, 0
    for lng, lat in pts:
        a, b = round(lat*1e5), round(lng*1e5)
        out += [a-pl, b-pg]; pl, pg = a, b
    return out

ROAD_CLS = {
    'motorway':'major','trunk':'major','primary':'major','motorway_link':'major','trunk_link':'major','primary_link':'major',
    'secondary':'mid','secondary_link':'mid','tertiary':'mid','tertiary_link':'mid',
    'residential':'minor','unclassified':'minor','living_street':'minor','pedestrian':'minor',
}
roads = {'major':[], 'mid':[], 'minor':[]}
names = {}
for g, r in layer('gis_osm_roads_free_1'):
    if not g or g[0] != 'line': continue
    c = ROAD_CLS.get(r['fclass'])
    if not c or not bbox_near(g[1]): continue
    for part in g[2]:
        s = dp(part, 2.5)
        roads[c].append(enc(s))
        if c in ('major','mid') and r.get('name'):
            L = sum(math.hypot(xy(s[i+1])[0]-xy(s[i])[0], xy(s[i+1])[1]-xy(s[i])[1]) for i in range(len(s)-1))
            mid = s[len(s)//2]
            if dist(mid) < RADIUS + 200:
                names.setdefault(r['name'], []).append((L, mid))

rail = []
for g, r in layer('gis_osm_railways_free_1'):
    if not g or g[0] != 'line' or r['fclass'] not in ('rail',) or not bbox_near(g[1]): continue
    if r.get('tunnel') == 'T': continue
    for part in g[2]: rail.append(enc(dp(part, 3)))

green = []
for g, r in layer('gis_osm_landuse_a_free_1'):
    if not g or g[0] != 'poly' or r['fclass'] not in ('park','grass','recreation_ground','meadow','forest','nature_reserve','allotments','cemetery') or not bbox_near(g[1]): continue
    ring = g[2][0]
    if len(ring) < 4: continue
    green.append(enc(dp(ring, 4)))
for g, r in layer('gis_osm_pois_a_free_1'):
    if not g or g[0] != 'poly' or r['fclass'] not in ('park','pitch') or not bbox_near(g[1]): continue
    green.append(enc(dp(g[2][0], 4)))

water = []
for g, r in layer('gis_osm_water_a_free_1'):
    if not g or g[0] != 'poly' or not bbox_near(g[1]): continue
    water.append(enc(dp(g[2][0], 4)))

pubs = {}
def add_pub(name, lng, lat, osm_id, extra, kind='n'):
    d = dist((lng, lat))
    if d > RADIUS or not name: return
    key = name.lower()
    if key in pubs and pubs[key]['d'] <= d: return
    pubs[key] = {'name': name, 'lat': round(lat, 6), 'lng': round(lng, 6), 'd': round(d), 'osm': osm_id, 'k': kind}
for g, r in layer('gis_osm_pois_free_1'):
    if g and r['fclass'] == 'pub':
        add_pub(r.get('name'), g[1][0], g[1][1], r.get('osm_id'), r)
for g, r in layer('gis_osm_pois_a_free_1'):
    if g and g[0] == 'poly' and r['fclass'] == 'pub':
        ring = g[2][0]; cx = sum(p[0] for p in ring)/len(ring); cy = sum(p[1] for p in ring)/len(ring)
        add_pub(r.get('name'), cx, cy, r.get('osm_id'), r, 'w')

labels = []
for n, segs in names.items():
    L, mid = max(segs)
    if L > 250: labels.append({'t': n, 'lat': round(mid[1], 5), 'lng': round(mid[0], 5), 'L': round(L)})
labels.sort(key=lambda x: -x['L'])

out = {'station': {'lat': round(LAT0, 6), 'lng': round(LNG0, 6)}, 'radius': round(RADIUS),
       'roads': roads, 'rail': rail, 'green': green, 'water': water,
       'labels': labels[:40], 'pubs': sorted(pubs.values(), key=lambda p: p['d'])}
with open(OUT, 'w') as f:
    json.dump(out, f, separators=(',', ':'))
print('station', LAT0, LNG0)
print({k: len(v) for k, v in roads.items()}, 'rail', len(rail), 'green', len(green), 'water', len(water))
print('pubs', len(out['pubs']))
for p in out['pubs']: print(f"{p['d']:5d}  {p['name']}")
print('bytes', os.path.getsize(OUT))
