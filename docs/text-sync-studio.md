# Text Sync Studio

## Setup

1. Run `app-schema-v2-step11-synchronized-readings.sql` in Supabase if it has not been run yet.
2. Run `app-schema-v2-step12-text-sync-readings.sql` in Supabase to enable manually selected reading ranges.
3. Add `TEXT_SYNC_WORKER_SECRET` to local `.env.local` for local testing. Add the same value to Vercel only when the worker will call the deployed site. Never commit the secret.
4. Install the existing Text2Video worker requirements if they are not already installed:

   ```powershell
   cd C:\Tora\Text2Video
   pip install -r requirements-builder-worker.txt
   ```

5. Start the site, then run the worker in a separate PowerShell window:

   ```powershell
   cd C:\Tora\bar-mitzvah-learning
   python .\tools\text_sync_worker.py --site-url http://localhost:3000 --worker-secret "<same secret>" --text2video-path C:\Tora\Text2Video
   ```

   In production, replace the local site URL with the Vercel production URL and keep the worker process running on the computer that has Text2Video, Whisper, and the Tikkun data. The worker can take a while for a long recording; the browser polls the job rather than holding a Vercel request open.

## Flow

- The teacher selects a teacher-owned parasha library, an assigned student, an aliyah, and the destination sub-part.
- The chosen aliyah text is loaded from Sefaria before recording. Manual readings (including haftarot) allow the teacher to set a display name, book, and start/end chapter and verse; no minhag-specific haftarah range is assumed.
- Audio uploads directly to Supabase Storage using a signed upload target.
- Weekly aliyah ranges are exported from the Text2Video Tikkun data to `src/data/torah-aliyah-ranges.ts`. The local worker retrieves Hebrew text from Sefaria, reuses Text2Video's Torah Tikkun layout when available, then runs `sync_core.transcribe_audio`, `extract_timed_words`, and `sync_words` against positioned layout words.
- The teacher reviews word timings. Estimated words are dotted and their confidence should be checked before approval.
- Approval saves the recording and word timing for that student and sub-part only. Other students and the shared teacher library are unchanged.
- The student lesson shows the synchronized text/audio player. Playback start and natural completion are recorded in the existing practice statistics.

The initial range mapping assumes the standard weekly Torah aliyah order represented by Text2Video's Tikkun dataset. Review the displayed Sefaria reference and text before approving, especially for combined parashot or a locally customized reading.
