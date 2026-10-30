"""Build a native Mac Jianying draft from the isolated export manifest.
Requires the managed pyJianYingDraft==0.3.0 runtime. Never modifies user drafts.
Schema reference: https://github.com/Vincentwei1021/video-shotcraft/blob/main/jianying-export/mac_draft.py
"""
import copy
import json
from pathlib import Path
import sys
import time
import uuid
import math
import pyJianYingDraft as jy
from native_masks import make_mask, mask_geometry, make_stroke, stroke_safe_framing
from timing import placed_source_duration, normalize_frame_boundaries, bounded_source_duration, visible_subtitles, precise_audio_duration, jianying_draft_fps, non_overlapping_lanes

folder = Path(sys.argv[1]).resolve()
m = normalize_frame_boundaries(json.loads((folder / 'handoff.json').read_text()))
res = folder / 'Resources'
w, h, fps = m['settings']['width'], m['settings']['height'], m['settings']['fps']
script = jy.ScriptFile(w, h, jianying_draft_fps(fps), False)
tr = jy.Timerange
background = script.append_track(jy.TrackSpec(jy.TrackType.video, '画布背景'))
video = script.append_track(jy.TrackSpec(jy.TrackType.video, '主视频 · 可继续剪辑'))
cards = script.append_track(jy.TrackSpec(jy.TrackType.video, '独立动效卡片'))
pip = script.append_track(jy.TrackSpec(jy.TrackType.video, '画中画 · 原生蒙版'))
captions = script.append_track(jy.TrackSpec(jy.TrackType.text, '字幕 · 可编辑'))
voice = script.append_track(jy.TrackSpec(jy.TrackType.audio, '人声'))
music = script.append_track(jy.TrackSpec(jy.TrackType.audio, '背景音乐'))
sfx = script.append_track(jy.TrackSpec(jy.TrackType.audio, '音效'))
script.add_segment(jy.VideoSegment(str(res / 'background.png'), tr(0, m['duration'])), background)

def card_at(t):
    return next((c for c in m['cards'] if c['start'] <= t < c['start'] + c['duration']), None)

export_warnings = []
def usable_range(filename, target_start, source_start, source_duration, target_duration, material_duration):
    # Preserve the original playback rate and every following clip's position.
    ratio = source_duration / target_duration if target_duration > 0 else 1
    begin = max(0, source_start)
    available = max(0, min(source_start + source_duration, material_duration) - begin)
    if begin != source_start or available != source_duration:
        export_warnings.append(f'「{filename}」时间线 {target_start/1e6:.3f} 秒：源范围 {source_start/1e6:.3f}–{(source_start+source_duration)/1e6:.3f} 秒超出素材（{material_duration/1e6:.3f} 秒）；已保留可用画面 {available/1e6:.3f} 秒，后续片段位置不变，请在剪映调整。')
    return begin, available, round(available / ratio) if ratio > 0 else 0

def source_segment(filename, target_start, source_start, duration, **kwargs):
    material = jy.VideoMaterial(str(res / filename))
    begin, available, target_duration = usable_range(filename, target_start, source_start, duration, duration, material.duration)
    if target_duration <= 0: return None
    return jy.VideoSegment(material, tr(target_start, target_duration),
        source_timerange=tr(begin, available), **kwargs)

native_masks = {}
native_strokes = {}
def animation_value(item, local):
    animation=item.get('animation') or {}
    total=item.get('animationDuration',item['duration'])
    clock=item.get('animationOffset',0)+local
    enter=min(animation.get('enterSeconds',.6)*1e6,total/2)
    leave=min(animation.get('exitSeconds',.6)*1e6,total/2)
    ease=lambda p: (1-math.cos(math.pi*max(0,min(1,p))))/2
    ep=ease(clock/max(1,enter)); xp=ease((total-clock)/max(1,leave))
    start=animation.get('enter','none'); end=animation.get('exit','none')
    x=({'slide-left':-1,'slide-right':1}.get(start,0)*(1-ep)+
       {'slide-left':-1,'slide-right':1}.get(end,0)*(1-xp))
    alpha=(ep if start=='fade' else 1)*(xp if end=='fade' else 1)
    return x,alpha

def animation_samples(item):
    duration=item['duration']; animation=item.get('animation') or {}
    total=item.get('animationDuration',duration); offset=item.get('animationOffset',0)
    times={0,max(0,duration-1)}
    for phase,seconds in [('enter',animation.get('enterSeconds',.6)),('exit',animation.get('exitSeconds',.6))]:
        if animation.get(phase,'none')=='none': continue
        length=min(seconds*1e6,total/2)
        origin=0 if phase=='enter' else total-length
        for step in range(9):
            local=round(origin+length*step/8-offset)
            if 0<=local<duration:times.add(local)
    return sorted(times)

def add_native_animation(seg,item,base_x=0,slide=True):
    a=item.get('animation') or {}
    if a.get('enter','none')=='none' and a.get('exit','none')=='none': return
    ratio=item.get('sourceDuration',item['duration'])/max(1,item['duration'])
    for local in animation_samples(item):
        x,alpha=animation_value(item,local)
        source_time=item['sourceStart']+round(local*ratio)
        if slide and (a.get('enter','').startswith('slide-') or a.get('exit','').startswith('slide-')):
            seg.add_keyframe(jy.KeyframeProperty.position_x,source_time,base_x+2*x)
        if a.get('enter')=='fade' or a.get('exit')=='fade':
            seg.add_keyframe(jy.KeyframeProperty.alpha,source_time,alpha)
# Keep the user's original cuts intact. Only duplicate their intersections with
# half/full cards onto the PiP track; the opaque card itself covers the main video.
from camera_segments import camera_segments, camera_properties
from playback import visible_main_segments
for v in [part for original in m['videos'] if original.get('visible', True) for visible in (visible_main_segments(original,m['cards']) if m.get('pruneCoveredMainVideo') else [original]) for part in camera_segments(visible)]:
    a, b = v['start'], v['start'] + v['duration']
    keys=v.get('cameraKeyframes',[])
    animated_slide=any((v.get('animation') or {}).get(k,'').startswith('slide-') for k in ('enter','exit'))
    if animated_slide:
        if not keys:keys=[dict(time=t,scale=1,x=0,y=0) for t in animation_samples(v)]
        keys=[dict(k,x=k['x']+2*animation_value(v,k['time'])[0]) for k in keys]
    if m.get('staticCameraProperties'):
        base, animated = camera_properties(keys)
    else:
        # Keep the native transform convention from the user-verified baseline.
        base={'scale':1,'x':0,'y':0}
        animated={p:[(k['time'],k[p]) for k in keys] for p in base} if keys else {}
    main_segment = source_segment(v['file'], a, v['sourceStart'], b-a, volume=0,
        clip_settings=jy.ClipSettings(scale_x=base['scale'],scale_y=base['scale'],
                                     transform_x=base['x'],transform_y=base['y']))
    if main_segment is None: continue
    properties={'scale':jy.KeyframeProperty.uniform_scale,'x':jy.KeyframeProperty.position_x,'y':jy.KeyframeProperty.position_y}
    for channel, keys in animated.items():
        for time_offset,value in keys:
            main_segment.add_keyframe(properties[channel],v['sourceStart']+time_offset,value)
    add_native_animation(main_segment,v,slide=False)
    script.add_segment(main_segment, video)

# PiP keeps original source cuts; it never inherits main-camera subdivisions.
pip_entries=[]
for v in m['videos']:
    if not v.get('visible', True):
        continue
    a,b=v['start'],v['start']+v['duration']
    for c in m['cards']:
        p, r = c['presentation'], c.get('rect')
        if c.get('overlayOnVideo') or p['type'] == 'small' or not r or (p['type'] == 'full' and not p['fullPip']['enabled']):
            continue
        left, right = max(a,c['start']), min(b,c['start']+c['duration'])
        if left >= right: continue
        base = max(r['w']/w, r['h']/h)
        scale = base * c['zoom']
        cx = p['fullPip']['focusX'] * (w-r['w']/base) + r['w']/base/2
        cy = p['fullPip']['focusY'] * (h-r['h']/base) + r['h']/base/2
        scale, cx, cy = stroke_safe_framing(c,w,h,scale,cx,cy)
        settings = jy.ClipSettings(scale_x=scale, scale_y=scale,
            transform_x=(r['x']+r['w']/2-w/2-scale*(cx-w/2))/(w/2),
            transform_y=-(r['y']+r['h']/2-h/2-scale*(cy-h/2))/(h/2))
        pip_entries.append(dict(start=left,duration=right-left,video=v,card=c,settings=settings,
                                shape=mask_geometry(c,w,h,scale,cx,cy)))

for lane_index,lane_entries in enumerate(non_overlapping_lanes(pip_entries)):
    lane = pip if lane_index == 0 else script.append_track(
        jy.TrackSpec(jy.TrackType.video, f'画中画 · 原生蒙版 {lane_index + 1}'))
    for entry in lane_entries:
        v,c=entry['video'],entry['card']
        a=v['start']; left=entry['start']; right=left+entry['duration']
        seg = source_segment(v['file'], left, v['sourceStart']+left-a, right-left,
                             volume=0, clip_settings=entry['settings'])
        if seg is None: continue
        shape, config = entry['shape']
        native_masks[seg.segment_id] = make_mask(res,shape,config)
        if c.get('rim'):
            native_strokes[seg.segment_id] = make_stroke(res,c['rim']['color'])
        script.add_segment(seg, lane)

for lane_index,lane_cards in enumerate(non_overlapping_lanes(m['cards'])):
    lane = cards if lane_index == 0 else script.append_track(
        jy.TrackSpec(jy.TrackType.video, f'独立动效卡片 {lane_index + 1}'))
    for c in lane_cards:
        vp = c['viewport']; fit = min(w/vp['width'], h/vp['height'])
        settings = jy.ClipSettings(scale_x=1/fit, scale_y=1/fit,
            transform_x=(vp['x']+vp['width']/2-w/2)/(w/2),
            transform_y=-(vp['y']+vp['height']/2-h/2)/(h/2))
        material = jy.VideoMaterial(str(res/c['file']), material_name=c['name'])
        source_start, duration, target_duration = usable_range(c['name'], c['start'], round(c['sourceOffset'] * 1e6), c['duration'], c['duration'], material.duration)
        if target_duration <= 0: continue
        script.add_segment(jy.VideoSegment(material, tr(c['start'], target_duration),
            source_timerange=tr(source_start, duration), volume=0, clip_settings=settings), lane)

# Placed recordings and general intro assets remain individually editable.
recording_backgrounds=[item for item in m.get('placedMedia',[]) if item.get('recordingLayout')=='full']
for lane_index,entries in enumerate(non_overlapping_lanes(recording_backgrounds)):
    lane=script.append_track(jy.TrackSpec(jy.TrackType.video,f'录屏背景 {lane_index+1}'))
    for item in entries: script.add_segment(jy.VideoSegment(str(res/'background.png'),tr(item['start'],item['duration']),volume=0),lane)
for label in ('B-roll', 'B-roll 图片', '录屏视频', '录屏人物画中画', '主视频画中画'):
    for lane_index, entries in enumerate(non_overlapping_lanes([
            item for item in m.get('placedMedia', []) if item['track'] == label])):
        lane = script.append_track(jy.TrackSpec(jy.TrackType.video,
            label if lane_index == 0 else f'{label} {lane_index + 1}'))
        for item in entries:
            material = jy.VideoMaterial(str(res / item['file']), material_name=item['name'])
            target_duration = item['duration']
            source = {}
            if item['type'] != 'image':
                begin, available, target_duration = usable_range(item['name'], item['start'], item['sourceStart'], item['sourceDuration'], item['duration'], material.duration)
                if target_duration <= 0: continue
                item = dict(item, sourceStart=begin, sourceDuration=available, duration=target_duration)
                source = dict(source_timerange=tr(begin, available))
            rect=item.get('rect')
            settings=None
            if rect:
                sw,sh=item.get('sourceWidth') or w,item.get('sourceHeight') or h
                fit=min(w/sw,h/sh)
                mask=item.get('mask') or {}
                cover=mask.get('fit')=='cover'
                scale=(max if cover else min)(rect['w']/(sw*fit),rect['h']/(sh*fit))*mask.get('contentScale',1)
                if item.get('border'):
                    padding=8*min(w/1920,h/1080)
                    scale=max(scale,(rect['w']+2*padding)/(sw*fit),(rect['h']+2*padding)/(sh*fit))
                fx,fy=mask.get('contentFocusX',.5),mask.get('contentFocusY',.5)
                ox=(fx-.5)*(sw*fit*scale-rect['w'])-rect['w']*mask.get('contentX',0)/100
                oy=(fy-.5)*(sh*fit*scale-rect['h'])-rect['h']*mask.get('contentY',0)/100
                if item.get('border'):
                    limit_x=max(0,(sw*fit*scale-rect['w'])/2-padding)
                    limit_y=max(0,(sh*fit*scale-rect['h'])/2-padding)
                    ox=max(-limit_x,min(limit_x,ox))
                    oy=max(-limit_y,min(limit_y,oy))
                settings=jy.ClipSettings(scale_x=scale,scale_y=scale,
                    transform_x=(rect['x']+rect['w']/2-w/2-ox)/(w/2),
                    transform_y=-(rect['y']+rect['h']/2-h/2-oy)/(h/2))
            clip_options=dict(volume=0,**source)
            if settings is not None: clip_options['clip_settings']=settings
            seg=jy.VideoSegment(material, tr(item['start'], target_duration),**clip_options)
            add_native_animation(seg,item,base_x=settings.transform_x if settings is not None else 0)
            if label in ('录屏视频','录屏人物画中画','主视频画中画') and rect and item.get('mask',{}).get('enabled',True):
                native_masks[seg.segment_id]=make_mask(res,'circle' if label=='录屏人物画中画' or item.get('mask',{}).get('shape')=='circle' else 'rectangle',{
                    'width':rect['w']/(sw*fit*scale),'height':rect['h']/(sh*fit*scale),'centerX':2*ox/(sw*fit*scale),'centerY':-2*oy/(sh*fit*scale),'rotation':0,
                    'feather':0,'invert':False,'aspectRatio':1,
                    'roundCorner':min(1,2*item.get('radius',0)/min(rect['w'],rect['h']))})
                if item.get('border'):
                    native_strokes[seg.segment_id]=make_stroke(res,item['border']['color'])
            script.add_segment(seg, lane)

def rgb(color):
    color=color.lstrip('#')
    return tuple(int(color[i:i+2],16)/255 for i in (0,2,4))

def background_style(st):
    import re
    value=st.get('backgroundColor','rgba(40,43,47,.76)')
    if value in ('transparent','none'): return None
    nums=re.findall(r'[\d.]+',value)
    if value.startswith('rgb') and len(nums)>=3:
        color='#'+''.join(f'{int(float(n)):02x}' for n in nums[:3]); alpha=float(nums[3]) if len(nums)>3 else 1
    else: color=value; alpha=1
    return jy.TextBackground(color=color,alpha=alpha,round_radius=.24,height=.14,width=.14)

caption_lanes=[(captions,0)]
for c in visible_subtitles(m['subtitles']):
    # A subtitle crossing a card boundary is split to keep its placement aligned.
    a,b=c['start'],c['start']+c['duration']
    cuts=sorted({a,b}|{x for k in m['cards'] for x in [k['start'],k['start']+k['duration']] if a<x<b})
    for left,right in zip(cuts,cuts[1:]):
        card=card_at((left+right)/2)
        x=0
        if card and not card.get('overlayOnVideo') and card['presentation']['type']=='half': x=.5 if card['presentation']['halfSide']=='left' else -.5
        st=c.get('style',{})
        font_pixels=st.get('fontSize',32)*w/1280*c.get('autoFit',1)
        font_size=font_pixels/ h * 100
        seg=jy.TextSegment(c['text'],tr(left,right-left),
            style=jy.TextStyle(size=font_size, bold=st.get('fontWeight',700)>=600,
                italic=st.get('italic',False),underline=st.get('underline',False), color=rgb(st.get('color','#ffffff')),
                align={'left':0,'center':1,'right':2}.get(st.get('align'),1),auto_wrapping=True,max_line_width=.47 if x else .9),
            background=background_style(st),
            clip_settings=jy.ClipSettings(transform_x=x,transform_y=-(1-2*(20+h*.04+font_pixels*.82)/h),
                scale_x=st.get('scale',1),scale_y=st.get('scale',1)))
        lane_index=next((i for i,(_,end) in enumerate(caption_lanes) if end<=left),None)
        if lane_index is None:
            lane_index=len(caption_lanes)
            caption_lanes.append((script.append_track(jy.TrackSpec(jy.TrackType.text,f'字幕重叠 {lane_index} · 可编辑')),0))
        lane=caption_lanes[lane_index][0]
        script.add_segment(seg,lane)
        caption_lanes[lane_index]=(lane,right)

for role, label in [('voice','人声'),('source-bed','原片底音'),('music','背景音乐'),('sfx','音效')]:
    if role not in m.get('audio', {}): continue
    track = {'voice':voice,'music':music,'sfx':sfx}.get(role)
    if track is None: track=script.append_track(jy.TrackSpec(jy.TrackType.audio,label))
    material = jy.AudioMaterial(str(res/m['audio'][role]))
    material.duration = precise_audio_duration(res/m['audio'][role])
    script.add_segment(jy.AudioSegment(material,tr(0,m['duration']),volume=m.get('audioGains',{}).get(role,1)),track)

# Reserve the same content viewport as the workbench. The progress strip is
# a narrow video at the top, never a full-canvas transparent movie.
vp=m.get('contentViewport')
if vp and not m.get("fullBleed"):
    # Camera transforms move video content, never the fixed viewing window.
    # Keep the outer canvas opaque even when a zoom exceeds the card background.
    from PIL import Image, ImageDraw
    border_file=res/'canvas-boundary.png'
    border=Image.new('RGBA',(w,h),(17,19,24,255))
    ImageDraw.Draw(border).rectangle((vp['x'],vp['y'],vp['x']+vp['width']-1,vp['y']+vp['height']-1),fill=(0,0,0,0))
    border.save(border_file)
    boundary=script.append_track(jy.TrackSpec(jy.TrackType.video,'画布边界'))
    script.add_segment(jy.VideoSegment(str(border_file),tr(0,m['duration']),volume=0),boundary)
if m.get('chapter'):
    c=m['chapter']; fit=min(w/c['width'],h/c['height'])
    top=script.append_track(jy.TrackSpec(jy.TrackType.video,'章节进度条'))
    chapter_segment=source_segment(c['file'],0,0,m['duration'],volume=0,
        clip_settings=jy.ClipSettings(scale_x=1/fit,scale_y=1/fit,transform_y=1-c['height']/h))
    if chapter_segment is not None: script.add_segment(chapter_segment,top)

# The general editor supplies its own track adapter; spoken manifests never enter it.
general_adapter = None
if m.get('generalLayers'):
    import importlib.util
    spec = importlib.util.spec_from_file_location('general_jianying', Path(__file__).parents[2] / 'general' / 'jianying-native.py')
    general_adapter = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(general_adapter)
    general_adapter.populate(script, m, res, jy)
content=json.loads(script.dumps())
# Append order is an implementation detail; compositing follows shared scene roles.
def layer_rank(track):
    name=track['name']
    if name=='画布背景': return 0
    if name.startswith('主视频 ·'): return 10
    if name.startswith('录屏背景'): return 20
    if name.startswith('B-roll 图片'): return 35
    if name.startswith(('B-roll','录屏视频')): return 30
    if name.startswith('独立动效卡片'): return 40
    if name.startswith(('画中画','录屏人物画中画','主视频画中画')): return 50
    if name=='画布边界': return 60
    if track['type']=='text': return 70
    if name=='章节进度条': return 80
    return 0
content['free_render_index_mode_on']=True
for index,track in enumerate(content['tracks']):
    for segment in track['segments']:
        segment['render_index']=layer_rank(track)*1000+index
        segment['track_render_index']=layer_rank(track)

content['materials']['common_mask'] = list(native_masks.values())
video_materials = {v['id']:v for v in content['materials']['videos']}
for track in content['tracks']:
    for seg in track['segments']:
        if seg['id'] in native_masks:
            seg['enable_video_mask'] = True
            seg['extra_material_refs'].append(native_masks[seg['id']]['id'])
        if seg['id'] in native_strokes:
            # A material may also serve the unmasked main track; isolate PiP styling.
            material = copy.deepcopy(video_materials[seg['material_id']])
            material['id'] = str(uuid.uuid4()).upper()
            material['video_mask_stroke'] = native_strokes[seg['id']]
            content['materials']['videos'].append(material)
            seg['material_id'] = material['id']
            seg['enable_mask_stroke'] = True
# Use the same Chinese system font as the web preview, and retain the actual
# font reference in the package instead of letting Jianying choose its default.
font_file=res/'PingFang.ttc'
if not font_file.exists():
    import shutil
    fonts=list(Path('/System/Library/AssetsV2').glob('com_apple_MobileAsset_Font*/*.asset/AssetData/PingFang.ttc'))
    if fonts: shutil.copyfile(fonts[0],font_file)
if font_file.exists():
    for material in content['materials']['texts']:
        text=json.loads(material['content'])
        for style in text['styles']: style['font']={'id':'','path':str(font_file)}
        material['content']=json.dumps(text,ensure_ascii=False)
        material['font_path']=str(font_file)
        material['font_name']='PingFang SC'

if general_adapter is not None:
    general_adapter.decorate(content, m, res)

if vp:
    for track in content['tracks']:
        if track['name'] in ('章节进度条','画布背景','画布边界'): continue
        for seg in track['segments']:
            if m.get('fullBleed'):
                if track['name']=='主视频 · 可继续剪辑' or track['name'].startswith(('录屏背景','录屏视频','录屏人物画中画','主视频画中画','B-roll')): continue
                at=seg['target_timerange']['start']+seg['target_timerange']['duration']/2
                card=card_at(at)
                if track['name'].startswith('独立动效卡片') and card and (card.get('behindText') or card.get('layoutBaked')): continue
                if track['name']=='字幕 · 可编辑' and (not card or card['presentation']['type']=='small'): continue
            cs=seg.get('clip')
            if not cs: continue
            cs['transform']['x']=cs['transform']['x']*vp['scaleX']+(vp['x']+vp['width']/2-w/2)/(w/2)
            cs['transform']['y']=cs['transform']['y']*vp['scaleY']-(vp['y']+vp['height']/2-h/2)/(h/2)
            cs['scale']['x']*=vp['scaleX']; cs['scale']['y']*=vp['scaleY']
            for group in seg.get('common_keyframes',[]):
                prop=group.get('property_type')
                for key in group.get('keyframe_list',[]):
                    values=key.get('values',[])
                    if not values: continue
                    if prop=='KFTypeScaleX': values[0]*=vp['scaleX']
                    elif prop=='KFTypeScaleY': values[0]*=vp['scaleY']
                    elif prop=='KFTypePositionX': values[0]=values[0]*vp['scaleX']+(vp['x']+vp['width']/2-w/2)/(w/2)
                    elif prop=='KFTypePositionY': values[0]=values[0]*vp['scaleY']-(vp['y']+vp['height']/2-h/2)/(h/2)
now=int(time.time()*1e6)
draft_id=json.loads((folder/'draft_info.json').read_text())['id'] if (folder/'draft_info.json').exists() else str(uuid.uuid4()).upper()
content.update(id=draft_id,name=m['name'],duration=m['duration'],create_time=now//1000000,update_time=now//1000000)
# Do not copy device identifiers from unrelated user drafts. Verify this minimal
# platform record in the installed application before treating it as compatible.
for key in ['platform','last_modified_platform']:
    content[key].update(os='mac',app_source='lv')
records=[]
for kind,typ in [('videos','video'),('audios','music')]:
    for v in content['materials'][kind]:
        records.append(dict(create_time=now//1000000,duration=v['duration'],extra_info=v.get('material_name') or v.get('name') or Path(v['path']).name,
            file_Path=v['path'],height=v.get('height',0),width=v.get('width',0),id=v.get('local_material_id') or str(uuid.uuid4()),
            import_time=now//1000000,import_time_ms=now,item_source=1,md5='',metetype='photo' if v.get('type')=='photo' else typ,
            roughcut_time_range=dict(duration=-1,start=-1),sub_time_range=dict(duration=-1,start=-1),type=0))
meta=json.loads(Path(jy.assets.get_asset_path('DRAFT_META_TEMPLATE')).read_text())
meta.update(draft_id=draft_id,draft_name=m['name'],draft_fold_path=str(folder),draft_root_path=str(folder.parent),
    tm_draft_create=now,tm_draft_modified=now,tm_duration=m['duration'],draft_timeline_materials_size_=sum(p.stat().st_size for p in res.iterdir()))
meta['draft_materials']=[dict(type=0,value=records)]+[g for g in meta.get('draft_materials',[]) if g.get('type')!=0]
for name,data in [('draft_info.json',content),('draft_content.json',content),('draft_meta_info.json',meta)]:
    (folder/name).write_text(json.dumps(data,ensure_ascii=False,indent=2))
ids={v['id'] for group in content['materials'].values() if isinstance(group,list) for v in group if isinstance(v,dict) and 'id'in v}
for track in content['tracks']:
    for s in track['segments']:
        assert s['material_id'] in ids
        assert s['target_timerange']['duration']>0
        assert s['target_timerange']['start']+s['target_timerange']['duration']<=m['duration']
for r in records: assert Path(r['file_Path']).is_file()
print(json.dumps(dict(draft_id=draft_id,duration=content['duration'],tracks=[(t['name'],len(t['segments'])) for t in content['tracks']]),ensure_ascii=False))

(folder / "export-warnings.json").write_text(json.dumps(export_warnings,ensure_ascii=False,indent=2))

if export_warnings:
    (folder / "导出检查提示.txt").write_text("工程已生成。以下片段已按可用画面导出，可在剪映继续调整：\n\n" + "\n".join(export_warnings), encoding="utf-8")
