import { Flex, Text, Box, IconButton, Tooltip } from '@radix-ui/themes';
import { Message, useTokensShape } from '../shapes';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useTheme } from './ThemeProvider';
import { abortMessage } from '../api';
import { useState, useEffect } from 'react';
import { Loader, OctagonX } from 'lucide-react';

function MarkdownMessage({ content }: { content: string }) {
  const { theme } = useTheme();
  const syntaxTheme = theme === 'dark' ? vscDarkPlus : oneLight;

  return (
    <Box
      px="6"
      style={{
        width: 'min(100%, 800px)',
      }}
    >
      <Flex justify="start">
        <div
          style={{
            width: '100%',
            fontSize: 'var(--font-size-2)',
            color: 'var(--gray-12)',
          }}
        >
          <ReactMarkdown
            components={{
              p: ({ children, ...props }) => (
                <p style={{ margin: '0.75em 0' }} {...props}>
                  {children}
                </p>
              ),
              pre: ({ children, ...props }) => (
                <pre
                  style={{
                    borderRadius: '5px',
                    overflow: 'auto',
                    margin: '1em 0',
                  }}
                  {...props}
                >
                  {children}
                </pre>
              ),
              code: ({ children, className, ...props }) => {
                const match = /language-(\w+)/.exec(className || '');
                const language = match ? match[1] : '';
                const isInline = !className;

                return isInline ? (
                  <code
                    style={{
                      backgroundColor: 'var(--gray-3)',
                      padding: '0.2em 0.4em',
                      borderRadius: '3px',
                      fontSize: '85%',
                      fontFamily: 'monospace',
                    }}
                    {...props}
                  >
                    {children}
                  </code>
                ) : (
                  <SyntaxHighlighter
                    style={syntaxTheme}
                    language={language}
                    PreTag="div"
                    className="syntax-highlighter"
                  >
                    {String(children).replace(/\n$/, '')}
                  </SyntaxHighlighter>
                );
              },
              a: ({ children, ...props }) => (
                <a
                  style={{
                    color: 'var(--blue-9)',
                    textDecoration: 'none',
                  }}
                  target="_blank"
                  rel="noopener noreferrer"
                  {...props}
                >
                  {children}
                </a>
              ),
              h1: ({ children, ...props }) => (
                <h1 style={{ margin: '0.67em 0', fontSize: '1.5em' }} {...props}>
                  {children}
                </h1>
              ),
              h2: ({ children, ...props }) => (
                <h2 style={{ margin: '0.83em 0', fontSize: '1.3em' }} {...props}>
                  {children}
                </h2>
              ),
              h3: ({ children, ...props }) => (
                <h3 style={{ margin: '1em 0', fontSize: '1.1em' }} {...props}>
                  {children}
                </h3>
              ),
              ul: ({ children, ...props }) => (
                <ul style={{ paddingLeft: '2em', margin: '1em 0' }} {...props}>
                  {children}
                </ul>
              ),
              ol: ({ children, ...props }) => (
                <ol style={{ paddingLeft: '2em', margin: '1em 0' }} {...props}>
                  {children}
                </ol>
              ),
            }}
          >
            {content || ''}
          </ReactMarkdown>
        </div>
      </Flex>
    </Box>
  );
}

export default function AiResponse({ message }: { message: Message }) {
  if (message.status === 'completed') {
    return <CompletedMessage message={message} />;
  } else if (message.status === 'pending') {
    return <PendingMessage message={message} />;
  } else if (message.status === 'aborted') {
    return <AbortedMessage message={message} />;
  } else {
    return <FailedMessage message={message} />;
  }
}

function CompletedMessage({ message }: { message: Message }) {
  return <MarkdownMessage content={message.content} />;
}

function PendingMessage({ message }: { message: Message }) {
  const { data: tokens } = useTokensShape(message.id);
  const tokenText = tokens?.map(token => token.token_text).join('');
  const [isAborting, setIsAborting] = useState(false);
  const [lastUpdateTime, setLastUpdateTime] = useState(Date.now());
  const [, forceUpdate] = useState({});

  // Update lastUpdateTime when new tokens arrive
  useEffect(() => {
    if (tokenText) {
      setLastUpdateTime(Date.now());
    }
  }, [tokenText]);

  // Set up timeout to trigger re-render when updates are stale
  useEffect(() => {
    const timeout = setTimeout(() => {
      forceUpdate({});
    }, 500);

    return () => clearTimeout(timeout);
  }, [lastUpdateTime]);

  const handleAbort = async () => {
    try {
      setIsAborting(true);
      await abortMessage(message.id);
      // The shape subscription will update the UI when the message status changes
    } catch (err) {
      console.error('Failed to abort message:', err);
      setIsAborting(false);
    }
  };

  const showThinking = !tokenText || Date.now() - lastUpdateTime > 500;

  return (
    <Box position="relative" width="100%">
      <MarkdownMessage content={tokenText || ''} />
      {showThinking && (
        <Box px="6" style={{ marginTop: '0.5em' }}>
          <Text
            color="gray"
            size="2"
            style={{
              animation: 'pulse 1.5s ease-in-out infinite',
            }}
          >
            Thinking...
          </Text>
        </Box>
      )}
      <Box position="absolute" top="0" right="6" style={{ zIndex: 100, top: '-10px' }}>
        <Tooltip content="Stop generating">
          <IconButton
            size="1"
            variant="ghost"
            color="ruby"
            onClick={handleAbort}
            disabled={isAborting}
            style={{
              padding: '0',
              width: '28px',
              height: '28px',
            }}
          >
            {isAborting ? (
              <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} />
            ) : (
              <OctagonX size={14} />
            )}
          </IconButton>
        </Tooltip>
      </Box>
      <style>
        {`
          @keyframes pulse {
            0% { opacity: 0.5; }
            50% { opacity: 1; }
            100% { opacity: 0.5; }
          }
        `}
      </style>
    </Box>
  );
}

function FailedMessage({}: { message: Message }) {
  return (
    <Box px="6" width="100%">
      <Text color="ruby">Failed to generate response</Text>
    </Box>
  );
}

function AbortedMessage({ message }: { message: Message }) {
  return (
    <Box width="100%">
      <MarkdownMessage content={message.content || ''} />
      <Box px="6">
        <Text color="ruby" size="2">
          Generation stopped
        </Text>
      </Box>
    </Box>
  );
}
