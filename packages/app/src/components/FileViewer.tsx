import { Dialog, Flex, Text, Button, Box } from '@radix-ui/themes';
import { File } from '../shapes';
import { Markdown } from './Markdown';
import { CodeBlock } from './CodeBlock';
import { Download } from 'lucide-react';

interface FileViewerProps {
  file: File | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function FileViewer({ file, open, onOpenChange }: FileViewerProps) {
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
    a.download = file.path.split('/').pop() || 'file';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content style={{ maxWidth: '90vw', maxHeight: '90vh' }}>
        <Dialog.Title>{file.path}</Dialog.Title>
        <Box style={{ maxHeight: 'calc(90vh - 100px)', overflow: 'auto' }}>
          {isTextFile && (
            <Box p="4">
              {isMarkdown ? (
                <Markdown content={file.content} />
              ) : isCode ? (
                <CodeBlock code={file.content} language={file.mime_type.split('/')[1]} />
              ) : (
                <div style={{ whiteSpace: 'pre-wrap' }}>{file.content}</div>
              )}
            </Box>
          )}
          {isImage && (
            <Box p="4">
              <img
                src={`data:${file.mime_type};base64,${file.content}`}
                alt={file.path}
                style={{ maxWidth: '100%', maxHeight: 'calc(90vh - 200px)' }}
              />
            </Box>
          )}
          {!isTextFile && !isImage && (
            <Flex direction="column" gap="4" p="4" align="center">
              <Text>This file type is not supported for preview.</Text>
              <Button onClick={handleDownload}>
                <Download size={16} style={{ marginRight: '8px' }} />
                Download File
              </Button>
            </Flex>
          )}
        </Box>
      </Dialog.Content>
    </Dialog.Root>
  );
}
