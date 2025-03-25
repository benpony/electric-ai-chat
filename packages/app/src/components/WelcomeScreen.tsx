import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import {
  Box,
  Flex,
  Text,
  Heading,
  Button,
} from '@radix-ui/themes';

export default function WelcomeScreen() {
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!username.trim()) {
      setError('Please enter your name');
      return;
    }
    
    // Indicate that we're submitting
    setIsSubmitting(true);
    
    // Save username to localStorage
    localStorage.setItem('username', username);
    
    // Trigger a custom storage event for the same window
    window.dispatchEvent(new Event('storage'));
    
    // Navigate to the home page immediately - no delay
    navigate({ to: '/' });
  };

  return (
    <Flex 
      direction="column" 
      align="center" 
      justify="center" 
      style={{ 
        minHeight: '100vh',
        width: '100%',
        backgroundColor: 'white'
      }}
    >
      <Box style={{ 
        maxWidth: '400px', 
        width: '100%',
        padding: '32px',
        backgroundColor: 'white',
        boxShadow: '0 0 10px rgba(0, 0, 0, 0.05)'
      }}>
        <Flex direction="column" align="center" gap="3" style={{ maxWidth: '320px', margin: '0 auto' }}>
          <Heading 
            size="6" 
            align="center" 
            style={{
              height: '56px',
              borderBottom: '1px solid var(--gray-5)',
              padding: '0 16px'
            }}
          >
            Electric Chat
          </Heading>
          
          <Text 
            size="2" 
            align="center"
            style={{ color: '#666' }}
          >
            Enter your name to begin chatting
          </Text>

          <form onSubmit={handleSubmit} style={{ width: '100%' }}>
            <Flex direction="column" gap="3" align="center" style={{ width: '100%' }}>
              <input
                type="text"
                placeholder="Enter your name"
                value={username}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  setUsername(e.target.value);
                  setError('');
                }}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  fontSize: '14px',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  marginBottom: '8px'
                }}
                disabled={isSubmitting}
              />
              
              {error && (
                <Text color="red" size="2" align="center">
                  {error}
                </Text>
              )}

              <Button 
                type="submit" 
                size="2"
                style={{ 
                  width: '100%',
                  backgroundColor: '#999',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  padding: '8px',
                  cursor: 'pointer',
                  opacity: isSubmitting ? 0.7 : 1
                }}
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Entering...' : 'Enter'}
              </Button>
            </Flex>
          </form>
        </Flex>
      </Box>
    </Flex>
  );
} 