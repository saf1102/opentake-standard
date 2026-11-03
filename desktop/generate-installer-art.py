"""Rebuild the NSIS sidebar from the existing logo; Pillow is build-time only."""
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont

root=Path(__file__).resolve().parent.parent
scale=4
im=Image.new('RGB',(164*scale,314*scale),'#122b2a')
draw=ImageDraw.Draw(im)
logo=Image.open(root/'public/opentake-icon-512.png').convert('RGBA').resize((76*scale,76*scale),Image.Resampling.LANCZOS)
im.paste(logo,(24*scale,30*scale),logo)
def text(x,y,value,size,color='#edf5ef'):
    font=ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',size*scale)
    draw.text((x*scale,y*scale),value,font=font,fill=color)
text(24,122,'OpenTake',20)
text(24,153,'Standard',15,'#ffc126')
draw.line((24*scale,201*scale,140*scale,201*scale),fill='#47615a',width=scale)
text(24,218,'录制 · 编辑 · 生成',11)
text(24,246,'完整离线组件',11,'#aac0b6')
text(24,268,'准备就绪，即刻创作',10,'#aac0b6')
out=root/'desktop/installer-assets/sidebar.bmp'
out.parent.mkdir(parents=True,exist_ok=True)
im.resize((164,314),Image.Resampling.LANCZOS).save(out)
print(out)
