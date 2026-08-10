<a href="https://chatbot.ai-sdk.dev/demo">
  <img alt="Chatbot" src="app/(chat)/opengraph-image.png">
  <h1 align="center">Medix Chat</h1>
</a>

<p align="center">
    Medix Chat is the hands-free medical-procedure QA interface for the Medix research prototype.
</p>

<p align="center">
  <a href="https://chatbot.ai-sdk.dev/docs"><strong>Read Docs</strong></a> ·
  <a href="#features"><strong>Features</strong></a> ·
  <a href="#model-providers"><strong>Model Providers</strong></a> ·
  <a href="#deploy-your-own"><strong>Deploy Your Own</strong></a> ·
  <a href="#running-locally"><strong>Running locally</strong></a>
</p>
<br/>

## Medix Integration

The chat agent can search the MedVidQA procedure corpus and analyze an attached
medical image through the companion FastAPI backend. Copy `.env.example` to
`.env.local`, set `MEDIX_API_URL` to the backend address, and start the FastAPI
service before asking procedure questions. This research software is not a
medical device and is not a substitute for emergency services or professional
medical advice.

## Features

- [Next.js](https://nextjs.org) App Router
  - Advanced routing for seamless navigation and performance
  - React Server Components (RSCs) and Server Actions for server-side rendering and increased performance
- [AI SDK](https://ai-sdk.dev/docs/introduction)
  - Unified API for generating text, structured objects, and tool calls with LLMs
  - Hooks for building dynamic chat and generative user interfaces
  - Direct Groq integration for reproducible Medix model evaluation
- [shadcn/ui](https://ui.shadcn.com)
  - Styling with [Tailwind CSS](https://tailwindcss.com)
  - Component primitives from [Radix UI](https://radix-ui.com) for accessibility and flexibility
- Data Persistence
  - [Neon Serverless Postgres](https://vercel.com/marketplace/neon) for saving chat history and user data
  - [Vercel Blob](https://vercel.com/storage/blob) for efficient file storage
- [Clerk](https://clerk.com/docs/nextjs/getting-started/quickstart)
  - Registered-user authentication with the existing Medix login and sign-up UI
  - Auth.js remains scoped to anonymous guest-chat sessions during migration

## Model Providers

Medix calls Groq directly through `@ai-sdk/groq`. The current chat and title
model is `openai/gpt-oss-20b`. GPT-OSS 120B can be added as a comparison after
it is enabled in the Groq project's model limits. Set `GROQ_API_KEY` in
`.env.local`. Spoken responses are generated locally by Kokoro through the
FastAPI backend and never use the Groq API key.

The model picker also offers local `Qwen 3.5 9B` through Ollama. Set
`OLLAMA_BASE_URL` and `OLLAMA_CHAT_MODEL` in `.env.local`; the defaults are
`http://127.0.0.1:11434` and `qwen3.5:9b-q4_K_M`. Both selectable models use
the same Medix system prompt and canonical evidence-retrieval tool.

## Deploy Your Own

You can deploy your own version of Chatbot to Vercel with one click:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/templates/next.js/chatbot)

## Running locally

Use the environment variables [defined in `.env.example`](.env.example) to run
Medix locally.

Create a Clerk development application, enable email/password with email-code
verification, and optionally enable Apple, GitHub, and Google social
connections. Then set `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and
`CLERK_SECRET_KEY` in `.env.local`. Clerk users are linked on first request to
the existing Medix UUID user record, preserving saved-chat ownership.

> Note: You should not commit your `.env` file or it will expose secrets that will allow others to control access to your various AI and authentication provider accounts.

```bash
pnpm install
pnpm db:migrate # Setup database or apply latest database changes
pnpm dev
```

Your app template should now be running on [localhost:3000](http://localhost:3000).
