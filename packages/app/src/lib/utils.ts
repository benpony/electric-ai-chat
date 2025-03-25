export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function generateChatId(): string {
  return Math.random().toString(36).substring(2, 15);
}

export interface Message {
  id: string;
  content: string;
  sender: string;
  timestamp: Date;
  isAI: boolean;
}

export interface Chat {
  id: string;
  title: string;
  messages: Message[];
  participants: string[];
  createdAt: Date;
  updatedAt: Date;
} 