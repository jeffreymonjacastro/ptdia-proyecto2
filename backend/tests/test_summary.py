import json

import pytest

from bedroom_backend.models import KaggleModels
from bedroom_backend.summary import InvalidSummary, render_summary


INTRO = "Aquí tienes una descripción de los cambios visibles entre la primera y la segunda imagen:"
OBSERVATION = "Se ha añadido una luz cálida detrás del cabecero."
DESCRIPTION = f"{INTRO}\n\n*   **Iluminación:** {OBSERVATION}\n*   **Colores:** La paleta usa tonos beige."


def entry(description=DESCRIPTION):
    return {"version_id": "japanese-v1", "description": description, "label": "Japanese",
            "decision": "rejected", "reason": "Conservar el techo"}


@pytest.mark.parametrize("excerpt", [INTRO, "una descripción de los cambios visibles", "Iluminación:"])
def test_summary_rejects_introductory_text_and_headings(excerpt):
    with pytest.raises(InvalidSummary):
        render_summary([entry()], [{"version_id": "japanese-v1", "excerpt": excerpt}])


def test_summary_preserves_a_literal_visual_observation_and_recorded_reason():
    result = render_summary([entry()], [{"version_id": "japanese-v1", "excerpt": OBSERVATION}])
    assert result["rejected_version_ids"] == ["japanese-v1"]
    assert f"Observación visual: «{OBSERVATION}»" in result["summary"]
    assert "Motivo indicado: «Conservar el techo»" in result["summary"]
    assert INTRO not in result["summary"]


class TextModel(KaggleModels):
    """Exercise summary preparation without loading GPU weights."""

    def __init__(self, response):
        self.response = response
        self.prompts = []

    def vision_text(self, prompt, **kwargs):
        self.prompts.append(prompt)
        return json.dumps(self.response, ensure_ascii=False)


def test_qwen_selects_an_observation_instead_of_rewriting_consecutive_passages():
    description = "La iluminación es más brillante. Se añaden focos de techo."
    model = TextModel([{"version_id": "japanese-v1", "observation_id": 1}])
    result = model.summarize([entry(description)])
    assert result == [{"version_id": "japanese-v1", "excerpt": "Se añaden focos de techo."}]
    assert "Observación visual: «Se añaden focos de techo.»" in render_summary([entry(description)], result)["summary"]


@pytest.mark.parametrize("response", [
    [{"version_id": "japanese-v1", "observation_id": True}],
    [{"version_id": "japanese-v1", "observation_id": -1}],
    [{"version_id": "japanese-v1", "observation_id": 9}],
    [{"version_id": "japanese-v1", "observation_id": "0"}],
    [{"version_id": "japanese-v1", "observation_id": 0, "excerpt": "Texto inventado"}],
    [{"version_id": "unknown", "observation_id": 0}],
    [{"version_id": "japanese-v1", "observation_id": 0}] * 2,
    [],
])
def test_qwen_rejects_invalid_observation_selections(response):
    with pytest.raises(InvalidSummary):
        TextModel(response).summarize([entry()])


def test_qwen_can_explicitly_select_no_observation():
    result = TextModel([{"version_id": "japanese-v1", "observation_id": None}]).summarize([entry()])
    assert result == [{"version_id": "japanese-v1", "excerpt": None}]


def test_selected_observations_respect_the_excerpt_length_limit():
    description = "Se conserva la cama con " + "acabado de madera " * 30
    result = TextModel([{"version_id": "japanese-v1", "observation_id": 0}]).summarize([entry(description)])
    assert len(result[0]["excerpt"]) == 300
    assert result[0]["excerpt"] in description
    render_summary([entry(description)], result)


def test_selections_keep_all_versions_when_history_needs_multiple_batches():
    entries = [{**entry(f"Se conserva la cama {number}. Se añade la lámpara {number}."),
                "version_id": f"v-{number}"} for number in range(10)]

    class BatchedModel(TextModel):
        def vision_text(self, prompt, **kwargs):
            self.prompts.append(prompt)
            rows = json.loads(prompt.split("\n", 1)[1])
            return json.dumps([{"version_id": row["version_id"],
                                "observation_id": int(row["version_id"].split("-")[1]) % 2} for row in reversed(rows)])

    model = BatchedModel(None)
    result = render_summary(entries, model.summarize(entries))
    assert result["rejected_version_ids"] == ["v-0", "v-1", "v-2", "v-3", "v-4", "v-5", "v-6", "v-7", "v-8", "v-9"]
    assert result["summary"].count("Observación visual:") == 10
    assert "Observación visual: «Se conserva la cama 0.»" in result["summary"]
    assert "Observación visual: «Se añade la lámpara 9.»" in result["summary"]
    assert len(model.prompts) == 2


def test_qwen_selects_only_from_visual_content_in_legacy_descriptions():
    model = TextModel([{"version_id": "japanese-v1", "observation_id": 0}])
    result = model.summarize([entry()])
    assert result == [{"version_id": "japanese-v1", "excerpt": OBSERVATION}]
    assert OBSERVATION in model.prompts[0]
    assert INTRO not in model.prompts[0]
    assert "Conservar el techo" not in model.prompts[0]
    assert "Observación visual" in render_summary([entry()], result)["summary"]


def test_an_intro_without_visual_content_produces_no_visual_claim():
    model = TextModel([{"version_id": "japanese-v1", "excerpt": INTRO}])
    result = model.summarize([entry(INTRO)])
    summary = render_summary([entry(INTRO)], result)
    assert not model.prompts
    assert "Observación visual" not in summary["summary"]
    assert summary["rejected_version_ids"] == ["japanese-v1"]
    assert "Motivo indicado: «Conservar el techo»" in summary["summary"]


def test_intro_and_observation_on_one_line_preserves_the_observation():
    description = f"{INTRO} {OBSERVATION}"
    model = TextModel([{"version_id": "japanese-v1", "observation_id": 0}])
    result = model.summarize([entry(description)])
    assert OBSERVATION in model.prompts[0]
    assert INTRO not in model.prompts[0]
    assert OBSERVATION in render_summary([entry(description)], result)["summary"]


@pytest.mark.parametrize("description", [
    "A continuación se describen los cambios visibles:\n**Iluminación:** " + OBSERVATION,
    "Aquí tienes los cambios visibles entre la primera y la segunda imagen:\n" + OBSERVATION,
    "### Colores\n" + OBSERVATION,
])
def test_only_concrete_passages_are_offered_to_the_model(description):
    model = TextModel([{"version_id": "japanese-v1", "observation_id": 0}])
    result = model.summarize([entry(description)])
    payload = json.loads(model.prompts[0].split("\n", 1)[1])
    assert payload == [{"version_id": "japanese-v1", "observations": [{"id": 0, "text": OBSERVATION}]}]
    assert OBSERVATION in render_summary([entry(description)], result)["summary"]


def test_summary_keeps_ids_for_rows_without_content_alongside_visual_observations():
    with_content = {**entry(), "version_id": "luxury-v1", "decision": "accepted"}
    model = TextModel([{"version_id": "luxury-v1", "observation_id": 0}])
    result = model.summarize([entry(INTRO), with_content])
    summary = render_summary([entry(INTRO), with_content], result)
    assert summary["accepted_version_ids"] == ["luxury-v1"]
    assert summary["rejected_version_ids"] == ["japanese-v1"]
    assert summary["summary"].count("Observación visual") == 1


@pytest.mark.parametrize("heading", ["### Cambios visibles", "**Comparación de imágenes**"])
def test_markdown_section_headings_are_excluded_from_summary_excerpts(heading):
    description = f"{heading}\n{OBSERVATION}"
    with pytest.raises(InvalidSummary):
        render_summary([entry(description)], [{"version_id": "japanese-v1", "excerpt": heading.strip('# *')}])
    model = TextModel([{"version_id": "japanese-v1", "observation_id": 0}])
    model.summarize([entry(description)])
    assert heading.strip('# *') not in model.prompts[0]


def test_numbered_observations_do_not_offer_list_numbers_as_visual_content():
    description = f"1. **Iluminación:** {OBSERVATION}"
    with pytest.raises(InvalidSummary):
        render_summary([entry(description)], [{"version_id": "japanese-v1", "excerpt": "1."}])
    model = TextModel([{"version_id": "japanese-v1", "observation_id": 0}])
    model.summarize([entry(description)])
    payload = json.loads(model.prompts[0].split("\n", 1)[1])
    assert payload == [{"version_id": "japanese-v1", "observations": [{"id": 0, "text": OBSERVATION}]}]


def test_a_visual_observation_in_bold_keeps_its_literal_text():
    observation = "Se ha añadido una luz cálida detrás del cabecero"
    description = f"**{observation}**"
    model = TextModel([{"version_id": "japanese-v1", "observation_id": 0}])
    result = model.summarize([entry(description)])
    assert model.prompts
    assert observation in render_summary([entry(description)], result)["summary"]
