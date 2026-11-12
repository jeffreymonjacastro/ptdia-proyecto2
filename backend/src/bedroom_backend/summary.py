from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationError


class InvalidSummary(ValueError):
    pass


class Excerpt(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    version_id: str
    excerpt: str | None = Field(max_length=300)


def render_summary(entries, model_output, rejections=()):
    try:
        excerpts = TypeAdapter(list[Excerpt]).validate_python(model_output)
    except ValidationError as error:
        raise InvalidSummary("Invalid summary format") from error
    lookup = {item.version_id: item.excerpt for item in excerpts}
    if len(lookup) != len(excerpts) or set(lookup) != {item["version_id"] for item in entries}:
        raise InvalidSummary("Summary does not match the recorded versions")

    accepted, rejected = [], []
    accepted_ids, rejected_ids = [], []
    for item in entries:
        version_id = item["version_id"]
        excerpt = lookup[version_id]
        if excerpt is not None and (not excerpt.strip() or excerpt not in item["description"]):
            raise InvalidSummary("Summary quotes a description that was not recorded")
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
