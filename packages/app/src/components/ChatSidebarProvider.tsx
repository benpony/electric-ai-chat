import { createContext, useContext, useState } from 'react';

interface ChatSidebarContextType {
  isChatSidebarOpen: boolean;
  toggleChatSidebar: () => void;
  setChatSidebarOpen: (open: boolean) => void;
}

const ChatSidebarContext = createContext<ChatSidebarContextType | undefined>(undefined);

export function ChatSidebarProvider({ children }: { children: React.ReactNode }) {
  const [isChatSidebarOpen, setIsChatSidebarOpen] = useState(false);

  const toggleChatSidebar = () => {
    setIsChatSidebarOpen(prev => !prev);
  };

  const setChatSidebarOpen = (open: boolean) => {
    setIsChatSidebarOpen(open);
  };

  return (
    <ChatSidebarContext.Provider
      value={{
        isChatSidebarOpen,
        toggleChatSidebar,
        setChatSidebarOpen,
      }}
    >
      {children}
    </ChatSidebarContext.Provider>
  );
}

export function useChatSidebar() {
  const context = useContext(ChatSidebarContext);
  if (context === undefined) {
    throw new Error('useChatSidebar must be used within a ChatSidebarProvider');
  }
  return context;
}
