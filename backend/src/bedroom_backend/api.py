from datetime import datetime
from io import BytesIO
from typing import Annotated, Literal
from uuid import UUID

from fastapi import Depends, FastAPI, File, Form, Header, Path, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, Field
from psycopg import OperationalError
from psycopg_pool import PoolTimeout

from .service import Problem, Sessions

FILE_LIMIT = 10 * 1024 * 1024
BODY_LIMIT = FILE_LIMIT + 64 * 1024
MEDIA_TYPES = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}
IdempotencyKey = Annotated[str, Header(alias="Idempotency-Key", min_length=1, max_length=128, pattern=r"^[!-~]+$")]


class SessionLink(BaseModel):
    session_id: UUID
    job_id: UUID


class Job(BaseModel):
    id: UUID
    kind: Literal["initial", "regenerate", "summary", "delete"]
    status: Literal["queued", "running", "succeeded", "failed"]
    position: int | None
    progress: int
    error: str | None
    luxury_variant: Literal["custom", "pretrained"] | None = None


class OwnedJob(Job):
    session_id: UUID


SessionState = Literal["generating", "needs_confirmation", "rejected", "failed", "ready", "paused", "completed"]
Decision = Literal["accepted", "rejected"]


class SessionItem(BaseModel):
    id: UUID
    status: SessionState
    revision: int
    created_at: datetime


class RecordedDecision(BaseModel):
    version_id: UUID
    decision: Decision
    reason: str | None
    created_at: datetime


class ImageVersion(BaseModel):
    id: UUID
    number: int
    prompt: str
    seed: str
    description: str
    decision: Decision | None
    reason: str | None
    settings: dict
    provenance: dict
    created_at: datetime
    size_bytes: int
    image_url: str
    decisions: list[RecordedDecision]


class Variation(BaseModel):
    position: int
    style_id: str
    label: str
    current_version_id: UUID | None
    versions: list[ImageVersion]
    luxury_variant: Literal["custom", "pretrained"] | None = None
    luxury_variants: list[dict[str, str]] = Field(default_factory=list)


class RejectionEvent(BaseModel):
    version_id: UUID
    reason: str | None
    created_at: datetime


class Summary(BaseModel):
    revision: int
    accepted_version_ids: list[UUID]
    rejected_version_ids: list[UUID]
    historical_rejections: list[RejectionEvent]
    summary: str


class SessionDetail(SessionItem):
    preferences: str
    original_image_url: str
    variations: list[Variation]
    summary: Summary | None
    jobs: list[Job]


class DecisionInput(BaseModel):
    decision: Decision
    reason: str | None = Field(default=None, max_length=1000)


class DecisionResult(BaseModel):
    session_id: UUID
    version_id: UUID
    decision: Decision
    job_id: UUID | None = None


class PauseInput(BaseModel):
    paused: bool


class LuxuryModelInput(BaseModel):
    variant: Literal["custom", "pretrained"]
    version_id: UUID


class LuxuryModelResult(BaseModel):
    session_id: UUID
    version_id: UUID
    variant: Literal["custom", "pretrained"]


class BodyLimit:
    def __init__(self, app, limit):
        self.app = app
        self.limit = limit

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] not in {"POST", "PUT", "PATCH"}:
            await self.app(scope, receive, send)
            return
        length = dict(scope["headers"]).get(b"content-length")
        if length is not None and (not length.isdigit() or len(length) > 12 or int(length) > self.limit):
            await JSONResponse({"detail": "upload_too_large"}, status_code=413)(scope, receive, send)
            return

        read = 0

        async def limited_receive():
            nonlocal read
            message = await receive()
            read += len(message.get("body", b""))
            if read > self.limit:
                # Starlette closes partially spooled files on its multipart-error path.
                from starlette.formparsers import MultiPartException
                raise MultiPartException("request_body_limit")
            return message

        async def limited_send(message):
            if read > self.limit:
                if message["type"] == "http.response.start":
                    await JSONResponse({"detail": "upload_too_large"}, status_code=413)(scope, receive, send)
                return
            await send(message)

        await self.app(scope, limited_receive, limited_send)


def read_image(image):
    data = image.file.read(FILE_LIMIT + 1)
    if len(data) > FILE_LIMIT:
        raise Problem(413, "upload_too_large")
    try:
        with Image.open(BytesIO(data), formats=list(MEDIA_TYPES)) as source:
            if source.width * source.height > 25_000_000:
                raise Problem(413, "too_many_pixels")
            if getattr(source, "is_animated", False):
                raise Problem(422, "invalid_image")
            media_type = MEDIA_TYPES[source.format]
            source.load()
    except Image.DecompressionBombError as error:
        raise Problem(413, "too_many_pixels") from error
    except (UnidentifiedImageError, OSError, ValueError) as error:
        raise Problem(422, "invalid_image") from error
    return data, media_type


def respond(result):
    status, payload = result
    return JSONResponse(payload, status_code=status)


def create_app(repo, store, authenticate, catalog, models_ready, *, origins=(), lifespan=None):
    app = FastAPI(title="PlanIA Bedroom Backend", version="0.2.0", lifespan=lifespan)
    app.add_middleware(BodyLimit, limit=BODY_LIMIT)
    if origins:
        app.add_middleware(CORSMiddleware, allow_origins=list(origins),
                           allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
                           allow_headers=["Authorization", "Content-Type", "Idempotency-Key", "ngrok-skip-browser-warning"])
    sessions = Sessions(repo, store, catalog)
    bearer = HTTPBearer(auto_error=False)

    def owner(credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]):
        user = authenticate(credentials.credentials) if credentials else None
        if user is None:
            raise Problem(401, "unauthorized")
        return user

    Owner = Annotated[UUID, Depends(owner)]

    @app.exception_handler(Problem)
    async def problem_handler(_request: Request, error: Problem):
        headers = {"WWW-Authenticate": "Bearer"} if error.status == 401 else None
        return JSONResponse({"detail": error.code}, status_code=error.status, headers=headers)

    @app.exception_handler(OperationalError)
    @app.exception_handler(PoolTimeout)
    async def database_unavailable(_request: Request, _error):
        return JSONResponse({"detail": "database_unavailable"}, status_code=503)

    @app.get("/health")
    def health():
        try:
            if models_ready() and repo.ready() and store.ready():
                return {"status": "ready"}
        except Exception:
            pass
        return JSONResponse({"status": "unavailable"}, status_code=503)

    @app.post("/api/generations", response_model=SessionLink, status_code=202)
    def submit(user: Owner, key: IdempotencyKey, image: Annotated[UploadFile, File()],
               consent: Annotated[bool, Form()], preferences: Annotated[str, Form(max_length=2000)] = "",
               luxury_model: Annotated[Literal["custom", "pretrained"] | None, Form()] = None):
        if not consent:
            raise Problem(422, "consent_required")
        data, media_type = read_image(image)
        return respond(sessions.submit(user, key, data, media_type, preferences.strip(), luxury_model))

    @app.get("/api/generations", response_model=list[SessionItem])
    def history(user: Owner):
        return sessions.list(user)

    @app.get("/api/generations/{session_id}", response_model=SessionDetail)
    def detail(session_id: UUID, user: Owner):
        return sessions.detail(user, session_id)

    @app.get("/api/jobs/{job_id}", response_model=OwnedJob)
    def job(job_id: UUID, user: Owner):
        return sessions.get_job(user, job_id)

    def image_response(data, media_type):
        return Response(data, media_type=media_type,
                        headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"})

    @app.get("/api/generations/{session_id}/original", response_class=Response)
    def original(session_id: UUID, user: Owner):
        return image_response(*sessions.image(user, session_id))

    @app.get("/api/generations/{session_id}/versions/{version_id}/image", response_class=Response)
    def version_image(session_id: UUID, version_id: UUID, user: Owner):
        return image_response(*sessions.image(user, session_id, version_id))

    @app.patch("/api/generations/{session_id}")
    def pause(session_id: UUID, body: PauseInput, user: Owner):
        return sessions.pause(user, session_id, body.paused)

    @app.post("/api/generations/{session_id}/confirm-bedroom", response_model=SessionLink, status_code=202)
    def confirm(session_id: UUID, user: Owner, key: IdempotencyKey):
        return respond(sessions.change(user, key, session_id, "confirm", None,
                                       lambda conn, row: sessions.initial(conn, row, True)))

    @app.post("/api/generations/{session_id}/retry", response_model=SessionLink, status_code=202)
    def retry(session_id: UUID, user: Owner, key: IdempotencyKey):
        return respond(sessions.change(user, key, session_id, "retry", None,
                                       lambda conn, row: sessions.initial(conn, row, False)))

    @app.put("/api/generations/{session_id}/decisions/{version_id}", response_model=DecisionResult,
             responses={202: {"model": DecisionResult}})
    def decide(session_id: UUID, version_id: UUID, body: DecisionInput, user: Owner, key: IdempotencyKey):
        reason = (body.reason or "").strip() or None
        return respond(sessions.change(user, key, session_id, "decision", [str(version_id), body.decision, reason],
                                       lambda conn, row: sessions.decide(conn, row, version_id, body.decision, reason)))

    @app.post("/api/generations/{session_id}/variations/{position}/retry", response_model=SessionLink, status_code=202)
    def retry_slot(session_id: UUID, position: Annotated[int, Path(ge=1, le=5)], user: Owner, key: IdempotencyKey):
        return respond(sessions.change(user, key, session_id, "retry_slot", position,
                                       lambda conn, row: sessions.retry_slot(conn, row, position)))

    @app.put("/api/generations/{session_id}/luxury-model", response_model=SessionLink, status_code=202,
             responses={200: {"model": LuxuryModelResult}})
    def switch_luxury(session_id: UUID, body: LuxuryModelInput, user: Owner, key: IdempotencyKey):
        return respond(sessions.change(user, key, session_id, "luxury_model", [str(body.version_id), body.variant],
                                       lambda conn, row: sessions.switch_luxury(conn, row, body.version_id, body.variant)))

    @app.post("/api/generations/{session_id}/summary", response_model=Summary, responses={202: {"model": SessionLink}})
    def summary(session_id: UUID, user: Owner, key: IdempotencyKey):
        return respond(sessions.change(user, key, session_id, "summary", None, sessions.summarize))

    @app.delete("/api/generations/{session_id}", status_code=202)
    def delete(session_id: UUID, user: Owner):
        return sessions.delete(user, session_id)

    return app
