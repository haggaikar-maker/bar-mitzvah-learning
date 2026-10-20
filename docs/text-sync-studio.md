# Text Sync Studio

## Setup

1. Run `app-schema-v2-step11-synchronized-readings.sql` in Supabase if it has not been run yet.
2. Run `app-schema-v2-step12-text-sync-readings.sql` in Supabase to enable manually selected reading ranges.
3. Configure `TEXT_SYNC_WORKER_SECRET` in the site environment (`.env.local` for the local Next.js app; Vercel Environment Variables for deployment). Set the same value in the worker process environment. Never commit the secret.
4. Install FFmpeg on the machine, then install the worker package requirements from the project root:

   ```powershell
   cd C:\Tora\bar-mitzvah-learning
   python -m pip install -r .\tools\text-sync-runtime\requirements.txt
   ```

5. Start the site, then run the worker in a separate PowerShell window:

   ```powershell
   cd C:\Tora\bar-mitzvah-learning
   $env:TEXT_SYNC_SITE_URL = "http://localhost:3000"
   $env:TEXT_SYNC_WORKER_SECRET = "<same secret>"
   python .\tools\text_sync_worker.py
   ```

   The worker now uses the bundled `tools/text-sync-runtime` by default. For production, set `TEXT_SYNC_SITE_URL` to the Vercel site and keep `TEXT_SYNC_WORKER_SECRET` out of Git. The worker can take a while for a long recording; the browser polls the job rather than holding a Vercel request open. A compatible alternate runtime can still be supplied with `--text2video-path`.

## Flow

- The teacher selects a teacher-owned parasha library, an assigned student, an aliyah, and the destination sub-part.
- The chosen aliyah text is loaded from Sefaria before recording. Manual readings (including haftarot) allow the teacher to set a display name, book, and start/end chapter and verse; no minhag-specific haftarah range is assumed.
- Audio uploads directly to Supabase Storage using a signed upload target.
- Weekly aliyah ranges are exported from the Text2Video Tikkun data to `src/data/torah-aliyah-ranges.ts`. The local worker retrieves Hebrew text from Sefaria, reuses Text2Video's Torah Tikkun layout when available, then runs `sync_core.transcribe_audio`, `extract_timed_words`, and `sync_words` against positioned layout words.
- The teacher reviews word timings. Estimated words are dotted and their confidence should be checked before approval.
- Approval saves the recording and word timing for that student and sub-part only. Other students and the shared teacher library are unchanged.
- The student lesson shows the synchronized text/audio player. Playback start and natural completion are recorded in the existing practice statistics.

The initial range mapping assumes the standard weekly Torah aliyah order represented by Text2Video's Tikkun dataset. Review the displayed Sefaria reference and text before approving, especially for combined parashot or a locally customized reading.
