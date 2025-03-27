import { Flex, Text, Box } from "@radix-ui/themes";
import { Message, useTokensShape } from "../shapes";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import { useTheme } from "./theme-provider";

function MarkdownMessage({ content }: { content: string }) {
  const { theme } = useTheme();
  const syntaxTheme = theme === "dark" ? vscDarkPlus : oneLight;

  return (
    <Box
      px="6"
      style={{
        maxWidth: "800px",
        width: "100%",
      }}
    >
      <Flex justify="start">
        <div
          style={{
            width: "100%",
            fontSize: "var(--font-size-2)",
            color: "var(--gray-12)",
          }}
        >
          <ReactMarkdown
            components={{
              p: ({ children, ...props }) => (
                <p style={{ margin: "0.75em 0" }} {...props}>
                  {children}
                </p>
              ),
              pre: ({ children, ...props }) => (
                <pre
                  style={{
                    borderRadius: "5px",
                    overflow: "auto",
                    margin: "1em 0",
                  }}
                  {...props}
                >
                  {children}
                </pre>
              ),
              code: ({ children, className, ...props }) => {
                const match = /language-(\w+)/.exec(className || "");
                const language = match ? match[1] : "";
                const isInline = !className;

                return isInline ? (
                  <code
                    style={{
                      backgroundColor: "var(--gray-3)",
                      padding: "0.2em 0.4em",
                      borderRadius: "3px",
                      fontSize: "85%",
                      fontFamily: "monospace",
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
                    customStyle={{
                      borderRadius: "5px",
                      margin: "0",
                    }}
                  >
                    {String(children).replace(/\n$/, "")}
                  </SyntaxHighlighter>
                );
              },
              a: ({ children, ...props }) => (
                <a
                  style={{
                    color: "var(--blue-9)",
                    textDecoration: "none",
                  }}
                  target="_blank"
                  rel="noopener noreferrer"
                  {...props}
                >
                  {children}
                </a>
              ),
              h1: ({ children, ...props }) => (
                <h1
                  style={{ margin: "0.67em 0", fontSize: "1.5em" }}
                  {...props}
                >
                  {children}
                </h1>
              ),
              h2: ({ children, ...props }) => (
                <h2
                  style={{ margin: "0.83em 0", fontSize: "1.3em" }}
                  {...props}
                >
                  {children}
                </h2>
              ),
              h3: ({ children, ...props }) => (
                <h3 style={{ margin: "1em 0", fontSize: "1.1em" }} {...props}>
                  {children}
                </h3>
              ),
              ul: ({ children, ...props }) => (
                <ul style={{ paddingLeft: "2em", margin: "1em 0" }} {...props}>
                  {children}
                </ul>
              ),
              ol: ({ children, ...props }) => (
                <ol style={{ paddingLeft: "2em", margin: "1em 0" }} {...props}>
                  {children}
                </ol>
              ),
            }}
          >
            {content || ""}
          </ReactMarkdown>
        </div>
      </Flex>
    </Box>
  );
}

export default function AiResponse({ message }: { message: Message }) {
  if (message.status === "completed") {
    return <CompletedMessage message={message} />;
  } else if (message.status === "pending") {
    return <PendingMessage message={message} />;
  } else {
    return <FailedMessage message={message} />;
  }
}

function CompletedMessage({ message }: { message: Message }) {
  return <MarkdownMessage content={message.content} />;
}

function PendingMessage({ message }: { message: Message }) {
  const { data: tokens } = useTokensShape(message.id);
  const tokenText = tokens?.map((token) => token.token_text).join("");

  return <MarkdownMessage content={tokenText || ""} />;
}

function FailedMessage({}: { message: Message }) {
  return (
    <Box px="4">
      <Text>Failed to generate response</Text>
    </Box>
  );
}
