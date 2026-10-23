# Medix on Vercel Services

This configuration is prepared for confirmation. It defines routing and a
container runtime; it is not evidence that the full medical pipeline fits Hobby
quotas or that the Sol video collection has been migrated. No deployment, account,
paid resource, or storage upload is created by adding these files.

## Service ownership

- `frontend`: Next.js, rooted at `frontend/`, handles every public path through
  the final `/(.*)` rewrite. This includes `/api/chat`, `/api/auth/*`, uploads,
  TTS and the authenticated `/api/medix/artifacts/*` video proxy.
- `app`: the existing FastAPI application, built from repository root using
  `backend/Dockerfile`. The container keeps FFmpeg and Python/speech dependencies.
  It has no public rewrite. Naming it `app` preserves Vercel's suggested name.
- `frontend` calls `app` over the `MEDIX_API_URL` binding. Vercel injects that
  variable into frontend functions at runtime. Do not set it manually in the
  project dashboard or read it from middleware/build steps.

All existing frontend calls to text/image/multimodal queries, TTS and clip files
use the shared server-side API client. The client reads the URL at request time,
retains the optional application token, and rejects a missing Vercel binding
instead of attempting localhost. Standalone development and Render internal
addresses retain their existing behavior. The binding does not replace user
sessions or the shared API token.

## Vercel project setup after confirmation

1. Root Directory: repository root (`./`). Preset: Services. Use the merged
   branch containing this configuration. Keep the Hobby plan if eligible.
2. Configure `AUTH_SECRET`, `POSTGRES_URL`, `ASU_RC_API_KEY`,
   `ASU_RC_MODEL=qwen35-27b`, and the same `MEDIX_API_TOKEN` for both services.
   Configure `REDIS_URL` for existing rate limits. The current upload route
   returns data URLs and requires no Blob token. Clerk keys are needed only if enabling Clerk.
3. Leave `MEDIX_API_URL` unset: the binding supplies it. Set `MEDIX_CONTAINER_PROFILE=vercel` explicitly, or keep Vercel system
   environment variables exposed so `VERCEL=1` selects the profile automatically.
   Leave `PORT` unset unless
   deliberately overriding Vercel's default routing port. The container's
   `vercel` profile listens on port 80 and defaults writable caches to
   `/tmp/medix`; the default Render profile retains port 10000 and `/var/data/medix`.
4. Run existing database migrations against the target database before exposing
   the deployment. Bindings do not exist during the Next.js build. Do not add
   inference or backend discovery to the build command.
5. Test the deployed frontend's authenticated text/image requests and video
   seeking, including a byte-range response. An app import or a 200 liveness
   response is insufficient evidence of readiness.

## Evidence storage is still required

The current backend reads validated videos, transcripts and the supported-video
manifest from local paths. They exist on the workstation/Sol collection and are
not included in Git or the image. Vercel has no persistent disk equivalent.
Temporary files can disappear, and another function instance will not share
extracted clips or caches. Changing paths to `/tmp` fixes writability only.

Before a working video demo can be deployed, choose and implement a durable
storage/provisioning strategy for the collection and generated clips. No storage
provider, download URL, dataset publication rights or free storage capacity has
been assumed. With resources missing, `/api/ready` must remain 503 and inference
must not fabricate evidence. Keeping the existing Sol backend is an alternative
architecture, but does not deploy both services on Vercel.

Hobby memory, duration, function/container size, CPU and transfer quotas still
apply. Hosted Voyager access is provided by the user's ASU account; Vercel does
not provide free inference merely by detecting FastAPI. Profile representative
requests, model initialization and the actual dataset before claiming a free,
complete or continuously available deployment.

## Verification

The added tests exercise public route ownership, the caller-side binding,
runtime URL lookup, credential forwarding, missing-binding handling, and both
container profiles using a fake `uv` executable. They do not download model
weights, start cloud resources, or prove a Vercel deployment.

Use `vercel dev --local` to test service wiring when the current Vercel CLI and
a Docker daemon are available. Cloud service networking, resource provisioning
and real inference still require a deployment smoke test after configuration
is confirmed.

## References

- https://vercel.com/docs/services
- https://vercel.com/docs/services/bindings
- https://vercel.com/docs/services/routing
- https://vercel.com/docs/functions/runtimes/container
- https://vercel.com/kb/guide/migrate-render-to-vercel
- https://vercel.com/docs/functions/limitations
