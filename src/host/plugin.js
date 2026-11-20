import { homedir } from 'node:os';
import { join } from 'node:path';
import { Library } from './library.js';
import { knowledgeRoute } from './http.js';
import { isDocumentVision } from './vision.js';

export const inject = ['webServer', 'tools', 'connection'];

export function apply(ctx) {
  const root = join(
    process.env.DSH_HOME || join(homedir(), '.dsh'),
    'storages',
    'knowledge-markdown-v1',
  );
  const library = new Library(root, ctx);
  ctx.effect(() => () => library.close(), 'Knowledge library');
  ctx.effect(
    () => ctx.webServer.register(knowledgeRoute(library, ctx.connection)),
    'Knowledge web API',
  );
  ctx.tools.register({
    name: 'knowledge_search',
    description:
      'Find relevant passages in the user’s Markdown library. Cite each document title and passage when using the results.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Question to search for' } },
      required: ['query'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute({ query }) {
      const hits = await library.search(query);
      return (
        hits
          .map(
            (h) =>
              h.title +
              ' · passage ' +
              (h.ordinal + 1) +
              '\n' +
              h.text +
              '\nMarkdown: /knowledge/documents/' +
              h.document +
              '/markdown',
          )
          .join('\n\n') || 'No indexed passages matched.'
      );
    },
  });
  ctx.on('llm/stream', (_options, next) =>
    (async function* () {
      if (isDocumentVision()) {
        yield* next();
        return;
      }
      library.engine.foreground++;
      library.engine.workers.accelerator.stop('Reserved for chat');
      try {
        yield* next();
      } finally {
        library.engine.foreground--;
        library.engine.lastChat = Date.now();
        library.wake();
      }
    })(),
  );
}
