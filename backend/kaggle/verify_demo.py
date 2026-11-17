"""Verify the private Kaggle demo from a local terminal."""

import argparse
from getpass import getpass
from hashlib import sha256
from pathlib import Path
from time import monotonic, sleep
from uuid import uuid4

import httpx

EXPECTED_STYLES = ["luxury", "japanese", "neo-classic", "attic", "cyberpunk"]


def token(url, publishable_key, participant):
    print(f"Sign in as participant {participant}")
    email = input("Email: ").strip()
    password = getpass("Password: ")
    response = httpx.post(f"{url.rstrip('/')}/auth/v1/token", params={"grant_type": "password"},
                          headers={"apikey": publishable_key}, json={"email": email, "password": password})
    response.raise_for_status()
    return response.json()["access_token"]


def request(client, method, path, **kwargs):
    response = client.request(method, path, **kwargs)
    response.raise_for_status()
    return response


def mutate(client, method, path, **kwargs):
    return request(client, method, path, headers={"Idempotency-Key": str(uuid4())}, **kwargs).json()


def wait(client, job_id):
    deadline = monotonic() + 1200
    while monotonic() < deadline:
        job = request(client, "GET", f"/api/jobs/{job_id}").json()
        if job["status"] == "succeeded":
            return
        if job["status"] == "failed":
            raise RuntimeError(f'{job["kind"]} job failed ({job["error"]})')
        sleep(4)
    raise TimeoutError(f"Timed out waiting for job {job_id}")


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def image_hashes(client, details):
    assets = {}
    for slot in details["variations"]:
        for version in slot["versions"]:
            if version["id"] == slot["current_version_id"]:
                image = request(client, "GET", version["image_url"]).content
                assets[slot["position"]] = (version["id"], sha256(image).hexdigest())
    return assets


def verify_new_session(client, photo):
    created = mutate(client, "POST", "/api/generations",
                     files={"image": (photo.name, photo.read_bytes())}, data={"consent": "true"})
    path = f'/api/generations/{created["session_id"]}'
    wait(client, created["job_id"])
    initial = request(client, "GET", path).json()
    if initial["status"] == "needs_confirmation":
        wait(client, mutate(client, "POST", f"{path}/confirm-bedroom")["job_id"])
        initial = request(client, "GET", path).json()
    require([item["style_id"] for item in initial["variations"]] == EXPECTED_STYLES,
            "The initial style set differs from the sprint catalog")

    old = image_hashes(client, initial)
    require(len(old) == 5, "The initial session does not have five private images")
    reason = "Conservar la forma del techo"
    reject = mutate(client, "PUT", f"{path}/decisions/{old[4][0]}",
                    json={"decision": "rejected", "reason": reason})
    wait(client, reject["job_id"])
    current = image_hashes(client, request(client, "GET", path).json())
    require(set(current) == set(old) and current[4][0] != old[4][0], "The rejected slot was not versioned")
    require(all(current[pos] == old[pos] for pos in (1, 2, 3, 5)), "An unrelated slot changed")

    for version_id, _ in current.values():
        mutate(client, "PUT", f"{path}/decisions/{version_id}", json={"decision": "accepted"})
    wait(client, mutate(client, "POST", f"{path}/summary")["job_id"])
    detail = request(client, "GET", path).json()
    require(old[4][0] in detail["summary"]["rejected_version_ids"] and reason in detail["summary"]["summary"],
            "The summary omitted the recorded rejection")
    return detail


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api", required=True, help="Current ngrok URL")
    parser.add_argument("--supabase-url", required=True)
    parser.add_argument("--publishable-key", required=True)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--photo", type=Path, help="An authorized bedroom photo for a new test")
    group.add_argument("--session", help="A completed session ID to check after restarting Kaggle")
    parser.add_argument("--check-isolation", action="store_true", help="Also sign in as participant B")
    args = parser.parse_args()

    headers = {"ngrok-skip-browser-warning": "true"}
    primary = token(args.supabase_url, args.publishable_key, "A")
    with httpx.Client(base_url=args.api, timeout=30,
                      headers={**headers, "Authorization": f"Bearer {primary}"}) as client:
        request(client, "GET", "/health")
        details = verify_new_session(client, args.photo) if args.photo else request(
            client, "GET", f"/api/generations/{args.session}",
        ).json()
        summary = details["summary"]
        require(details["status"] == "completed" and summary and summary["revision"] == details["revision"],
                "The current summary is unavailable")
        require(len(summary["accepted_version_ids"]) == 5 and len(image_hashes(client, details)) == 5,
                "The completed session is missing accepted versions or images")
        if args.check_isolation:
            secondary = token(args.supabase_url, args.publishable_key, "B")
            version_url = details["variations"][0]["versions"][0]["image_url"]
            for path in (f'/api/generations/{details["id"]}', details["original_image_url"], version_url,
                         f'/api/jobs/{details["jobs"][0]["id"]}'):
                response = client.get(path, headers={"Authorization": f"Bearer {secondary}"})
                require(response.status_code == 404, "Participant B could read participant A's data")
        print(f'Verified completed session {details["id"]} at revision {details["revision"]}')


if __name__ == "__main__":
    main()
