# Electric AI Chat

A multi-user AI chat application built with [ElectricSQL](https://electric-sql.com) that enables real-time collaboration and state synchronization. Multiple users can participate in AI-powered conversations simultaneously, with chat history and responses instantly synchronized across all connected devices. The application maintains perfect state consistency through ElectricSQL's robust sync engine, ensuring chat continuity even through page refreshes, network interruptions, or application restarts.

This project demonstrates:

- Real-time chat synchronization across multiple users, with the sidebar dynamically updating as new chats are created
- Live streaming of AI responses to all connected clients through ElectricSQL, with seamless resumption of interrupted chats
- Persistent chat history stored in the database, enabling session continuity across page reloads and perfect synchronization between users
- Real-time streaming of LLM tool responses via ElectricSQL, powering features like:
  - Chat pinning and renaming
  - Live updates of AI-generated or modified files
  - Immediate visibility of tool actions across all clients

## Outline

- [What is Electric?](#what-is-electric)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [LLM Tools Integration](#llm-tools-integration)
- [ElectricSQL Benefits for AI Applications](#electricsql-benefits-for-ai-applications)
- [Getting Started](#getting-started)
- [Project Structure](#project-structure)
- [Features](#features)
- [API Endpoints](#api-endpoints)

## What is Electric?

Sync is the magic ingredient behind fast, modern software. From apps like Figma and Linear to AI agents running on live local data.

Electric is a Postgres sync engine. It solves the hard problems of sync for you, including partial replication, fan-out, and data delivery. So you can build awesome software, without rolling your own sync.

Specifically, Electric is a read-path sync engine for Postgres. It syncs data out of Postgres into ... anything you like. The core sync protocol is based on a low-level [HTTP API](https://electric-sql.com/docs/api/http). This integrates with CDNs for highly-scalable data delivery.

Partial replication is managed using [Shapes](https://electric-sql.com/docs/guides/shapes). Sync can be consumed directly or via [client libraries](https://electric-sql.com/docs/api/clients/typescript) and [framework integrations](https://electric-sql.com/docs/api/integrations/react).

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite, TanStack Router, Radix UI
- **Backend**: Node.js, Hono (web framework), TypeScript
- **Database**: PostgreSQL with ElectricSQL for local-first data sync
- **AI Integration**: OpenAI API with tool calling capabilities
- **Package Management**: pnpm
- **Project Structure**: Monorepo with pnpm workspaces

## Architecture

Electric AI Chat is built using a modern architecture with these key components:

1. **Frontend Application (packages/app)**

   - React-based single-page application
   - Uses TanStack Router for client-side routing
   - Uses Radix UI for UI components
   - Implements light/dark theme support
   - Connects to ElectricSQL for local-first data management

2. **Backend API (packages/api)**

   - Node.js API server using Hono web framework
   - Provides REST endpoints for chat operations
   - Handles user authentication and message processing
   - Integrates with OpenAI's API for AI responses
   - Implements tool calling for enhanced AI capabilities

3. **Database Layer**

   - PostgreSQL database with ElectricSQL
   - Schemas for chats, messages, and token storage
   - ElectricSQL for real-time sync between clients and server

4. **Infrastructure**
   - Docker Compose configuration for development environment
   - Includes PostgreSQL and ElectricSQL services

## LLM Tools Integration

Electric AI Chat implements several LLM tools to enhance the AI assistant capabilities:

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

## ElectricSQL Benefits for AI Applications

Electric AI Chat showcases how ElectricSQL enhances AI applications in several key ways:

- **Resume-ability**: Chat sessions persist across page reloads and device restarts, allowing users to continue exactly where they left off without losing context or progress.

- **Multi-User**: Multiple users can view and interact with the same chat simultaneously, with changes propagated in real-time across all connected clients.

- **Decoupled UI Updates**: ElectricSQL enables UI updates throughout the application independent of the main chat stream. This means:

  - Status indicators can update in real-time
  - Side panels can refresh with new information
  - Notifications can appear across the application
  - All without interrupting or being tied to the main chat interaction

- **Streaming Efficiency**: Token streaming from AI responses is handled efficiently, with ElectricSQL ensuring all clients receive updates in real-time.

## Getting Started

### Prerequisites

- Node.js (v18 or higher)
- pnpm (v8 or higher)
- Docker and Docker Compose (for local development environment)
- An OpenAI API key

### Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/electric-sql/ai-chat.git
cd ai-chat
pnpm install
```

### Start the Development Environment

1. Start the PostgreSQL and ElectricSQL services using Docker:

```bash
docker-compose up -d
```

2. Start the development API server:

```bash
cd packages/api
export OPENAI_API_KEY=<your-openai-api-key>
pnpm dev
```

3. Start the development frontend application:

```bash
cd packages/app
pnpm dev
```

The frontend application will be available at http://localhost:5173
The API server will be available at http://localhost:3001

## Project Structure

```
ai-chat/
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

## Features

- User authentication (local storage based)
- Chat creation and management
- Real-time chat interface with AI responses
- AI tool calling for enhanced capabilities
- Message streaming support
- Offline capability with ElectricSQL
- Responsive design
- Light and dark theme support

## API Endpoints

- `POST /api/chats` - Create a new chat
- `POST /api/chats/:id/messages` - Add a message to a chat

See the API documentation in packages/api/README.md for more details.
