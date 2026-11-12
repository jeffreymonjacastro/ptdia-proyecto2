import argparse
import os

import httpx

from .repository import Repository, all_rows, one
from .supabase import SupabaseStorage
from .worker import Worker


def purge(repo, store, *, apply):
    with repo.transaction() as conn:
        if not apply:
            count = one(conn, "SELECT count(*) FROM bedroom.sessions")["count"]
            return count, count
        count = one(conn, "SELECT count(*) FROM bedroom.sessions")["count"]
        rows = all_rows(conn, """
            UPDATE bedroom.sessions SET status = 'deleting'
            WHERE status <> 'deleting' RETURNING id
        """)
        for row in rows:
            repo.enqueue(conn, row["id"], "delete")
    worker = Worker(repo, store, None)
    while worker.run_once(only_delete=True):
        pass
    with repo.transaction() as conn:
        return count, one(conn, "SELECT count(*) FROM bedroom.sessions")["count"]


def main():
    parser = argparse.ArgumentParser(description="Purge sprint sessions and private images after grading.")
    parser.add_argument("--apply", action="store_true", help="Delete all sprint sessions. Default is a dry run.")
    args = parser.parse_args()
    with httpx.Client(base_url=os.environ["SUPABASE_URL"], timeout=httpx.Timeout(30, connect=5)) as client:
        store = SupabaseStorage(client, os.environ["SUPABASE_SECRET_KEY"],
                                os.getenv("BEDROOM_BUCKET", "bedroom-private"))
        if not store.ready():
            parser.exit(1, "The configured private bucket is unavailable.\n")
        with Repository(os.environ["BEDROOM_DATABASE_URL"]) as repo:
            before, after = purge(repo, store, apply=args.apply)
            with repo.transaction() as conn:
                rechecks = one(conn, "SELECT count(*) FROM bedroom.storage_cleanup")["count"]
    if args.apply:
        print(f"Removed {before - after} session(s). Remaining: {after}.")
        if after or rechecks:
            parser.exit(1, f"{rechecks} deferred image recheck(s). Stop the demo server and retry in two minutes.\n")
    else:
        print(f"Dry run: {before} session(s) would be removed.")
