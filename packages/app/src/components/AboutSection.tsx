import { Box, Heading, Text } from '@radix-ui/themes';

export default function AboutSection() {
  return (
    <Box style={{ padding: '32px 16px', maxWidth: '600px' }}>
      <Heading size="3" mb="2" align="center" weight="medium">
        About Electric AI Chat
      </Heading>
      <Text size="2" color="gray">
        This is a demo AI chat application using Electric for resumeability, interruptability,
        multi-user and multi-agent sync. See the{' '}
        <a href="https://electric-sql.com/blog/2025/04/09/building-ai-apps-on-sync">
          Building AI apps on sync
        </a>{' '}
        blog post for more context.
      </Text>
      <Heading size="3" mb="2" mt="4" align="center" weight="medium">
        ElectricSQL
      </Heading>
      <Text size="2" color="gray">
        Electric is a Postgres sync engine. It solves the hard problems of sync for you, including
        partial replication, fan-out, and data delivery. See{' '}
        <a href="https://electric-sql.com">electric-sql.com</a> for more information.
      </Text>
    </Box>
  );
}
