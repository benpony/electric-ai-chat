import { useState, useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Box, Flex, Text, Heading, TextArea, IconButton } from '@radix-ui/themes';
import { Send, Menu } from 'lucide-react';
import { matchStream } from '@electric-sql/experimental';
import { useSidebar } from './SidebarProvider';
import { createChat } from '../api';
import { useChatsShape, preloadMessages } from '../shapes';
import { v4 as uuidv4 } from 'uuid';

export default function NewChatScreen() {
  const [prompt, setPrompt] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const username = localStorage.getItem('username') || 'User';
  const { stream } = useChatsShape();
  const { toggleSidebar } = useSidebar();

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    // Add global styles for textarea scrollbar
    const style = document.createElement('style');
    style.innerHTML = `
      .textarea-with-button .rt-TextAreaInput {
        padding-right: 56px !important;
      }
    `;
    document.head.appendChild(style);
    return () => {
      document.head.removeChild(style);
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!prompt.trim()) return;

    try {
      setIsLoading(true);

      // Generate a UUID for the new chat
      const chatId = uuidv4();

      // Start watching for the chat to sync BEFORE making the API call
      const matchPromise = matchStream(stream, ['insert'], message => {
        console.log('message id', message.value.id);
        return message.value.id === chatId;
      });

      // Create a new chat via API with the pre-generated UUID
      await createChat(prompt.trim(), username, chatId);

      // Wait for the chat to sync
      await matchPromise;
      console.log('Chat synced');

      // Preload messages for the new chat
      await preloadMessages(chatId);

      // Navigate to the new chat
      navigate({ to: `/chat/${chatId}` });
    } catch (error) {
      console.error('Failed to create chat:', error);
      // Could add error handling/display here
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Flex direction="column" style={{ height: '100%', width: '100%' }}>
      {/* Header with menu button */}
      <Box className="chat-header">
        <Flex align="center" gap="2">
          {isMobile && (
            <IconButton variant="ghost" size="1" onClick={toggleSidebar}>
              <Menu size={18} />
            </IconButton>
          )}
          <Text size="3" weight="medium">
            New Chat
          </Text>
        </Flex>
      </Box>

      <Flex
        direction="column"
        align="center"
        justify="center"
        style={{
          height: '100%',
          width: '100%',
          padding: '16px',
        }}
      >
        <Box width="100%" mb="6" style={{ maxWidth: '800px' }}>
          <Heading align="center" size="5" weight="medium">
            Start a New Chat
          </Heading>
        </Box>

        <form
          onSubmit={handleSubmit}
          style={{ width: '100%', maxWidth: '800px', position: 'relative' }}
        >
          <Box className="textarea-with-button" style={{ position: 'relative' }}>
            <TextArea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder="Type a message to start a chat..."
              size="3"
              style={{
                height: '240px',
                width: '100%',
                resize: 'none',
                ['--scrollarea-scrollbar-vertical-margin-right' as string]: '56px',
              }}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
                  e.preventDefault();
                  if (prompt.trim()) {
                    handleSubmit(e);
                  }
                }
              }}
            />

            <Box style={{ position: 'absolute', bottom: '12px', right: '12px', zIndex: 1 }}>
              <IconButton
                type="submit"
                size="2"
                variant="solid"
                radius="full"
                disabled={!prompt.trim() || isLoading}
              >
                <Send size={16} />
              </IconButton>
            </Box>
          </Box>
        </form>
      </Flex>
    </Flex>
  );
}
