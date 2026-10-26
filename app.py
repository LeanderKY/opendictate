"""
OpenDictate starten: Engine + lokale Oberfläche (http://127.0.0.1) + Aufnahme-Anzeige.

  python app.py            normal starten (öffnet das Fenster)
  python app.py --no-ui    ohne Fenster starten
"""

import ctypes
import json
import mimetypes
import os
import secrets
import socket
import subprocess
import sys
import threading
import time
import tkinter as tk
import webbrowser
import winreg
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import engine as eng

PORT = int(os.environ.get("OPENDICTATE_PORT", 47821))
UI_DIR = eng.BASE / "ui"
SESSION_FILE = eng.DATA / "session.json"


# --------------------------------------------------------------------------- API
class Api(BaseHTTPRequestHandler):
    engine: eng.Engine
    token: str

    def log_message(self, *a):
        pass

    def _json(self, data, code=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _authorized(self):
        # Schützt davor, dass beliebige Webseiten im Browser die lokale API ansprechen
        return secrets.compare_digest(self.headers.get("X-Token", ""), self.token)

    def do_GET(self):
        url = urlparse(self.path)
        if url.path.startswith("/api/"):
            if not self._authorized():
                return self._json({"error": "unauthorized"}, 401)
            return self.api_get(url.path[5:], parse_qs(url.query))
        name = "index.html" if url.path in ("/", "") else url.path.lstrip("/")
        file = (UI_DIR / name).resolve()
        if UI_DIR.resolve() not in file.parents or not file.is_file():
            self.send_error(404)
            return
        body = file.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", (mimetypes.guess_type(file.name)[0] or "text/plain") + "; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        url = urlparse(self.path)
        if not url.path.startswith("/api/") or not self._authorized():
            return self._json({"error": "unauthorized"}, 401)
        length = int(self.headers.get("Content-Length", 0))
        data = json.loads(self.rfile.read(length) or b"{}")
        self.api_post(url.path[5:], data)

    def api_get(self, path, q):
        e = self.engine
        if path == "state":
            default, mics = eng.input_devices()
            return self._json({
                "settings": e.settings, "cleaning": e.cleaning,
                "mics": mics, "default_mic": default,
                "ollama_models": eng.ollama_models(e.settings),
                "history": e.history.since(0)[-200:],
            })
        if path == "poll":
            since = int(q.get("since", ["0"])[0])
            return self._json({
                "status": e.status, "message": e.message, "level": e.level,
                "model_info": e.model_info, "mic": e.mic_name,
                "history": e.history.since(since),
            })
        if path == "ollama":
            return self._json({"models": eng.ollama_models(e.settings), "cpu_share": eng.ollama_cpu_share(e.settings)})
        if path == "setup":
            return self._json({
                "gpu": e.gpu_name, "vram": e.vram, "recommended": eng.recommend(e.vram),
                "ollama": e.ollama.status(), "pull": e.ollama.pull,
                "status": e.status, "message": e.message, "model_info": e.model_info,
            })
        self._json({"error": "not found"}, 404)

    def api_post(self, path, data):
        e = self.engine
        if path == "settings":
            e.update_settings(data)
            return self._json({"ok": True})
        if path == "cleaning":
            e.update_cleaning(data)
            return self._json({"ok": True})
        if path == "test":
            t = time.time()
            cleaning = eng._merge(eng.DEFAULT_CLEANING, data.get("cleaning") or e.cleaning)
            text, info = eng.cleanup(data.get("raw", ""), e.settings, cleaning, data.get("app", ""))
            return self._json({"text": text, "info": info, "ms": round((time.time() - t) * 1000)})
        if path == "ollama/start":
            return self._json({"ok": e.ollama.start()})
        if path == "ollama/pull":
            e.ollama.start_pull(data.get("model") or e.settings["llm"]["model"])
            return self._json({"ok": True})
        if path == "pause":
            e.paused = bool(data.get("paused"))
            return self._json({"ok": True})
        if path == "history/clear":
            e.history.clear()
            return self._json({"ok": True})
        if path == "copy":
            eng.pyperclip.copy(data.get("text", ""))
            return self._json({"ok": True})
        if path == "quit":
            self._json({"ok": True})
            threading.Timer(0.2, lambda: os._exit(0)).start()
            return
        self._json({"error": "not found"}, 404)


# --------------------------------------------------------------------------- Fenster öffnen
def find_browser():
    for exe in ("msedge.exe", "chrome.exe", "brave.exe"):
        for hive in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
            try:
                with winreg.OpenKey(hive, rf"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\{exe}") as k:
                    path = winreg.QueryValue(k, None)
                    if path and Path(path).exists():
                        return path
            except OSError:
                pass
    return None


def open_ui(url):
    browser = find_browser()
    if browser:
        # Eigenes Profil, damit OpenDictate als eigenes App-Fenster läuft und nicht als Tab
        profile = Path(os.environ["LOCALAPPDATA"]) / "OpenDictate" / "ui-profile"
        subprocess.Popen([browser, f"--app={url}", f"--user-data-dir={profile}",
                          "--window-size=1120,780", "--no-first-run", "--no-default-browser-check"])
    else:
        webbrowser.open(url)


# --------------------------------------------------------------------------- Aufnahme-Anzeige
class Overlay:
    """Kleine Pille unten am Bildschirm. Nimmt nie den Fokus – sonst landet der Text im falschen Fenster."""

    W, H, KEY = 196, 40, "#ff00fe"

    def __init__(self, engine):
        self.engine = engine
        self.root = tk.Tk()
        self.root.overrideredirect(True)
        self.root.attributes("-topmost", True)
        self.root.attributes("-transparentcolor", self.KEY)
        self.root.configure(bg=self.KEY)
        sw, sh = self.root.winfo_screenwidth(), self.root.winfo_screenheight()
        self.root.geometry(f"{self.W}x{self.H}+{(sw - self.W) // 2}+{sh - self.H - 72}")
        self.canvas = tk.Canvas(self.root, width=self.W, height=self.H, bg=self.KEY, highlightthickness=0)
        self.canvas.pack()
        self.root.update_idletasks()
        u = ctypes.windll.user32
        self.hwnd = u.GetParent(self.root.winfo_id())
        ex = u.GetWindowLongW(self.hwnd, -20)
        u.SetWindowLongW(self.hwnd, -20, ex | 0x08000000 | 0x00000080 | 0x00000008)  # NOACTIVATE|TOOLWINDOW|TOPMOST
        self.visible = True
        self._show(False)
        self.levels = [0.0] * 14
        self.phase = 0
        self.tick()

    def _show(self, show):
        if show == self.visible:
            return
        self.visible = show
        u = ctypes.windll.user32
        if show:
            u.ShowWindow(self.hwnd, 4)  # SW_SHOWNOACTIVATE
            u.SetWindowPos(self.hwnd, -1, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010)  # TOPMOST, NOSIZE|NOMOVE|NOACTIVATE
        else:
            u.ShowWindow(self.hwnd, 0)

    def _pill(self, fill):
        c, w, h, r = self.canvas, self.W, self.H, self.H // 2
        c.create_oval(0, 0, h, h, fill=fill, outline=fill)
        c.create_oval(w - h, 0, w, h, fill=fill, outline=fill)
        c.create_rectangle(r, 0, w - r, h, fill=fill, outline=fill)

    def tick(self):
        e = self.engine
        status = e.status if e.settings.get("overlay", True) else "off"
        self._show(status in ("recording", "processing"))
        if self.visible:
            c = self.canvas
            c.delete("all")
            self._pill("#1b1a18")
            if status == "recording":
                c.create_oval(16, 15, 26, 25, fill="#e5484d", outline="")
                c.create_text(36, 20, text="Aufnahme", fill="#ecebe7", anchor="w", font=("Segoe UI", 10))
                self.levels = self.levels[1:] + [min(1.0, e.level * 14)]
                for i, lv in enumerate(self.levels):
                    x, hh = 112 + i * 5, 3 + lv * 20
                    c.create_rectangle(x, 20 - hh / 2, x + 2, 20 + hh / 2, fill="#ecebe7", outline="")
            else:
                self.phase = (self.phase + 1) % 30
                c.create_text(18, 20, text="Verarbeite", fill="#a9a59c", anchor="w", font=("Segoe UI", 10))
                for i in range(3):
                    on = (self.phase // 10) == i
                    c.create_oval(96 + i * 10, 17, 102 + i * 10, 23, fill="#ecebe7" if on else "#55524c", outline="")
        else:
            self.levels = [0.0] * len(self.levels)
        self.root.after(40, self.tick)

    def run(self):
        self.root.mainloop()


# --------------------------------------------------------------------------- Start
def already_running():
    with socket.socket() as s:
        return s.connect_ex(("127.0.0.1", PORT)) == 0


def main():
    no_ui = "--no-ui" in sys.argv
    if already_running():
        # Läuft schon: nur das Fenster nochmal öffnen
        try:
            s = json.loads(SESSION_FILE.read_text(encoding="utf-8"))
            open_ui(f"http://127.0.0.1:{PORT}/?t={s['token']}")
            print("OpenDictate läuft bereits – Fenster geöffnet.")
        except Exception:
            print(f"Port {PORT} ist belegt, aber OpenDictate-Sitzung nicht gefunden.")
        return

    engine = eng.Engine()
    engine.start()

    token = secrets.token_urlsafe(16)
    eng.DATA.mkdir(exist_ok=True)
    SESSION_FILE.write_text(json.dumps({"token": token, "port": PORT}), encoding="utf-8")
    Api.engine, Api.token = engine, token
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Api)
    threading.Thread(target=server.serve_forever, daemon=True).start()

    url = f"http://127.0.0.1:{PORT}/?t={token}"
    print(f"\nOpenDictate läuft. Oberfläche: {url}")
    print(f"Diktieren: [{engine.settings['hotkey']}] halten. Dieses Fenster offen lassen (schließen = beenden).\n")
    if not no_ui:
        open_ui(url)

    Overlay(engine).run()


if __name__ == "__main__":
    main()
