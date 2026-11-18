import re

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationError


INTRODUCTION = re.compile(
    r"^(?:aqu[ií] (?:tienes?|est[aá]n?)|a continuaci[oó]n|"
    r"(?:estos|estas) son (?:los cambios|las diferencias)|"
    r"(?:esta es|este es) (?:una? )?(?:descripci[oó]n|comparaci[oó]n|resumen)|"
    r"(?:descripci[oó]n|comparaci[oó]n|resumen) de (?:los cambios|las diferencias))\b",
    re.IGNORECASE,
)
VISUAL_LABELS = {
    "iluminación", "iluminacion", "colores", "materiales", "muebles", "distribución", "distribucion",
}


def visual_passages(description):
    """Keep literal source passages while removing introductions and Markdown labels."""
    passages = []
    content = re.sub(r"(?m)^[ \t]*(?:[-*+]|\d+[.)])[ \t]+", "", description)
    for segment in re.split(r"\n+|(?<=[.!?])\s+", content):
        passage = segment.strip()
        if re.match(r"^#{1,6}\s", passage) or re.fullmatch(
            r"\*\*(?:comparaci[oó]n|descripci[oó]n|resumen|cambios|an[aá]lisis|detalles)\b[^*.!?]*\*\*",
            passage, re.IGNORECASE,
        ):
            continue
        passage = passage.strip(" *_`")
        if INTRODUCTION.match(passage):
            passage = passage.partition(":")[2].strip(" *_`")
        label, separator, content = passage.partition(":")
        if separator and label.strip(" *_`").casefold() in VISUAL_LABELS:
            passage = content.strip(" *_`")
        if (
            passage and passage.casefold() not in VISUAL_LABELS
            and not passage.endswith(":") and not INTRODUCTION.match(passage)
        ):
            passages.append(passage)
    return passages


class InvalidSummary(ValueError):
    def __init__(self, message, *, code="invalid_output"):
        super().__init__(message)
        self.code = code


class ObservationSelection(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    version_id: str
    observation_id: int | None = Field(ge=0)


def selected_excerpts(inputs, model_output):
    """Resolve model-selected IDs to saved text, never to model-written quotes."""
    try:
        selections = TypeAdapter(list[ObservationSelection]).validate_python(model_output)
    except ValidationError as error:
        raise InvalidSummary("Invalid observation selection format", code="invalid_selection") from error
    lookup = {row["version_id"]: row["observations"] for row in inputs}
    ids = [selection.version_id for selection in selections]
    if len(set(ids)) != len(ids) or set(ids) != set(lookup):
        raise InvalidSummary("Selection does not match the requested versions", code="version_mismatch")
    excerpts = []
    for selection in selections:
        observations = lookup[selection.version_id]
        index = selection.observation_id
        if index is not None and index >= len(observations):
            raise InvalidSummary("Selected observation does not exist", code="invalid_selection")
        excerpts.append({"version_id": selection.version_id,
                         "excerpt": observations[index]["text"] if index is not None else None})
    return excerpts


class Excerpt(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    version_id: str
    excerpt: str | None = Field(max_length=300)


def render_summary(entries, model_output, rejections=()):
    try:
        excerpts = TypeAdapter(list[Excerpt]).validate_python(model_output)
    except ValidationError as error:
        raise InvalidSummary("Invalid summary format", code="invalid_format") from error
    lookup = {item.version_id: item.excerpt for item in excerpts}
    if len(lookup) != len(excerpts) or set(lookup) != {item["version_id"] for item in entries}:
        raise InvalidSummary("Summary does not match the recorded versions", code="version_mismatch")

    accepted, rejected = [], []
    accepted_ids, rejected_ids = [], []
    for item in entries:
        version_id = item["version_id"]
        excerpt = lookup[version_id]
        if excerpt is not None and (
            not excerpt.strip() or not any(excerpt in passage for passage in visual_passages(item["description"]))
        ):
            raise InvalidSummary("Summary must quote recorded visual content", code="ungrounded_excerpt")
        text = f'{item["label"]}, versión {item.get("number", 1)}.'
        if excerpt:
            text += f" Observación visual: «{excerpt}»."
        if item["reason"]:
            text += f' Motivo indicado: «{item["reason"]}».'
        if item["decision"] == "accepted":
            accepted_ids.append(version_id)
            accepted.append(text)
        else:
            rejected_ids.append(version_id)
            rejected.append(text)
    displayed = {item.get("decision_id") for item in entries if item["decision"] == "rejected"}
    extra_history = []
    history = []
    for event in rejections:
        history.append({
            "version_id": str(event["version_id"]), "reason": event["reason"],
            "created_at": event["created_at"].isoformat(),
        })
        if event["id"] not in displayed:
            text = f'{event["label"]}, versión {event["number"]}.'
            if event["reason"]:
                text += f' Motivo indicado: «{event["reason"]}».'
            extra_history.append(text)
    sections = ["Propuestas aceptadas", *accepted, "", "Propuestas rechazadas", *(rejected or ["Ninguna."])]
    if extra_history:
        sections.extend(["", "Rechazos anteriores", *extra_history])
    return {
        "historical_rejections": history,
        "accepted_version_ids": accepted_ids,
        "rejected_version_ids": rejected_ids,
        "summary": "\n".join(sections),
    }
