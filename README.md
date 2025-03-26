# Electric Chat

A multi-user AI chat application, it demonstrates the use of ElectricSQL for syncing and streaming application state between server and client in an AI application. This enables multiple users or devices to see the same chat history and AI responses in real-time. It is also resilient to application refreshed and restarts.

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite, TanStack Router, Radix UI, Tailwind CSS
- **Backend**: Node.js, Hono (web framework), TypeScript
- **Database**: PostgreSQL with ElectricSQL for local-first data sync
- **Package Management**: pnpm
- **Project Structure**: Monorepo with pnpm workspaces

## Architecture

Electric Chat is built using a modern architecture with these key components:

1. **Frontend Application (packages/app)**
   - React-based single-page application
   - Uses TanStack Router for client-side routing
   - Uses Radix UI and Tailwind CSS for UI components
   - Implements light/dark theme support
   - Connects to ElectricSQL for local-first data management

2. **Backend API (packages/api)**
   - Node.js API server using Hono web framework
   - Provides REST endpoints for chat operations
   - Handles user authentication and message processing

3. **Database Layer**
   - PostgreSQL database with ElectricSQL
   - Schemas for chats, messages, and token storage
   - ElectricSQL for real-time sync between clients and server

4. **Infrastructure**
   - Docker Compose configuration for development environment
   - Includes PostgreSQL and ElectricSQL services

## Getting Started

### Prerequisites

- Node.js (v18 or higher)
- pnpm (v8 or higher)
- Docker and Docker Compose (for local development environment)

### Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/yourusername/electric-chat.git
cd electric-chat
pnpm install
```

### Start the Development Environment

1. Start the database and ElectricSQL services using Docker:

```bash
docker-compose up -d
```

2. Start the development API server:

```bash
cd packages/api
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
electric-chat/
├── packages/
│   ├── app/       # React frontend application
│   │   ├── src/   # Source code
│   │   └── ...    # Configuration files
│   └── api/       # Backend API server
│       ├── src/   # API source code
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
- Message streaming support
- Offline capability with ElectricSQL
- Responsive design
- Light and dark theme support

## API Endpoints

- `POST /api/chats` - Create a new chat
- `POST /api/chats/:id/messages` - Add a message to a chat

See the API documentation in packages/api/README.md for more details. 