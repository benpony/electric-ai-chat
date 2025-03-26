import { useState, useEffect, useRef } from "react";
import { useParams } from "@tanstack/react-router";
import {
  Box,
  Flex,
  Text,
  TextField,
  IconButton,
  ScrollArea,
  Button,
} from "@radix-ui/themes";
import { Menu } from "lucide-react";
import { toggleSidebar } from "./Sidebar";
import { useChat, useMessagesShape } from "../shapes";
import { addMessage } from "../api";
import AiResponse from "./AiResponse";
export default function ChatScreen() {
  const { chatId } = useParams({ from: "/chat/$chatId" });
  const chat = useChat(chatId);
  const { data: messages } = useMessagesShape(chatId);
  const [message, setMessage] = useState("");
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const username = localStorage.getItem("username") || "User";

  // Define CSS variables for theming that will adapt to dark mode
  const themeVariables = {
    "--color-background-message": "var(--gray-3)",
    "--shadow-message": "0 1px 1px rgba(0, 0, 0, 0.04)",
    "@media (prefers-color-scheme: dark)": {
      "--color-background-message": "var(--gray-5)",
      "--shadow-message": "0 1px 1px rgba(0, 0, 0, 0.2)",
    },
  };

  useEffect(() => {
    // Add event listener for window resize
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    // Scroll to bottom whenever messages change
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat?.messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!message.trim()) return;
    
    try {
      setIsLoading(true);
      
      // Send message to API
      await addMessage(chatId, message.trim(), username);
      
      // Clear input
      setMessage("");
    } catch (error) {
      console.error("Failed to send message:", error);
      // Could add error handling/display here
    } finally {
      setIsLoading(false);
    }
  };

  if (!chat) {
    return (
      <Flex align="center" justify="center" style={{ height: "100%" }}>
        <Text color="gray" size="2">
          Not found
        </Text>
      </Flex>
    );
  }

  return (
    <Flex
      direction="column"
      style={{ height: "100%", width: "100%", ...themeVariables }}
    >
      {/* Header with title and sidebar toggle */}
      <Flex
        align="center"
        justify="between"
        style={{
          height: "56px",
          borderBottom: "1px solid var(--gray-5)",
          padding: "0 16px",
          flexShrink: 0,
        }}
      >
        <Flex align="center" gap="2">
          {isMobile && (
            <IconButton variant="ghost" size="1" onClick={toggleSidebar}>
              <Menu size={18} />
            </IconButton>
          )}
          <Text size="3" weight="medium">
            {chat.name}
          </Text>
        </Flex>
      </Flex>

      {/* Messages - Scrollable */}
      <ScrollArea style={{ height: "100%" }} scrollbars="vertical">
        <Box
          p="3"
          style={{ display: "flex", flexDirection: "column", gap: "12px" }}
        >
          {messages.map((msg) => (
            <Flex
              key={msg.id}
              justify={
                msg.role === "agent" ? "center" : msg.user_name === username ? "end" : "start"
              }
            >
              {msg.role === "agent" ? (
                <AiResponse message={msg} />
              ) : (
                <Flex
                  direction="column"
                  style={{
                    maxWidth: "60%",
                    marginBottom: "10px",
                    alignItems:
                      msg.user_name === username ? "flex-end" : "flex-start",
                  }}
                >
                  {msg.user_name !== username && (
                    <Text
                      size="1"
                      style={{
                        color: "var(--gray-11)",
                        marginLeft: "4px",
                        marginBottom: "3px",
                      }}
                    >
                      {msg.user_name}
                    </Text>
                  )}
                  <Box
                    style={{
                      backgroundColor:
                        msg.user_name === username
                          ? "var(--accent-9)"
                          : "var(--color-background-message)",
                      color:
                        msg.user_name === username ? "white" : "var(--gray-12)",
                      padding: "8px 12px",
                      borderRadius: "18px",
                      position: "relative",
                      maxWidth: "fit-content",
                      boxShadow: "var(--shadow-message)",
                    }}
                  >
                    <Text size="2" style={{ whiteSpace: "pre-wrap" }}>
                      {msg.content}
                    </Text>
                  </Box>
                </Flex>
              )}
            </Flex>
          ))}

          {/* {isLoading && (
              <Flex justify="center">
                <Box className="typing-indicator">
                  <Box className="typing-dot" />
                  <Box className="typing-dot" />
                  <Box className="typing-dot" />
                </Box>
              </Flex>
            )} */}

          <div ref={messagesEndRef} />
        </Box>
      </ScrollArea>

      {/* Message Input - Fixed */}
      <Box
        style={{
          borderTop: "1px solid var(--border-color)",
          flexShrink: 0,
          padding: "16px",
        }}
      >
        <form onSubmit={handleSubmit}>
          <Flex gap="2">
            <Box style={{ flex: 1 }}>
              <TextField.Root
                size="3"
                placeholder="Type a message..."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                disabled={isLoading}
              />
            </Box>
            <Button type="submit" size="3" disabled={!message.trim() || isLoading}>
              Send
            </Button>
          </Flex>
        </form>
      </Box>
    </Flex>
  );
}
