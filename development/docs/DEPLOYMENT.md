# Deploying Medix

Medix needs a Next.js **server**, a Python API, PostgreSQL, an inference provider,
and persistent evidence resources. GitHub Pages cannot host this application.
No deployment runs from GitHub Actions; CI tests and builds the project only.

## Render topology

Use a public Node web service for `frontend/` and a **private Docker service** for
`backend/`. The frontend is the browser's only API origin. It authenticates users
and proxies MP4 clips, including Range requests, to the backend. A shared
`MEDIX_API_TOKEN` authenticates server-to-server calls and is never exposed to the
browser. Keep Redis-backed and per-user production rate limits enabled.

You can use managed PostgreSQL and Redis on Render or another provider. The
existing attachment route uses Vercel Blob, which works independently of Vercel
hosting; configure its token for image uploads. Clerk is optional; when enabled,
set both Clerk keys and configure the deployed domain in Clerk. Auth.js remains
the supported fallback. Do not set `LOCAL_AUTH_BYPASS` in production.

Render services and persistent disks incur costs when you provision them. These
files do not create an account, deploy a service, or purchase resources.

## Backend service

- Runtime: Docker; repository root is the build context.
- Dockerfile: `backend/Dockerfile`.
- Internal port: the platform's `PORT` (defaults to `10000`).
- Attach a persistent disk at `/var/data/medix`. Size it for the video collection,
  transcript cache, embedding/vision weights, optional speech weights, and clips.
- Configure `ASU_RC_API_KEY`, `ASU_RC_MODEL=qwen35-27b`, and a strong
  `MEDIX_API_TOKEN`. Generate the token once and set the same value on both services.
- The image includes FFmpeg and speech support. To omit speech, build with
  `--build-arg MEDIX_WITH_SPEECH=0`; the Listen endpoint then reports unavailable.
- Linux x86-64 uses CPU-only PyTorch wheels. Hosted Voyager performs text/vision
  generation; the local embedding and CLIP models still consume RAM. Profile your
  deployment rather than assuming a free or minimum-size instance is sufficient.

Required disk contents:

```text
/var/data/medix/
  supported_video_collection.json
  transcripts/<video_id>.json
  videos/<video_id>.mp4
```

Transfer your validated resources from your existing workstation/Sol collection;
they are deliberately excluded from Git and the image. The checked-in catalog is
metadata, not the video/transcript corpus. Rebuild the supported collection with
`development.scripts.build_runtime_collection` after changing the available media.
The root `data/` and `MedVidQA/` source datasets remain separate from development
scripts. Existing Sol jobs and the local SSH tunnel do not make a production
Render backend: Sol allocations expire and private Mac localhost addresses are
not reachable from Render.

Use `/api/health` as a liveness endpoint during initial resource provisioning.
It can return HTTP 200 with `status: degraded`; that is **not** a successful
readiness check. Once resources and the provider are configured, use
`/api/ready` as the deployment health check: it returns HTTP 503 until the
pipeline initializes, and HTTP 200 when it is ready. Check actual text/image
queries and video playback before directing users to the service. Readiness
alone does not measure answer accuracy or prove every catalog asset is usable.

## Frontend service

Root directory: `frontend`. Use Node 22 and the pinned pnpm from `package.json`.

Build command:

```bash
corepack pnpm install --frozen-lockfile && corepack pnpm build
```

Pre-deploy command (after PostgreSQL is available):

```bash
corepack pnpm db:migrate
```

Start command:

```bash
corepack pnpm start --hostname 0.0.0.0 --port "$PORT"
```

Required environment:

| Variable | Value |
| --- | --- |
| `AUTH_SECRET` | Strong random session secret; keep stable across deploys |
| `POSTGRES_URL` | Hosted database connection string |
| `MEDIX_API_URL` | Private backend HTTP URL, or Render's internal `host:port` |
| `MEDIX_API_TOKEN` | Same server-only secret as the backend |
| `ASU_RC_API_KEY` | Server-side Voyager key for response composition |
| `ASU_RC_MODEL` | `qwen35-27b` |
| `BLOB_READ_WRITE_TOKEN` | Required for the current hosted image-upload route |
| `REDIS_URL` | Configure for production IP limits and resumable streams |

Set `NEXT_PUBLIC_APP_URL` to the public frontend origin when not using Render;
Render supplies `RENDER_EXTERNAL_URL`. Public Clerk keys must be available at
build time; never prefix private keys or `MEDIX_API_TOKEN` with `NEXT_PUBLIC_`.

The Next.js configuration retains BotID and existing rate-limit checks. Verify
BotID behavior, trusted proxy headers, authentication callbacks, Redis limits,
and storage access in the hosting environment before a public launch. The
server-only credential protects the private backend; it does not replace user
sessions or abuse controls.

## Release verification

1. CI must pass Python checks/tests, frontend lint/types/tests, fresh database
   migrations, the Next.js production build, and the backend image build.
2. Confirm unauthenticated backend inference/artifact calls return 401 when a
   token is configured; readiness remains reachable by the platform.
3. Test text, image, and combined inputs with representative evidence. A question
   with no supported evidence must not produce a fabricated answer or timestamp.
4. Play an extracted clip over HTTPS, seek via timestamps, and verify a Range
   request returns partial content through the authenticated proxy.
5. Restart the backend and verify evidence/cache persistence. Restore a database
   backup in a separate test environment before relying on recovery procedures.
6. Check request timing logs and resource use under representative concurrency.
   Unit tests and compilation do not establish a clinical accuracy percentage,
   end-to-end latency improvement, or medical-device readiness.

The application remains research software. A tested deployment package is not a
clinical validation or a substitute for institutional review of its intended use.

## References

- [Render Next.js deployment](https://render.com/docs/deploy-nextjs-app)
- [Render FastAPI deployment](https://render.com/docs/deploy-fastapi)
- [Render persistent disks](https://render.com/docs/disks)
- [Render private services](https://render.com/docs/private-services)
