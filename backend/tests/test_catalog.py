import json

import pytest

from bedroom_backend.catalog import load_catalog
from bedroom_backend.summary import InvalidSummary, render_summary


def test_extra_profile_can_replace_one_without_changing_batch_size(tmp_path):
    catalog = load_catalog()
    profiles = list(catalog)
    custom = {**profiles[0], "id": "custom", "label": "Custom", "weights": "Custom.safetensors", "sha256": None, "variants": {}}
    path = tmp_path / "styles.json"
    path.write_text(json.dumps({"profiles": [*profiles, custom], "active": [p["id"] for p in profiles[1:]] + ["custom"]}))
    loaded = load_catalog(path)
    assert [style["id"] for style in loaded] == ["japanese", "neo-classic", "attic", "cyberpunk", "custom"]


def test_summary_rejects_invented_excerpts():
    entries = [{"version_id": "a", "description": "Cama blanca", "decision": "accepted", "reason": None, "label": "Luxury"}]
    with pytest.raises(InvalidSummary):
        render_summary(entries, [{"version_id": "a", "excerpt": "Cama azul"}])
