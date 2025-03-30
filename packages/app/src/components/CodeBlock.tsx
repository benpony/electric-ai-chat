import { PrismAsyncLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import vscDarkPlus from 'react-syntax-highlighter/dist/esm/styles/prism/vsc-dark-plus';
import oneLight from 'react-syntax-highlighter/dist/esm/styles/prism/one-light';
import { useTheme } from './ThemeProvider';

interface CodeBlockProps {
  code: string;
  language: string;
}

export function CodeBlock({ code, language }: CodeBlockProps) {
  const { theme } = useTheme();
  const syntaxTheme = theme === 'dark' ? vscDarkPlus : oneLight;

  return (
    <SyntaxHighlighter
      language={language}
      style={syntaxTheme}
      customStyle={{
        margin: 0,
        borderRadius: 0,
        padding: '1rem',
        fontSize: 'var(--font-size-2)',
        lineHeight: 1.5,
      }}
    >
      {code}
    </SyntaxHighlighter>
  );
}
