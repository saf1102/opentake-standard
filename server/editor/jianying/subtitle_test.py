"""Task 25 evidence tests. JSON structure is not Jianying UI acceptance."""
import json
import shutil
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import pyJianYingDraft as jy
from PIL import Image


class SubtitleTest(unittest.TestCase):
    def build(self, subtitles, cards=(), resource_fonts=(), **options):
        with tempfile.TemporaryDirectory(prefix='task25-subtitle-') as root:
            folder = Path(root)
            resources = folder / 'Resources'
            resources.mkdir()
            for source, filename in resource_fonts:
                shutil.copyfile(source, resources / filename)
            Image.new('RGB', (1280, 720)).save(resources / 'background.png')
            manifest = dict(name='字幕结构回归', duration=6000000,
                            settings=dict(width=1280, height=720, fps=30),
                            videos=[], cards=list(cards), subtitles=subtitles,
                            audio={}, sfx=[])
            manifest.update(options)
            (folder / 'handoff.json').write_text(json.dumps(manifest))
            subprocess.run([sys.executable, str(Path(__file__).with_name('build.py')), root],
                           check=True, capture_output=True, timeout=30)
            return json.loads((folder / 'draft_content.json').read_text())

    @staticmethod
    def segments(draft):
        return [s for t in draft['tracks'] if t['type'] == 'text' for s in t['segments']]

    @staticmethod
    def card(start, side):
        return dict(start=start, duration=1000000, sourceOffset=0,
                    file='background.png', name='半卡',
                    viewport=dict(x=0, y=0, width=1280, height=720),
                    presentation=dict(type='half', halfSide=side))

    def test_current_builder_already_serializes_subtitle_material(self):
        draft = self.build([dict(start=0, duration=1000000, text='字幕')])
        self.assertEqual([m['type'] for m in draft['materials']['texts']], ['subtitle'])
        track = next(t for t in draft['tracks'] if t['segments'] and t['type'] == 'text')
        self.assertEqual((track['type'], track['flag'], track['attribute']), ('text', 0, 0))

    def test_styles_and_auto_wrapping_survive_real_serialization(self):
        style = dict(fontSize=40, fontWeight=700, italic=True, underline=True,
                     color='#9869dc', align='right', backgroundColor='rgba(40,43,47,.76)', scale=1.2)
        draft = self.build([dict(start=0, duration=1000000, text='第一行\n第二行', style=style, autoFit=.8)])
        material = draft['materials']['texts'][0]
        text = json.loads(material['content'])
        rich = text['styles'][0]
        self.assertEqual(text['text'], '第一行\n第二行')
        self.assertAlmostEqual(rich['size'], 40 * .8 / 720 * 100)
        self.assertTrue(all(rich[k] for k in ('bold', 'italic', 'underline')))
        self.assertEqual(rich['fill']['content']['solid']['color'], [152/255, 105/255, 220/255])
        self.assertEqual(material['alignment'], 2)
        self.assertEqual(material['line_max_width'], .9)
        self.assertEqual(material['background_alpha'], .76)
        self.assertEqual(material['background_color'], '#282b2f')
        self.assertEqual(self.segments(draft)[0]['clip']['scale'], dict(x=1.2, y=1.2))

    def test_card_boundaries_split_and_half_cards_shift_both_directions(self):
        draft = self.build([dict(start=0, duration=4000000, text='跨卡字幕')],
                           [self.card(1000000, 'left'), self.card(2000000, 'right')])
        segments = self.segments(draft)
        self.assertEqual([s['target_timerange'] for s in segments],
                         [dict(start=i*1000000, duration=1000000) for i in range(4)])
        self.assertEqual([s['clip']['transform']['x'] for s in segments], [0, .5, -.5, 0])
        materials = {m['id']: m for m in draft['materials']['texts']}
        self.assertEqual([materials[s['material_id']]['line_max_width'] for s in segments], [.9, .47, .47, .9])

    def test_plain_title_stays_text_with_library_api(self):
        title = jy.TextSegment('普通标题', jy.Timerange(0, 1000000))
        self.assertEqual(title.export_material()['type'], 'text')
        # This is a library control, not a claim that general text-video export
        # has become editable text.

    def test_srt_api_and_existing_auto_wrapping_use_same_material_fields(self):
        with tempfile.TemporaryDirectory(prefix='task25-srt-') as root:
            srt = Path(root) / 'captions.srt'
            srt.write_text('1\n00:00:00,000 --> 00:00:01,000\n字幕\n', encoding='utf-8')
            script = jy.ScriptFile(1280, 720, 30, False)
            style = jy.TextStyle(size=5, align=1, auto_wrapping=True)
            script.import_srt(str(srt), '字幕', text_style=style)
            imported = json.loads(script.dumps())['materials']['texts'][0]
            direct = jy.TextSegment('字幕', jy.Timerange(0, 1000000), style=style).export_material()
            imported.pop('id'); direct.pop('id')
            self.assertEqual(imported, direct)

    def test_overlaps_keep_full_duration_on_separate_tracks(self):
        draft = self.build([dict(start=0, duration=3000000, text='原字幕'),
                            dict(start=1000000, duration=1000000, text='重叠字幕')])
        tracks = [t for t in draft['tracks'] if t['type'] == 'text' and t['segments']]
        self.assertEqual(len(tracks), 2)
        self.assertCountEqual([s['target_timerange'] for t in tracks for s in t['segments']],
                              [dict(start=0, duration=3000000), dict(start=1000000, duration=1000000)])

    def test_overlap_lanes_share_full_bleed_viewport_placement(self):
        cues = [dict(start=0, duration=3000000, text='原字幕'),
                dict(start=1000000, duration=1000000, text='重叠字幕')]
        baseline = self.segments(self.build(cues))[0]['clip']
        for full_bleed in (False, True):
            with self.subTest(full_bleed=full_bleed):
                draft = self.build(cues, fullBleed=full_bleed,
                                   contentViewport=dict(x=0, y=36, width=1280, height=684,
                                                        scaleX=1, scaleY=.95))
                clips = [s['clip'] for s in self.segments(draft)]
                self.assertEqual(clips[0], clips[1])
                if full_bleed:
                    self.assertEqual(clips[0], baseline)
                else:
                    self.assertAlmostEqual(clips[0]['transform']['y'],
                                           baseline['transform']['y'] * .95 - .05)

    def test_general_style_keeps_font_colour_stroke_background_and_explicit_position(self):
        font = Path('/System/Library/Fonts/Helvetica.ttc')
        if not font.exists(): self.skipTest('需要本机可移交字体')
        style = dict(fontSizePx=36, fontWeight=400, italic=True, color='#9869dc', opacity=.7,
                     align='left', fontFamily='Helvetica', fontFile='preset.ttc',
                     strokeWidthPx=1.8, strokeColor='#ffffff', backgroundColor='rgba(20,40,60,.6)',
                     backgroundRadiusEm=.1, tracking=.05, lineHeight=1.3, rotate=-5,
                     box=dict(x=100, y=200, width=500, height=90), renderOrder=7)
        draft = self.build([dict(start=0, duration=3000000, text='ABC字幕', generalStyle=style,
                                 runs=[dict(start=1, end=3, color='#f00', underline=True)])],
                           resource_fonts=[(font, 'preset.ttc')])
        material = draft['materials']['texts'][0]
        rich = json.loads(material['content'])['styles']
        self.assertEqual(material['type'], 'subtitle')
        self.assertEqual(material['font_name'], 'Helvetica')
        self.assertTrue(material['font_path'].endswith('/preset-face-0.otf'))
        self.assertTrue(all(s['font']['path'].endswith('/preset-face-0.otf') for s in rich))
        self.assertEqual([s['range'] for s in rich], [[0,1],[1,3],[3,5]])
        self.assertEqual(rich[1]['fill']['content']['solid']['color'], [1,0,0])
        self.assertTrue(rich[1]['underline'])
        self.assertFalse(rich[0]['bold'])
        self.assertTrue(rich[0]['italic'])
        self.assertAlmostEqual(rich[0]['size'], 5)
        self.assertAlmostEqual(rich[0]['strokes'][0]['width'], .05)
        self.assertEqual(material['alignment'], 0)
        self.assertEqual(material['global_alpha'], .7)
        self.assertEqual(material['background_color'], '#14283c')
        self.assertEqual(material['background_alpha'], .6)
        self.assertAlmostEqual(material['letter_spacing'], .05)
        self.assertAlmostEqual(material['line_spacing'], .3)
        seg = self.segments(draft)[0]
        self.assertAlmostEqual(seg['clip']['transform']['x'], (350-640)/640)
        self.assertAlmostEqual(seg['clip']['transform']['y'], -(245-360)/360)
        self.assertEqual(seg['clip']['rotation'], -5)
        self.assertEqual(seg['render_index'], 70007000)

    def test_general_layout_measures_font_and_preserves_full_overlap_without_video_text(self):
        font = Path('/System/Library/Fonts/Helvetica.ttc')
        if not font.exists(): self.skipTest('需要本机可移交字体')
        style = dict(fontSizePx=30, fontFamily='Helvetica', fontFile='preset.ttc',
                     lineHeight=1.2, backgroundColor='transparent',
                     layout=dict(anchorX=.5, anchorY=1, x=640, y=650, maxWidth=900,
                                 paddingX=0, paddingY=0))
        cues = [dict(start=0, duration=3000000, text='AB\nCD', generalStyle=style),
                dict(start=1000000, duration=1000000, text='AB\nCD', generalStyle=style)]
        draft = self.build(cues, resource_fonts=[(font, 'preset.ttc')])
        tracks = [t for t in draft['tracks'] if t['type']=='text' and t['segments']]
        self.assertEqual(len(tracks), 2)
        self.assertEqual([s['target_timerange']['duration'] for s in self.segments(draft)], [3000000,1000000])
        clips = [s['clip'] for s in self.segments(draft)]
        self.assertEqual(clips[0], clips[1])
        self.assertAlmostEqual(clips[0]['transform']['x'], 0)
        self.assertAlmostEqual(clips[0]['transform']['y'], -(650-36-360)/360)
        self.assertTrue(all(m['type']=='subtitle' for m in draft['materials']['texts']))
        self.assertFalse(any(t['name'].startswith('通用文字') for t in draft['tracks']))

    def test_native_caption_painter_order_is_above_page_and_between_noncaption_videos(self):
        font = Path('/System/Library/Fonts/Helvetica.ttc')
        if not font.exists(): self.skipTest('需要本机可移交字体')
        general = dict(film=dict(width=1280,height=720,duration=6,ending='cut',segments=[dict(start=0,transition='cut')]),
                       picture=[dict(start=0,duration=1000000,file='background.png')],
                       textVideos=[dict(start=0,duration=1000000,file='background.png',renderOrder=0),
                                   dict(start=0,duration=1000000,file='background.png',renderOrder=2)])
        style = dict(fontSizePx=32,fontFamily='Helvetica',fontFile='preset.ttc',renderOrder=1,
                     backgroundColor='transparent',box=dict(x=0,y=0,width=500,height=40))
        draft = self.build([dict(start=0,duration=1000000,text='caption',generalStyle=style)],
                           resource_fonts=[(font,'preset.ttc')],generalLayers=general)
        ranks={t['name']:t['segments'][0]['render_index'] for t in draft['tracks'] if t['segments']}
        self.assertLess(ranks['通用画面页'],ranks['通用文字'])
        self.assertLess(ranks['通用文字'],ranks['字幕 · 可编辑'])
        self.assertLess(ranks['字幕 · 可编辑'],ranks['通用文字 2'])

    def test_chinese_primary_glyphs_keep_primary_font_and_ttc_uses_named_face(self):
        chinese=list(Path('/System/Library/AssetsV2').glob('com_apple_MobileAsset_Font*/*.asset/AssetData/PingFang.ttc'))
        latin=Path('/System/Library/Fonts/Helvetica.ttc')
        if not chinese or not latin.exists(): self.skipTest('需要本机中英文字库')
        style=dict(fontSizePx=32,fontFamily='PingFang SC',fontFile='primary.ttc',
                   fallbackFamily='Helvetica',fallbackFontFile='fallback.ttc',
                   backgroundColor='transparent',box=dict(x=100,y=100,width=600,height=100))
        draft=self.build([dict(start=0,duration=1000000,text='中文ABC',generalStyle=style)],
                         resource_fonts=[(chinese[0],'primary.ttc'),(latin,'fallback.ttc')])
        material=draft['materials']['texts'][0]
        rich=json.loads(material['content'])['styles']
        self.assertTrue(all('primary-face-' in item['font']['path'] for item in rich))
        # Reversing primary/fallback must retain Latin in Helvetica and use the
        # real CJK glyph coverage, not a blanket replacement of all Chinese.
        style.update(fontFamily='Helvetica',fontFile='fallback.ttc',fallbackFamily='PingFang SC',fallbackFontFile='primary.ttc')
        draft=self.build([dict(start=0,duration=1000000,text='ABC中文',generalStyle=style)],
                         resource_fonts=[(chinese[0],'primary.ttc'),(latin,'fallback.ttc')])
        rich=json.loads(draft['materials']['texts'][0]['content'])['styles']
        self.assertEqual([item['range'] for item in rich],[[0,3],[3,5]])
        self.assertIn('fallback-face-',rich[0]['font']['path'])
        self.assertIn('primary-face-',rich[1]['font']['path'])

    def test_css_rgba_and_hex_alpha_are_preserved(self):
        font=Path('/System/Library/Fonts/Helvetica.ttc')
        if not font.exists(): self.skipTest('需要本机字库')
        style=dict(fontSizePx=32,fontFamily='Helvetica',fontFile='font.ttc',
                   color='rgba(10,20,30,.5)',strokeColor='#ffffff80',strokeWidthPx=2,
                   backgroundColor='#1234',box=dict(x=0,y=0,width=500,height=40))
        draft=self.build([dict(start=0,duration=1000000,text='AB',generalStyle=style,
                              runs=[dict(start=1,end=2,color='rgba(100,150,200,.4)')])],
                         resource_fonts=[(font,'font.ttc')])
        material=draft['materials']['texts'][0]; rich=json.loads(material['content'])['styles']
        self.assertEqual(material['global_alpha'],1)
        self.assertEqual(rich[0]['fill']['content']['solid']['alpha'],.5)
        self.assertEqual(material['background_color'],'#112233')
        self.assertAlmostEqual(material['background_alpha'],0x44/255)
        self.assertAlmostEqual(rich[0]['strokes'][0]['content']['solid']['alpha'],0x80/255)
        self.assertEqual(rich[1]['fill']['content']['solid']['alpha'],.4)


if __name__ == '__main__':
    unittest.main()
