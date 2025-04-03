import { memo } from 'react';
import { Box, Flex } from '@radix-ui/themes';
import UserAvatar from './UserAvatar';

interface TypingIndicatorProps {
  username: string;
}

const TypingIndicator = memo(({ username }: TypingIndicatorProps) => {
  return (
    <Flex
      direction="column"
      style={{
        maxWidth: '60%',
        marginBottom: '10px',
        alignItems: 'flex-start',
        alignSelf: 'flex-start',
      }}
    >
      <Flex align="center" gap="2" style={{ marginBottom: '3px' }}>
        <div style={{ marginBottom: '-8px' }}>
          <UserAvatar username={username} size="small" showTooltip={true} />
        </div>
      </Flex>
      <Box
        style={{
          backgroundColor: 'var(--gray-4)',
          borderRadius: '18px',
          padding: '12px 16px 4px 16px',
          position: 'relative',
          minWidth: '60px',
          minHeight: '34px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: 'var(--shadow-message)',
          gap: '4px',
        }}
      >
        <Box
          className="typing-dot"
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: 'var(--gray-8)',
            animation: 'bounce 1.4s infinite ease-in-out',
            animationDelay: '0s',
          }}
        />
        <Box
          className="typing-dot"
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: 'var(--gray-8)',
            animation: 'bounce 1.4s infinite ease-in-out',
            animationDelay: '0.2s',
          }}
        />
        <Box
          className="typing-dot"
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: 'var(--gray-8)',
            animation: 'bounce 1.4s infinite ease-in-out',
            animationDelay: '0.4s',
          }}
        />
      </Box>
    </Flex>
  );
});

export default TypingIndicator;
