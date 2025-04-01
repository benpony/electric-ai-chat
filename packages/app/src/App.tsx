import { useState, useEffect } from 'react';
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { Flex } from '@radix-ui/themes';
import '@radix-ui/themes/styles.css';
import { Providers } from './components/Providers';
import WelcomeScreen from './components/WelcomeScreen';
import NewChatScreen from './components/NewChatScreen';
import ChatScreen from './components/ChatScreen';
import Sidebar from './components/Sidebar';
import Todo from './components/Todo';
import { preloadChats, preloadMessages, preloadTodoLists, preloadTodoItems } from './shapes';
import { ChatSidebarProvider } from './components/ChatSidebarProvider';

// Define the root route
const rootRoute = createRootRoute({
  component: () => {
    const [loading, setLoading] = useState(true);
    const [username, setUsername] = useState<string | null>(localStorage.getItem('username'));

    // Listen for localStorage changes to detect login/logout
    useEffect(() => {
      const checkAuth = () => {
        const currentUser = localStorage.getItem('username');

        if (currentUser !== username) {
          // Update username state
          setUsername(currentUser);
        }
      };

      // Check auth status periodically
      const interval = setInterval(checkAuth, 100);

      // Add storage event listener to detect changes from other tabs
      window.addEventListener('storage', checkAuth);

      Promise.all([
        preloadChats(),
        preloadTodoLists()
      ]).then(() => {
        setLoading(false);
      });

      return () => {
        clearInterval(interval);
        window.removeEventListener('storage', checkAuth);
      };
    }, [username]);

    // If username exists, user is logged in - show sidebar immediately
    const isLoggedIn = !!username;

    if (loading) {
      return null;
    }

    return (
      <Providers defaultTheme="light">
        <Flex style={{ height: '100vh', width: '100vw', overflow: 'hidden' }}>
          {isLoggedIn && <Sidebar />}
          <Flex
            direction="column"
            className="content-area"
            style={{
              width: '100%',
              transition: 'width 0.2s ease-in-out',
            }}
          >
            <Outlet />
          </Flex>
        </Flex>
      </Providers>
    );
  },
});

// Define routes
const welcomeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => {
    const [username, setUsername] = useState<string | null>(localStorage.getItem('username'));

    // Update username state when localStorage changes
    useEffect(() => {
      const checkAuth = () => {
        const currentUser = localStorage.getItem('username');
        if (currentUser !== username) {
          setUsername(currentUser);
        }
      };

      const interval = setInterval(checkAuth, 100);
      return () => clearInterval(interval);
    }, [username]);

    // The welcome route serves two purposes depending on login state
    return username ? <NewChatScreen /> : <WelcomeScreen />;
  },
});

const chatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/chat/$chatId',
  loader: async ({ params }) => {
    await preloadMessages(params.chatId);
  },
  component: () => (
    <ChatSidebarProvider>
      <ChatScreen />
    </ChatSidebarProvider>
  ),
});

const todoRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/todo/$listId',
  loader: async ({ params }) => {
    await preloadTodoItems(params.listId);
    // Preload the lists to ensure we have the list name
    await preloadTodoLists();
  },
  component: () => <Todo />,
});

// Create the router
const routeTree = rootRoute.addChildren([welcomeRoute, chatRoute, todoRoute]);

const router = createRouter({ routeTree });

// Register the router for type safety
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

function App() {
  return <RouterProvider router={router} />;
}

export default App;
