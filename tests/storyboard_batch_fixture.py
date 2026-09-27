"""Local synthetic pictures for storyboard_batch_smoke.cjs; no external assets."""
from pathlib import Path
import sys
from PIL import Image, ImageDraw

output = Path(sys.argv[1])
output.mkdir(parents=True, exist_ok=True)
for index, color in enumerate(['#436b81', '#ab7858', '#52654c']):
    image = Image.new('RGB', (480, 300), color)
    draw = ImageDraw.Draw(image)
    draw.ellipse((285, 30, 370, 115), fill='#edd9b7')
    draw.polygon([(0, 300), (180, 80), (350, 300)], fill='#253a49')
    draw.polygon([(170, 300), (350, 155), (480, 300)], fill='#375561')
    image.save(output / f'fixture-{index}.png')
