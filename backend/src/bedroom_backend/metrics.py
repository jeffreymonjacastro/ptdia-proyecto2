"""Small, bounded, text-free samples for the job that owns GPU execution."""
import math
import re

STAGES = {"generation", "classification", "description", "summary"}


def sanitize_metric(value):
    if not isinstance(value, dict) or not isinstance(value.get("stage"), str) or value["stage"] not in STAGES:
        return None
    seconds, peak = value.get("seconds"), value.get("peak_bytes")
    if (isinstance(seconds, bool) or not isinstance(seconds, (int, float)) or not 0 <= seconds <= 1_000_000_000
            or not math.isfinite(seconds) or isinstance(peak, bool) or not isinstance(peak, int) or not 0 <= peak < 2**63):
        return None
    result = {"stage": value["stage"], "seconds": round(seconds, 6), "peak_bytes": peak}
    style, digest = value.get("style"), value.get("lora_sha256")
    if isinstance(style, str) and re.fullmatch(r"[a-z][a-z0-9-]{0,63}", style):
        result["style"] = style
    if isinstance(digest, str) and re.fullmatch(r"[0-9a-f]{64}", digest):
        result["lora_sha256"] = digest
    if isinstance(value.get("variant"), str) and value["variant"] in {"custom", "pretrained"}:
        result["variant"] = value["variant"]
    settings = value.get("settings")
    if isinstance(settings, dict):
        result["settings"] = {key: number for key, number in settings.items()
                              if key in {"steps", "strength", "scale", "guidance"}
                              and not isinstance(number, bool) and isinstance(number, (int, float))
                              and 0 <= number <= 1_000_000_000 and math.isfinite(number)}
    return result
