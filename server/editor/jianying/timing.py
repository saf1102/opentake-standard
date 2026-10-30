"""Repair microsecond rounding at frame boundaries in older handoff manifests."""


def jianying_draft_fps(source_fps):
    """Use a stable preview clock while retaining the original source media.

    Jianying can decode 59.94/60 fps sources in a 30 fps timeline without
    transcoding.  LinkReader's generated 60 fps timelines fall behind realtime
    audio in fullscreen preview, while the same sources stay synchronized in a
    30 fps timeline.
    """
    fps = float(source_fps)
    return min(30, round(fps)) if fps > 0 else 30


def precise_audio_duration(filename):
    """Use the audio sample clock; MediaInfo rounds WAV duration to milliseconds."""
    import json
    import subprocess
    from fractions import Fraction
    probe = json.loads(subprocess.check_output([
        'ffprobe', '-v', 'error', '-select_streams', 'a:0',
        '-show_entries', 'stream=duration_ts,time_base', '-of', 'json', str(filename)
    ], timeout=30))['streams'][0]
    return round(int(probe['duration_ts']) * Fraction(probe['time_base']) * 1_000_000)


def normalize_frame_boundaries(manifest):
    fps = manifest['settings']['fps']
    def boundary(value):
        aligned = round(round(value * fps / 1_000_000) * 1_000_000 / fps)
        # Only repair rounding noise, never conceal a genuine clip overlap.
        return aligned if abs(aligned - value) <= 2 else value
    for group in ('videos', 'cards', 'subtitles', 'sfx', 'placedMedia'):
        for segment in manifest.get(group, []):
            begin = boundary(segment['start'])
            finish = boundary(segment['start'] + segment['duration'])
            segment['start'], segment['duration'] = begin, finish - begin
        # Legacy projects may already contain sub-microsecond residues from a
        # repeated timeline split. Jianying cannot represent them and its video
        # segment constructor divides by the zero target duration.
        manifest[group] = [segment for segment in manifest.get(group, []) if segment['duration'] > 0]
    return manifest


def bounded_source_duration(source_start, duration, material_duration, fps):
    """Allow up to three missing tail frames without stretching or re-rendering."""
    overflow = source_start + duration - material_duration
    if overflow <= 0:
        return duration
    if source_start < 0 or duration <= 0 or material_duration <= source_start:
        raise ValueError('Invalid or empty source range')
    if overflow > round(3_000_000 / fps):
        raise ValueError('Source range exceeds media duration by more than three frames')
    return material_duration - source_start


def visible_subtitles(segments):
    """Match preview: among active captions the latest start wins (stable last tie)."""
    import copy
    points=sorted({x for s in segments for x in (s['start'],s['start']+s['duration'])})
    result=[]
    for a,b in zip(points,points[1:]):
        active=[(i,s) for i,s in enumerate(segments) if s['start']<=a and s['start']+s['duration']>=b]
        if not active: continue
        i,s=max(active,key=lambda pair:(pair[1]['start'],pair[0]))
        if result and result[-1].get('_source_index')==i and result[-1]['start']+result[-1]['duration']==a:
            result[-1]['duration']+=b-a
        else:
            item=copy.deepcopy(s);item.update(start=a,duration=b-a,_source_index=i);result.append(item)
    return result


def non_overlapping_lanes(segments):
    """Distribute real overlaps across native tracks without changing timing.

    Jianying rejects overlapping segments on one track.  LinkReader allows
    independent motion cards to overlap, so those clips need separate native
    tracks rather than trimming either clip.
    """
    lanes = []
    for _, segment in sorted(enumerate(segments), key=lambda pair: (pair[1]['start'], pair[0])):
        lane_index = next((index for index, lane in enumerate(lanes)
                           if lane[-1]['start'] + lane[-1]['duration'] <= segment['start']), None)
        if lane_index is None:
            lanes.append([segment])
        else:
            lanes[lane_index].append(segment)
    return lanes


def placed_source_duration(filename, source_start, duration, material_duration, fps):
    """Preserve authored timing; short EOF tails are warnings, not edit decisions."""
    overflow = source_start + duration - material_duration
    if source_start < 0 or duration <= 0 or source_start >= material_duration:
        raise ValueError(f'Invalid source range: {filename}')
    if overflow > max(100_000, 1_000_000 / fps):
        raise ValueError(f'Source range exceeds media duration by {overflow / 1000:.1f} ms: {filename}')
    return duration
