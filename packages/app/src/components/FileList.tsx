import { useState } from 'react';
import { Box, Flex, Text, Button } from '@radix-ui/themes';
import { File } from 'lucide-react';
import { useFilesShape } from '../shapes';
import { FileViewer } from './FileViewer';

interface FileListProps {
  chatId: string;
}

export function FileList({ chatId }: FileListProps) {
  const { data: files } = useFilesShape(chatId);
  const [selectedFile, setSelectedFile] = useState<any>(null);
  const [fileViewerOpen, setFileViewerOpen] = useState(false);

  if (!files || files.length === 0) return null;

  return (
    <Box>
      <Box py="2" px="4">
        <Text size="1" color="gray" weight="medium">
          CHAT FILES
        </Text>
      </Box>
      <Flex direction="column" gap="1" px="4">
        {files.map(file => (
          <Button
            key={file.id}
            variant="ghost"
            color="gray"
            size="1"
            my="1"
            style={{
              justifyContent: 'flex-start',
              height: '22px',
              overflow: 'hidden',
            }}
            onClick={() => {
              setSelectedFile(file);
              setFileViewerOpen(true);
            }}
          >
            <File size={12} style={{ marginRight: '8px', opacity: 0.7 }} />
            <Text
              size="1"
              style={{
                maxWidth: '100%',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {file.path}
            </Text>
          </Button>
        ))}
      </Flex>

      <FileViewer file={selectedFile} open={fileViewerOpen} onOpenChange={setFileViewerOpen} />
    </Box>
  );
}
