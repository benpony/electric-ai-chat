import { useState, useEffect } from 'react';
import { useNavigate, useMatchRoute } from '@tanstack/react-router';
import { Box, Flex, Text, IconButton, Button, ScrollArea, Tooltip } from '@radix-ui/themes';
import { LogOut, Moon, Sun, MessageSquarePlus, Monitor, Pin } from 'lucide-react';
import { useTheme } from './ThemeProvider';
import { useChatsShape } from '../shapes';
import { FileList } from './FileList';
import { useSidebar } from './SidebarProvider';

// Chat Button Component
type ChatButtonProps = {
  chat: {
    id: string;
    name: string;
    pinned: boolean;
  };
  isActive: boolean;
  onClick: (chatId: string) => void;
};

function ChatButton({ chat, isActive, onClick }: ChatButtonProps) {
  return (
    <Button
      key={chat.id}
      variant="ghost"
      color="gray"
      size="1"
      my="1"
      style={{
        justifyContent: 'flex-start',
        height: '22px',
        backgroundColor: isActive ? 'var(--gray-5)' : undefined,
        overflow: 'hidden',
        color: 'var(--black)',
      }}
      onClick={() => onClick(chat.id)}
    >
      {chat.pinned && <Pin size={12} style={{ marginRight: '8px', opacity: 0.7 }} />}
      <Text
        size="1"
        style={{
          maxWidth: '100%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {chat.name}
      </Text>
    </Button>
  );
}

// Header Component
type HeaderProps = {
  isMobile: boolean;
  handleNewChat: () => void;
  setSidebarOpen: (value: boolean) => void;
};

function SidebarHeader({ isMobile, handleNewChat, setSidebarOpen }: HeaderProps) {
  return (
    <Flex
      p="3"
      align="center"
      justify="between"
      style={{
        height: '56px',
        borderBottom: '1px solid var(--gray-5)',
        position: 'relative',
        flexShrink: 0,
      }}
    >
      <Text size="3" weight="medium" style={{ paddingLeft: '4px' }}>
        Electric Chat
      </Text>
      {!isMobile && (
        <Tooltip content="New Chat">
          <IconButton variant="ghost" size="2" onClick={handleNewChat}>
            <MessageSquarePlus size={22} />
          </IconButton>
        </Tooltip>
      )}
      {isMobile && (
        <IconButton
          size="1"
          variant="ghost"
          style={{
            position: 'absolute',
            right: '12px',
            opacity: 0.8,
            height: '28px',
            width: '28px',
          }}
          onClick={() => setSidebarOpen(false)}
        >
          ✕
        </IconButton>
      )}
    </Flex>
  );
}

// Footer Component
type FooterProps = {
  username: string;
  theme: string | undefined;
  setTheme: (theme: string) => void;
  handleLogout: () => void;
};

function SidebarFooter({ username, theme, setTheme, handleLogout }: FooterProps) {
  return (
    <Box p="2" style={{ marginTop: 'auto', borderTop: '1px solid var(--gray-5)' }}>
      <Flex align="center" justify="between" style={{ padding: '0 8px' }}>
        <Flex align="center" gap="2">
          <Text size="1">{username}</Text>
        </Flex>
        <Flex gap="3">
          <Tooltip
            content={
              theme === 'dark' ? 'Light mode' : theme === 'light' ? 'System mode' : 'Dark mode'
            }
          >
            <IconButton
              size="1"
              variant="ghost"
              onClick={() => {
                if (theme === 'dark') setTheme('light');
                else if (theme === 'light') setTheme('system');
                else setTheme('dark');
              }}
            >
              {theme === 'dark' ? (
                <Sun size={14} />
              ) : theme === 'light' ? (
                <Monitor size={14} />
              ) : (
                <Moon size={14} />
              )}
            </IconButton>
          </Tooltip>
          <Tooltip content="Log out">
            <IconButton size="1" variant="ghost" color="red" onClick={handleLogout}>
              <LogOut size={14} />
            </IconButton>
          </Tooltip>
        </Flex>
      </Flex>
    </Box>
  );
}

export default function Sidebar() {
  const { data: chats } = useChatsShape();
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const username = localStorage.getItem('username') || 'User';
  const { isSidebarOpen, setSidebarOpen } = useSidebar();

  // Use TanStack Router to get current chat ID
  const matchRoute = useMatchRoute();
  const chatMatch = matchRoute({ to: '/chat/$chatId' });
  const currentChatId = chatMatch ? chatMatch.chatId : undefined;

  // Set up window resize handler
  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (!mobile) {
        setSidebarOpen(false);
      }
    };

    handleResize(); // Call immediately
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [setSidebarOpen]);

  const handleLogout = () => {
    localStorage.removeItem('username');
    navigate({ to: '/' });
  };

  const handleChatClick = (chatId: string) => {
    navigate({ to: `/chat/${chatId}` });
    if (isMobile) {
      setSidebarOpen(false);
    }
  };

  const handleNewChat = () => {
    navigate({ to: '/' });
    if (isMobile) {
      setSidebarOpen(false);
    }
  };

  // Sort and separate chats into pinned and unpinned
  const sortedChats = chats.sort((a, b) => {
    // First sort by pinned status
    if (a.pinned !== b.pinned) {
      return b.pinned ? 1 : -1;
    }
    // Then by creation date
    return b.created_at.getTime() - a.created_at.getTime();
  });

  const pinnedChats = sortedChats.filter(chat => chat.pinned);
  const unpinnedChats = sortedChats.filter(chat => !chat.pinned);

  return (
    <>
      {/* Sidebar overlay (mobile only) */}
      {isMobile && (
        <Box
          className={`sidebar-overlay ${isSidebarOpen ? 'open' : ''}`}
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <Box
        className={`sidebar ${isSidebarOpen ? 'open' : ''}`}
        style={{
          width: isMobile ? '280px' : '280px',
          height: '100%',
        }}
      >
        {/* Header */}
        <SidebarHeader
          isMobile={isMobile}
          handleNewChat={handleNewChat}
          setSidebarOpen={setSidebarOpen}
        />

        {/* Prominent New Chat button for mobile */}
        {isMobile && (
          <Box p="2">
            <Button
              size="1"
              variant="solid"
              style={{
                width: '100%',
                justifyContent: 'center',
                height: '28px',
              }}
              onClick={handleNewChat}
            >
              <MessageSquarePlus size={14} style={{ marginRight: '8px' }} />
              New Chat
            </Button>
          </Box>
        )}

        {/* Chats */}
        <ScrollArea>
          <div className="sidebar-content">
            {/* Files Section for Active Chat */}
            {currentChatId && <FileList chatId={currentChatId} />}

            <Flex direction="column" gap="1" px="4">
              {/* Pinned Chats Section */}
              {pinnedChats.length > 0 && (
                <>
                  <Box py="2">
                    <Text size="1" color="gray" weight="medium">
                      PINNED CHATS
                    </Text>
                  </Box>
                  {pinnedChats.map(chat => (
                    <ChatButton
                      key={chat.id}
                      chat={chat}
                      isActive={chat.id === currentChatId}
                      onClick={handleChatClick}
                    />
                  ))}
                </>
              )}

              {/* Recent Chats Header */}
              <Box py="2">
                <Text size="1" color="gray" weight="medium">
                  RECENT CHATS
                </Text>
              </Box>

              {/* Unpinned Chats */}
              {unpinnedChats.map(chat => (
                <ChatButton
                  key={chat.id}
                  chat={chat}
                  isActive={chat.id === currentChatId}
                  onClick={handleChatClick}
                />
              ))}
            </Flex>
          </div>
        </ScrollArea>

        {/* Footer */}
        <SidebarFooter
          username={username}
          theme={theme}
          setTheme={setTheme}
          handleLogout={handleLogout}
        />
      </Box>
    </>
  );
}
