// Lambda handler for Next.js serverless deployment
// This wraps the Next.js standalone server to work with Lambda Function URLs

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

// Next.js standalone server path (relative to Lambda's working directory after bundling)
// The standalone build will be copied to the Lambda package
const NEXT_SERVER_PATH = './.next/standalone/server.js';

// Cache the Next.js server instance
let nextServer: any = null;

async function getNextServer() {
  if (!nextServer) {
    try {
      // Import the Next.js server from standalone build
      // The standalone build creates a server.js that exports the handler
      const serverModule = await import(NEXT_SERVER_PATH);
      
      // Next.js standalone server typically exports a default handler function
      nextServer = serverModule.default || serverModule;
      
      // If it's a function that needs to be called, call it
      if (typeof nextServer === 'function' && !nextServer.constructor || nextServer.name === 'handler') {
        // It's likely a handler function, use it directly
        // Otherwise try calling it if it's a factory
        try {
          const result = await nextServer();
          if (result && typeof result === 'object') {
            nextServer = result;
          }
        } catch {
          // If calling fails, use it as-is (it's probably the handler)
        }
      }
    } catch (error) {
      console.error('Failed to load Next.js server:', error);
      // Fallback: try alternative import path
      try {
        const altPath = './server.js';
        const altModule = await import(altPath);
        nextServer = altModule.default || altModule;
      } catch (fallbackError) {
        console.error('Fallback import also failed:', fallbackError);
        throw error;
      }
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
    const response = await server.handleRequest(request);
    
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

