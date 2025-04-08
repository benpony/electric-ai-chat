import { useState, useEffect, useRef, memo, useMemo, useCallback } from 'react';
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
import { Menu, Send, FileText, Terminal, Paperclip } from 'lucide-react';
import { useSidebar } from './SidebarProvider';
import { useChatSidebar } from './ChatSidebarProvider';
import { useChat, useMessagesShape, useFilesShape, usePresenceShape } from '../shapes';
import { addMessage, updatePresence, deletePresence } from '../api';
import AiResponse from './AiResponse';
import { ChatSidebar } from './ChatSidebar';
import { processDatabaseUrl } from '../utils/db-url';
import { getChatPasswords } from '../utils/password-store';
import UserAvatar from './UserAvatar';
import TypingIndicator from './TypingIndicator';

const TYPING_INDICATOR_TIMEOUT = 5000;

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
  attachment?: string;
};

interface MessageListProps {
  messages: Message[];
  username: string;
  scrollAreaRef: React.RefObject<HTMLDivElement>;
  scrollContentRef: React.RefObject<HTMLDivElement>;
  messagesEndRef: React.RefObject<HTMLDivElement>;
  typingUsers: string[];
}

interface MessageInputProps {
  onSubmit: (message: string, attachment?: string) => void;
  isLoading: boolean;
  onTypingChange?: (isTyping: boolean) => void;
}

interface UserPromptProps {
  message: Message;
  isCurrentUser: boolean;
  multipleUsers: boolean;
}

// UserPrompt component to display user messages
const UserPrompt = memo(({ message, isCurrentUser, multipleUsers }: UserPromptProps) => {
  const isSystemMessage = message.role === 'system';
  const hasAttachment = Boolean(message.attachment);

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
        {(!isCurrentUser || multipleUsers) && (
          <div style={{ marginBottom: '-8px' }}>
            <UserAvatar username={message.user_name} size="small" showTooltip={true} />
          </div>
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
        {hasAttachment && (
          <Flex align="center" gap="1" style={{ marginTop: '4px', opacity: 0.7 }}>
            <Paperclip size={12} />
            <Text size="1">Attachment</Text>
          </Flex>
        )}
      </Box>
    </Flex>
  );
});

// MessageList component to display messages
const MessageList = memo(
  ({
    messages,
    username,
    scrollAreaRef,
    scrollContentRef,
    messagesEndRef,
    typingUsers,
  }: MessageListProps) => {
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
              const timeA = a.role === 'agent' ? a.updated_at.getTime() : a.created_at.getTime();
              const timeB = b.role === 'agent' ? b.updated_at.getTime() : b.created_at.getTime();
              return timeA - timeB;
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

          {/* Show typing indicators after the messages */}
          {typingUsers.map(user => (
            <TypingIndicator key={`typing-${user}`} username={user} />
          ))}

          <div ref={messagesEndRef} />
        </Box>
      </ScrollArea>
    );
  }
);

// MessageInput component for the form
const MessageInput = memo(({ onSubmit, isLoading, onTypingChange }: MessageInputProps) => {
  const [message, setMessage] = useState('');
  const [attachment, setAttachment] = useState<string | null>(null);
  const [attachmentName, setAttachmentName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { chatId } = useParams({ from: '/chat/$chatId' });
  const typingTimeoutRef = useRef<number | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const lastTypingStatus = useRef(false);

  // Focus input on mount
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [chatId]);

  // Pass the typing status to the parent when it changes
  useEffect(() => {
    onTypingChange?.(isTyping);
  }, [onTypingChange]);

  // Pass the typing status to the parent when it changes
  useEffect(() => {
    if (lastTypingStatus.current !== isTyping) {
      lastTypingStatus.current = isTyping;
      onTypingChange?.(isTyping);
    }
  }, [isTyping, onTypingChange]);

  // Handle typing status
  useEffect(() => {
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    if (isTyping) {
      // They were typing, are they still typing?
      if (message.trim().length === 0) {
        setIsTyping(false);
      } else {
        typingTimeoutRef.current = setTimeout(() => {
          setIsTyping(false);
          typingTimeoutRef.current = null;
        }, TYPING_INDICATOR_TIMEOUT);
      }
    } else {
      // They were not typing, are they typing now?
      if (message.trim().length > 0) {
        setIsTyping(true);
        typingTimeoutRef.current = setTimeout(() => {
          setIsTyping(false);
          typingTimeoutRef.current = null;
        }, TYPING_INDICATOR_TIMEOUT);
      }
    }

    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, [message]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if ((!message.trim() && !attachment) || isLoading) return;
    onSubmit(message, attachment || undefined);
    setMessage('');
    setAttachment(null);
    setAttachmentName(null);

    // Clear typing status when submitting
    if (isTyping) {
      setIsTyping(false);
      if (onTypingChange) {
        onTypingChange(false);
      }
    }

    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Only accept text files
    if (!file.type.startsWith('text/') && !file.name.endsWith('.txt')) {
      alert('Please select a text file');
      return;
    }

    // Read the file content
    const reader = new FileReader();
    reader.onload = event => {
      const content = event.target?.result as string;
      setAttachment(content);
      setAttachmentName(file.name);
    };
    reader.readAsText(file);
  };

  const handleAttachmentClick = () => {
    fileInputRef.current?.click();
  };

  const removeAttachment = () => {
    setAttachment(null);
    setAttachmentName(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
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
          {attachment && (
            <Box
              style={{
                marginBottom: '8px',
                padding: '8px',
                backgroundColor: 'var(--gray-3)',
                borderRadius: '4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <Flex align="center" gap="2">
                <FileText size={16} />
                <Text size="2">{attachmentName}</Text>
              </Flex>
              <IconButton
                size="1"
                variant="ghost"
                onClick={removeAttachment}
                style={{ color: 'var(--gray-11)' }}
              >
                ×
              </IconButton>
            </Box>
          )}
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
                if ((message.trim() || attachment) && !isLoading) {
                  handleSubmit(e);
                }
              }
            }}
          />
          <Flex
            direction="row"
            gap="2"
            align="center"
            style={{
              position: 'absolute',
              bottom: '10px',
              right: '10px',
              zIndex: 1,
            }}
          >
            <IconButton
              type="button"
              size="2"
              variant="ghost"
              radius="full"
              onClick={handleAttachmentClick}
              disabled={isLoading}
              style={{ color: 'var(--gray-11)' }}
            >
              <Paperclip size={16} />
            </IconButton>
            <IconButton
              type="submit"
              size="2"
              variant="solid"
              radius="full"
              disabled={(!message.trim() && !attachment) || isLoading}
            >
              <Send size={16} />
            </IconButton>
          </Flex>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept=".txt,text/*"
            style={{ display: 'none' }}
          />
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

  // Keep track of typing users with timeouts
  const typingTimeoutsRef = useRef<Record<string, { timeout: number; timestamp: number }>>({});

  // Get typing users with proper timeouts
  const typingUsers = useMemo(() => {
    const now = Date.now();

    // Add new typing users and refresh existing ones
    const activeTypingUsers = presences
      .filter(p => isActivePresence(p) && p.typing && p.user_name !== username)
      .map(p => {
        const userName = p.user_name;

        // If not already tracked, add a timeout
        if (!typingTimeoutsRef.current[userName]) {
          typingTimeoutsRef.current[userName] = {
            timeout: window.setTimeout(() => {
              // This will trigger a re-render to remove this user
              const updatedTimeouts = { ...typingTimeoutsRef.current };
              delete updatedTimeouts[userName];
              typingTimeoutsRef.current = updatedTimeouts;

              // Force re-render
              setShouldScrollToBottom(prev => prev);
            }, 5000),
            timestamp: now,
          };
        } else {
          // Update the timestamp
          typingTimeoutsRef.current[userName].timestamp = now;
        }

        return userName;
      });

    // Clean up typing timeouts that are no longer active
    Object.keys(typingTimeoutsRef.current).forEach(userName => {
      const isUserStillTyping = activeTypingUsers.includes(userName);
      const hasTimedOut = now - typingTimeoutsRef.current[userName].timestamp > 5000;

      if (!isUserStillTyping || hasTimedOut) {
        clearTimeout(typingTimeoutsRef.current[userName].timeout);
        delete typingTimeoutsRef.current[userName];
      }
    });

    // Return users who have active timeouts
    return Object.keys(typingTimeoutsRef.current);
  }, [presences, username]);

  // Clean up typing timeouts on unmount
  useEffect(() => {
    return () => {
      Object.values(typingTimeoutsRef.current).forEach(({ timeout }) => {
        clearTimeout(timeout);
      });
    };
  }, []);

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

  // Add event listener for window resize
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Check if user is scrolled to bottom
  useEffect(() => {
    const handleScroll = () => {
      if (isMobile) {
        // For mobile, check the content area scroll position
        const contentArea = document.querySelector('.content-area');
        if (contentArea) {
          const { scrollTop, scrollHeight, clientHeight } = contentArea;
          const isAtBottom = scrollHeight - scrollTop - clientHeight < 20; // 20px threshold
          setShouldScrollToBottom(isAtBottom);
        }
      } else if (scrollAreaRef.current) {
        // For desktop, check the ScrollArea scroll position
        const { scrollTop, scrollHeight, clientHeight } = scrollAreaRef.current;
        const isAtBottom = scrollHeight - scrollTop - clientHeight < 20; // 20px threshold
        setShouldScrollToBottom(isAtBottom);
      }
    };

    if (isMobile) {
      // For mobile, add scroll listener to content area
      const contentArea = document.querySelector('.content-area');
      if (contentArea) {
        contentArea.addEventListener('scroll', handleScroll);
        return () => contentArea.removeEventListener('scroll', handleScroll);
      }
    } else if (scrollAreaRef.current) {
      // For desktop, add scroll listener to ScrollArea
      scrollAreaRef.current.addEventListener('scroll', handleScroll);
      return () => scrollAreaRef.current?.removeEventListener('scroll', handleScroll);
    }
  }, [isMobile]);

  // Set up mutation observer to detect content changes
  useEffect(() => {
    if (!scrollContentRef.current) return;

    // Function to scroll to bottom if needed
    const scrollToBottomIfNeeded = () => {
      if (shouldScrollToBottom) {
        if (isMobile) {
          // For mobile, scroll the content area
          const contentArea = document.querySelector('.content-area');
          if (contentArea) {
            contentArea.scrollTop = contentArea.scrollHeight;
          }
        } else if (messagesEndRef.current) {
          // For desktop, scroll the ScrollArea
          messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
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
  }, [shouldScrollToBottom, isMobile]);

  // Scroll to bottom when messages change or component mounts
  useEffect(() => {
    if (shouldScrollToBottom) {
      if (isMobile) {
        // For mobile, scroll the content area
        const contentArea = document.querySelector('.content-area');
        if (contentArea) {
          contentArea.scrollTop = contentArea.scrollHeight;
        }
      } else if (messagesEndRef.current) {
        // For desktop, scroll the ScrollArea
        messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }, [messages, shouldScrollToBottom, isMobile]);

  // Function to handle typing status change
  const handleTypingChange = useCallback(
    (isTyping: boolean) => {
      updatePresence(chatId, username, isTyping).catch(error => {
        console.error('Failed to update typing status:', error);
      });
    },
    [chatId, username]
  );

  const handleMessageSubmit = async (messageText: string, attachment?: string) => {
    try {
      setIsLoading(true);

      // Process the message to check for database URLs
      const processedData = processDatabaseUrl(messageText, chatId);
      let messageToSend = processedData.message;
      let dbUrlToSend = processedData.dbUrl;

      // If no database URL was found in this message, check if we have stored passwords
      if (!dbUrlToSend) {
        const storedPasswords = getChatPasswords(chatId);

        if (storedPasswords.size > 0) {
          // Get the most recent database URL from the password store
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
      await addMessage(chatId, messageToSend, username, dbUrlToSend, attachment);

      // Force scroll to bottom when user sends a message
      setShouldScrollToBottom(true);

      // For mobile, immediately scroll to bottom after sending a message
      if (isMobile) {
        setTimeout(() => {
          const contentArea = document.querySelector('.content-area');
          if (contentArea) {
            contentArea.scrollTop = contentArea.scrollHeight;
          } else {
            window.scrollTo({
              top: document.documentElement.scrollHeight,
              behavior: 'smooth',
            });
          }
        }, 100);
      }
    } catch (error) {
      console.error('Failed to send message:', error);
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
    <Flex
      direction="column"
      style={{
        height: '100%',
        width: '100%',
        ...themeVariables,
        // On mobile, use a different layout approach
        ...(isMobile
          ? {
              height: '100%',
              position: 'relative',
              overflow: 'hidden',
              // Use dynamic viewport height for mobile
              minHeight: '100dvh',
              maxHeight: '100dvh', // Prevent overscrolling
            }
          : {}),
      }}
    >
      {/* Header with title and sidebar toggle */}
      <Flex
        align="center"
        justify="between"
        style={{
          height: '56px',
          borderBottom: '1px solid var(--gray-5)',
          padding: '0 16px',
          flexShrink: 0,
          // Make header sticky on mobile
          ...(isMobile
            ? {
                position: 'sticky',
                top: 0,
                zIndex: 10,
                backgroundColor: 'var(--background)',
              }
            : {}),
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
      <Flex
        className={isMobile ? 'content-area' : ''}
        style={{
          flex: 1,
          overflow: 'hidden',
          position: 'relative',
          // On mobile, allow the content to scroll naturally
          ...(isMobile
            ? {
                overflow: 'auto',
                WebkitOverflowScrolling: 'touch', // For smooth scrolling on iOS
                height: 'calc(100vh - 112px)', // Account for header and input height
                maxHeight: 'calc(100vh - 112px)',
              }
            : {}),
        }}
      >
        {/* Messages - Scrollable */}
        <Box
          style={{
            flex: 1,
            overflow: 'hidden',
            minWidth: 0,
            // On mobile, use a different approach for the message list
            ...(isMobile
              ? {
                  overflow: 'visible',
                  height: 'auto',
                }
              : {}),
          }}
        >
          {isMobile ? (
            // Mobile version - no ScrollArea, just a regular div
            <Box
              p="3"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                maxWidth: '100%',
                paddingBottom: '16px', // Reduced padding at the bottom
                width: '100%', // Ensure it takes full width
              }}
              ref={scrollContentRef}
            >
              {messages
                .sort((a, b) => {
                  const timeA =
                    a.role === 'agent' ? a.updated_at.getTime() : a.created_at.getTime();
                  const timeB =
                    b.role === 'agent' ? b.updated_at.getTime() : b.created_at.getTime();
                  return timeA - timeB;
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
                        multipleUsers={Boolean(
                          new Set(messages.filter(m => m.role === 'user').map(m => m.user_name))
                            .size > 1
                        )}
                      />
                    )}
                  </Flex>
                ))}

              {/* Show typing indicators after the messages */}
              {typingUsers.map(user => (
                <TypingIndicator key={`typing-${user}`} username={user} />
              ))}

              <div ref={messagesEndRef} style={{ height: '1px' }} />
            </Box>
          ) : (
            // Desktop version - use the existing MessageList component
            <MessageList
              messages={messages}
              username={username}
              scrollAreaRef={scrollAreaRef}
              scrollContentRef={scrollContentRef}
              messagesEndRef={messagesEndRef}
              typingUsers={typingUsers}
            />
          )}
        </Box>

        {/* Chat Sidebar */}
        {hasFiles && <ChatSidebar chatId={chatId} isMobile={isMobile} />}
      </Flex>

      {/* Message Input - Fixed */}
      <Box
        style={{
          // Make the input sticky on mobile
          ...(isMobile
            ? {
                position: 'sticky',
                bottom: 0,
                left: 0,
                right: 0,
                zIndex: 10,
                backgroundColor: 'var(--background)',
                borderTop: '1px solid var(--gray-5)',
              }
            : {}),
        }}
      >
        <MessageInput
          onSubmit={handleMessageSubmit}
          isLoading={isLoading}
          onTypingChange={handleTypingChange}
        />
      </Box>
    </Flex>
  );
}
