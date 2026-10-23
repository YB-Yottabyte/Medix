# Medix frontend

Next.js chat interface for Medix's evidence-grounded medical-procedure pipeline.
It supports text and image inputs, cited video clips, transcript synchronization,
conversation-aware follow-ups, optional speech, and per-response server timings.

Use Node 22 and the pnpm version pinned in `package.json`:

```bash
corepack pnpm install --frozen-lockfile
cp .env.example .env.local
corepack pnpm db:migrate
corepack pnpm dev
```

Copy the environment example only for a new setup. Configure PostgreSQL,
`AUTH_SECRET`, and server-only Voyager credentials; configure Blob for image
uploads. Set `MEDIX_API_URL=http://127.0.0.1:5001` for a local backend or port 5002
for the current Sol tunnel. Set the same optional `MEDIX_API_TOKEN` on both
services when backend authentication is enabled. Existing private environment
files must never be committed.

```bash
corepack pnpm exec biome check .
corepack pnpm typecheck
corepack pnpm test:unit
corepack pnpm build
```

`db:migrate` fails if its database URL is missing or migration fails. The default
build does not migrate or connect to a production database. Deploy the app as a
Node server, not a static export. See [deployment instructions](../development/docs/DEPLOYMENT.md)
for Render, resource provisioning, production secrets, and operational checks.

The UI's medical answer is composed from checked reference/video evidence; a
model review or a green CI check is not independent clinical validation.
