#!/usr/bin/env python3
"""WoZ 實驗用的靜態檔案伺服器 + 狀態中繼（只用 Python 標準函式庫）。

  python3 server/serve.py [--port 8000] [--host 0.0.0.0]

狀態是唯一真相且放在這裡，client 與 wizard 都只送 action：

  GET  /api/state    目前狀態 JSON
  GET  /api/events   SSE；連上時先推一次完整狀態，之後每次變更都推
  POST /api/action   套用一個 action，廣播新狀態，回 {"version": n}
"""

import argparse
import datetime
import json
import queue
import re
import socket
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote

import state as woz_state

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SESSIONS_DIR = PROJECT_ROOT / "sessions"
STEP_IMAGE_DIR = PROJECT_ROOT / "images" / "steps"
STAGE_ICON_DIR = PROJECT_ROOT / "images" / "icon"
STEP_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"}
# 檔名格式：<頁>-<步驟>（例如 3-2、03-02）＝第 3 頁第 2 個步驟；
# 只寫 <頁>（例如 3）＝整頁的預設圖，該頁沒有指定圖的步驟都用它。
STEP_IMAGE_NAME = re.compile(r"^(\d+)(?:[-_](\d+))?$")
# SSE 沒有訊息時多久送一次 keepalive 註解（順便偵測已斷線的連線）。
KEEPALIVE_SECONDS = 15

_lock = threading.Lock()
_state = woz_state.default_state()
_subscribers = set()
_session_log = None


def open_session_log():
    """每次啟動開一個新的紀錄檔，實驗結束後可直接拿來分析。"""
    global _session_log
    SESSIONS_DIR.mkdir(exist_ok=True)
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    path = SESSIONS_DIR / f"session-{stamp}.jsonl"
    _session_log = path.open("a", encoding="utf-8")
    return path


def log_action(action, snapshot):
    if _session_log is None:
        return
    exported = woz_state.export_payload(snapshot)
    _session_log.write(json.dumps({
        "ts": datetime.datetime.now().isoformat(timespec="milliseconds"),
        "action": action,
        "version": snapshot["version"],
        "currentIndex": snapshot["currentIndex"],
        "remaining": snapshot["remaining"],
        # 舊欄位保留相容性；另存完整狀態與可直接分析的排序紀錄。
        "state": snapshot,
        "records": exported["records"],
    }, ensure_ascii=False) + "\n")
    _session_log.flush()


def broadcast(snapshot):
    payload = json.dumps(snapshot, ensure_ascii=False)
    for subscriber in list(_subscribers):
        subscriber.put(payload)


def scan_step_images():
    """掃描 images/steps/，把檔名換算成 "頁-步驟" → 網址。

    每次請求都重新掃描，所以加了圖片只要重整瀏覽器，不用重啟 server。
    """
    images = {}
    if not STEP_IMAGE_DIR.is_dir():
        return images

    for path in sorted(STEP_IMAGE_DIR.iterdir()):
        if not path.is_file() or path.suffix.lower() not in STEP_IMAGE_EXTENSIONS:
            continue
        match = STEP_IMAGE_NAME.match(path.stem)
        if not match:
            continue
        page, step = match.group(1), match.group(2)
        # 去掉補零，3-2 與 03-02 視為同一個。
        key = str(int(page)) if step is None else f"{int(page)}-{int(step)}"
        images[key] = f"/images/steps/{quote(path.name)}"

    return images


def scan_stage_icons():
    """掃描 images/icon/，key 就是去掉副檔名的檔名。

    要用哪一個檔名由 client 決定（見 client.js 的 stageIcon）：
    「頁碼」→「餐點-階段」→「階段」，找到就用。
    """
    icons = {}
    if not STAGE_ICON_DIR.is_dir():
        return icons

    for path in sorted(STAGE_ICON_DIR.iterdir()):
        if not path.is_file() or path.suffix.lower() not in STEP_IMAGE_EXTENSIONS:
            continue
        icons[path.stem] = f"/images/icon/{quote(path.name)}"

    return icons


def local_ip():
    """取得對外的區網 IP（不會真的送出封包）。"""
    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        probe.connect(("8.8.8.8", 80))
        return probe.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        probe.close()


class WozHandler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PROJECT_ROOT), **kwargs)

    # --- 靜態檔案 ---------------------------------------------------------

    def end_headers(self):
        # 實驗期間常常邊改邊看，不要讓瀏覽器拿到舊的 JS/CSS。
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_request(self, *args, **kwargs):
        # 每次勾選都是一個請求，逐筆印出來太吵；錯誤仍會由 log_error 印出，
        # 完整的操作紀錄則在 sessions/*.jsonl。
        pass

    # --- 路由 -------------------------------------------------------------

    def do_GET(self):
        if self.path.startswith("/api/events"):
            self.handle_events()
        elif self.path.startswith("/api/export"):
            with _lock:
                payload = woz_state.export_payload(_state)
            stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
            self.send_download_json(payload, f"woz-records-{stamp}.json")
        elif self.path.startswith("/api/state"):
            with _lock:
                snapshot = dict(_state)
            self.send_json(snapshot)
        elif self.path.startswith("/api/images"):
            self.send_json({"images": scan_step_images(), "icons": scan_stage_icons()})
        else:
            super().do_GET()

    def do_POST(self):
        if not self.path.startswith("/api/action"):
            self.send_error(404, "Not Found")
            return

        length = int(self.headers.get("Content-Length") or 0)
        try:
            action = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            self.send_json({"error": "invalid JSON"}, status=400)
            return

        global _state
        with _lock:
            _state, changed = woz_state.apply_action(_state, action)
            snapshot = dict(_state)
            if changed:
                log_action(action, snapshot)
                broadcast(snapshot)

        self.send_json({"version": snapshot["version"], "changed": changed})

    # --- SSE --------------------------------------------------------------

    def handle_events(self):
        channel = queue.Queue()
        with _lock:
            _subscribers.add(channel)
            snapshot = dict(_state)

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("X-Accel-Buffering", "no")
        # 不送 Content-Length 也不做 chunked：明確關閉 keep-alive，
        # 讓「讀到 EOF」成為合法的訊息框架。（send_header 會順便設好
        # close_connection，end_headers 會補上 Cache-Control: no-store。）
        self.send_header("Connection", "close")
        self.end_headers()

        try:
            self.write_event(json.dumps(snapshot, ensure_ascii=False))
            while True:
                try:
                    self.write_event(channel.get(timeout=KEEPALIVE_SECONDS))
                except queue.Empty:
                    self.wfile.write(b": ping\n\n")
                    self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            with _lock:
                _subscribers.discard(channel)

    def write_event(self, payload):
        self.wfile.write(f"data: {payload}\n\n".encode("utf-8"))
        self.wfile.flush()

    # --- 工具 -------------------------------------------------------------

    def send_json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_download_json(self, payload, filename):
        body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class WozServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main():
    parser = argparse.ArgumentParser(description="WoZ 實驗伺服器")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--host", default="0.0.0.0", help="預設綁全部介面，跨機才連得到")
    args = parser.parse_args()

    log_path = open_session_log()
    server = WozServer((args.host, args.port), WozHandler)

    print("WoZ 實驗伺服器已啟動")
    print(f"  本機      http://localhost:{args.port}")
    print(f"  區網      http://{local_ip()}:{args.port}")
    print(f"  參與者    http://localhost:{args.port}/client/")
    print(f"  Wizard    http://localhost:{args.port}/wizard/")
    print(f"  Actor     http://localhost:{args.port}/actor/")
    print(f"  食譜頁數  {woz_state.SLIDE_COUNT}")
    print(f"  紀錄檔    {log_path.relative_to(PROJECT_ROOT)}")
    print("按 Ctrl-C 結束。")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止。")
    finally:
        server.server_close()
        if _session_log:
            _session_log.close()


if __name__ == "__main__":
    main()
