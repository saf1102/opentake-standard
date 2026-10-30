"""Native editable masks for Jianying 11.3; verified against local app imports.
common_mask + category=video are required; legacy materials.masks is ignored.
"""
from pathlib import Path
import shutil
import uuid

RESOURCES = {
    'circle': ('82432977', '3ab1c47350d987c8ad415497e020a38b', '7356934080102928946', '圆形'),
    'rectangle': ('82432980', '02b8999168d121538a98ea59127483ef', '7356934318301647410', '矩形'),
}

def make_mask(resources, shape, config):
    effect, digest, rid, name = RESOURCES[shape]
    target = Path(resources) / ('native-mask-' + shape)
    if not target.exists():
        source = Path.home() / 'Movies/JianyingPro/User Data/Cache/effect' / effect / digest
        if not (source / 'config.json').is_file():
            raise RuntimeError('请先在剪映中使用一次%s蒙版，下载本机蒙版资源后重新导出。' % name)
        shutil.copytree(source, target)
    return dict(id=str(uuid.uuid4()).upper(), type='mask', category='video', category_name='',
        category_id='', panel='', is_old_version=False, resource_id=rid,
        constant_material_id=str(uuid.uuid4()).upper(), name=name, resource_type=shape,
        path=str(target), position_info='', config=dict(expansion=0, **config),
        text_config=dict(content='',font_name='',font_path='',font_resource_id='',font_size=15,
            bold_width=0,italic_degree=0,has_underline=False,line_gap=0,char_spacing=0,align_type=15,scale=1),
        platform='all',loader_work_space='',track_segment='',contour_path=None,source_platform=0)


def stroke_safe_framing(card, w, h, scale, cx, cy):
    """Keep the output aperture fixed, with source pixels beyond its stroke.

    A cover-fit mask can touch the source texture's top/bottom. Jianying clips
    the native stroke there, so reserve a small output-space gutter in the
    source transform, not by shrinking or moving the output mask.
    """
    if not card.get('rim'):
        return scale, cx, cy
    r = card['rect']
    padding = 8 * min(w / 1920, h / 1080)
    scale = max(scale, (r['w'] + 2*padding)/w, (r['h'] + 2*padding)/h)
    half_w = (r['w']/2 + padding)/scale
    half_h = (r['h']/2 + padding)/scale
    return scale, max(half_w,min(w-half_w,cx)), max(half_h,min(h-half_h,cy))


def mask_geometry(card, w, h, scale, cx, cy):
    r, p = card['rect'], card['presentation']
    circle = p['fullPip']['shape'] == 'circle' if p['type'] == 'full' else p['aRollMask'] == 'circle'
    radius = card.get('radius', 0) if p['type'] == 'half' else (card.get('rim') or {}).get('radius', 0)
    return ('circle' if circle else 'rectangle', dict(
        width=r['w']/scale/w, height=r['h']/scale/h,
        centerX=(cx-w/2)/(w/2), centerY=-(cy-h/2)/(h/2),
        rotation=0, feather=0, invert=False, aspectRatio=1,
        roundCorner=min(1, 2*radius/min(r['w'],r['h']))))


def make_stroke(resources, color, size=0.01):
    """The native artist effect is required in addition to mask-stroke parameters."""
    rid = '7563928939278765348'
    target = Path(resources) / 'native-mask-stroke'
    if not target.exists():
        root = Path.home() / 'Movies/JianyingPro/User Data/Cache/artistEffect' / rid
        candidates = sorted(root.glob('*/config.json'))
        if not candidates:
            raise RuntimeError('请先在剪映中启用一次蒙版描边，下载本机描边资源后重新导出。')
        shutil.copytree(candidates[-1].parent, target)
    return dict(resource_id=rid, path=str(target), type='mask-stroke-single',
        color=color.upper(), size=size, alpha=1, distance=0, texture=0,
        horizontal_shift=0, vertical_shift=0)
