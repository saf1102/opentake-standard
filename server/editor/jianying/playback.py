"""Avoid decoding main A-roll while an opaque full-canvas card covers it."""
from camera_segments import sparse_camera_keys

def visible_main_segments(video, cards):
    intervals=[(video['start'],video['start']+video['duration'])]
    for c in cards:
        if not c.get('opaqueCanvas'):
            continue
        left,right=c['start'],c['start']+c['duration']
        intervals=[piece for a,b in intervals for piece in
                   ([(a,min(b,left))] if a<left else [])+
                   ([(max(a,right),b)] if b>right else []) if piece[1]>piece[0]]
    result=[]
    keys=video.get('cameraKeyframes',[])
    def value(t):
        if t<=keys[0]['time']:return dict(keys[0],time=t)
        if t>=keys[-1]['time']:return dict(keys[-1],time=t)
        a,b=next((a,b) for a,b in zip(keys,keys[1:]) if a['time']<=t<=b['time'])
        ratio=(t-a['time'])/(b['time']-a['time'])
        return dict(time=t,**{p:a[p]+ratio*(b[p]-a[p]) for p in ('scale','x','y')})
    for a,b in intervals:
        offset=a-video['start']
        part=dict(video,start=a,duration=b-a,sourceStart=video['sourceStart']+offset)
        if keys:
            end=offset+b-a-1
            samples=[value(offset)]+[k for k in keys if offset<k['time']<end]+[value(end)]
            part['cameraKeyframes']=sparse_camera_keys([dict(k,time=k['time']-offset) for k in samples])
        result.append(part)
    return result
