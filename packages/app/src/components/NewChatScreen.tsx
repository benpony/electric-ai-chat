import { useState, useEffect, useRef } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Box, Flex, Text, Heading, TextArea, IconButton } from '@radix-ui/themes';
import { Send, Menu, Paperclip } from 'lucide-react';
import { matchStream } from '@electric-sql/experimental';
import { useSidebar } from './SidebarProvider';
import { createChat } from '../api';
import { useChatsShape, preloadMessages } from '../shapes';
import { v4 as uuidv4 } from 'uuid';
import { processDatabaseUrl } from '../utils/db-url';

export default function NewChatScreen() {
  const [prompt, setPrompt] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [attachment, setAttachment] = useState<string | null>(null);
  const [attachmentName, setAttachmentName] = useState<string | null>(null);
  const navigate = useNavigate();
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const username = localStorage.getItem('username') || 'User';
  const { stream } = useChatsShape();
  const { toggleSidebar } = useSidebar();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Focus input on mount
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!prompt.trim() && !attachment) return;

    try {
      setIsLoading(true);

      // Generate a UUID for the new chat
      const chatId = uuidv4();

      // Process any database URL in the message
      const { message: processedMessage, dbUrl } = processDatabaseUrl(prompt, chatId);

      // Start watching for the chat to sync BEFORE making the API call
      const matchPromise = matchStream(stream, ['insert'], message => {
        console.log('message id', message.value.id);
        return message.value.id === chatId;
      });

      // Create a new chat via API with the pre-generated UUID
      await createChat(
        processedMessage,
        username,
        chatId,
        dbUrl?.redactedUrl || '',
        attachment || undefined
      );

      // Wait for the chat to sync
      await matchPromise;
      console.log('Chat synced');

      // Preload messages for the new chat
      await preloadMessages(chatId);

      // Reset form
      setPrompt('');
      setAttachment(null);
      setAttachmentName(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }

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
                  <Send size={16} />
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
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder="Type a message to start a chat..."
              size="3"
              ref={inputRef}
              style={{
                height: '240px',
                width: '100%',
                resize: 'none',
                ['--scrollarea-scrollbar-vertical-margin-right' as string]: '56px',
              }}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
                  e.preventDefault();
                  if (prompt.trim() || attachment) {
                    handleSubmit(e);
                  }
                }
              }}
            />

            <Flex
              direction="column"
              gap="2"
              align="center"
              style={{
                position: 'absolute',
                bottom: '12px',
                right: '12px',
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
                style={{
                  color: 'var(--gray-11)',
                  width: '36px',
                  height: '36px',
                  padding: '0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Paperclip size={16} />
              </IconButton>
              <IconButton
                type="submit"
                size="2"
                variant="solid"
                radius="full"
                disabled={(!prompt.trim() && !attachment) || isLoading}
                style={{
                  color: '#fff',
                  width: '36px',
                  height: '36px',
                  padding: '0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
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
      </Flex>
    </Flex>
  );
}
