#!/usr/bin/env python3
"""Build a self-contained, read-only Client page that opens via file://."""

import base64
import json
import mimetypes
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "offline-client.html"
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"}
STEP_NAME = re.compile(r"^(\d+)(?:[-_](\d+))?$")

sys.path.insert(0, str(ROOT / "server"))
import state as woz_state  # noqa: E402


def script_safe(value):
    """Keep embedded data from accidentally closing its script element."""
    return value.replace("</", "<\\/")


def image_data(path):
    mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    return f"data:{mime};base64,{base64.b64encode(path.read_bytes()).decode('ascii')}"


def image_manifests():
    steps = {}
    icons = {}
    step_dir = ROOT / "images" / "steps"
    icon_dir = ROOT / "images" / "icon"
    if step_dir.is_dir():
        for path in sorted(step_dir.iterdir()):
            if not path.is_file() or path.suffix.lower() not in IMAGE_EXTENSIONS:
                continue
            match = STEP_NAME.match(path.stem)
            if not match:
                continue
            page, step = match.groups()
            key = str(int(page)) if step is None else f"{int(page)}-{int(step)}"
            steps[key] = image_data(path)
    if icon_dir.is_dir():
        for path in sorted(icon_dir.iterdir()):
            if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS:
                icons[path.stem] = image_data(path)
    return steps, icons


def offline_images(steps, icons):
    return """(function () {
  const manifest = %s;
  const icons = %s;
  const listeners = new Set();
  function get(page, step) {
    if (step != null && manifest[`${page}-${step}`]) return manifest[`${page}-${step}`];
    return manifest[String(page)] || "";
  }
  window.WozImages = {
    load() { listeners.forEach((fn) => fn(manifest)); return Promise.resolve(manifest); },
    get,
    icon: (...names) => names.map((name) => icons[String(name)]).find(Boolean) || "",
    has: (page, step) => Boolean(get(page, step)),
    hasOwn: (page, step) => Boolean(manifest[`${page}-${step}`]),
    onLoad(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
})();""" % (
        script_safe(json.dumps(steps, ensure_ascii=False)),
        script_safe(json.dumps(icons, ensure_ascii=False)),
    )


def offline_store():
    initial = script_safe(json.dumps(woz_state.default_state(), ensure_ascii=False))
    return """(function () {
  let state = %s;
  const listeners = new Set();
  window.WozStore = {
    get state() { return state; },
    get status() { return "connected"; },
    subscribe(fn) { listeners.add(fn); fn(state, null); return () => listeners.delete(fn); },
    onStatus(fn) { fn("connected"); return () => {}; },
    dispatch(action) {
      if (action.type === "setPage") {
        const previous = state;
        state = { ...state, currentIndex: action.index };
        listeners.forEach((fn) => fn(state, previous));
      }
      return Promise.resolve({ changed: action.type === "setPage" });
    },
  };
})();""" % initial


def main():
    html = (ROOT / "client" / "index.html").read_text(encoding="utf-8")
    css = (ROOT / "client" / "client.css").read_text(encoding="utf-8")
    html = html.replace(
        '<link rel="stylesheet" href="/client/client.css" />',
        f"<style>\n{css}\n</style>",
    )
    steps, icons = image_manifests()
    scripts = {
        "/data/recipe-data.js": (ROOT / "data" / "recipe-data.js").read_text(encoding="utf-8"),
        "/shared/format.js": (ROOT / "shared" / "format.js").read_text(encoding="utf-8"),
        "/shared/images.js": offline_images(steps, icons),
        "/shared/store.js": offline_store(),
        "/client/client.js": (ROOT / "client" / "client.js").read_text(encoding="utf-8"),
    }
    for src, contents in scripts.items():
        tag = f'<script src="{src}"></script>'
        if tag not in html:
            raise ValueError(f"Missing expected script tag: {tag}")
        html = html.replace(tag, f"<script>\n{script_safe(contents)}\n</script>")

    OUTPUT.write_text(html, encoding="utf-8")
    print(f"Created {OUTPUT} ({OUTPUT.stat().st_size / 1024 / 1024:.1f} MiB)")
    print(f"Embedded {len(steps)} step images and {len(icons)} stage icons")


if __name__ == "__main__":
    main()
