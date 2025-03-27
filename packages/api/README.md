# Electric Chat API

This is the API server for Electric Chat.

## Tech Stack

- Node.js
- TypeScript
- Hono (web framework)
- Postgres with postgres.js client

## Setup

1. Make sure you have Node.js and Postgres installed.

2. Install dependencies:

   ```
   npm install
   ```

3. Set up a Postgres database (default name: `electric_chat`).
   Note: The Docker setup will handle database initialization automatically.

4. Configure environment variables (optional):
   - `DB_HOST` - Database host (default: localhost)
   - `DB_PORT` - Database port (default: 5432)
   - `DB_NAME` - Database name (default: electric_chat)
   - `DB_USER` - Database username (default: postgres)
   - `DB_PASSWORD` - Database password (default: postgres)
   - `PORT` - API server port (default: 3001)

## Running the API

Development mode:

```
npm run dev
```

Production mode:

```
npm run build
npm start
```

The server will start on http://localhost:3001 by default.

## API Endpoints

- `POST /api/chats` - Create a new chat

  - Request body: `{ "message": "Hello", "user": "John" }`
  - Response: `{ "chat": { "id": 1, "created_at": "2023-06-15T10:30:00Z", "messages": [...] } }`

- `POST /api/chats/:id/messages` - Add a message to a chat
  - Request body: `{ "message": "Hello back", "user": "Jane" }`
  - Response: `{ "message": { "id": 2, "content": "Hello back", "user_name": "Jane", "created_at": "2023-06-15T10:35:00Z" } }`
