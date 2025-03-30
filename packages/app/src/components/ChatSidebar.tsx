import { Box, Flex, Text, IconButton, ScrollArea } from '@radix-ui/themes';
import { X } from 'lucide-react';
import { FileList } from './FileList';
import { useChatSidebar } from './ChatSidebarProvider';

interface ChatSidebarProps {
  chatId: string;
  isMobile: boolean;
}

export function ChatSidebar({ chatId, isMobile }: ChatSidebarProps) {
  const { isChatSidebarOpen, setChatSidebarOpen } = useChatSidebar();

  return (
    <>
      {/* Overlay for mobile */}
      {isMobile && (
        <Box
          className={`sidebar-overlay ${isChatSidebarOpen ? 'open' : ''}`}
          onClick={() => setChatSidebarOpen(false)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.4)',
            opacity: isChatSidebarOpen ? 1 : 0,
            visibility: isChatSidebarOpen ? 'visible' : 'hidden',
            transition: 'opacity 0.2s ease-in-out',
            zIndex: 99,
          }}
        />
      )}

      {/* Sidebar */}
      <Box
        className={`chat-sidebar ${isChatSidebarOpen ? 'open' : ''}`}
        style={{
          width: '280px',
          height: '100%',
          borderLeft: '1px solid var(--gray-5)',
          backgroundColor: 'var(--color-background)',
          ...(isMobile
            ? {
                position: 'fixed',
                right: isChatSidebarOpen ? 0 : '-280px',
                top: 0,
                bottom: 0,
                zIndex: 100,
                transition: 'right 0.2s ease-in-out',
              }
            : {
                position: 'relative',
                flexShrink: 0,
                flexGrow: 0,
                flexBasis: isChatSidebarOpen ? '280px' : '0px',
                overflow: 'hidden',
              }),
        }}
      >
        {/* Header - Only show on mobile */}
        {isMobile && (
          <Flex
            p="3"
            align="center"
            justify="between"
            style={{
              height: '56px',
              borderBottom: '1px solid var(--gray-5)',
              flexShrink: 0,
            }}
          >
            <Text size="3" weight="medium">
              Assets
            </Text>
            <IconButton variant="ghost" size="1" onClick={() => setChatSidebarOpen(false)}>
              <X size={18} />
            </IconButton>
          </Flex>
        )}

        {/* File List */}
        <ScrollArea style={{ height: isMobile ? 'calc(100% - 56px)' : '100%' }}>
          <FileList chatId={chatId} />
        </ScrollArea>
      </Box>
    </>
  );
}
