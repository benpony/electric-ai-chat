import { useState, useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import {
  Box,
  Flex,
  Text,
  Heading,
  TextArea,
  IconButton
} from '@radix-ui/themes';
import { Send, Menu } from 'lucide-react';
import { generateChatId } from '../lib/utils';
import { toggleSidebar } from './Sidebar';

export default function NewChatScreen() {
  const [prompt, setPrompt] = useState('');
  const navigate = useNavigate();
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const username = localStorage.getItem('username') || 'User';

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!prompt.trim()) return;
    
    // Create a new chat
    const chatId = generateChatId();
    const title = prompt.trim().split('\n')[0].slice(0, 30) + (prompt.length > 30 ? '...' : '');
    
    // Create a new chat object
    const newChat = {
      id: chatId,
      title,
      createdAt: new Date(),
      updatedAt: new Date(),
      messages: [
        {
          id: generateChatId(),
          content: prompt,
          sender: username,
          timestamp: new Date(),
          isAI: false
        }
      ]
    };
    
    // Save to localStorage
    const chats = JSON.parse(localStorage.getItem('chats') || '[]');
    localStorage.setItem('chats', JSON.stringify([newChat, ...chats]));
    
    // Navigate to the new chat
    navigate({ to: `/chat/${chatId}` });
  };

  return (
    <Flex direction="column" style={{ height: '100%', width: '100%' }}>
      {/* Header with menu button */}
      <Box className="chat-header">
        <Flex align="center" gap="2">
          {isMobile && (
            <IconButton 
              variant="ghost" 
              size="1" 
              onClick={toggleSidebar}
            >
              <Menu size={18} />
            </IconButton>
          )}
          <Text size="3" weight="medium">New Chat</Text>
        </Flex>
      </Box>
      
      <Flex 
        direction="column" 
        align="center" 
        justify="center" 
        style={{ 
          height: '100%', 
          width: '100%',
          padding: '16px'
        }}
      >
        <Box width="100%" mb="6" style={{ maxWidth: '800px' }}>
          <Heading align="center" size="5">
            Start a New Chat
          </Heading>
        </Box>
        
        <form onSubmit={handleSubmit} style={{ width: '100%', maxWidth: '800px', position: 'relative' }}>
          <TextArea 
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Type a message to start a chat..."
            size="3"
            style={{ 
              height: '240px',
              width: '100%',
              paddingRight: '56px',
              resize: 'none'
            }}
          />
          
          <Box style={{ position: 'absolute', bottom: '12px', right: '12px' }}>
            <IconButton 
              type="submit" 
              size="2" 
              variant="solid" 
              radius="full"
              disabled={!prompt.trim()}
            >
              <Send size={16} />
            </IconButton>
          </Box>
        </form>
      </Flex>
    </Flex>
  );
} 