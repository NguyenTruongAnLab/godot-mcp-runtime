import * as net from 'net';
import { pathToFileURL } from 'url';

export interface ValidationError {
  line?: number;
  message: string;
}

/**
 * Convert a filesystem path to a file:// URI.
 */
function toFileUri(filePath: string): string {
  return pathToFileURL(filePath).href;
}

/**
 * Simple, self-contained LSP validator that attempts to validate a GDScript file
 * by connecting directly to the running Godot Editor's Language Server.
 * Returns null if the LSP is unavailable, timed out, or errors out, letting the
 * caller fallback gracefully to headless Godot validation.
 */
export async function tryLspValidate(
  projectPath: string,
  filePath: string,
  fileContent: string,
): Promise<ValidationError[] | null> {
  const envPort = process.env.GODOT_LSP_PORT;
  const ports = envPort ? [parseInt(envPort, 10)] : [6005, 6008]; // 6005 is default for Godot 3
  const targetUri = toFileUri(filePath);

  for (const port of ports) {
    if (isNaN(port) || port < 1 || port > 65535) continue;
    try {
      const errors = await validateWithLspOnPort(port, targetUri, fileContent);
      if (errors !== null) {
        return errors;
      }
    } catch (_e) {
      // Try the next port
    }
  }
  return null;
}

function validateWithLspOnPort(
  port: number,
  targetUri: string,
  fileContent: string,
): Promise<ValidationError[] | null> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let buffer = '';
    let isInitialized = false;
    let timeoutTimer: NodeJS.Timeout | null = null;
    let resolved = false;

    const cleanup = () => {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }
      try {
        socket.destroy();
      } catch (_e) {
        /* ignore */
      }
    };

    const finish = (result: ValidationError[] | null) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(result);
    };

    // Set an overall timeout of 800ms to keep tool execution fast
    timeoutTimer = setTimeout(() => {
      finish(null); // Fallback to headless
    }, 800);

    socket.on('error', () => {
      finish(null);
    });

    socket.on('close', () => {
      finish(null);
    });

    socket.on('data', (chunk) => {
      buffer += chunk.toString();

      while (true) {
        const headerEnd = buffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) break;

        const header = buffer.slice(0, headerEnd);
        const contentLengthMatch = header.match(/Content-Length: (\d+)/i);
        if (!contentLengthMatch) {
          buffer = buffer.slice(headerEnd + 4);
          continue;
        }

        const contentLength = parseInt(contentLengthMatch[1], 10);
        const messageStart = headerEnd + 4;
        const messageEnd = messageStart + contentLength;

        if (buffer.length < messageEnd) break;

        const messageStr = buffer.slice(messageStart, messageEnd);
        buffer = buffer.slice(messageEnd);

        try {
          const message = JSON.parse(messageStr);
          handleLspMessage(message);
        } catch (_e) {
          // Ignore invalid parse
        }
      }
    });

    const sendMessage = (msg: unknown) => {
      if (socket.destroyed) return;
      const content = JSON.stringify(msg);
      const header = `Content-Length: ${Buffer.byteLength(content, 'utf8')}\r\n\r\n`;
      socket.write(header + content, 'utf8');
    };

    const handleLspMessage = (message: any) => {
      // Handshake: initialized when we receive the response to initialize (ID: 1)
      if (message.id === 1 && message.result) {
        isInitialized = true;
        // Send initialized notification
        sendMessage({
          jsonrpc: '2.0',
          method: 'initialized',
          params: {},
        });

        // Open the virtual document
        sendMessage({
          jsonrpc: '2.0',
          method: 'textDocument/didOpen',
          params: {
            textDocument: {
              uri: targetUri,
              languageId: 'gdscript',
              version: 1,
              text: fileContent,
            },
          },
        });

        // Trigger diagnostics generation via didSave with the source content
        sendMessage({
          jsonrpc: '2.0',
          method: 'textDocument/didSave',
          params: {
            textDocument: {
              uri: targetUri,
            },
            text: fileContent,
          },
        });
        return;
      }

      // Publish diagnostics notification
      if (message.method === 'textDocument/publishDiagnostics') {
        const params = message.params;
        if (params && params.uri === targetUri) {
          const diagnostics = Array.isArray(params.diagnostics) ? params.diagnostics : [];
          const validationErrors: ValidationError[] = diagnostics.map((d: any) => {
            const line =
              d.range && d.range.start && typeof d.range.start.line === 'number'
                ? d.range.start.line + 1 // convert 0-indexed to 1-indexed
                : undefined;
            return {
              line,
              message: d.message || 'Unknown syntax error',
            };
          });
          finish(validationErrors);
        }
      }
    };

    socket.connect(port, '127.0.0.1', () => {
      // Handshake start: Send initialize request
      sendMessage({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          processId: process.pid,
          rootUri: null,
          capabilities: {
            textDocument: {
              publishDiagnostics: {},
            },
          },
        },
      });
    });
  });
}
