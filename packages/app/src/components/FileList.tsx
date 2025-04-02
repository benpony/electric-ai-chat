import { useState, useEffect } from 'react';
import { Box, Flex, Text, Button } from '@radix-ui/themes';
import { ChevronRight, ChevronDown, Folder } from 'lucide-react';
import { useFilesShape } from '../shapes';
import { FileViewer } from './FileViewer';

interface FileListProps {
  chatId: string;
}

interface FileNode {
  id: string;
  name: string;
  path: string;
  isDirectory: boolean;
  children: Record<string, FileNode>;
  data?: any;
}

export function FileList({ chatId }: FileListProps) {
  const { data: files } = useFilesShape(chatId);
  const [selectedFile, setSelectedFile] = useState<any>(null);
  const [fileViewerOpen, setFileViewerOpen] = useState(false);
  const [expandedDirs, setExpandedDirs] = useState<Record<string, boolean>>({});

  if (!files || files.length === 0) return null;

  // Convert flat file list to hierarchical structure
  const buildFileTree = (files: any[]) => {
    const root: FileNode = {
      id: 'root',
      name: '',
      path: '',
      isDirectory: true,
      children: {},
    };

    files.forEach(file => {
      const pathParts = file.path.split('/');
      let current = root;

      pathParts.forEach((part: string, index: number) => {
        const isLastPart = index === pathParts.length - 1;
        const currentPath = pathParts.slice(0, index + 1).join('/');

        if (!current.children[part]) {
          current.children[part] = {
            id: isLastPart ? file.id : currentPath,
            name: part,
            path: currentPath,
            isDirectory: !isLastPart,
            children: {},
            data: isLastPart ? file : undefined,
          };
        }

        current = current.children[part];
      });
    });

    return root;
  };

  // Set all directories to expanded when files change
  useEffect(() => {
    if (files && files.length > 0) {
      const tree = buildFileTree(files);
      const initialExpandedState: Record<string, boolean> = {};

      // Helper function to collect all directory paths
      const collectDirectoryPaths = (node: FileNode, path: string = '') => {
        if (node.isDirectory) {
          if (path) {
            initialExpandedState[path] = true;
          }

          Object.values(node.children).forEach(child => {
            collectDirectoryPaths(child, child.path);
          });
        }
      };

      collectDirectoryPaths(tree);
      setExpandedDirs(initialExpandedState);
    }
  }, [files]);

  const toggleDirectory = (path: string) => {
    setExpandedDirs(prev => ({
      ...prev,
      [path]: !prev[path],
    }));
  };

  const renderFileNode = (node: FileNode, depth = 0) => {
    const isExpanded = expandedDirs[node.path] !== false; // Default to expanded

    if (node.isDirectory) {
      const hasChildren = Object.keys(node.children).length > 0;

      return (
        <Box key={node.id}>
          <Button
            variant="ghost"
            color="gray"
            size="1"
            my="1"
            style={{
              justifyContent: 'flex-start',
              height: '22px',
              overflow: 'hidden',
              paddingLeft: `${depth * 12}px`,
              width: '100%',
              color: 'var(--gray-11)',
            }}
            onClick={() => toggleDirectory(node.path)}
          >
            {hasChildren &&
              (isExpanded ? (
                <ChevronDown size={12} style={{ marginRight: '4px', opacity: 0.7 }} />
              ) : (
                <ChevronRight size={12} style={{ marginRight: '4px', opacity: 0.7 }} />
              ))}
            <Folder size={12} style={{ marginRight: '8px', opacity: 0.7 }} />
            <Text
              size="1"
              style={{
                maxWidth: '100%',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {node.name}
            </Text>
          </Button>

          {isExpanded && (
            <Flex direction="column">
              {Object.values(node.children)
                .sort((a, b) => {
                  // Directories first, then sort alphabetically
                  if (a.isDirectory && !b.isDirectory) return -1;
                  if (!a.isDirectory && b.isDirectory) return 1;
                  return a.name.localeCompare(b.name);
                })
                .map(childNode => renderFileNode(childNode, depth + 1))}
            </Flex>
          )}
        </Box>
      );
    } else {
      return (
        <Button
          key={node.id}
          variant="ghost"
          color="gray"
          size="1"
          my="1"
          style={{
            justifyContent: 'flex-start',
            height: '22px',
            overflow: 'hidden',
            paddingLeft: `${depth * 12}px`,
            width: '100%',
            color: 'var(--gray-11)',
          }}
          onClick={() => {
            setSelectedFile(node.data);
            setFileViewerOpen(true);
          }}
        >
          <div style={{ width: '16px' }}></div>
          <Text
            size="1"
            style={{
              maxWidth: '100%',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {node.name}
          </Text>
        </Button>
      );
    }
  };

  const fileTree = buildFileTree(files);

  return (
    <Box>
      <Box py="2" px="4">
        <Text size="1" color="gray" weight="medium">
          CHAT FILES
        </Text>
      </Box>
      <Flex direction="column" gap="1" px="4">
        {Object.values(fileTree.children)
          .sort((a, b) => {
            // Directories first, then sort alphabetically
            if (a.isDirectory && !b.isDirectory) return -1;
            if (!a.isDirectory && b.isDirectory) return 1;
            return a.name.localeCompare(b.name);
          })
          .map(node => renderFileNode(node))}
      </Flex>

      <FileViewer file={selectedFile} open={fileViewerOpen} onOpenChange={setFileViewerOpen} />
    </Box>
  );
}
