
<!-- blog post header image extra-landscape crop -->

# Electric AI Chat

AI chat application using Electric for resumeability, interruptability, multi-user and multi-agent sync. See the [Building&nbsp;AI&nbsp;apps&nbsp;on&nbsp;sync](https://electric-sql.com/blog/2025/04/09/building-ai-apps-on-sync) blog post for more context.

## ElectricSQL

Electric is a Postgres sync engine. It solves the hard problems of sync for you, including partial replication, fan-out, and data delivery. See https://electric-sql.com for more information.

## Building AI apps on sync

This is a demo application that shows how to build collaborative AI apps that use Electric to keep both agents and users in sync. It shows:

- real-time multi-agent, multi-user and multi-device sync
- live streaming of AI sessions with seamless resumeability and session continuity
- real-time streaming of LLM tool responses

The demo is deployed at [electric-ai-chat.examples.electric-sql.com](https://electric-ai-chat.examples.electric-sql.com). See the [blog post](https://electric-sql.com/blog/2025/04/09/building-ai-apps-on-sync) for more information.

<!-- and can be seen running in the video below ... -->

## Getting Started

### Pre-reqs

- Node.js (v18 or higher)
- pnpm (v8 or higher)
- Docker and Docker Compose (for local development environment)
- An OpenAI API key

### Install

Clone the repository and install dependencies:

```bash
git clone https://github.com/electric-sql/electric-ai-chat.git
cd electric-ai-chat
pnpm install
```

### Develop

1. Start Postgres and Electric using Docker:

```bash
docker compose up -d
```

2. Start the backend API:

```bash
export OPENAI_API_KEY=<your-openai-api-key>
pnpm dev:api
```

3. Build and serve the frontend app:

```bash
pnpm dev:app
```

Open in your browser at http://localhost:5173

## Code structure

```
electric-ai-chat/
├── packages/
│   ├── app/       # React frontend application
│   │   ├── src/   # Source code
│   │   └── ...    # Configuration files
│   └── api/       # Backend API server
│       ├── src/   # API source code
│       ├── ai/    # AI integration and tools
│       └── ...    # Configuration files
├── db/            # Database initialization scripts
│   └── schema.sql # Database schema
├── docker-compose.yaml # Docker configuration for development
└── pnpm-workspace.yaml # Workspace configuration
```

## Stack

1. **Front-end**

   - React 19
   - TypeScript
   - Vite
   - TanStack Router
   - Radix UI

2. **Back-end**:

   - Node.js
   - Hono (web framework)
   - TypeScript

3. **Database**:

   - Postgres
   - ElectricSQL for sync

4. **AI**:

   - OpenAI API with tool calling capabilities

## Tools

The demo app implements several LLM tools to enhance the AI assistant capabilities:

1. **ElectricSQL Tools**

   - Fetch and utilize ElectricSQL documentation
   - Provide context-aware answers about ElectricSQL features and best practices

2. **Database Tools**

   - Query database schema information
   - Execute read-only PostgreSQL queries and return results
   - Safely handle database connections with proper authentication

3. **File Management Tools**

   - Create, read, edit, delete, and rename files within chat sessions
   - Support various file types with MIME type handling
   - Persist files in the database for cross-session access

4. **Chat Management Tools**

   - Automatically generate descriptive chat names based on content
   - Rename chats with user-specified names
   - Pin/unpin chats for easier organization

5. **Todo List Tools**
   - Create, update, delete, and manage collaborative todo lists
   - Bidirectional real-time synchronization of todo items across all clients
   - LLM-powered todo processing with the ability to:
     - Process entire todo lists automatically
     - Watch lists for new items and process them as they're added
     - Respond to task completion status changes in real-time
     - Use ElectricSQL's shape streams to monitor tasks without polling
   - Todo items can be created by users or the AI, demonstrating real-time collaboration
   - Demonstrates practical uses of ElectricSQL for:
     - Event-driven architectures with shape streams
     - Real-time UI updates across multiple clients
     - Reactive programming patterns with AI integrations
     - Resumable operations that can survive page reloads or connection interruptions
