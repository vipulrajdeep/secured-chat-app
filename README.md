# Secure Chat App

A lightweight username-based chat app with 1-to-1 and group conversations. Messages are encrypted with AES-256-GCM before they are written to storage and are decrypted only by the server when the requesting username is a participant in that conversation.

## Features

- No login flow; users enter a username to see their conversations.
- Direct and group chats.
- No chat history stored in browser storage.
- Server-side encrypted message storage.
- JSON file storage for local development.
- Optional Upstash Redis REST storage for a free hosted deployment.
- Server-sent events for near real-time refresh, with polling fallback.

## Security note

Because there is no login, usernames are not cryptographic identities. The app prevents non-participant usernames from reading a conversation, and stored messages are encrypted at rest, but anyone who knows a username can claim it. For production-grade privacy, add authentication or per-user key ownership.

## Run locally

```bash
npm start
```

Open `http://localhost:3000`.

Set a strong encryption secret before sharing the app:

```bash
export CHAT_MASTER_KEY="replace-with-a-long-random-secret"
npm start
```

Local data is stored at `data/chat-store.json`.

## Free hosting path

1. Create a GitHub repository and push this project.
2. Create a free Upstash Redis database.
3. Deploy the Node app on Render's free web service tier from the GitHub repo.
4. Add these Render environment variables:
   - `CHAT_MASTER_KEY`: long random secret.
   - `UPSTASH_REDIS_REST_URL`: from Upstash.
   - `UPSTASH_REDIS_REST_TOKEN`: from Upstash.
   - `NODE_VERSION`: `22`.
5. In GitHub, add `RENDER_DEPLOY_HOOK_URL` as a repository secret if you want GitHub Actions to trigger Render deploys after tests pass.

The included workflow runs tests on pushes to `main` and triggers Render when the deploy hook secret is present.
