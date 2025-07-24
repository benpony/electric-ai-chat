import { useState, useEffect } from 'react';
import { useNavigate, useMatchRoute } from '@tanstack/react-router';
import { Box, Flex, Text, IconButton, Button, ScrollArea, Tooltip, AlertDialog } from '@radix-ui/themes';
import { LogOut, Moon, Sun, MessageSquarePlus, Monitor, Pin, Trash2 } from 'lucide-react';
import { useTheme } from './ThemeProvider';
import { useChatsShape } from '../shapes';
import { useSidebar } from './SidebarProvider';
import TodoLists from './TodoLists';
import UserAvatar from './UserAvatar';
import { deleteChat } from '../api';

// Chat Button Component
type ChatButtonProps = {
  chat: {
    id: string;
    name: string;
    pinned: boolean;
  };
  isActive: boolean;
  onClick: (chatId: string) => void;
  onDelete: (chatId: string) => void;
};

function ChatButton({ chat, isActive, onClick, onDelete }: ChatButtonProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const handleDelete = async () => {
    try {
      await onDelete(chat.id);
      setShowDeleteDialog(false);
    } catch (error) {
      console.error('Failed to delete chat:', error);
      // Could add error toast here
    }
  };

  return (
    <>
      <div
        style={{ position: 'relative', width: '100%' }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <Button
          key={chat.id}
          variant="ghost"
          color="gray"
          size="1"
          my="1"
          mx="1"
          style={{
            justifyContent: 'flex-start',
            height: '22px',
            backgroundColor: isActive ? 'var(--gray-5)' : undefined,
            overflow: 'hidden',
            color: 'var(--black)',
            width: 'calc(100% - 8px)',
            paddingRight: isHovered ? '32px' : '8px',
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

        {/* Delete button - appears on hover */}
        {isHovered && (
          <Tooltip content="Delete Chat">
            <IconButton
              variant="ghost"
              size="1"
              color="red"
              style={{
                position: 'absolute',
                right: '4px',
                top: '2px',
                height: '18px',
                width: '18px',
                opacity: 0.7,
              }}
              onClick={(e) => {
                e.stopPropagation();
                setShowDeleteDialog(true);
              }}
            >
              <Trash2 size={12} />
            </IconButton>
          </Tooltip>
        )}
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog.Root open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialog.Content style={{ maxWidth: 450 }}>
          <AlertDialog.Title>Delete Chat</AlertDialog.Title>
          <AlertDialog.Description size="2">
            Are you sure you want to delete "{chat.name}"? This action cannot be undone and will permanently remove the chat and all its messages.
          </AlertDialog.Description>

          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray">
                Cancel
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button variant="solid" color="red" onClick={handleDelete}>
                Delete Chat
              </Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </>
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
        Electric AI Chat
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
          <UserAvatar username={username} size="small" showTooltip={false} />
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

  const handleDeleteChat = async (chatId: string) => {
    try {
      await deleteChat(chatId);
      // If the deleted chat is currently active, navigate to home
      if (currentChatId === chatId) {
        navigate({ to: '/' });
      }
      // Electric will automatically sync the deletion
    } catch (error) {
      console.error('Failed to delete chat:', error);
      // Could add error toast here
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
                color: 'var(--white)',
              }}
              onClick={handleNewChat}
            >
              New Chat
            </Button>
          </Box>
        )}

        {/* Main Chat List */}
        <ScrollArea style={{ flexGrow: 1 }}>
          <Flex direction="column" px="3" py="1">
            {/* Pinned chats header */}
            {pinnedChats.length > 0 && (
              <Box py="2" px="1">
                <Text size="1" color="gray" weight="medium">
                  PINNED CHATS
                </Text>
              </Box>
            )}

            {/* Pinned chats */}
            {pinnedChats.map(chat => (
              <ChatButton
                key={chat.id}
                chat={chat}
                isActive={chat.id === currentChatId}
                onClick={handleChatClick}
                onDelete={handleDeleteChat}
              />
            ))}

            {/* Recent Chats header */}
            <Box py="2" px="1">
              <Text size="1" color="gray" weight="medium">
                RECENT CHATS
              </Text>
            </Box>

            {/* Unpinned chats */}
            {unpinnedChats.length === 0 ? (
              <Text
                size="1"
                color="gray"
                style={{ marginLeft: '4px', marginTop: '4px', marginBottom: '4px' }}
              >
                No chats yet
              </Text>
            ) : (
              unpinnedChats.map(chat => (
                <ChatButton
                  key={chat.id}
                  chat={chat}
                  isActive={chat.id === currentChatId}
                  onClick={handleChatClick}
                  onDelete={handleDeleteChat}
                />
              ))
            )}
          </Flex>
        </ScrollArea>

        {/* Todo Lists Section - moved to bottom of sidebar */}
        <TodoLists />

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
