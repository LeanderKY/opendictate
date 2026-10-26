"""
Rendert video/intro.html Bild für Bild zu video/out/opendictate-intro.mp4 (1920x1080, 30 fps).

  pip install playwright imageio-ffmpeg
  python video/render.py            # nutzt das installierte Chrome
  python video/render.py 2 7.5 16   # nur Standbilder bei diesen Sekunden (zum Prüfen)
"""

import subprocess
import sys
from pathlib import Path

import imageio_ffmpeg
from playwright.sync_api import sync_playwright

FPS = 30
HERE = Path(__file__).resolve().parent
OUT = HERE / "out" / "opendictate-intro.mp4"


def stills(times):
    OUT.parent.mkdir(exist_ok=True)
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel="chrome")
        page = browser.new_page(viewport={"width": 1920, "height": 1080})
        page.goto((HERE / "intro.html").as_uri() + "?render")
        page.wait_for_function("window.seek && document.fonts.ready")
        for t in times:
            page.evaluate(f"seek({t})")
            page.screenshot(path=str(OUT.parent / f"still-{t:05.1f}.png"))
        browser.close()


def main():
    if len(sys.argv) > 1:
        return stills([float(a) for a in sys.argv[1:]])
    OUT.parent.mkdir(exist_ok=True)
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel="chrome")
        page = browser.new_page(viewport={"width": 1920, "height": 1080}, device_scale_factor=1)
        page.goto((HERE / "intro.html").as_uri() + "?render")
        page.wait_for_function("window.seek && document.fonts.ready")
        total = int(page.evaluate("DURATION") * FPS)

        # Sprecherstimme (falls vorhanden) mit dem Versatz aus intro.html dazumischen
        voice = HERE / "voiceover.mp3"
        audio = []
        if voice.exists():
            delay = int(page.evaluate("window.VO_OFFSET || 0") * 1000)
            audio = ["-i", str(voice), "-filter_complex", f"[1:a]adelay={delay}|{delay},apad[a]",
                     "-map", "0:v", "-map", "[a]", "-c:a", "aac", "-b:a", "192k", "-shortest"]
        ffmpeg = subprocess.Popen(
            [imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-loglevel", "error",
             "-f", "image2pipe", "-framerate", str(FPS), "-c:v", "png", "-i", "-", *audio,
             "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p",
             "-movflags", "+faststart", str(OUT)],
            stdin=subprocess.PIPE,
        )
        for i in range(total):
            page.evaluate(f"seek({i / FPS})")
            ffmpeg.stdin.write(page.screenshot(type="png"))
            if i % FPS == 0:
                print(f"\r{i // FPS:>3}/{total // FPS} s", end="", flush=True)
        browser.close()
    ffmpeg.stdin.close()
    sys.exit(ffmpeg.wait())


if __name__ == "__main__":
    main()
