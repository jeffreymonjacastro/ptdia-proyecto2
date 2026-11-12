from urllib.parse import quote
from uuid import UUID

import httpx

from .service import Problem


class SupabaseAuth:
    def __init__(self, client, publishable_key):
        self.client = client
        self.publishable_key = publishable_key

    def __call__(self, token):
        try:
            response = self.client.get("/auth/v1/user", headers={
                "apikey": self.publishable_key, "Authorization": f"Bearer {token}",
            })
            if response.status_code in (401, 403):
                return None
            response.raise_for_status()
            user = response.json()
            if user.get("is_anonymous"):
                return None
            return UUID(user["id"])
        except (httpx.HTTPError, ValueError, KeyError) as error:
            raise Problem(503, "auth_unavailable") from error


class SupabaseStorage:
    def __init__(self, client, secret_key, bucket):
        self.client = client
        self.bucket = quote(bucket, safe="")
        self.headers = {"apikey": secret_key}
        if secret_key.startswith("eyJ"):
            self.headers["Authorization"] = f"Bearer {secret_key}"

    def ready(self):
        response = self.client.get(f"/storage/v1/bucket/{self.bucket}", headers=self.headers)
        response.raise_for_status()
        return response.json().get("public") is False

    def put(self, key, data, media_type):
        response = self.client.post(
            f"/storage/v1/object/{self.bucket}/{quote(key, safe='/')}", content=data,
            headers={**self.headers, "Content-Type": media_type, "x-upsert": "true", "Cache-Control": "no-store"},
        )
        response.raise_for_status()

    def get(self, key):
        response = self.client.get(
            f"/storage/v1/object/authenticated/{self.bucket}/{quote(key, safe='/')}", headers=self.headers,
        )
        response.raise_for_status()
        return response.content, response.headers["content-type"]

    def delete(self, key):
        response = self.client.request(
            "DELETE", f"/storage/v1/object/{self.bucket}", headers=self.headers, json={"prefixes": [key]},
        )
        response.raise_for_status()
