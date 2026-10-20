# Text Sync Worker Runtime

This folder contains the small, non-personal runtime bundle used by
`../text_sync_worker.py`. It replaces the worker's former dependency on a
machine-specific `C:\Tora\Text2Video` folder.

## Included

- Text2Video alignment and Torah layout source modules.
- The Torah Tikkun page data and table of contents required for exact layout.
- The font used to measure Sefaria text consistently.
- Python dependencies and a Dockerfile for a future Vercel Daemon deployment.

Personal recordings, generated videos, and other Text2Video media are
intentionally excluded. Do not place secrets or student media in this folder.

## Run locally

From the repository root, install FFmpeg separately, then install the Python
requirements and set the site URL and worker secret in the environment:

```powershell
python -m pip install -r .\tools\text-sync-runtime\requirements.txt
$env:TEXT_SYNC_SITE_URL = "https://bar-mitzvah-learning.vercel.app"
$env:TEXT_SYNC_WORKER_SECRET = "<the configured worker secret>"
python .\tools\text_sync_worker.py
```

The worker uses this bundled runtime by default. `--text2video-path` remains
available for testing another compatible runtime directory. Use `--once` to
check connectivity and process at most one queued job.

## Container

Build from the repository root so the Dockerfile can copy the worker and the
shared app layout data:

```powershell
docker build -f .\tools\text-sync-runtime\Dockerfile -t text-sync-worker .
```

Run with `TEXT_SYNC_SITE_URL` and `TEXT_SYNC_WORKER_SECRET` supplied as
environment variables. The Whisper model is downloaded on first use into the
container's temporary cache; container restarts may require downloading it
again unless a persistent/external model cache is configured.
