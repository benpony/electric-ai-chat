import { ReactNode } from 'react';
import { ThemeProvider } from './ThemeProvider';
import { SidebarProvider } from './SidebarProvider';
import { ChatSidebarProvider } from './ChatSidebarProvider';

type ProvidersProps = {
  children: ReactNode;
  defaultTheme?: 'light' | 'dark' | 'system';
};

export function Providers({ children, defaultTheme = 'light' }: ProvidersProps) {
  return (
    <ThemeProvider defaultTheme={defaultTheme}>
      <SidebarProvider>
        <ChatSidebarProvider>{children}</ChatSidebarProvider>
      </SidebarProvider>
    </ThemeProvider>
  );
}
