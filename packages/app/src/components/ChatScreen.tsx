import { useState, useEffect, useRef, memo } from 'react';
import { useParams } from '@tanstack/react-router';
import { Box, Flex, Text, TextField, IconButton, ScrollArea, Button } from '@radix-ui/themes';
import { Menu } from 'lucide-react';
import { useSidebar } from './SidebarProvider';
import { useChat, useMessagesShape } from '../shapes';
import { addMessage } from '../api';
import AiResponse from './AiResponse';

type Message = {
  id: string;
  content: string;
  role: string;
  user_name: string;
  created_at: Date;
  chat_id: string;
  status: string;
};

interface MessageListProps {
  messages: Message[];
  username: string;
  scrollAreaRef: React.RefObject<HTMLDivElement>;
  scrollContentRef: React.RefObject<HTMLDivElement>;
  messagesEndRef: React.RefObject<HTMLDivElement>;
}

interface MessageInputProps {
  onSubmit: (message: string) => void;
  isLoading: boolean;
}

// MessageList component to display messages
const MessageList = memo(
  ({ messages, username, scrollAreaRef, scrollContentRef, messagesEndRef }: MessageListProps) => {
    return (
      <ScrollArea style={{ height: '100%' }} scrollbars="vertical" ref={scrollAreaRef}>
        <Box
          p="3"
          style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '100%' }}
          ref={scrollContentRef}
        >
          {messages
            .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
            .map(msg => (
              <Flex
                key={msg.id}
                justify={
                  msg.role === 'agent' ? 'center' : msg.user_name === username ? 'end' : 'start'
                }
              >
                {msg.role === 'agent' ? (
                  <AiResponse message={msg} />
                ) : (
                  <Flex
                    direction="column"
                    style={{
                      maxWidth: '60%',
                      marginBottom: '10px',
                      alignItems: msg.user_name === username ? 'flex-end' : 'flex-start',
                    }}
                  >
                    {msg.user_name !== username && (
                      <Text
                        size="1"
                        style={{
                          color: 'var(--gray-11)',
                          marginLeft: '4px',
                          marginBottom: '3px',
                        }}
                      >
                        {msg.user_name}
                      </Text>
                    )}
                    <Box
                      style={{
                        backgroundColor:
                          msg.user_name === username
                            ? 'var(--accent-9)'
                            : 'var(--color-background-message)',
                        color: msg.user_name === username ? 'white' : 'var(--gray-12)',
                        padding: '8px 12px',
                        borderRadius: '18px',
                        position: 'relative',
                        maxWidth: 'fit-content',
                        boxShadow: 'var(--shadow-message)',
                      }}
                    >
                      <Text size="2" style={{ whiteSpace: 'pre-wrap' }}>
                        {msg.content}
                      </Text>
                    </Box>
                  </Flex>
                )}
              </Flex>
            ))}

          {/* {isLoading && (
            <Flex justify="center">
              <Box className="typing-indicator">
                <Box className="typing-dot" />
                <Box className="typing-dot" />
                <Box className="typing-dot" />
              </Box>
            </Flex>
          )} */}

          <div ref={messagesEndRef} />
        </Box>
      </ScrollArea>
    );
  }
);

// MessageInput component for the form
const MessageInput = memo(({ onSubmit, isLoading }: MessageInputProps) => {
  const [message, setMessage] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || isLoading) return;

    onSubmit(message.trim());
    setMessage('');
  };

  return (
    <Box
      style={{
        borderTop: '1px solid var(--border-color)',
        flexShrink: 0,
        padding: '16px',
      }}
    >
      <form onSubmit={handleSubmit}>
        <Flex gap="2">
          <Box style={{ flex: 1 }}>
            <TextField.Root
              size="3"
              placeholder="Type a message..."
              value={message}
              onChange={e => setMessage(e.target.value)}
              disabled={isLoading}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
                  e.preventDefault();
                  if (message.trim() && !isLoading) {
                    handleSubmit(e);
                  }
                }
              }}
            />
          </Box>
          <Button type="submit" size="3" disabled={!message.trim() || isLoading}>
            Send
          </Button>
        </Flex>
      </form>
    </Box>
  );
});

export default function ChatScreen() {
  const { chatId } = useParams({ from: '/chat/$chatId' });
  const chat = useChat(chatId);
  const { data: messages } = useMessagesShape(chatId);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const scrollContentRef = useRef<HTMLDivElement>(null);
  const [shouldScrollToBottom, setShouldScrollToBottom] = useState(true);
  const username = localStorage.getItem('username') || 'User';
  const { toggleSidebar } = useSidebar();

  // Define CSS variables for theming that will adapt to dark mode
  const themeVariables = {
    '--color-background-message': 'var(--gray-3)',
    '--shadow-message': '0 1px 1px rgba(0, 0, 0, 0.04)',
    '@media (prefersColorScheme: dark)': {
      '--color-background-message': 'var(--gray-5)',
      '--shadow-message': '0 1px 1px rgba(0, 0, 0, 0.2)',
    },
  };

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
    // Scroll to bottom on initial load and when messages change, if shouldScrollToBottom is true
    if (shouldScrollToBottom && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, shouldScrollToBottom]);

  const handleMessageSubmit = async (messageText: string) => {
    try {
      setIsLoading(true);

      // Send message to API
      await addMessage(chatId, messageText, username);

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
      </Flex>

      {/* Messages - Scrollable */}
      <MessageList
        messages={messages}
        username={username}
        scrollAreaRef={scrollAreaRef}
        scrollContentRef={scrollContentRef}
        messagesEndRef={messagesEndRef}
      />

      {/* Message Input - Fixed */}
      <MessageInput onSubmit={handleMessageSubmit} isLoading={isLoading} />
    </Flex>
  );
}
