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
      console.log(`__dirname equivalent check`);
      
      // Import the Next.js server from standalone build
      // Next.js standalone server.js exports a request handler
      const serverModule = await import(NEXT_SERVER_PATH);
      console.log('Next.js server module loaded successfully');
      console.log('Module keys:', Object.keys(serverModule));
      console.log('Has default export:', 'default' in serverModule);
      
      // Next.js standalone typically exports the handler as default
      // Or it might export a server instance with handleRequest method
      nextServer = serverModule.default || serverModule;
      
      // If it's a function, it might be the handler directly
      // Or if it's an object, it might have handleRequest or similar
      if (typeof nextServer === 'function') {
        console.log('Server is a function, checking if it needs to be called');
        // Try calling it - some Next.js versions need initialization
        try {
          const result = await nextServer();
          if (result && typeof result === 'object') {
            nextServer = result;
            console.log('Server function returned an object');
          } else {
            console.log('Server function returned:', typeof result);
          }
        } catch (callError) {
          console.log('Server function call failed (might be handler directly):', callError);
          // If calling fails, it's probably the handler function itself
        }
      }
      
      console.log('Final server type:', typeof nextServer);
      if (typeof nextServer === 'object' && nextServer !== null) {
        console.log('Server object keys:', Object.keys(nextServer));
      }
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
    
    // Convert API Gateway headers to Headers object
    const headers = new Headers();
    for (const [key, value] of Object.entries(event.headers || {})) {
      if (value) {
        headers.set(key.toLowerCase(), value);
      }
    }
    
    // Create Request object
    const request = new Request(url, {
      method: event.requestContext.http.method || 'GET',
      headers,
      body: event.body && event.isBase64Encoded
        ? Buffer.from(event.body, 'base64')
        : event.body || undefined,
    });
    
    // Handle the request with Next.js server
    // The server might be a handler function or an object with handleRequest
    let response: Response;
    if (typeof server === 'function') {
      // Server is a handler function - call it directly
      response = await server(request);
    } else if (server && typeof server.handleRequest === 'function') {
      // Server has handleRequest method
      response = await server.handleRequest(request);
    } else if (server && typeof server.request === 'function') {
      // Alternative method name
      response = await server.request(request);
    } else {
      throw new Error(`Unsupported server type: ${typeof server}. Server: ${JSON.stringify(Object.keys(server || {}))}`);
    }
    
    // Convert Response to API Gateway format
    const body = await response.text();
    const responseHeaders: Record<string, string> = {};
    
    response.headers.forEach((value: string, key: string) => {
      // Skip hop-by-hop headers
      const lowerKey = key.toLowerCase();
      if (!['connection', 'keep-alive', 'transfer-encoding', 'upgrade'].includes(lowerKey)) {
        responseHeaders[key] = value;
      }
    });
    
    return {
      statusCode: response.status,
      headers: responseHeaders,
      body,
      isBase64Encoded: false,
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

