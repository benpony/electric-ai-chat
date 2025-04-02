import { Flex, Text, Box, IconButton, Tooltip } from '@radix-ui/themes';
import { Message, useTokensShape } from '../shapes';
import ReactMarkdown from 'react-markdown';
import { PrismAsyncLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import vscDarkPlus from 'react-syntax-highlighter/dist/esm/styles/prism/vsc-dark-plus';
import oneLight from 'react-syntax-highlighter/dist/esm/styles/prism/one-light';
import { useTheme } from './ThemeProvider';
import { abortMessage } from '../api';
import { useState, useEffect, memo } from 'react';
import { Loader, OctagonX, Copy, Check } from 'lucide-react';

interface StopButtonProps {
  onStop: () => void;
  isAborting?: boolean;
}

function StopButton({ onStop, isAborting = false }: StopButtonProps) {
  return (
    <>
      <Box
        position="sticky"
        style={{
          top: '12px',
          left: '100%',
          marginLeft: '12px',
          zIndex: 100,
          display: 'flex',
          alignItems: 'center',
          float: 'right',
        }}
        className="stop-button-container"
      >
        <Tooltip content="Stop generating">
          <IconButton
            size="2"
            variant="soft"
            color="ruby"
            onClick={onStop}
            disabled={isAborting}
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '50%',
              padding: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.2s ease',
              opacity: isAborting ? 0.7 : 1,
              backgroundColor: 'var(--color-background)',
              boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            }}
            className="stop-button"
          >
            {isAborting ? (
              <Loader size={18} style={{ animation: 'spin 1s linear infinite' }} />
            ) : (
              <OctagonX size={18} />
            )}
          </IconButton>
        </Tooltip>
      </Box>
      <style>
        {`
          @media (max-width: 900px) {
            .stop-button-container {
              position: absolute !important;
              right: 24px !important;
              left: auto !important;
              margin-left: 0 !important;
            }
          }
          .stop-button:hover {
            background-color: var(--ruby-3) !important;
            transform: scale(1.05);
          }
        `}
      </style>
    </>
  );
}

const CopyButton = memo(function CopyButton({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <Tooltip content={copied ? 'Copied!' : 'Copy code'}>
      <IconButton
        size="1"
        variant="ghost"
        color="gray"
        onClick={handleCopy}
        style={{
          position: 'absolute',
          right: '6px',
          top: '13px',
          opacity: 0.5,
        }}
        className="copy-button"
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </IconButton>
    </Tooltip>
  );
});

interface CodeHighlighterProps {
  children: string;
  language: string;
}

const CodeHighlighter = memo(function CodeHighlighter({
  children,
  language,
}: CodeHighlighterProps) {
  const { theme } = useTheme();
  const syntaxTheme = theme === 'dark' ? vscDarkPlus : oneLight;

  return (
    <SyntaxHighlighter
      style={syntaxTheme}
      language={language}
      PreTag="div"
      className="syntax-highlighter"
    >
      {children}
    </SyntaxHighlighter>
  );
});

const InlineCode = memo(function InlineCode({ children, ...props }: { children: React.ReactNode }) {
  return (
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
  );
});

const CodeBlock = memo(function CodeBlock({
  children,
  language,
}: {
  children: React.ReactNode;
  language: string;
}) {
  const content = String(children).replace(/\n$/, '');
  return (
    <>
      <CopyButton content={content} />
      <CodeHighlighter language={language}>{content}</CodeHighlighter>
    </>
  );
});

const MarkdownMessage = memo(function MarkdownMessage({ content }: { content: string }) {
  return (
    <Box>
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
                    position: 'relative',
                  }}
                  className="code-block"
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
                  <InlineCode {...props}>{children}</InlineCode>
                ) : (
                  <CodeBlock language={language}>{children}</CodeBlock>
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
});

const AiResponse = memo(({ message }: { message: Message }) => {
  if (message.status === 'completed') {
    return <CompletedMessage message={message} />;
  } else if (message.status === 'pending') {
    return <PendingMessage message={message} />;
  } else if (message.status === 'aborted') {
    return <AbortedMessage message={message} />;
  } else {
    return <FailedMessage message={message} />;
  }
});

function CompletedMessage({ message }: { message: Message }) {
  return (
    <Box
      px="6"
      style={{
        width: 'min(100%, 800px)',
      }}
    >
      <MarkdownMessage content={message.content} />
    </Box>
  );
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
    <Box
      position="relative"
      style={{
        width: 'min(100%, 800px)',
        isolation: 'isolate',
      }}
    >
      <StopButton onStop={handleAbort} isAborting={isAborting} />
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
            {message.thinking_text || 'Thinking...'}
          </Text>
        </Box>
      )}
      <style>
        {`
          @keyframes pulse {
            0% { opacity: 0.5; }
            50% { opacity: 1; }
            100% { opacity: 0.5; }
          }
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}
      </style>
    </Box>
  );
}

function FailedMessage({}: { message: Message }) {
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
            color: 'var(--ruby-9)',
          }}
        >
          Failed to generate response
        </div>
      </Flex>
    </Box>
  );
}

function AbortedMessage({ message }: { message: Message }) {
  return (
    <Box
      px="6"
      style={{
        width: 'min(100%, 800px)',
      }}
    >
      <MarkdownMessage content={message.content || ''} />
      <Box>
        <Text color="ruby" size="2">
          Generation interrupted
        </Text>
      </Box>
    </Box>
  );
}

export default AiResponse;
