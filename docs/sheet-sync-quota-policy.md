# Sheet sync quota policy

Firestore remains the source of truth for scan confirmation. Google Sheets is a background
mirror and recovery target, so a Sheets failure must leave the Firestore order recoverable.

## Limits applied by the app

- Every request to `sheets.googleapis.com` is serialized in a browser-wide FIFO queue.
- The queue starts at most one Sheets request every 2 seconds: at most 30 Sheets API requests
  per minute per open app session. This includes reads used for verification, not only writes.
- Recovery processes at most 10 orders per run.
- Automatic recovery checks every 10 minutes.
- The recovery cooldown starts after the previous run finishes, so manual and automatic recovery
  cannot immediately start a second batch while the first is still draining.
- Marketplace/Drive requests and Firestore scan writes are not put behind the Sheets queue.

Google's published Sheets limits are 60 reads/minute/user/project, 60 writes/minute/user/project,
and 300 reads or writes/minute/project. The app's 30-request/minute combined client budget leaves
headroom for both readback verification and retry traffic. See [Google Sheets API usage limits](https://developers.google.com/workspace/sheets/api/limits).

The 10-row recovery cap is intentional: one recovered order can require multiple reads, writes,
and native date/time verification calls. A larger row cap can keep one recovery run busy long enough
to collide with the next operator's work even when each individual request is valid.
