from __future__ import annotations

import fcntl
import json
import logging
import time
from contextlib import contextmanager
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlparse

from app import cooklang
from app.config import Settings
from app.page_fetch import ImageScrapeResult, first_http_url
from app.sources import RECIPE_FILENAME

logger = logging.getLogger(__name__)

QUEUE_VERSION = 1


@dataclass
class HostState:
    cooldown_seconds: float = 0
    next_ok_at: float = 0


@dataclass
class ImageJob:
    slug: str
    source_url: str
    attempts: int = 0
    last_error: str | None = None
    next_attempt_at: float = 0


@dataclass
class ImageQueueState:
    hosts: dict[str, HostState] = field(default_factory=dict)
    jobs: list[ImageJob] = field(default_factory=list)
    version: int = QUEUE_VERSION


def registrable_host(url: str) -> str:
    host = urlparse(url).netloc.lower()
    if host.startswith("www."):
        host = host[4:]
    return host


def now_ts() -> float:
    return time.time()


def load_queue(path: Path) -> ImageQueueState:
    if not path.exists():
        return ImageQueueState()
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return ImageQueueState()
    if not isinstance(raw, dict):
        return ImageQueueState()

    hosts: dict[str, HostState] = {}
    for host, value in (raw.get("hosts") or {}).items():
        if not isinstance(value, dict):
            continue
        hosts[str(host)] = HostState(
            cooldown_seconds=float(value.get("cooldown_seconds") or 0),
            next_ok_at=float(value.get("next_ok_at") or 0),
        )

    jobs: list[ImageJob] = []
    for entry in raw.get("jobs") or []:
        if not isinstance(entry, dict):
            continue
        slug = str(entry.get("slug") or "").strip()
        source_url = str(entry.get("source_url") or "").strip()
        if not slug or not source_url:
            continue
        jobs.append(
            ImageJob(
                attempts=int(entry.get("attempts") or 0),
                last_error=(
                    str(entry["last_error"]) if entry.get("last_error") is not None else None
                ),
                next_attempt_at=float(entry.get("next_attempt_at") or 0),
                slug=slug,
                source_url=source_url,
            )
        )
    return ImageQueueState(hosts=hosts, jobs=jobs, version=int(raw.get("version") or QUEUE_VERSION))


def save_queue(path: Path, state: ImageQueueState) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "hosts": {
            host: {
                "cooldown_seconds": host_state.cooldown_seconds,
                "next_ok_at": host_state.next_ok_at,
            }
            for host, host_state in sorted(state.hosts.items())
        },
        "jobs": [asdict(job) for job in state.jobs],
        "version": QUEUE_VERSION,
    }
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temp.replace(path)


@contextmanager
def queue_lock(path: Path):
    """Exclusive lock for queue read-modify-write across API + worker processes."""
    path.parent.mkdir(parents=True, exist_ok=True)
    lock_path = path.with_suffix(path.suffix + ".lock")
    with lock_path.open("a+", encoding="utf-8") as lock_file:
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)


def enqueue_image_job(
    path: Path,
    *,
    slug: str,
    source_url: str,
    now: float | None = None,
) -> bool:
    """Add or refresh a job. Returns True when the queue changed."""
    cleaned = source_url.strip().split("#", 1)[0]
    if not slug.strip() or not cleaned.startswith(("http://", "https://")):
        return False

    current = now if now is not None else now_ts()
    with queue_lock(path):
        state = load_queue(path)
        for job in state.jobs:
            if job.slug == slug:
                if job.source_url == cleaned:
                    return False
                job.source_url = cleaned
                job.next_attempt_at = min(job.next_attempt_at, current)
                save_queue(path, state)
                return True

        state.jobs.append(
            ImageJob(slug=slug.strip(), source_url=cleaned, next_attempt_at=current)
        )
        save_queue(path, state)
        return True


def claim_jobs(
    state: ImageQueueState,
    *,
    concurrency: int,
    now: float | None = None,
) -> list[ImageJob]:
    """Pick up to N due jobs on distinct eligible hosts."""
    current = now if now is not None else now_ts()
    limit = max(1, concurrency)
    claimed: list[ImageJob] = []
    claimed_hosts: set[str] = set()

    for job in sorted(state.jobs, key=lambda item: (item.next_attempt_at, item.slug)):
        if len(claimed) >= limit:
            break
        if job.next_attempt_at > current:
            continue
        host = registrable_host(job.source_url)
        if not host or host in claimed_hosts:
            continue
        host_state = state.hosts.get(host)
        if host_state and host_state.next_ok_at > current:
            continue
        claimed.append(job)
        claimed_hosts.add(host)
    return claimed


def seconds_until_next_wake(state: ImageQueueState, *, now: float | None = None) -> float:
    current = now if now is not None else now_ts()
    wakes: list[float] = []
    for job in state.jobs:
        host = registrable_host(job.source_url)
        host_ready = 0.0
        host_state = state.hosts.get(host)
        if host_state:
            host_ready = host_state.next_ok_at
        wakes.append(max(job.next_attempt_at, host_ready))
    if not wakes:
        return 5.0
    return max(0.5, min(wakes) - current)


def resolve_image_source_url(recipe_dir: Path, metadata: dict) -> str | None:
    explicit = metadata.get("image_source")
    if isinstance(explicit, str) and explicit.strip().startswith(("http://", "https://")):
        return explicit.strip().split("#", 1)[0]

    source = cooklang.metadata_source_url(metadata)
    if source:
        return source.split("#", 1)[0]

    for path in sorted(recipe_dir.glob("source.*")):
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        found = first_http_url(text)
        if found:
            return found
    return None


def maybe_enqueue_from_recipe(
    *,
    settings: Settings,
    slug: str,
    content: str,
) -> bool:
    metadata, _body = cooklang.parse_document(content)
    if cooklang.metadata_image_url(metadata) or cooklang.metadata_image_file(metadata):
        return False
    if not cooklang.metadata_image_pending(metadata):
        return False

    recipe_dir = settings.recipe_root / slug
    source_url = resolve_image_source_url(recipe_dir, metadata)
    if not source_url:
        return False
    return enqueue_image_job(settings.image_queue_path, slug=slug, source_url=source_url)


def mark_recipe_image_pending(
    content: str, *, source_url: str | None
) -> str:
    """Set image_pending (+ optional image_source) when recipe has no image yet."""
    metadata, body = cooklang.parse_document(content)
    if cooklang.metadata_image_url(metadata) or cooklang.metadata_image_file(metadata):
        metadata.pop("image_pending", None)
        metadata.pop("image_source", None)
        return cooklang.render_document(metadata, body)

    if not source_url or not source_url.startswith(("http://", "https://")):
        return content

    metadata["image_pending"] = True
    metadata["image_source"] = source_url.split("#", 1)[0]
    rendered = cooklang.render_document(metadata, body)
    return rendered if rendered.endswith("\n") else rendered + "\n"


def apply_image_to_recipe(
    recipe_root: Path,
    *,
    slug: str,
    image_url: str,
) -> bool:
    path = recipe_root / slug / RECIPE_FILENAME
    if not path.exists():
        return False
    metadata, body = cooklang.parse_document(path.read_text(encoding="utf-8"))
    metadata["image"] = image_url
    metadata.pop("image_pending", None)
    metadata.pop("image_source", None)
    content = cooklang.render_document(metadata, body)
    if not content.endswith("\n"):
        content += "\n"
    path.write_text(content, encoding="utf-8")
    return True


def clear_image_pending(
    recipe_root: Path,
    *,
    slug: str,
    note: str | None = None,
) -> None:
    path = recipe_root / slug / RECIPE_FILENAME
    if not path.exists():
        return
    metadata, body = cooklang.parse_document(path.read_text(encoding="utf-8"))
    metadata["image_pending"] = False
    metadata.pop("image_source", None)
    if note:
        notes = cooklang.metadata_import_notes(metadata)
        if note not in notes:
            notes.append(note)
            metadata["import_notes"] = notes
    content = cooklang.render_document(metadata, body)
    if not content.endswith("\n"):
        content += "\n"
    path.write_text(content, encoding="utf-8")


def record_host_success(
    state: ImageQueueState, host: str, *, settings: Settings, now: float
) -> None:
    state.hosts[host] = HostState(
        cooldown_seconds=0,
        next_ok_at=now + max(1, settings.image_queue_host_gap_seconds),
    )


def record_host_block(
    state: ImageQueueState, host: str, *, settings: Settings, now: float
) -> None:
    previous = state.hosts.get(host)
    base = float(settings.image_queue_host_cooldown_seconds)
    if previous and previous.cooldown_seconds > 0:
        cooldown = min(previous.cooldown_seconds * 2, 6 * 3600)
    else:
        cooldown = base
    state.hosts[host] = HostState(cooldown_seconds=cooldown, next_ok_at=now + cooldown)


def apply_job_result(
    job: ImageJob,
    *,
    result: ImageScrapeResult,
    settings: Settings,
    state: ImageQueueState,
    now: float,
) -> None:
    """Apply a fetch result to queue state + recipe files. Caller holds queue_lock."""
    host = registrable_host(job.source_url)
    remaining = [entry for entry in state.jobs if entry.slug != job.slug]
    # Prefer live queue entry when present (attempts may have advanced).
    live = next((entry for entry in state.jobs if entry.slug == job.slug), job)

    if result.image_url:
        apply_image_to_recipe(settings.recipe_root, slug=live.slug, image_url=result.image_url)
        record_host_success(state, host, settings=settings, now=now)
        state.jobs = remaining
        logger.info("image queue: fetched %s for %s", result.image_url, live.slug)
        return

    live.attempts += 1
    live.last_error = result.error or f"status={result.status_code}"
    if result.blocked:
        record_host_block(state, host, settings=settings, now=now)
        host_state = state.hosts[host]
        live.next_attempt_at = host_state.next_ok_at
    else:
        record_host_success(state, host, settings=settings, now=now)
        live.next_attempt_at = now + max(1, settings.image_queue_host_gap_seconds)

    if live.attempts >= settings.image_queue_max_attempts:
        clear_image_pending(
            settings.recipe_root,
            slug=live.slug,
            note=f"Image queue gave up after {live.attempts} attempts: {live.last_error}",
        )
        state.jobs = remaining
        logger.warning("image queue: giving up on %s (%s)", live.slug, live.last_error)
        return

    remaining.append(live)
    state.jobs = remaining


def process_claimed_job(
    job: ImageJob,
    *,
    settings: Settings,
    state: ImageQueueState,
    now: float,
) -> None:
    from app.page_fetch import fetch_page_image_result

    result = fetch_page_image_result(job.source_url, settings=settings)
    apply_job_result(job, result=result, settings=settings, state=state, now=now)


def enqueue_missing_recipes(*, settings: Settings, dry_run: bool = False) -> tuple[int, int]:
    """Seed queue + image_pending for recipes missing images. Returns (enqueued, skipped)."""
    enqueued = 0
    skipped = 0
    for path in sorted(settings.recipe_root.glob(f"*/{RECIPE_FILENAME}")):
        slug = path.parent.name
        content = path.read_text(encoding="utf-8")
        metadata, body = cooklang.parse_document(content)
        if cooklang.metadata_image_url(metadata) or cooklang.metadata_image_file(metadata):
            skipped += 1
            continue
        source_url = resolve_image_source_url(path.parent, metadata)
        if not source_url:
            skipped += 1
            continue
        next_content = mark_recipe_image_pending(content, source_url=source_url)
        if not dry_run:
            if next_content != content:
                path.write_text(
                    next_content if next_content.endswith("\n") else next_content + "\n",
                    encoding="utf-8",
                )
            if enqueue_image_job(settings.image_queue_path, slug=slug, source_url=source_url):
                enqueued += 1
            else:
                skipped += 1
        else:
            enqueued += 1
    return enqueued, skipped


def isoformat(ts: float) -> str:
    return datetime.fromtimestamp(ts, UTC).isoformat().replace("+00:00", "Z")
