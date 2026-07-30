from __future__ import annotations

import argparse
import asyncio
import logging
import sys
import time

from app.config import Settings, get_settings
from app.image_queue import (
    apply_job_result,
    claim_jobs,
    load_queue,
    queue_lock,
    save_queue,
    seconds_until_next_wake,
)
from app.page_fetch import fetch_page_image_result

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [image-queue] %(message)s",
)
logger = logging.getLogger("image_queue_worker")


async def run_batch(settings: Settings) -> float:
    """Claim and process one parallel batch. Returns seconds to sleep before next tick."""
    with queue_lock(settings.image_queue_path):
        state = load_queue(settings.image_queue_path)
        if not state.jobs:
            return 5.0
        now = time.time()
        claimed = claim_jobs(state, concurrency=settings.image_queue_concurrency, now=now)
        if not claimed:
            return seconds_until_next_wake(state, now=now)

    logger.info(
        "processing %s job(s): %s",
        len(claimed),
        ", ".join(f"{job.slug}@{registrable(job.source_url)}" for job in claimed),
    )

    async def fetch_one(job):
        result = await asyncio.to_thread(
            fetch_page_image_result, job.source_url, settings=settings
        )
        return job, result

    fetched = await asyncio.gather(*[fetch_one(job) for job in claimed])

    with queue_lock(settings.image_queue_path):
        state = load_queue(settings.image_queue_path)
        now = time.time()
        for job, result in fetched:
            apply_job_result(job, result=result, settings=settings, state=state, now=now)
        save_queue(settings.image_queue_path, state)

    return 0.5


def registrable(url: str) -> str:
    from app.image_queue import registrable_host

    return registrable_host(url) or url


async def run_forever(settings: Settings) -> None:
    logger.info(
        "starting worker concurrency=%s host_gap=%ss cooldown=%ss queue=%s",
        settings.image_queue_concurrency,
        settings.image_queue_host_gap_seconds,
        settings.image_queue_host_cooldown_seconds,
        settings.image_queue_path,
    )
    while True:
        try:
            sleep_for = await run_batch(settings)
        except Exception:  # noqa: BLE001 - keep worker alive
            logger.exception("batch failed")
            sleep_for = 5.0
        await asyncio.sleep(max(0.5, sleep_for))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Drain the deferred recipe image queue")
    parser.add_argument("--once", action="store_true", help="Process one batch and exit")
    args = parser.parse_args(argv)
    settings = get_settings()

    if args.once:
        asyncio.run(run_batch(settings))
        return 0

    asyncio.run(run_forever(settings))
    return 0


if __name__ == "__main__":
    sys.exit(main())
