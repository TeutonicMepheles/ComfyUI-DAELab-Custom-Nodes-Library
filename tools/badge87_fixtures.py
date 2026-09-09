"""Create deterministic local inputs for tests/badge87_cases.json."""
import argparse
from pathlib import Path
from PIL import Image, ImageDraw


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input-directory', required=True)
    args = parser.parse_args()
    folder = Path(args.input_directory) / 'badge87-tests'
    folder.mkdir(parents=True, exist_ok=True)
    image = Image.new('RGB', (1024, 1024), 'white')
    draw = ImageDraw.Draw(image)
    draw.ellipse((128,128,896,896), fill='#aaaaaa')
    draw.ellipse((160,160,864,864), fill='#0055aa')
    draw.polygon(((260,700),(510,300),(760,700)), fill='#aa0000')
    draw.ellipse((580,290,700,410), fill='#ffaa00')
    for filename in ('flat.png', 'height.png'):
        image.save(folder / filename)
    wide = Image.new('RGBA', (1024,512), (255,255,255,0))
    ImageDraw.Draw(wide).rounded_rectangle((200,100,824,400), radius=35, fill=(174,11,9,255))
    wide.save(folder / 'wide-alpha.png')
    print(folder)


if __name__ == '__main__': main()
