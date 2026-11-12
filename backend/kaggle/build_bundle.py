"""Build a private Kaggle upload folder from a local backend wheel."""

import argparse
from base64 import b64encode
import json
from pathlib import Path
import re


def install_cell(wheel):
    encoded = b64encode(wheel.read_bytes()).decode("ascii")
    return f"""from base64 import b64decode
from pathlib import Path
import subprocess
import sys

wheel = Path('/tmp') / {wheel.name!r}
wheel.write_bytes(b64decode({encoded!r}))
# The Kaggle image ships an older TorchAO that blocks PEFT even for float16 adapters.
subprocess.check_call([sys.executable, '-m', 'pip', 'uninstall', '-y', 'torchao'])
subprocess.check_call([sys.executable, '-m', 'pip', 'install', '-q', f'{{wheel}}[gpu]'])
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["smoke", "demo"])
    parser.add_argument("--wheel", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--slug", required=True, help="A new private owner/slug")
    parser.add_argument("--revision", required=True, help="Exact Qwen Hugging Face commit")
    parser.add_argument("--lora-dataset", default="jeffreyamc/plania-p2-jjs-luxury-bedroom-xl")
    parser.add_argument("--smoke-photo", type=Path, help="Public-domain JPEG fixture")
    args = parser.parse_args()

    if not re.fullmatch(r"[a-z0-9-]+/[a-z0-9-]+", args.slug):
        parser.error("Use an owner/slug with lowercase letters, digits, and hyphens")
    if args.slug.endswith("/plania-p2-sdxl-lora-bedroom-y-qwen3-vl-v5"):
        parser.error("Use a new notebook slug for this backend")
    if not re.fullmatch(r"[a-f0-9]{40}", args.revision):
        parser.error("Specify the exact 40-character Qwen commit")
    if args.mode == "smoke" and not args.smoke_photo:
        parser.error("--smoke-photo is required for a smoke run")

    args.output.mkdir(parents=True, exist_ok=True)
    installer = install_cell(args.wheel)
    revision = f"import os\nos.environ['QWEN_REVISION'] = {args.revision!r}\n"
    if args.mode == "smoke":
        filename = "bedroom_smoke.py"
        encoded = b64encode(args.smoke_photo.read_bytes()).decode("ascii")
        source = installer + revision + f"""
from bedroom_backend.smoke import run_smoke

fixture = Path('/tmp/public-bedroom-smoke.jpg')
fixture.write_bytes(b64decode({encoded!r}))
run_smoke(fixture, '/kaggle/working/bedroom-smoke')
"""
        (args.output / filename).write_text(source, encoding="utf-8")
    else:
        filename = "bedroom_demo.ipynb"
        preflight = revision + """from kaggle_secrets import UserSecretsClient

secrets = UserSecretsClient()
for name in ('HF_TOKEN', 'NGROK_TOKEN', 'BEDROOM_DATABASE_URL', 'SUPABASE_URL',
             'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY'):
    os.environ[name] = secrets.get_secret(name)
if 'sslmode=verify-full' in os.environ['BEDROOM_DATABASE_URL']:
    ca = Path('/tmp/bedroom-supabase-ca.pem')
    ca.write_text(secrets.get_secret('BEDROOM_DATABASE_CA'), encoding='utf-8')
    os.environ['PGSSLROOTCERT'] = str(ca)
os.environ.setdefault('BEDROOM_ORIGINS', 'http://localhost:5173')

from bedroom_backend.runtime import check_persistence
check_persistence()
print('PostgreSQL and the private bucket are reachable.')
"""
        launch = """from bedroom_backend.runtime import serve_kaggle
await serve_kaggle()
"""
        notebook = {
            "nbformat": 4, "nbformat_minor": 5,
            "metadata": {"kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"}},
            "cells": [
                {"cell_type": "markdown", "id": "setup", "metadata": {}, "source": [
                    "# Bedroom backend\n",
                    "Select two T4 GPUs and enable Internet. Attach the LoRA dataset and enable the secrets listed in the runbook.\n",
                ]},
                {"cell_type": "code", "id": "install", "metadata": {}, "execution_count": None,
                 "outputs": [], "source": installer.splitlines(keepends=True)},
                {"cell_type": "markdown", "id": "preflight-note", "metadata": {}, "source": [
                    "## Connect to Supabase\n", "Check the database and bucket before loading models.\n",
                ]},
                {"cell_type": "code", "id": "preflight", "metadata": {}, "execution_count": None,
                 "outputs": [], "source": preflight.splitlines(keepends=True)},
                {"cell_type": "markdown", "id": "launch-note", "metadata": {}, "source": [
                    "## Launch the API\n", "Keep this cell running for the demo.\n",
                ]},
                {"cell_type": "code", "id": "launch", "metadata": {}, "execution_count": None,
                 "outputs": [], "source": launch.splitlines(keepends=True)},
            ],
        }
        (args.output / filename).write_text(json.dumps(notebook, indent=2), encoding="utf-8")

    metadata = {
        "id": args.slug, "title": args.slug.split("/", 1)[1],
        "code_file": filename, "language": "python", "kernel_type": "script" if args.mode == "smoke" else "notebook",
        "is_private": True, "enable_gpu": True, "enable_internet": True, "machine_shape": "NvidiaTeslaT4",
        "dataset_sources": [args.lora_dataset], "competition_sources": [], "kernel_sources": [], "model_sources": [],
    }
    (args.output / "kernel-metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
