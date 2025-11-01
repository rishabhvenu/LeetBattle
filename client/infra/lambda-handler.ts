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
      console.log(`[INIT] Starting Next.js server initialization...`);
      console.log(`[INIT] Current working directory: ${process.cwd()}`);
      
      const fs = await import('fs/promises');
      const pathModule = await import('path');
      const { createRequire } = await import('module');
      const cjsRequire = createRequire(import.meta.url || __filename);
      
      // Verify .next exists
      try {
        await fs.stat('./.next');
        console.log('[INIT] ✓ .next directory exists');
      } catch {
        console.error('[INIT] ✗ .next directory not found!');
      }
      
      // Test module resolution first
      console.log('[INIT] Testing module resolution...');
      try {
        cjsRequire('next');
        console.log('[INIT] ✓ "next" module resolvable');
      } catch (nextError) {
        console.error('[INIT] ✗ Cannot require "next":', nextError);
        throw new Error(`Module resolution failed: ${nextError}`);
      }
      
      // Strategy 1: Require server.js with timeout
      console.log('[INIT] Strategy 1: Requiring server.js...');
      try {
        const absoluteServerPath = pathModule.resolve(process.cwd(), NEXT_SERVER_PATH);
        console.log('[INIT] Path:', absoluteServerPath);
        
        // Wrap require in timeout
        const requireWithTimeout = Promise.race([
          Promise.resolve(cjsRequire(absoluteServerPath)),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('require timeout')), 10000)
          ),
        ]);
        
        const serverModule = await requireWithTimeout as any;
        console.log('[INIT] ✓ server.js loaded');
        console.log('[INIT] Exports:', Object.keys(serverModule));
        
        // Extract handler from serverModule
        let handler = serverModule.default || serverModule.handler || serverModule;
        
        if (typeof handler === 'function') {
          nextServer = handler;
          console.log('[INIT] ✓ Handler extracted from server.js');
          return nextServer;
        } else if (handler && typeof handler.getRequestHandler === 'function') {
          nextServer = handler.getRequestHandler();
          console.log('[INIT] ✓ Handler via getRequestHandler()');
          return nextServer;
        } else {
          throw new Error(`server.js exports unusable handler. Type: ${typeof handler}`);
        }
      } catch (requireError) {
        console.error('[INIT] Strategy 1 failed:', requireError);
        console.log('[INIT] Strategy 2: Programmatic Next.js...');
        
        // Strategy 2: Use Next.js programmatically
        try {
          const nextModule = cjsRequire('next');
          const nextApp = nextModule.default({ dev: false, dir: process.cwd() });
          
          const prepareWithTimeout = Promise.race([
            nextApp.prepare(),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('prepare timeout')), 15000)
            ),
          ]);
          
          await prepareWithTimeout;
          nextServer = nextApp.getRequestHandler();
          console.log('[INIT] ✓ Handler via programmatic Next.js');
          return nextServer;
        } catch (progError) {
          console.error('[INIT] Strategy 2 failed:', progError);
          throw new Error(`Both strategies failed. require error: ${requireError}, programmatic error: ${progError}`);
        }
      }
    } catch (error) {
      console.error('[INIT] ✗ Failed to load Next.js server:', error);
      console.error('[INIT] Error details:', {
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
    // Ensure we're in the right working directory for module resolution
    // Lambda's working directory should be /var/task where all files are
    const originalCwd = process.cwd();
    console.log('Current working directory:', originalCwd);
    console.log('NODE_PATH:', process.env.NODE_PATH);
    
    // Ensure server.js can find node_modules by checking paths
    const pathModule = await import('path');
    const serverPath = pathModule.resolve(process.cwd(), NEXT_SERVER_PATH);
    console.log('Server.js path:', serverPath);
    console.log('Node modules path:', pathModule.join(process.cwd(), 'node_modules'));
    const fs = await import('fs/promises');
    try {
      const nodeModulesExists = await fs.access(pathModule.join(process.cwd(), 'node_modules')).then(() => true).catch(() => false);
      console.log('node_modules exists:', nodeModulesExists);
      if (nodeModulesExists) {
        const nextExists = await fs.access(pathModule.join(process.cwd(), 'node_modules', 'next')).then(() => true).catch(() => false);
        console.log('node_modules/next exists:', nextExists);
      }
    } catch (checkError) {
      console.warn('Could not verify node_modules:', checkError);
    }
    
    // Get Next.js server with timeout protection
    // server.js initialization might try to connect to databases
    let server: any;
    try {
      console.log('[HANDLER] Calling getNextServer()...');
      const serverPromise = getNextServer();
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('getNextServer timeout after 25s')), 25000);
      });
      server = await Promise.race([serverPromise, timeoutPromise]);
      console.log('[HANDLER] ✓ getNextServer() completed successfully');
    } catch (serverError) {
      console.error('[HANDLER] ✗ Failed to get Next.js server:', serverError);
      const errorMsg = serverError instanceof Error ? serverError.message : String(serverError);
      console.error('[HANDLER] Error stack:', serverError instanceof Error ? serverError.stack : 'No stack');
      
      // Return a proper error response instead of throwing
      return {
        statusCode: 500,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          error: 'Server Initialization Failed',
          message: `Next.js server initialization failed: ${errorMsg}`,
          details: 'The server is still initializing or encountered an error during startup. Please try again in a moment.',
        }),
        isBase64Encoded: false,
      };
    }
    
    // Build request URL
    // CloudFront forwards original host in x-forwarded-host when using ALL_VIEWER_EXCEPT_HOST_HEADER
    // Prefer x-forwarded-host over other sources for the original viewer domain
    const protocol = event.headers['x-forwarded-proto'] || 'https';
    const host = event.headers['x-forwarded-host'] || 
                 event.requestContext.domainName || 
                 event.headers.host || 
                 'localhost';
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
      
      let finished = false;
      const finish = (error?: Error) => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };
      
      nodeResponse.on('finish', () => {
        console.log(`Response finished for ${method} ${path}`);
        finish();
      });
      
      nodeResponse.on('close', () => {
        console.log(`Response closed for ${method} ${path}`);
        finish();
      });
      
      nodeResponse.on('error', (err) => {
        console.error(`Response error for ${method} ${path}:`, err);
        finish(err);
      });
      
      try {
        // Next.js standalone handler signature: (req, res) => void
        // Handle both sync and async handlers
        const result = server(nodeRequest, nodeResponse);
        
        // If handler returns a Promise, wait for it
        if (result && typeof result.then === 'function') {
          result.catch((err: unknown) => {
            console.error(`Next.js handler promise rejected for ${method} ${path}:`, err);
            finish(err instanceof Error ? err : new Error(String(err)));
          });
        }
      } catch (error) {
        console.error(`Error calling Next.js handler for ${method} ${path}:`, error);
        finish(error as Error);
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
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    console.error('Error details:', {
      message: error instanceof Error ? error.message : String(error),
      name: error instanceof Error ? error.name : typeof error,
    });
    return {
      statusCode: 500,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ 
        error: 'Internal Server Error',
        message: error instanceof Error ? error.message : String(error),
      }),
      isBase64Encoded: false,
    };
  }
};

