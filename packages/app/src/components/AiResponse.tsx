import { Flex, Text, Box } from "@radix-ui/themes";
import { Message, useTokensShape } from "../shapes";

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
  return (
    <Box
      style={{
        maxWidth: "800px",
        width: "100%",
      }}
    >
      <Flex justify="start">
        <Text
          size="2"
          style={{
            whiteSpace: "pre-wrap",
            color: "var(--gray-12)",
          }}
        >
          {message.content}
        </Text>
      </Flex>
    </Box>
  );
}

function PendingMessage({ message }: { message: Message }) {
  const { data: tokens } = useTokensShape(message.id);
  const tokenText = tokens?.map((token) => token.token_text).join("");
  return (
    <Box
      style={{
        maxWidth: "800px",
        width: "100%",
      }}
    >
      <Flex justify="start">
        <Text
          size="2"
          style={{
            whiteSpace: "pre-wrap",
            color: "var(--gray-12)",
          }}
        >
          {tokenText}
        </Text>
      </Flex>
    </Box>
  );
}

function FailedMessage({}: { message: Message }) {
  return (
    <Box>
      <Text>Failed to generate response</Text>
    </Box>
  );
}
