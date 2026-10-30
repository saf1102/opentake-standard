"""Native keyframes use source-media time, including the source trim offset."""
def camera_properties(keys):
    """Static transforms belong on the clip, not in repeated keyframes."""
    base = {p: keys[0][p] if keys else (1 if p == 'scale' else 0)
            for p in ('scale', 'x', 'y')}
    animated = {}
    for p in base:
        if keys and max(k[p] for k in keys)-min(k[p] for k in keys) > 1e-7:
            # Reduce each channel independently: an unchanged position must not
            # inherit scale keyframes, and a linear channel needs two endpoints.
            channel = [dict(k, **{q:0 for q in base if q != p}) for k in keys]
            animated[p] = [(k['time'], k[p]) for k in sparse_camera_keys(channel)]
    return base, animated

def sparse_camera_keys(keys, tolerance=1e-7):
    """Keep endpoints and non-linear bends with a bounded interpolation error."""
    if len(keys) <= 2:
        return keys
    keep = {0, len(keys)-1}
    pending = [(0, len(keys)-1)]
    while pending:
        left, right = pending.pop()
        a, b = keys[left], keys[right]
        if right-left <= 1 or b['time'] <= a['time']:
            continue
        worst, index = 0, None
        for i in range(left+1, right):
            ratio = (keys[i]['time']-a['time'])/(b['time']-a['time'])
            error = max(abs(keys[i][p]-(a[p]+ratio*(b[p]-a[p])))
                        for p in ('scale', 'x', 'y'))
            if error > worst:
                worst, index = error, i
        if worst > tolerance:
            keep.add(index)
            pending.extend([(left,index),(index,right)])
    return [keys[i] for i in sorted(keep)]

def camera_segments(video):
    keys = video.get('cameraKeyframes', [])
    if not keys:
        return [video]
    cuts = [0]
    for i in range(1, len(keys)-1):
        a, b, c = keys[i-1:i+2]
        if min(b['time']-a['time'], c['time']-b['time']) < 1000:
            continue
        slopes = [(b[p]-a[p])*1e6/(b['time']-a['time']) -
                  (c[p]-b[p])*1e6/(c['time']-b['time']) for p in ('scale','x','y')]
        if max(map(abs, slopes)) > .0001:
            cuts.append(i)
    cuts.append(len(keys)-1)
    result = []
    for left, right in zip(cuts, cuts[1:]):
        begin = keys[left]['time']
        end = keys[right]['time'] if right < len(keys)-1 else video['duration']
        if end <= begin:
            continue
        segment = dict(video, start=video['start']+begin,
                       sourceStart=video['sourceStart']+begin, duration=end-begin)
        segment['animationOffset'] = video.get('animationOffset',0) + begin
        segment['cameraKeyframes'] = sparse_camera_keys(
            [dict(k, time=k['time']-begin) for k in keys[left:right+1]])
        result.append(segment)
    return result
