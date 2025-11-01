// Lambda handler for Next.js serverless deployment
// This wraps the Next.js standalone server to work with Lambda Function URLs

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

// Next.js standalone server path (relative to Lambda's working directory)
// The standalone build contents are copied to /var/task/ (Lambda package root)
// So server.js should be at the root: ./server.js
const NEXT_SERVER_PATH = './server.js';

// Cache the Next.js server instance
let nextServer: any = null;

async function getNextServer() {
  if (!nextServer) {
    try {
      console.log(`Attempting to import Next.js server from: ${NEXT_SERVER_PATH}`);
      console.log(`Current working directory: ${process.cwd()}`);
      
      // Check if .next directory exists
      const fs = await import('fs/promises');
      try {
        const nextDirStat = await fs.stat('./.next');
        console.log('✓ .next directory exists:', nextDirStat.isDirectory());
      } catch (statError) {
        console.error('✗ .next directory not found!');
        console.error('Directory contents:', await fs.readdir('.').catch(() => []));
      }
      
      // Import the Next.js server from standalone build
      // Next.js 15 standalone server.js typically exports a handler function
      const serverModule = await import(NEXT_SERVER_PATH);
      console.log('Next.js server module loaded successfully');
      console.log('Module keys:', Object.keys(serverModule));
      
      // Next.js 15 standalone exports the handler as default
      // The handler is a function that takes (req, res) for Node.js HTTP
      // But we need to adapt it for Lambda Function URL format
      const defaultExport = serverModule.default;
      
      if (!defaultExport) {
        throw new Error('Next.js server.js does not have a default export');
      }
      
      console.log('Default export type:', typeof defaultExport);
      
      // Next.js standalone server is typically an HTTP server handler
      // We need to wrap it to work with Lambda Function URLs
      // The handler expects Node.js IncomingMessage/ServerResponse, but we have Lambda events
      
      // For Next.js 15, the standalone server.js exports a handler that expects
      // Node.js-style request/response objects. We'll need to adapt them.
      nextServer = defaultExport;
      
      console.log('Next.js server initialized');
    } catch (error) {
      console.error('Failed to load Next.js server:', error);
      console.error('Error details:', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        code: (error as any)?.code,
      });
      throw error;
    }
  }
  return nextServer;
}

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  try {
    const server = await getNextServer();
    
    // Build request URL
    const protocol = event.headers['x-forwarded-proto'] || 'https';
    const host = event.requestContext.domainName || event.headers.host || 'localhost';
    const path = event.rawPath || event.requestContext.http.path || '/';
    const query = event.rawQueryString ? `?${event.rawQueryString}` : '';
    const url = `${protocol}://${host}${path}${query}`;
    const method = event.requestContext.http.method || 'GET';
    
    // Log request for debugging
    console.log(`[${method}] ${path}`);
    
    // Check for potential edge runtime routes
    if (path.includes('/_next/data/') || path.startsWith('/api/edge')) {
      console.warn(`⚠️  Edge runtime route detected: ${path}`);
      console.warn('   Edge routes are not supported in AWS Lambda. Request may fail.');
    }
    
    // Next.js standalone server.js exports a handler function that expects Node.js req/res
    // We need to convert Lambda Function URL event to Node.js HTTP request/response format
    if (typeof server !== 'function') {
      throw new Error(`Next.js server must be a function, got: ${typeof server}`);
    }
    
    // Next.js standalone server expects Node.js HTTP (req, res) format
    // We need to convert Lambda Function URL event to Node.js request/response
    const http = await import('http');
    const stream = await import('stream');
    
    // Create mock socket for the request
    const socket = new stream.Duplex() as any;
    socket._write = () => {};
    socket._read = () => {};
    
    // Create Node.js IncomingMessage
    const nodeRequest = new http.IncomingMessage(socket) as any;
    nodeRequest.url = path + query;
    nodeRequest.method = event.requestContext.http.method || 'GET';
    nodeRequest.headers = {};
    for (const [key, value] of Object.entries(event.headers || {})) {
      if (value) {
        nodeRequest.headers[key.toLowerCase()] = value;
      }
    }
    nodeRequest.headers.host = host;
    nodeRequest.headers['x-forwarded-proto'] = protocol;
    
    // Handle request body
    if (event.body) {
      const bodyBuffer = event.isBase64Encoded
        ? Buffer.from(event.body, 'base64')
        : Buffer.from(event.body, 'utf-8');
      nodeRequest.push(bodyBuffer);
    }
    nodeRequest.push(null); // End stream
    
    // Create Node.js ServerResponse
    const nodeResponse = new http.ServerResponse(nodeRequest) as any;
    
    // Collect response
    let statusCode = 200;
    const responseHeaders: Record<string, string> = {};
    const responseChunks: Buffer[] = [];
    let responseFinished = false;
    
    // Override response methods to collect output
    const originalWriteHead = nodeResponse.writeHead.bind(nodeResponse);
    nodeResponse.writeHead = function(code: number, reasonPhrase?: string | any, headers?: any) {
      statusCode = code;
      // Handle different signatures: writeHead(code, headers) or writeHead(code, reason, headers)
      if (typeof reasonPhrase === 'object' && reasonPhrase !== null) {
        headers = reasonPhrase;
      }
      if (headers) {
        Object.keys(headers).forEach(key => {
          responseHeaders[key.toLowerCase()] = String(headers[key]);
        });
      }
      return originalWriteHead(code, reasonPhrase, headers);
    };
    
    const originalSetHeader = nodeResponse.setHeader.bind(nodeResponse);
    nodeResponse.setHeader = function(name: string, value: string | string[]) {
      responseHeaders[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value);
      return originalSetHeader(name, value);
    };
    
    const originalWrite = nodeResponse.write.bind(nodeResponse);
    nodeResponse.write = function(chunk: any) {
      responseChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return originalWrite(chunk);
    };
    
    const originalEnd = nodeResponse.end.bind(nodeResponse);
    nodeResponse.end = function(chunk?: any) {
      if (chunk) {
        responseChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      responseFinished = true;
      return originalEnd(chunk);
    };
    
    // Call Next.js handler with 55s timeout (Lambda max is 60s)
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (!responseFinished) {
          console.error(`Request timeout after 55s: ${method} ${path}`);
          reject(new Error('Next.js handler timeout after 55 seconds'));
        }
      }, 55000);
      
      nodeResponse.on('finish', () => {
        clearTimeout(timeout);
        resolve();
      });
      
      nodeResponse.on('close', () => {
        clearTimeout(timeout);
        resolve();
      });
      
      try {
        // Next.js standalone handler signature: (req, res) => void
        server(nodeRequest, nodeResponse);
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
      }
    });
    
    // Get final status code from response object
    const finalStatusCode = nodeResponse.statusCode || statusCode;
    
    // Collect headers from response object as well
    const allHeaders = { ...responseHeaders };
    if (nodeResponse.getHeaders) {
      const responseHeadersObj = nodeResponse.getHeaders();
      for (const [key, value] of Object.entries(responseHeadersObj)) {
        allHeaders[key.toLowerCase()] = String(value);
      }
    }
    
    // Process response body
    const bodyBuffer = responseChunks.length > 0 
      ? Buffer.concat(responseChunks)
      : Buffer.alloc(0);
    
    // Get content type before processing
    const contentType = allHeaders['content-type'] || '';
    
    // Binary & Compression Support
    // Detect binary content types
    const isBinary = /^(image\/|application\/octet-stream|font\/)/i.test(contentType);
    
    // Check if compression is needed (text/HTML > 10KB and not already compressed)
    const shouldCompress = !isBinary && 
      bodyBuffer.length > 10240 && 
      !allHeaders['content-encoding'];
    
    let finalBody: string;
    let isBase64Encoded = false;
    
    if (isBinary) {
      // Binary content: encode as base64
      finalBody = bodyBuffer.toString('base64');
      isBase64Encoded = true;
    } else if (shouldCompress) {
      // Compress large text responses
      const zlib = await import('zlib');
      const compressed = await new Promise<Buffer>((resolve, reject) => {
        zlib.gzip(bodyBuffer, (err, result) => {
          if (err) reject(err);
          else resolve(result);
        });
      });
      finalBody = compressed.toString('base64');
      isBase64Encoded = true;
      allHeaders['content-encoding'] = 'gzip';
      // Remove content-length as it will be incorrect after compression
      delete allHeaders['content-length'];
    } else {
      // Plain text: keep as UTF-8 string
      finalBody = bodyBuffer.toString('utf-8');
    }
    
    // Clean headers - remove hop-by-hop headers
    const cleanedHeaders: Record<string, string> = {};
    const hopByHopHeaders = [
      'connection',
      'keep-alive',
      'transfer-encoding',
      'upgrade',
      'server',
      'date',
    ];
    
    // Only remove content-length if we compressed (it's now incorrect)
    if (shouldCompress) {
      hopByHopHeaders.push('content-length');
    }
    
    for (const [key, value] of Object.entries(allHeaders)) {
      const lowerKey = key.toLowerCase();
      if (!hopByHopHeaders.includes(lowerKey)) {
        cleanedHeaders[key] = value;
      }
    }
    
    // Content-Type Handling: Default to HTML for pages (not API routes)
    if (!cleanedHeaders['content-type'] && finalStatusCode < 400) {
      // Default to HTML for pages, but let API routes set their own
      if (!path.startsWith('/api/')) {
        cleanedHeaders['content-type'] = 'text/html; charset=utf-8';
      }
    }
    
    // Response Logging
    const bodyLength = isBase64Encoded 
      ? Buffer.from(finalBody, 'base64').length 
      : Buffer.byteLength(finalBody, 'utf-8');
    
    const contentTypeHeader = cleanedHeaders['content-type'] || 'no-content-type';
    const base64Flag = isBase64Encoded ? ' (base64)' : '';
    console.log(`Response: ${finalStatusCode} ${contentTypeHeader} ${bodyLength} bytes${base64Flag}`);
    
    return {
      statusCode: finalStatusCode,
      headers: cleanedHeaders,
      body: finalBody,
      isBase64Encoded,
    };
  } catch (error) {
    console.error('Lambda handler error:', error);
    return {
      statusCode: 500,
      headers: { 'content-type': 'text/plain' },
      body: 'Internal Server Error',
    };
  }
};

