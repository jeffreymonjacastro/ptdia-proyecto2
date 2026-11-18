import json
from uuid import UUID

import httpx
import pytest

from bedroom_backend.service import Problem
from bedroom_backend.supabase import SupabaseAuth, SupabaseStorage


def test_auth_accepts_only_a_validated_nonanonymous_user():
    def send(request):
        assert request.url.path == "/auth/v1/user"
        assert request.headers["apikey"] == "sb_publishable_test"
        token = request.headers["Authorization"]
        if token == "Bearer rejected":
            return httpx.Response(401)
        if token == "Bearer unavailable":
            return httpx.Response(503)
        return httpx.Response(200, json={"id": str(UUID(int=12)), "is_anonymous": token.endswith("anonymous")})

    with httpx.Client(base_url="https://supabase.test", transport=httpx.MockTransport(send)) as client:
        auth = SupabaseAuth(client, "sb_publishable_test")
        assert auth("valid") == UUID(int=12)
        assert auth("anonymous") is None
        assert auth("rejected") is None
        with pytest.raises(Problem, match="auth_unavailable"):
            auth("unavailable")


def test_private_storage_uses_authenticated_object_endpoints():
    def send(request):
        assert request.headers["apikey"] == "sb_secret_test"
        assert "Authorization" not in request.headers
        if request.url.path == "/storage/v1/bucket/bedroom-private":
            return httpx.Response(200, json={"public": False})
        if request.method == "POST":
            assert request.url.path == "/storage/v1/object/bedroom-private/user/session/original"
            assert request.content == b"image"
            return httpx.Response(200)
        if request.method == "GET":
            assert request.url.path == "/storage/v1/object/authenticated/bedroom-private/user/session/original"
            return httpx.Response(200, content=b"image", headers={"Content-Type": "image/png"})
        assert request.method == "DELETE"
        assert request.url.path == "/storage/v1/object/bedroom-private"
        assert json.loads(request.content) == {"prefixes": ["user/session/original"]}
        return httpx.Response(200, json=[])

    with httpx.Client(base_url="https://supabase.test", transport=httpx.MockTransport(send)) as client:
        storage = SupabaseStorage(client, "sb_secret_test", "bedroom-private")
        assert storage.ready()
        storage.put("user/session/original", b"image", "image/png")
        assert storage.get("user/session/original") == (b"image", "image/png")
        storage.delete("user/session/original")
