import json
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class Style(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(pattern=r"^[a-z][a-z0-9-]*$")
    label: str = Field(min_length=1)
    weights: str = Field(pattern=r"^[a-zA-Z0-9_.-]+\.safetensors$")
    revision: str = Field(min_length=1)
    sha256: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    trigger: str = Field(min_length=1)
    template: str = Field(min_length=1)
    scale: float = Field(ge=0, le=2)
    strength: float = Field(gt=0, le=1)
    steps: int = Field(gt=0)
    guidance: float = Field(gt=0)
    variant: Literal["custom", "pretrained"] | None = None
    negative_prompt: str = ""
    variants: dict[str, dict] = Field(default_factory=dict)

    @field_validator("label", "trigger", "template", "revision", mode="before")
    @classmethod
    def trim(cls, value):
        return value.strip() if isinstance(value, str) else value


def load_catalog(path=None):
    config = json.loads(Path(path or Path(__file__).with_name("styles.json")).read_text(encoding="utf-8"))
    profiles = {}
    for entry in config["profiles"]:
        profile = Style.model_validate(config.get("defaults", {}) | entry)
        profile.variants = {name: Style.model_validate(config.get("defaults", {}) | option | {"variant": name, "variants": {}}).model_dump(exclude={"variants"})
                            for name, option in profile.variants.items()}
        if profile.variants and (set(profile.variants) != {"custom", "pretrained"} or any(p["id"] != profile.id for p in profile.variants.values())):
            raise ValueError("Luxury choices must use the same style ID and both variants")
        if profile.id in profiles:
            raise ValueError(f"Duplicate style: {profile.id}")
        profiles[profile.id] = profile.model_dump()
    active = config["active"]
    if len(active) != 5 or len(set(active)) != 5 or any(key not in profiles for key in active):
        raise ValueError("The active catalog must contain five distinct, configured styles")
    return tuple(profiles[key] for key in active)


def selected_profile(profile):
    return {key: value for key, value in profile.items() if key != "variants"}


def luxury_variant(profile):
    return profile.get("variant") or ("custom" if profile["weights"] == "Luxury_UTEC_r8_step300.safetensors" else "pretrained")


def effective_prompt(profile, preferences, feedback):
    parts = [
        profile["trigger"], f'photorealistic bedroom, {profile["template"]}',
        "Preserve the existing layout, perspective, bed position, walls, ceiling, doors and windows.",
    ]
    if feedback:
        parts.append(f"User feedback for this revision: {feedback}")
    if preferences:
        parts.append(f"User preferences: {preferences}")
    return ". ".join(parts)
