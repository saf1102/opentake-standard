"""General-film adapter for the existing spoken draft writer; no alternate serialization."""
def populate(script,m,res,jy):
    g=m['generalLayers']; film=g['film']; us=lambda x:round(x*1e6)
    lanes={}; labels={'footage':'通用素材','picture':'通用画面页','textVideos':'通用文字','voice':'通用旁白','music':'通用配乐','sfx':'通用音效','finish':'通用整片效果','source':'通用素材原声'}
    from timing import non_overlapping_lanes
    g['_reverse']=[]
    for kind in labels:
        items=g.get(kind,[])
        for n,items in enumerate([[item] for item in items] if kind=='textVideos' else non_overlapping_lanes(items)):
            lane=script.append_track(jy.TrackSpec(jy.TrackType.audio if kind in ('voice','music','sfx','source') else jy.TrackType.video, labels[kind]+(f' {n+1}' if n else '')))
            for item in items:
                timerange=jy.Timerange(item['start'],item['duration'])
                if kind in ('voice','music','sfx','source'):
                    material=jy.AudioMaterial(str(res/item['file']))
                    from timing import precise_audio_duration
                    material.duration=precise_audio_duration(res/item['file'])
                    seg=jy.AudioSegment(material,timerange,source_timerange=jy.Timerange(item.get('sourceStart',0),item['duration']),volume=item.get('gain',1))
                else:
                    source=jy.Timerange(item.get('sourceStart',0),item.get('sourceDuration',item['duration']))
                    settings=jy.ClipSettings()
                    if kind=='footage':
                        sw,sh=item['width'],item['height'];w,h=film['width'],film['height'];fit=min(w/sw,h/sh)
                        scale=(max(w/sw,h/sh) if item.get('fit')=='cover' else fit)/fit
                        fx,fy=item.get('focus',[.5,.5]);ox=max(0,sw*fit*scale-w);oy=max(0,sh*fit*scale-h)
                        settings=jy.ClipSettings(scale_x=scale,scale_y=scale,transform_x=-(fx-.5)*ox/(w/2),transform_y=(fy-.5)*oy/(h/2))
                    seg=jy.VideoSegment(str(res/item['file']),timerange,source_timerange=source,volume=0,clip_settings=settings)
                    if item.get('reverse'):g['_reverse'].append(seg.segment_id)
                    if kind=='footage':
                        following=next((s for s in film['segments'][1:] if abs(us(s['start'])-(item['start']+item['duration']))<=2),None)
                        if following and following['transition'] in ('dissolve','dip-black','dip-white'):
                            key={'dissolve':'叠化','dip-black':'闪黑','dip-white':'闪白'}[following['transition']]
                            seg.add_transition(getattr(jy.TransitionType,key),duration=500000 if key=='叠化' else 300000)
                    # Opacity keys avoid dependence on downloadable animation resources.
                    if kind in ('footage','picture','textVideos','finish'):
                        fadein=item['start']==0 and film['segments'][0]['transition']=='fade'
                        fadeout=item['start']+item['duration']==us(film['duration']) and film['ending']=='fade'
                        start=item.get('sourceStart',0);rate=item.get('sourceDuration',item['duration'])/item['duration']
                        if fadein:
                            seg.add_keyframe(jy.KeyframeProperty.alpha,start,0);seg.add_keyframe(jy.KeyframeProperty.alpha,start+round(min(500000,item['duration']/2)*rate),1)
                        if fadeout:
                            seg.add_keyframe(jy.KeyframeProperty.alpha,start+round((item['duration']-min(500000,item['duration']/2))*rate),1);seg.add_keyframe(jy.KeyframeProperty.alpha,start+round((item['duration']-1)*rate),0)
                script.add_segment(seg,lane)


def decorate(content,m,res):
    g=m['generalLayers'];rank={'通用素材':10000,'通用画面页':40000,'通用文字':70000,'通用整片效果':90000}; text_index=0
    for track in content['tracks']:
        r=next((v for k,v in rank.items() if track['name'].startswith(k)),0)
        if track['name'].startswith('通用文字'):
            r+=text_index; text_index+=1
        if r:
            for seg in track['segments']:
                seg['render_index']=r*1000;seg['track_render_index']=r
                if seg['id'] in g['_reverse']:seg['reverse']=True
