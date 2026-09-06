"""Deploy with: modal deploy experiments/encrypted-relay/modal_app.py."""
import os
from pathlib import Path
import subprocess

import modal

ROOT = Path(__file__).parent
app = modal.App("banana-browser-relay")
# Explicit file list: never upload auth, local environment files, or the checkout.
image = (
    modal.Image.from_registry("node:22-bookworm-slim", add_python="3.12")
    .add_local_file(ROOT / "package.json", "/relay/package.json", copy=True)
    .add_local_file(ROOT / "package-lock.json", "/relay/package-lock.json", copy=True)
    .run_commands("cd /relay && npm ci --omit=dev --ignore-scripts")
)
for name in ["relay.mjs", "index.html", "experiment.js", "browser-oauth.mjs", "relay-config.json", "LICENSE", "modal_app.py", "README.md"]:
    image = image.add_local_file(ROOT / name, f"/relay/{name}", copy=True)


@app.function(image=image, cpu=0.125, memory=256, min_containers=1, max_containers=1, timeout=360)
@modal.concurrent(max_inputs=64)
@modal.web_server(5189, startup_timeout=20)
def web():
    public_url = web.get_web_url().rstrip("/")
    origins = [public_url, "https://aburkard.github.io", "https://andrewburkard.com",
               "http://127.0.0.1:5189", "http://127.0.0.1:5178"]
    subprocess.Popen(
        ["node", "/relay/relay.mjs"],
        env={**os.environ, "BIND_HOST": "0.0.0.0", "PORT": "5189",
             "BANANA_ALLOWED_ORIGINS": ",".join(origins)},
    )
