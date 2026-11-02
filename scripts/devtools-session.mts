// Local development helper: an MCP client for the user's explicitly authorized Chrome session.
// Browser tool calls are forwarded as JSON lines on stdin. Responses are saved
// to ignored local artifacts for debugging; no data is uploaded by this helper.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { mkdir, writeFile } from 'node:fs/promises';

const server = fileURLToPath(new URL('../node_modules/chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js', import.meta.url));
const transport = new StdioClientTransport({ command: process.execPath,
  args: [server, '--autoConnect', '--no-usage-statistics', '--categoryExtensions'], stderr: 'pipe' });
transport.stderr?.on('data', chunk => process.stderr.write(chunk));
const client = new Client({ name: 'chat-fold-debugger', version: '1.0.0' }, { capabilities: { roots: { listChanged: false } } });
client.setRequestHandler(ListRootsRequestSchema, () => ({ roots: [{
  uri: pathToFileURL(fileURLToPath(new URL('../', import.meta.url))).href,
  name: 'ChatFolder workspace'
}] }));
await client.connect(transport);
const { tools } = await client.listTools();
console.log(JSON.stringify({ ready: true, tools: tools.map(({ name }) => name) }));
const input = createInterface({ input: process.stdin, terminal: false });
for await (const line of input) {
  if (!line.trim()) continue;
  try {
    const request = JSON.parse(line);
    if (request.tool === 'close') break;
    if (request.schema) {
      console.log(JSON.stringify(tools.find(tool => tool.name === request.tool)?.inputSchema));
      continue;
    }
    const result = await client.callTool({ name: request.tool, arguments: request.arguments || {} }, undefined, { timeout: 60000 });
    const directory = new URL('../artifacts/', import.meta.url);
    await mkdir(directory, { recursive: true });
    await writeFile(new URL('devtools-last-result.json', directory), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ completed: request.tool, isError: result.isError || false }));
  } catch (error) { console.log(JSON.stringify({ error: error instanceof Error ? error.message : String(error) })); }
}
await client.close();
