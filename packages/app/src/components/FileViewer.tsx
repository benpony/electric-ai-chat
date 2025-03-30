import {
  Dialog,
  Flex,
  Text,
  Button,
  Box,
  IconButton,
  Tooltip,
  ScrollArea,
  Badge,
  VisuallyHidden,
} from '@radix-ui/themes';
import { File } from '../shapes';
import { Markdown } from './Markdown';
import { CodeBlock } from './CodeBlock';
import { Download, X, FileIcon, Code, Copy, Check } from 'lucide-react';
import { useTheme } from './ThemeProvider';
import { useMemo, useState, useCallback } from 'react';

interface FileViewerProps {
  file: File | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function FileViewer({ file, open, onOpenChange }: FileViewerProps) {
  const { theme } = useTheme();
  const [showRawMarkdown, setShowRawMarkdown] = useState(false);
  const [showRawSvg, setShowRawSvg] = useState(false);
  const [hasCopied, setHasCopied] = useState(false);

  const fileName = useMemo(() => file?.path.split('/').pop() || 'file', [file?.path]);
  const fileExt = useMemo(() => {
    if (!fileName) return '';
    const parts = fileName.split('.');
    return parts.length > 1 ? parts.pop()?.toLowerCase() : '';
  }, [fileName]);

  const handleCopy = useCallback(() => {
    if (!file) return;
    navigator.clipboard.writeText(file.content).then(() => {
      setHasCopied(true);
      setTimeout(() => setHasCopied(false), 2000);
    });
  }, [file]);

  if (!file) return null;

  const isTextFile = file.mime_type.startsWith('text/');
  const isMarkdown = file.mime_type === 'text/markdown';
  const isCode = file.mime_type.startsWith('text/') && !isMarkdown;
  const isImage = file.mime_type.startsWith('image/');

  const handleDownload = () => {
    const blob = new Blob([file.content], { type: file.mime_type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content
        style={{
          maxWidth: '90vw',
          maxHeight: '90vh',
          padding: 0,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          borderRadius: '6px',
        }}
      >
        <Dialog.Title>
          <VisuallyHidden>{fileName}</VisuallyHidden>
        </Dialog.Title>

        <Box px="3" pb="3" style={{ borderBottom: '1px solid var(--gray-5)' }}>
          <Flex justify="between" align="center">
            <Flex align="center" gap="2">
              <FileIcon size={18} />
              <Text weight="medium" size="3" style={{ wordBreak: 'break-all' }}>
                {fileName}
              </Text>
              {fileExt && (
                <Badge size="1" color="gray" variant="soft">
                  {fileExt}
                </Badge>
              )}
            </Flex>
            <Flex gap="2" align="center">
              {isMarkdown && (
                <Tooltip content={showRawMarkdown ? 'View rendered' : 'View raw'}>
                  <IconButton
                    size="1"
                    variant="soft"
                    color="indigo"
                    highContrast={showRawMarkdown}
                    onClick={() => setShowRawMarkdown(!showRawMarkdown)}
                  >
                    <Code size={16} />
                  </IconButton>
                </Tooltip>
              )}
              {file.mime_type === 'image/svg+xml' && (
                <Tooltip content={showRawSvg ? 'View rendered' : 'View raw'}>
                  <IconButton
                    size="1"
                    variant="soft"
                    color="indigo"
                    highContrast={showRawSvg}
                    onClick={() => setShowRawSvg(!showRawSvg)}
                  >
                    <Code size={16} />
                  </IconButton>
                </Tooltip>
              )}
              {!isImage && (
                <Tooltip content={hasCopied ? 'Copied!' : 'Copy content'}>
                  <IconButton
                    size="1"
                    variant="soft"
                    color={hasCopied ? 'green' : 'gray'}
                    onClick={handleCopy}
                  >
                    {hasCopied ? <Check size={16} /> : <Copy size={16} />}
                  </IconButton>
                </Tooltip>
              )}
              <Tooltip content="Download file">
                <IconButton size="1" variant="soft" color="gray" onClick={handleDownload}>
                  <Download size={16} />
                </IconButton>
              </Tooltip>
              <Tooltip content="Close">
                <IconButton
                  size="1"
                  variant="soft"
                  color="gray"
                  onClick={() => onOpenChange(false)}
                >
                  <X size={16} />
                </IconButton>
              </Tooltip>
            </Flex>
          </Flex>

          {file.path !== fileName && (
            <Text size="1" color="gray" mt="1">
              {file.path}
            </Text>
          )}
        </Box>

        <ScrollArea
          style={{
            flex: 1,
            width: '100%',
            backgroundColor: theme === 'dark' ? 'var(--gray-2)' : 'var(--gray-1)',
          }}
          scrollbars="vertical"
        >
          {isTextFile && (
            <Box>
              {isMarkdown ? (
                showRawMarkdown ? (
                  <CodeBlock code={file.content} language="markdown" />
                ) : (
                  <Box p="4">
                    <div
                      style={{
                        fontSize: 'var(--font-size-2)',
                        color: 'var(--gray-12)',
                        lineHeight: 1.5,
                      }}
                    >
                      <Markdown content={file.content} />
                    </div>
                  </Box>
                )
              ) : isCode ? (
                <CodeBlock code={file.content} language={file.mime_type.split('/')[1]} />
              ) : (
                <pre
                  style={{
                    margin: 0,
                    padding: '16px',
                    whiteSpace: 'pre-wrap',
                    fontFamily: 'monospace',
                    fontSize: 'var(--font-size-2)',
                    color: 'var(--gray-12)',
                    lineHeight: 1.5,
                  }}
                >
                  {file.content}
                </pre>
              )}
            </Box>
          )}
          {isImage && (
            <Flex justify="center" p="4">
              {file.mime_type === 'image/svg+xml' ? (
                showRawSvg ? (
                  <Box>
                    <CodeBlock code={decodeURIComponent(file.content)} language="xml" />
                  </Box>
                ) : (
                  <div
                    dangerouslySetInnerHTML={{
                      __html: decodeURIComponent(file.content),
                    }}
                    style={{
                      maxWidth: '100%',
                      maxHeight: 'calc(90vh - 200px)',
                      borderRadius: '4px',
                    }}
                  />
                )
              ) : (
                <img
                  src={`data:${file.mime_type};base64,${file.content}`}
                  alt={file.path}
                  style={{
                    maxWidth: '100%',
                    maxHeight: 'calc(90vh - 200px)',
                    borderRadius: '4px',
                  }}
                />
              )}
            </Flex>
          )}
          {!isTextFile && !isImage && (
            <Flex
              direction="column"
              gap="4"
              p="4"
              align="center"
              justify="center"
              style={{ minHeight: '300px' }}
            >
              <FileIcon size={64} opacity={0.5} />
              <Text color="gray">This file type is not supported for preview.</Text>
              <Button onClick={handleDownload} size="2">
                <Download size={16} />
                Download File
              </Button>
            </Flex>
          )}
        </ScrollArea>
      </Dialog.Content>
    </Dialog.Root>
  );
}
