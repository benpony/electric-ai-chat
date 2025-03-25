I am build a multi user ai chat app.

It is going to be built with:
- pnpm for package manager
- Vite for building and the dev server
- react
- typescript
- tanstack router for routing
- Radix UI

I want it to be in a pnpm workspace with the following packages:
- packages/app
- packages/api

Please use the vite react template for the starting point.

Screens:

- Welcome screen
  - input for a user to enter their name
- New chat screen
  - A large text input for the user to enter their prompt
- Chat screen
  - A text input for the user to enter their prompt at the bottom of the screen
  - list of messages between the users and the AI

There should be a sidebar on the left with a new chat button and a list of previous chats.

The UI should be built with Radix UI and and have a light and dark theme.

I would like the app to be responsive and work on mobile, tablet and desktop.

When a user enters the chat promp on the new chat screen, ideally the UI animates to the new layout of the chat screen with the new message in the chat.

We only need to build the UI at this point. No backend or API is needed yet - we will come back to it later.

