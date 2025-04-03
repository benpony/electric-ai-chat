import { useState, useEffect, useRef, memo, useMemo } from 'react';
import { useParams } from '@tanstack/react-router';
import {
  Box,
  Flex,
  Text,
  IconButton,
  ScrollArea,
  TextArea,
  Tooltip,
  Switch,
} from '@radix-ui/themes';
import { Menu, Send, FileText, Terminal } from 'lucide-react';
import { useSidebar } from './SidebarProvider';
import { useChatSidebar } from './ChatSidebarProvider';
import { useChat, useMessagesShape, useFilesShape, usePresenceShape } from '../shapes';
import { addMessage, updatePresence, deletePresence } from '../api';
import AiResponse from './AiResponse';
import { ChatSidebar } from './ChatSidebar';
import { processDatabaseUrl } from '../utils/db-url';
import { getChatPasswords } from '../utils/password-store';
import UserAvatar from './UserAvatar';

type Message = {
  id: string;
  content: string;
  role: string;
  user_name: string;
  created_at: Date;
  updated_at: Date;
  chat_id: string;
  status: string;
  thinking_text: string;
};

interface MessageListProps {
  messages: Message[];
  username: string;
  scrollAreaRef: React.RefObject<HTMLDivElement>;
  scrollContentRef: React.RefObject<HTMLDivElement>;
  messagesEndRef: React.RefObject<HTMLDivElement>;
}

interface MessageInputProps {
  onSubmit: (
    message: string,
    dbUrl?: { redactedUrl: string; redactedId: string; password: string }
  ) => void;
  isLoading: boolean;
}

interface UserPromptProps {
  message: Message;
  isCurrentUser: boolean;
  multipleUsers: boolean;
}

// UserPrompt component to display user messages
const UserPrompt = memo(({ message, isCurrentUser, multipleUsers }: UserPromptProps) => {
  const isSystemMessage = message.role === 'system';
  const showAvatar = !isSystemMessage;

  return (
    <Flex
      direction="column"
      style={{
        maxWidth: isSystemMessage ? '100%' : '60%',
        marginBottom: '10px',
        alignItems: isCurrentUser ? 'flex-end' : 'flex-start',
        alignSelf: isSystemMessage ? 'stretch' : 'auto',
      }}
    >
      <Flex
        align="center"
        gap="2"
        style={{
          marginBottom: '3px',
          flexDirection: isCurrentUser ? 'row-reverse' : 'row',
        }}
      >
        {multipleUsers && showAvatar && (
          <UserAvatar username={message.user_name} size="small" showTooltip={false} />
        )}

        {multipleUsers && !isSystemMessage && (
          <Text
            size="1"
            style={{
              color: 'var(--gray-11)',
              marginLeft: '-2px',
              marginBottom: '3px',
            }}
          >
            {message.user_name}
          </Text>
        )}
        {isSystemMessage && (
          <Text
            size="1"
            style={{
              color: 'var(--amber-11)',
              marginLeft: '4px',
              marginBottom: '3px',
              fontWeight: 'bold',
            }}
          >
            System
          </Text>
        )}
      </Flex>
      <Box
        style={{
          backgroundColor: isSystemMessage
            ? 'var(--amber-3)'
            : isCurrentUser
              ? 'var(--accent-9)'
              : 'var(--color-background-message)',
          color: isSystemMessage ? 'var(--amber-11)' : isCurrentUser ? 'white' : 'var(--gray-12)',
          padding: '4px 12px 6px 12px',
          borderRadius: '18px',
          position: 'relative',
          maxWidth: isSystemMessage ? '100%' : 'fit-content',
          width: isSystemMessage ? '100%' : 'auto',
          boxShadow: 'var(--shadow-message)',
          borderLeft: isSystemMessage ? '3px solid var(--amber-9)' : 'none',
          fontFamily: isSystemMessage ? 'monospace' : 'inherit',
        }}
      >
        <Text size="2" style={{ whiteSpace: 'pre-wrap' }}>
          {message.content}
        </Text>
      </Box>
    </Flex>
  );
});

// MessageList component to display messages
const MessageList = memo(
  ({ messages, username, scrollAreaRef, scrollContentRef, messagesEndRef }: MessageListProps) => {
    const usernames = new Set(
      messages.filter(msg => msg.role === 'user').map(msg => msg.user_name)
    );
    const multipleUsers = Boolean(usernames.size > 1);

    return (
      <ScrollArea style={{ height: '100%' }} scrollbars="vertical" ref={scrollAreaRef}>
        <Box
          p="3"
          style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '100%' }}
          ref={scrollContentRef}
        >
          {messages
            .sort((a, b) => {
              // If both messages are from agent, compare by updated_at
              if (a.role === 'agent' && b.role === 'agent') {
                const timeA = a.updated_at.getTime();
                const timeB = b.updated_at.getTime();
                if (timeA === timeB) {
                  // If timestamps equal, pending messages come after non-pending
                  if (a.status === 'pending' && b.status !== 'pending') return 1;
                  if (a.status !== 'pending' && b.status === 'pending') return -1;
                }
                return timeA - timeB;
              }
              // Otherwise compare by created_at
              return a.created_at.getTime() - b.created_at.getTime();
            })
            .map(msg => (
              <Flex
                key={msg.id}
                justify={
                  msg.role === 'system'
                    ? 'start'
                    : msg.role === 'agent'
                      ? 'center'
                      : msg.user_name === username
                        ? 'end'
                        : 'start'
                }
                style={{
                  width: '100%',
                }}
              >
                {msg.role === 'agent' ? (
                  <AiResponse message={msg} />
                ) : (
                  <UserPrompt
                    message={msg}
                    isCurrentUser={msg.user_name === username}
                    multipleUsers={multipleUsers}
                  />
                )}
              </Flex>
            ))}
          <div ref={messagesEndRef} />
        </Box>
      </ScrollArea>
    );
  }
);

// MessageInput component for the form
const MessageInput = memo(({ onSubmit, isLoading }: MessageInputProps) => {
  const [message, setMessage] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { chatId } = useParams({ from: '/chat/$chatId' });

  // Focus input on mount
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [chatId]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || isLoading) return;

    // Process any database URL in the message
    const { message: processedMessage, dbUrl } = processDatabaseUrl(message, chatId);
    onSubmit(processedMessage, dbUrl);
    setMessage('');
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  };

  // Auto-resize textarea as content grows
  const adjustTextareaHeight = () => {
    if (!textareaRef.current) return;
    const textarea = textareaRef.current;
    textarea.style.height = 'auto';
    const maxHeight = window.innerHeight * 0.2; // 20% of screen height
    const newHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${newHeight}px`;
  };

  useEffect(() => {
    adjustTextareaHeight();
  }, [message]);

  return (
    <Box
      style={{
        borderTop: '1px solid var(--border-color)',
        flexShrink: 0,
        padding: '16px',
      }}
    >
      <form onSubmit={handleSubmit}>
        <Box style={{ position: 'relative' }}>
          <TextArea
            ref={textareaRef}
            placeholder="Type a message..."
            value={message}
            onChange={e => setMessage(e.target.value)}
            disabled={isLoading}
            style={{
              resize: 'none',
              minHeight: '40px',
              maxHeight: '20vh',
              paddingRight: '56px',
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
                e.preventDefault();
                if (message.trim() && !isLoading) {
                  handleSubmit(e);
                }
              }
            }}
          />
          <Box style={{ position: 'absolute', bottom: '10px', right: '10px', zIndex: 1 }}>
            <IconButton
              type="submit"
              size="2"
              variant="solid"
              radius="full"
              disabled={!message.trim() || isLoading}
            >
              <Send size={16} />
            </IconButton>
          </Box>
        </Box>
      </form>
    </Box>
  );
});

export default function ChatScreen() {
  const { chatId } = useParams({ from: '/chat/$chatId' });
  const chat = useChat(chatId);
  const { data: allMessages } = useMessagesShape(chatId);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const scrollContentRef = useRef<HTMLDivElement>(null);
  const [shouldScrollToBottom, setShouldScrollToBottom] = useState(false);
  const username = localStorage.getItem('username') || 'User';
  const { toggleSidebar } = useSidebar();
  const { toggleChatSidebar, isChatSidebarOpen } = useChatSidebar();
  const { data: files } = useFilesShape(chatId);
  const hasFiles = files && files.length > 0;
  const [showSystemMessages, setShowSystemMessages] = useState(
    localStorage.getItem('showSystemMessages') === 'true'
  );

  // Presence related state
  const { data: presences } = usePresenceShape(chatId);
  const presenceIntervalRef = useRef<number | null>(null);

  // User presence utilities
  const isActivePresence = (presence: { last_seen: Date | string }, maxAgeSeconds = 20) => {
    const lastSeen = new Date(presence.last_seen);
    const now = new Date();
    const diffSeconds = Math.floor((now.getTime() - lastSeen.getTime()) / 1000);
    return diffSeconds < maxAgeSeconds;
  };

  // Get sorted presences (excluding current user if there's only 1 presence)
  const sortedPresences = useMemo(() => {
    // Filter out stale presences (older than 20 seconds)
    const activePresences = presences.filter(p => isActivePresence(p));

    // Filter out current user
    const otherUsers = activePresences.filter(p => p.user_name !== username);

    // Sort by username
    return [...otherUsers].sort((a, b) => a.user_name.localeCompare(b.user_name));
  }, [presences, username]);

  // Determine if we should show current user avatar
  const showCurrentUserAvatar = presences.filter(p => isActivePresence(p)).length > 1;

  // Save showSystemMessages preference to localStorage when it changes
  useEffect(() => {
    localStorage.setItem('showSystemMessages', showSystemMessages.toString());
  }, [showSystemMessages]);

  // Filter messages based on the toggle state
  const messages = allMessages.filter(msg => showSystemMessages || msg.role !== 'system');

  // Define CSS variables for theming that will adapt to dark mode
  const themeVariables = {
    '--color-background-message': 'var(--gray-3)',
    '--shadow-message': '0 1px 1px rgba(0, 0, 0, 0.04)',
    '@media (prefersColorScheme: dark)': {
      '--color-background-message': 'var(--gray-5)',
      '--shadow-message': '0 1px 1px rgba(0, 0, 0, 0.2)',
    },
  };

  // Set up presence ping interval
  useEffect(() => {
    // Function to update presence
    const pingPresence = async () => {
      try {
        await updatePresence(chatId, username);
      } catch (error) {
        console.error('Failed to update presence:', error);
      }
    };

    // Ping immediately on mount
    pingPresence();

    // Set up interval to ping every 10 seconds
    presenceIntervalRef.current = window.setInterval(pingPresence, 10000);

    // Cleanup interval on unmount and remove user presence
    return () => {
      if (presenceIntervalRef.current) {
        window.clearInterval(presenceIntervalRef.current);
      }

      // Delete presence when leaving the chat
      deletePresence(chatId, username).catch(error => {
        console.error('Failed to delete presence:', error);
      });
    };
  }, [chatId, username]);

  useEffect(() => {
    // Add event listener for window resize
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Check if user is scrolled to bottom
  useEffect(() => {
    const handleScroll = () => {
      if (!scrollAreaRef.current) return;

      const { scrollTop, scrollHeight, clientHeight } = scrollAreaRef.current;
      const isAtBottom = scrollHeight - scrollTop - clientHeight < 20; // 20px threshold
      setShouldScrollToBottom(isAtBottom);
    };

    const scrollAreaElement = scrollAreaRef.current;
    if (scrollAreaElement) {
      scrollAreaElement.addEventListener('scroll', handleScroll);
      return () => scrollAreaElement.removeEventListener('scroll', handleScroll);
    }
  }, []);

  // Set up mutation observer to detect content changes
  useEffect(() => {
    if (!scrollContentRef.current) return;

    // Function to scroll to bottom if needed
    const scrollToBottomIfNeeded = () => {
      if (shouldScrollToBottom && messagesEndRef.current) {
        messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
      }
    };

    // Create mutation observer
    const observer = new MutationObserver(mutations => {
      // Check if there were meaningful changes that should trigger a scroll
      const hasContentChanges = mutations.some(
        mutation =>
          mutation.type === 'childList' ||
          mutation.type === 'characterData' ||
          (mutation.type === 'attributes' && mutation.attributeName === 'style')
      );

      if (hasContentChanges) {
        scrollToBottomIfNeeded();
      }
    });

    // Start observing
    observer.observe(scrollContentRef.current, {
      childList: true, // Observe direct children changes
      subtree: true, // Observe all descendants
      characterData: true, // Observe text content changes
      attributes: true, // Observe attribute changes
    });

    // Cleanup
    return () => observer.disconnect();
  }, [shouldScrollToBottom]);

  useEffect(() => {
    // Scroll to bottom only when messages change and shouldScrollToBottom is true
    if (shouldScrollToBottom && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, shouldScrollToBottom]);

  const handleMessageSubmit = async (messageText: string) => {
    try {
      setIsLoading(true);

      // Process the message to check for database URLs
      const processedData = processDatabaseUrl(messageText, chatId);
      let messageToSend = processedData.message;
      let dbUrlToSend = processedData.dbUrl;

      // If no database URL was found in this message, check if we have stored passwords
      // for this chat and use the most recent one if available
      if (!dbUrlToSend) {
        const storedPasswords = getChatPasswords(chatId);

        if (storedPasswords.size > 0) {
          // Get the most recent database URL from the password store
          // This assumes the latest entry is the one we want - alternatively we could
          // create a specific function to get the latest password
          const entries = Array.from(storedPasswords.entries());
          const [latestRedactedId, latestPassword] = entries[entries.length - 1];

          // We need to create a dbUrl object with the redacted URL
          // This assumes the URL format is postgresql://username:PASSWORD@host:port/database
          // We need to extract this pattern from a previous message
          const urlPattern = messages
            .find(msg => msg.content.includes(`redacted-`) && msg.content.includes('postgresql'))
            ?.content.match(/(?:postgres|postgresql):\/\/[^@]+@[^\s]+/);

          if (urlPattern) {
            // Create the dbUrl object with the stored information
            dbUrlToSend = {
              redactedUrl: urlPattern[0],
              redactedId: latestRedactedId,
              password: latestPassword,
            };
          }
        }
      }

      // Send message to API
      await addMessage(chatId, messageToSend, username, dbUrlToSend);

      // Force scroll to bottom when user sends a message
      setShouldScrollToBottom(true);
    } catch (error) {
      console.error('Failed to send message:', error);
      // Could add error handling/display here
    } finally {
      setIsLoading(false);
    }
  };

  if (!chat) {
    return (
      <Flex align="center" justify="center" style={{ height: '100%' }}>
        <Text color="gray" size="2">
          Not found
        </Text>
      </Flex>
    );
  }

  return (
    <Flex direction="column" style={{ height: '100%', width: '100%', ...themeVariables }}>
      {/* Header with title and sidebar toggle */}
      <Flex
        align="center"
        justify="between"
        style={{
          height: '56px',
          borderBottom: '1px solid var(--gray-5)',
          padding: '0 16px',
          flexShrink: 0,
        }}
      >
        <Flex align="center" gap="2">
          {isMobile && (
            <IconButton variant="ghost" size="1" onClick={toggleSidebar}>
              <Menu size={18} />
            </IconButton>
          )}
          <Text size="3" weight="medium">
            {chat.name}
          </Text>
        </Flex>

        <Flex align="center" gap="3">
          {/* User presence avatars */}
          {presences.filter(p => isActivePresence(p)).length > 0 && (
            <Flex align="center" style={{ marginRight: '8px', paddingLeft: '5px' }}>
              {/* Show all other users */}
              {sortedPresences.map((presence, index) => (
                <UserAvatar
                  key={presence.id}
                  username={presence.user_name}
                  size="medium"
                  index={index}
                />
              ))}

              {/* Show current user if there are multiple users */}
              {showCurrentUserAvatar && (
                <UserAvatar username={username} size="medium" index={sortedPresences.length} />
              )}
            </Flex>
          )}

          <Tooltip content="Show System Messages">
            <Flex align="center" gap="1">
              <Terminal size={14} style={{ opacity: showSystemMessages ? 1 : 0.5 }} />
              <Switch
                size="1"
                checked={showSystemMessages}
                onCheckedChange={setShowSystemMessages}
                highContrast
              />
            </Flex>
          </Tooltip>
          {/* Only show toggle button if there are files */}
          {hasFiles && (
            <Tooltip content="Chat Assets">
              <IconButton
                variant="ghost"
                size="1"
                onClick={toggleChatSidebar}
                style={{
                  opacity: isChatSidebarOpen ? 1 : 0.5,
                }}
              >
                <FileText size={18} />
              </IconButton>
            </Tooltip>
          )}
        </Flex>
      </Flex>

      {/* Main content area */}
      <Flex style={{ flex: 1, overflow: 'hidden' }}>
        {/* Messages - Scrollable */}
        <Box style={{ flex: 1, overflow: 'hidden', minWidth: 0 }}>
          <MessageList
            messages={messages}
            username={username}
            scrollAreaRef={scrollAreaRef}
            scrollContentRef={scrollContentRef}
            messagesEndRef={messagesEndRef}
          />
        </Box>

        {/* Chat Sidebar */}
        {hasFiles && <ChatSidebar chatId={chatId} isMobile={isMobile} />}
      </Flex>

      {/* Message Input - Fixed */}
      <MessageInput onSubmit={handleMessageSubmit} isLoading={isLoading} />
    </Flex>
  );
}
