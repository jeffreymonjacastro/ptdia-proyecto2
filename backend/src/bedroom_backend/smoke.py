from importlib.metadata import version
import json
import os
from pathlib import Path
from time import perf_counter
import traceback
from uuid import UUID

from .catalog import effective_prompt, load_catalog
from .models import KaggleModels
from .summary import InvalidSummary, render_summary

PHOTO_SOURCE = "https://commons.wikimedia.org/wiki/File:Hotel-suite-bedroom.jpg"


def run_smoke(photo_path, output_dir):
    output = Path(output_dir)
    output.mkdir(parents=True, exist_ok=True)
    report = {"status": "running", "photo_source": PHOTO_SOURCE, "styles": []}
    start = perf_counter()

    def save():
        report["elapsed_seconds"] = round(perf_counter() - start, 3)
        (output / "smoke.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(report, ensure_ascii=False), flush=True)

    try:
        catalog = load_catalog(os.getenv("BEDROOM_CATALOG"))
        original = Path(photo_path).read_bytes()
        report["dependencies"] = {name: version(name) for name in ("torch", "transformers", "diffusers", "peft", "accelerate")}
        models = KaggleModels(os.getenv("BEDROOM_LORA_ROOT", "/kaggle/input"), os.environ["QWEN_REVISION"])
        report["devices"] = [models.torch.cuda.get_device_name(i) for i in range(2)]
        catalog = models.pin_profiles(catalog)
        report["classification"] = models.classify(original)
        if report["classification"] not in {"bedroom", "uncertain"}:
            raise RuntimeError("The reference bedroom was rejected")
        entries = []
        for index, profile in enumerate(catalog, 1):
            image = models.render(original, profile, effective_prompt(profile, "", None), index)
            description = models.describe(original, image)
            if not description:
                raise RuntimeError("Qwen returned an empty description")
            (output / f'{profile["id"]}.png').write_bytes(image)
            report["styles"].append({"style_id": profile["id"], "bytes": len(image),
                                     "description": description, **models.provenance()})
            entries.append({"version_id": str(UUID(int=index)), "description": description,
                            "label": profile["label"], "decision": "accepted", "reason": None})
            report["metrics"] = models.metrics
            save()

        profile = catalog[3]
        feedback = "Conservar la forma del techo"
        image = models.render(original, profile, effective_prompt(profile, "", feedback), 6)
        regenerated_description = models.describe(original, image)
        if not regenerated_description:
            raise RuntimeError("Qwen returned an empty regeneration description")
        (output / "attic-regenerated.png").write_bytes(image)
        report["regeneration_bytes"] = len(image)
        entries[3].update(decision="rejected", reason=feedback)
        entries.append({"version_id": str(UUID(int=6)), "description": regenerated_description,
                        "label": profile["label"], "decision": "accepted", "reason": None, "number": 2})
        for attempt in range(2):
            try:
                report["summary"] = render_summary(entries, models.summarize(entries))
                break
            except InvalidSummary:
                if attempt == 1:
                    raise
        report["status"] = "complete"
    except Exception as error:
        report.update(status="failed", error_type=type(error).__name__)
        # Smoke runs use a public fixture and no persistence credentials.
        traceback.print_exc()
    finally:
        save()
    return report
