from contextlib import asynccontextmanager
import logging
import os
from threading import Event, Thread

import httpx
import uvicorn

from .api import create_app
from .catalog import load_catalog
from .models import KaggleModels, resolve_weight
from .repository import Repository
from .supabase import SupabaseAuth, SupabaseStorage
from .worker import Worker


def persistence_clients():
    repo = Repository(os.environ["BEDROOM_DATABASE_URL"])
    client = httpx.Client(base_url=os.environ["SUPABASE_URL"], timeout=httpx.Timeout(30, connect=5))
    store = SupabaseStorage(client, os.environ["SUPABASE_SECRET_KEY"],
                            os.getenv("BEDROOM_BUCKET", "bedroom-private"))
    auth = SupabaseAuth(client, os.environ["SUPABASE_PUBLISHABLE_KEY"])
    return repo, client, store, auth


def check_persistence():
    repo, client, store, _ = persistence_clients()
    with client, repo:
        repo.ready()
        if not store.ready():
            raise RuntimeError("The bedroom image bucket must be private")


def check_lora_inputs():
    catalog = load_catalog(os.getenv("BEDROOM_CATALOG"))
    root = os.getenv("BEDROOM_LORA_ROOT", "/kaggle/input")
    profiles = [option for profile in catalog for option in (profile, *profile.get("variants", {}).values())]
    unique = {(profile["weights"], profile.get("sha256")): profile for profile in profiles}
    for profile in unique.values():
        resolve_weight(root, profile)
    return len(unique)


def create_runtime(*, tunnel=False):
    # Diffusers can quote truncated prompt text in warnings.
    logging.getLogger("diffusers").setLevel(logging.ERROR)
    catalog = load_catalog(os.getenv("BEDROOM_CATALOG"))
    check_lora_inputs()
    models = KaggleModels(os.getenv("BEDROOM_LORA_ROOT", "/kaggle/input"),
                          os.environ["QWEN_REVISION"], os.getenv("HF_HOME"))
    catalog = models.pin_profiles(catalog)
    repo, client, store, auth = persistence_clients()
    port = int(os.getenv("BEDROOM_PORT", "8000"))
    stop = Event()
    worker = Thread(target=Worker(repo, store, models).serve, args=(stop,), daemon=True)

    @asynccontextmanager
    async def lifespan(_app):
        public_url = None
        with client, repo:
            try:
                if not store.ready():
                    raise RuntimeError("The bedroom image bucket must be private")
                if tunnel:
                    from pyngrok import ngrok
                    ngrok.set_auth_token(os.environ["NGROK_TOKEN"])
                    public_url = ngrok.connect(addr=port, proto="http").public_url
                    print(f"Bedroom API: {public_url}/docs", flush=True)
                worker.start()
                yield
            finally:
                stop.set()
                if worker.is_alive():
                    worker.join(timeout=10)
                if public_url:
                    ngrok.disconnect(public_url)
                    ngrok.kill()

    origins = tuple(origin.strip() for origin in os.getenv("BEDROOM_ORIGINS", "").split(",") if origin.strip())
    app = create_app(repo, store, auth, catalog, worker.is_alive, origins=origins, lifespan=lifespan)
    return app, port


async def serve_kaggle():
    app, port = create_runtime(tunnel=True)
    await uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, access_log=False)).serve()


def main():
    logging.basicConfig(level=logging.INFO)
    app, port = create_runtime()
    uvicorn.run(app, host="127.0.0.1", port=port, access_log=False)
