# Electric Chat

A multi-user AI chat application built with modern web technologies.

## Tech Stack

- **Frontend**: React, TypeScript, Vite, TanStack Router, Radix UI, Tailwind CSS
- **Package Management**: pnpm
- **Project Structure**: Monorepo with pnpm workspaces

## Getting Started

### Prerequisites

- Node.js (v18 or higher)
- pnpm (v8 or higher)

### Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/yourusername/electric-chat.git
cd electric-chat
pnpm install
```

### Development

Start the development server:

```bash
pnpm dev
```

The application will be available at http://localhost:5173

### Building for Production

```bash
pnpm build
```

### Preview Production Build

```bash
pnpm preview
```

## Project Structure

```
electric-chat/
├── packages/
│   ├── app/       # React frontend application
│   └── api/       # API server (to be implemented)
└── pnpm-workspace.yaml
```

## Features

- User authentication (local storage based)
- Chat creation and management
- Real-time chat interface
- Responsive design
- Light and dark theme support 