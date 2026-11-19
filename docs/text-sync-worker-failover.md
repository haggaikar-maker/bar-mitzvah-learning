# Text Sync Worker Failover

The local worker is the preferred processor. A scheduled GitHub Actions workflow
checks its heartbeat and the job queue every fifteen minutes. It requests one Vercel
Daemon instance only when the local worker is offline and work is waiting, and
requests zero instances when no cloud processing is needed. The `text_sync_jobs`
claim function uses a lease and worker identity so a job can be reclaimed after
the previous worker disappears without allowing an old worker to update a job
that has already been claimed by another one.

Vercel Daemons remain subject to the team's Hobby quotas. This setup does not
enable paid overages. If the quota is exhausted, the workflow records a failed
or overdue scale attempt and the job stays queued (or becomes reclaimable after
its lease expires); it will not be processed in the cloud until quota is
available again.

## One-time setup

1. Make sure no worker is currently processing a job, then run
   `app-schema-v2-step13-text-sync-failover.sql` in the Supabase SQL Editor.
   This is required before deploying the new worker/API code.
2. Generate a strong random value for `TEXT_SYNC_FAILOVER_SECRET`. Add it to the
   Vercel project's **Production** environment variables and add the exact same
   value as a GitHub Actions repository secret named
   `TEXT_SYNC_FAILOVER_SECRET`.
3. Create a Vercel API token with access to the `haggai-maker` team and
   `bar-mitzvah-learning` project. Store it as a GitHub Actions secret named
   `VERCEL_TOKEN`. Do not put the token in the repository or in application
   source files.
4. Deploy the application after the migration is applied. The daemon's
   configured instance count is zero so it does not consume provisioned-memory
   quota while idle. GitHub Actions will adjust it when fallback is needed.
5. Run **Actions → Text sync worker failover → Run workflow** once. Confirm the
   run succeeds and that the decision is `queue_empty` or
   `local_worker_online`.

## Run locally

From the repository root, with `TEXT_SYNC_SITE_URL` and `TEXT_SYNC_WORKER_SECRET`
set in the PowerShell session, run:

```powershell
python .\tools\text_sync_worker.py
```

The worker posts a heartbeat every 30 seconds. When it is running, the scheduled
controller keeps the Vercel daemon at zero instances unless a Vercel job is
already in progress.

## Failure records

Cloud scale attempts and failures are written to
`public.text_sync_worker_events` in Supabase. GitHub Actions also keeps the
command output for each workflow run. Job-processing errors remain in
`text_sync_jobs.error_message`.
