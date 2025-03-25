import { useState, useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Box,
  Flex,
  Text,
  IconButton,
  Button,
  ScrollArea,
  Tooltip,
  Separator,
} from "@radix-ui/themes";
import {
  LogOut,
  Moon,
  Sun,
  MessageSquarePlus,
  Monitor,
} from "lucide-react";
import { useTheme } from "./theme-provider";
import { useChatsShape } from "../shapes";

// Create a global variable to track sidebar state
let isSidebarOpen = false;
let setSidebarOpen: (value: boolean) => void;

// Export a function to toggle the sidebar that can be used by other components
export function toggleSidebar() {
  if (setSidebarOpen) {
    setSidebarOpen(!isSidebarOpen);
  }
}

export default function Sidebar() {
  const { data: chats } = useChatsShape();
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [sidebarOpen, setSidebarOpenState] = useState(false);
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const username = localStorage.getItem("username") || "User";

  // Use window.location directly to determine current path
  const [currentPath, setCurrentPath] = useState(window.location.pathname);

  // Force re-render periodically to check current path
  useEffect(() => {
    const interval = setInterval(() => {
      if (window.location.pathname !== currentPath) {
        setCurrentPath(window.location.pathname);
      }
    }, 100);

    return () => clearInterval(interval);
  }, [currentPath]);

  // Set up the global toggle function
  useEffect(() => {
    isSidebarOpen = sidebarOpen;
    setSidebarOpen = setSidebarOpenState;
  }, [sidebarOpen]);

  // Set up window resize handler
  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (!mobile) {
        setSidebarOpenState(false);
      }
    };

    handleResize(); // Call immediately
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("username");
    navigate({ to: "/" });
  };

  const handleChatClick = (chatId: string) => {
    navigate({ to: `/chat/${chatId}` });
    if (isMobile) {
      setSidebarOpenState(false);
    }
  };

  const handleNewChat = () => {
    navigate({ to: "/" });
    if (isMobile) {
      setSidebarOpenState(false);
    }
  };

  return (
    <>
      {/* Sidebar overlay (mobile only) */}
      {isMobile && (
        <Box
          className={`sidebar-overlay ${sidebarOpen ? "open" : ""}`}
          onClick={() => setSidebarOpenState(false)}
        />
      )}

      {/* Sidebar */}
      <Box
        className={`sidebar ${sidebarOpen ? "open" : ""}`}
        style={{
          width: isMobile ? "280px" : "280px",
          height: "100%",
        }}
      >
        {/* Header */}
        <Flex 
          p="3" 
          align="center" 
          justify="between"
          style={{
            height: '56px',
            borderBottom: '1px solid var(--gray-5)',
            position: 'relative'
          }}
        >
          <Text size="3" weight="medium" style={{ paddingLeft: "4px" }}>
            Electric Chat
          </Text>
          {!isMobile && (
            <Tooltip content="New Chat">
              <IconButton variant="ghost" size="2" onClick={handleNewChat}>
                <MessageSquarePlus size={22} />
              </IconButton>
            </Tooltip>
          )}
          {isMobile && (
            <IconButton
              size="1"
              variant="ghost"
              style={{
                position: "absolute",
                right: "12px",
                opacity: 0.8,
                height: '28px',
                width: '28px'
              }}
              onClick={() => setSidebarOpenState(false)}
            >
              ✕
            </IconButton>
          )}
        </Flex>

        {/* Prominent New Chat button for mobile */}
        {isMobile && (
          <Box p="2">
            <Button
              size="1"
              variant="solid"
              style={{
                width: "100%",
                justifyContent: "center",
                height: "28px",
              }}
              onClick={handleNewChat}
            >
              <MessageSquarePlus size={14} style={{ marginRight: "8px" }} />
              New Chat
            </Button>
          </Box>
        )}

        {/* Chats */}
        <ScrollArea style={{ flex: 1, minHeight: 0 }}>
          <Box p="4">
            <Text size="1" color="gray" mb="1" style={{ fontWeight: "medium" }}>
              RECENT CHATS
            </Text>
            <Flex direction="column" gap="1" style={{ paddingTop: "4px" }}>
              {chats.map((chat) => {
                const chatPath = `/chat/${chat.id}`;
                const isActive = currentPath === chatPath;

                return (
                  <Button
                    key={chat.id}
                    variant="ghost"
                    color="gray"
                    size="1"
                    
                    style={{
                      justifyContent: "flex-start",
                      height: "22px",
                      backgroundColor: isActive ? "var(--gray-5)" : undefined,
                      marginTop: "0",
                      marginBottom: "-2px",
                    }}
                    onClick={() => handleChatClick(chat.id)}
                  >
                    <Text
                      size="1"
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        // fontWeight: isActive ? "bold" : "normal",
                      }}
                    >
                      {chat.name}
                    </Text>
                  </Button>
                );
              })}
            </Flex>
          </Box>
        </ScrollArea>

        {/* Footer */}
        <Box p="2" style={{ marginTop: "auto" }}>
          <Separator size="4" mb="2" />
          <Flex align="center" justify="between" style={{ padding: "0 8px" }}>
            <Flex align="center" gap="2">
              <Text size="1">{username}</Text>
            </Flex>
            <Flex gap="3">
              <Tooltip content={theme === "dark" ? "Light mode" : theme === "light" ? "System mode" : "Dark mode"}>
                <IconButton
                  size="1"
                  variant="ghost"
                  onClick={() => {
                    if (theme === "dark") setTheme("light");
                    else if (theme === "light") setTheme("system");
                    else setTheme("dark");
                  }}
                >
                  {theme === "dark" ? <Sun size={14} /> : theme === "light" ? <Monitor size={14} /> : <Moon size={14} />}
                </IconButton>
              </Tooltip>
              <Tooltip content="Log out">
                <IconButton
                  size="1"
                  variant="ghost"
                  color="red"
                  onClick={handleLogout}
                >
                  <LogOut size={14} />
                </IconButton>
              </Tooltip>
            </Flex>
          </Flex>
        </Box>
      </Box>
    </>
  );
}
