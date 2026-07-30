from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import httpx
from app.config import Settings
from app.image_queue import (
    ImageJob,
    ImageQueueState,
    apply_job_result,
    claim_jobs,
    enqueue_image_job,
    enqueue_missing_recipes,
    load_queue,
    mark_recipe_image_pending,
)
from app.page_fetch import ImageScrapeResult
from app.sources import RECIPE_FILENAME


def _settings(tmp_path: Path, **overrides) -> Settings:
    return Settings(
        data_root=tmp_path,
        fireworks_api_key="test",
        session_secret="test-secret",
        **overrides,
    )


def test_claim_jobs_selects_distinct_hosts_only(tmp_path: Path):
    state = ImageQueueState(
        jobs=[
            ImageJob(slug="a", source_url="https://food52.com/a", next_attempt_at=0),
            ImageJob(slug="b", source_url="https://food52.com/b", next_attempt_at=0),
            ImageJob(slug="c", source_url="https://bbcgoodfood.com/c", next_attempt_at=0),
            ImageJob(slug="d", source_url="https://nytimes.com/d", next_attempt_at=0),
        ]
    )
    claimed = claim_jobs(state, concurrency=6, now=0)
    assert [job.slug for job in claimed] == ["a", "c", "d"]


def test_claim_jobs_respects_host_cooldown(tmp_path: Path):
    from app.image_queue import HostState

    state = ImageQueueState(
        hosts={"food52.com": HostState(next_ok_at=100, cooldown_seconds=60)},
        jobs=[
            ImageJob(slug="a", source_url="https://food52.com/a", next_attempt_at=0),
            ImageJob(slug="b", source_url="https://bbc.com/b", next_attempt_at=0),
        ],
    )
    claimed = claim_jobs(state, concurrency=6, now=50)
    assert [job.slug for job in claimed] == ["b"]


def test_enqueue_image_job_dedupes_by_slug(tmp_path: Path):
    path = tmp_path / "image_queue.json"
    assert enqueue_image_job(path, slug="chili", source_url="https://example.com/a")
    assert not enqueue_image_job(path, slug="chili", source_url="https://example.com/a")
    assert enqueue_image_job(path, slug="chili", source_url="https://example.com/b")
    state = load_queue(path)
    assert len(state.jobs) == 1
    assert state.jobs[0].source_url == "https://example.com/b"


def test_apply_job_result_success_writes_image(tmp_path: Path):
    settings = _settings(tmp_path, image_queue_host_gap_seconds=30)
    recipe_dir = settings.recipe_root / "chili"
    recipe_dir.mkdir(parents=True)
    (recipe_dir / RECIPE_FILENAME).write_text(
        "---\ntitle: Chili\nimage_pending: true\n"
        "image_source: https://example.com/chili\n---\n\nBrown @beef{}.\n",
        encoding="utf-8",
    )
    state = ImageQueueState(
        jobs=[ImageJob(slug="chili", source_url="https://example.com/chili")]
    )
    apply_job_result(
        state.jobs[0],
        result=ImageScrapeResult(image_url="https://cdn.example.com/chili.jpg"),
        settings=settings,
        state=state,
        now=1000,
    )
    content = (recipe_dir / RECIPE_FILENAME).read_text(encoding="utf-8")
    assert "image: https://cdn.example.com/chili.jpg" in content
    assert "image_pending" not in content
    assert state.jobs == []
    assert state.hosts["example.com"].next_ok_at == 1030


def test_apply_job_result_blocked_sets_cooldown(tmp_path: Path):
    settings = _settings(
        tmp_path,
        image_queue_host_cooldown_seconds=1800,
        image_queue_max_attempts=8,
    )
    state = ImageQueueState(
        jobs=[ImageJob(slug="chili", source_url="https://food52.com/chili")]
    )
    apply_job_result(
        state.jobs[0],
        result=ImageScrapeResult(blocked=True, status_code=429, error="status=429"),
        settings=settings,
        state=state,
        now=1000,
    )
    assert len(state.jobs) == 1
    assert state.jobs[0].attempts == 1
    assert state.jobs[0].next_attempt_at == 2800
    assert state.hosts["food52.com"].cooldown_seconds == 1800


def test_enqueue_missing_recipes_marks_pending(tmp_path: Path):
    settings = _settings(tmp_path)
    recipe_dir = settings.recipe_root / "chili"
    recipe_dir.mkdir(parents=True)
    (recipe_dir / RECIPE_FILENAME).write_text(
        "---\ntitle: Chili\nsource: https://example.com/chili\n---\n\nCook.\n",
        encoding="utf-8",
    )
    enqueued, skipped = enqueue_missing_recipes(settings=settings)
    assert enqueued == 1
    assert skipped == 0
    content = (recipe_dir / RECIPE_FILENAME).read_text(encoding="utf-8")
    assert "image_pending: true" in content
    assert load_queue(settings.image_queue_path).jobs[0].slug == "chili"


def test_mark_recipe_image_pending_noop_when_image_present():
    content = '---\ntitle: "Chili"\nimage: https://cdn.example.com/x.jpg\n---\n\nCook.\n'
    assert mark_recipe_image_pending(content, source_url="https://example.com/x") == content


def test_worker_batch_fetches_in_parallel(tmp_path: Path):
    from app.image_queue_worker import run_batch

    settings = _settings(tmp_path, image_queue_concurrency=3, image_queue_host_gap_seconds=1)
    for slug, host in (("a", "a.com"), ("b", "b.com"), ("c", "c.com")):
        recipe_dir = settings.recipe_root / slug
        recipe_dir.mkdir(parents=True)
        (recipe_dir / RECIPE_FILENAME).write_text(
            f"---\ntitle: {slug}\nimage_pending: true\n"
            f"image_source: https://{host}/r\n---\n\nCook.\n",
            encoding="utf-8",
        )
        enqueue_image_job(settings.image_queue_path, slug=slug, source_url=f"https://{host}/r")

    def fake_fetch(url: str, *, settings=None):
        host = url.split("/")[2]
        return ImageScrapeResult(image_url=f"https://cdn.example.com/{host}.jpg")

    with patch("app.image_queue_worker.fetch_page_image_result", side_effect=fake_fetch):
        import asyncio

        asyncio.run(run_batch(settings))

    for slug, host in (("a", "a.com"), ("b", "b.com"), ("c", "c.com")):
        content = (settings.recipe_root / slug / RECIPE_FILENAME).read_text(encoding="utf-8")
        assert f"image: https://cdn.example.com/{host}.jpg" in content
    assert load_queue(settings.image_queue_path).jobs == []


def test_fetch_page_image_result_marks_blocked(tmp_path: Path):
    from app.page_fetch import fetch_page_image_result

    settings = _settings(tmp_path)
    with patch("app.page_fetch._get_page", return_value=httpx.Response(429, text="slow")):
        result = fetch_page_image_result("https://example.com/r", settings=settings)
    assert result.blocked is True
    assert result.image_url is None
