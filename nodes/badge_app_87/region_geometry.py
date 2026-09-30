"""Material-independent, bounded image-space completion and boundary coverage.

No semantic segmentation: every new pixel must have a short, low-cost path to a
seed. Original seed islands and holes are never removed by morphology.
"""
from collections import OrderedDict
import hashlib
import json
from threading import RLock

import cv2
import numpy as np
from scipy import ndimage as ndi

VERSION = 'badge87-region-v1'
_CACHE = OrderedDict()
_LOCK = RLock()
DEFAULTS = dict(radius=12, chroma_step=5., light_step=12., chroma_drift=14.,
                light_drift=38., ambiguity=.35, context=8)


def settings(options=None):
    result = dict(DEFAULTS)
    for key, value in (options or {}).items():
        if key not in result or isinstance(value, bool) or not np.isfinite(value) or value < 0:
            raise ValueError('Invalid region geometry option: ' + str(key))
        result[key] = float(value)
    if result['radius'] > 48 or result['context'] > 32:
        raise ValueError('Region completion exceeds the bounded local radius.')
    return result


def color_seeds(source, support, groups, overlap_policy='error'):
    rgb = source[..., :3].astype(np.float32)
    owner = np.full(rgb.shape[:2], -1, np.int16)
    best = np.full(owner.shape, np.inf, np.float32)
    hits = np.zeros(owner.shape, np.uint8)
    for index, group in enumerate(groups):
        distance = np.full(owner.shape, np.inf, np.float32)
        for sample in [group['color'], *group.get('samples', [])]:
            color = np.array([int(sample[i:i+2], 16) for i in (1, 3, 5)])
            distance = np.minimum(distance, ((rgb-color)**2).sum(-1))
        match = distance <= float(group.get('threshold', 30))**2
        if group.get('invert'):
            match = ~match
            distance = np.where(match, 0, np.inf)
        match &= support
        hits += match
        take = match & (distance < best)
        owner[take], best[take] = index, distance[take]
    if overlap_policy == 'error' and (hits > 1).any():
        raise ValueError(f'区域存在 {int((hits > 1).sum())} 个重叠像素，请调整取样色或阈值后再生成。')
    return owner


def _slices(dy, dx):
    return ((slice(max(0,dy), None if dy >= 0 else dy), slice(max(0,dx), None if dx >= 0 else dx)),
            (slice(max(0,-dy), None if dy <= 0 else -dy), slice(max(0,-dx), None if dx <= 0 else -dx)))


def complete(target, seeds, count, options):
    lab = cv2.cvtColor(target[..., :3].astype(np.float32)/255, cv2.COLOR_RGB2LAB)
    support = target[..., 3] > 127
    radius = int(options['radius'])
    best = np.full(seeds.shape, np.inf, np.float32)
    second = best.copy()
    owner = np.full(seeds.shape, -1, np.int16)
    links = []
    for dy, dx in ((0,1),(0,-1),(1,0),(-1,0)):
        dst, src = _slices(dy, dx)
        delta = lab[dst]-lab[src]
        chroma = np.linalg.norm(delta[..., 1:], axis=-1)
        light = np.abs(delta[..., 0])
        allowed = (chroma <= options['chroma_step']) & (light <= options['light_step'])
        links.append((dst, src, np.where(allowed, 1+chroma*.5+light*.12, np.inf)))
    for index in range(count):
        seed = seeds == index
        if not seed.any():
            continue
        distance, near = ndi.distance_transform_edt(~seed, return_indices=True)
        delta = lab-lab[tuple(near)]
        allowed = support & (distance <= radius) & ((seeds < 0) | seed)
        allowed &= (np.linalg.norm(delta[..., 1:], axis=-1) <= options['chroma_drift'])
        allowed &= np.abs(delta[..., 0]) <= options['light_drift']
        cost = np.where(seed, 0., np.inf).astype(np.float32)
        for _ in range(radius):
            updated = cost.copy()
            for dst, src, step in links:
                np.minimum(updated[dst], cost[src]+step, out=updated[dst])
            updated[~allowed | (updated > radius)] = np.inf
            if np.array_equal(updated, cost):
                break
            cost = updated
        better = cost < best
        second = np.where(better, best, np.minimum(second, cost))
        owner[better] = index
        best = np.minimum(best, cost)
    finite = np.isfinite(best)
    gap = np.full(best.shape, np.inf, np.float32)
    np.subtract(second, best, out=gap, where=finite)
    owner[~finite | (gap <= options['ambiguity'])] = -1
    owner[seeds >= 0] = seeds[seeds >= 0]
    return owner


def definition(mask, context=8):
    """Closed discrete support with subpixel inner coverage; no outward feather.

    Signed-distance supersampling fits only within the approved support. Thin
    structures without an interior retain full coverage rather than disappearing.
    """
    mask = mask.astype(bool)
    padded = np.pad(mask, 1)
    inside = ndi.distance_transform_edt(padded)[1:-1, 1:-1]
    outside = ndi.distance_transform_edt(~padded)[1:-1, 1:-1]
    signed = (inside-outside).astype(np.float32)
    h, w = mask.shape
    coverage = np.empty((h,w),np.float32)
    # One-row halos preserve the same subpixel samples as a whole-image resize,
    # without allocating a 16x full-canvas float image at large output sizes.
    for top in range(0,h,64):
        bottom = min(h,top+64)
        start,end = max(0,top-1),min(h,bottom+1)
        high = cv2.resize(signed[start:end],(w*4,(end-start)*4),interpolation=cv2.INTER_LINEAR)>0
        high = high[(top-start)*4:(bottom-start)*4]
        coverage[top:bottom] = high.reshape(bottom-top,4,w,4).mean((1,3))
    coverage[~mask] = 0
    # Protect one-pixel strokes/islands and narrow necks, including diagonal ones.
    core = inside >= 2
    near_core = ndi.distance_transform_edt(~core) if core.any() else np.full(mask.shape, np.inf)
    coverage[mask & (near_core > 2)] = 1
    return dict(mask=mask, coverage=coverage, core=core,
                context=ndi.binary_dilation(mask, iterations=max(1,int(context))) if context else mask.copy())


def resolve(target, seeds, count, options=None, expand=True):
    options = settings(options)
    digest = hashlib.sha256(VERSION.encode()+target.tobytes()+seeds.tobytes()
                            +json.dumps([count, options, expand], sort_keys=True).encode()).hexdigest()
    with _LOCK:
        if digest in _CACHE:
            _CACHE.move_to_end(digest)
            return _CACHE[digest]
    owner = complete(target, seeds, count, options) if expand else seeds.copy()
    regions = [definition(owner == i, options['context']) for i in range(count)]
    result = dict(version=VERSION, fingerprint=digest, owner=owner, seeds=seeds.copy(), regions=regions,
                  stats=[dict(seed_pixels=int((seeds==i).sum()), selected_pixels=int(r['mask'].sum()),
                              added_pixels=int(((owner==i)&(seeds!=i)).sum()),
                              boundary_pixels=int(((r['coverage']>0)&(r['coverage']<1)).sum()))
                         for i,r in enumerate(regions)])
    with _LOCK:
        # Bound by bytes as well as count: full-resolution definitions are large.
        def size(v):
            return sum(a.nbytes for a in (v['owner'],v['seeds'])) + sum(a.nbytes for r in v['regions'] for a in r.values())
        if size(result) > 192*1024*1024:
            return result
        _CACHE[digest] = result
        while len(_CACHE)>1 and (len(_CACHE)>4 or sum(size(v) for v in _CACHE.values())>192*1024*1024):
            _CACHE.popitem(last=False)
    return result
