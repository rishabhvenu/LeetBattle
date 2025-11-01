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
      
      // Check if server.js exists before importing
      try {
        const serverJsStat = await fs.stat(NEXT_SERVER_PATH);
        console.log(`✓ server.js found at ${NEXT_SERVER_PATH}, size: ${serverJsStat.size} bytes`);
      } catch (statError) {
        console.error(`✗ server.js not found at ${NEXT_SERVER_PATH}!`);
        console.error('Current directory:', process.cwd());
        console.error('Directory contents:', await fs.readdir('.').catch(() => []));
        throw new Error(`Next.js server.js not found at ${NEXT_SERVER_PATH}. Make sure the standalone build is copied correctly.`);
      }
      
      // Import the Next.js server from standalone build
      // Next.js standalone server.js can export in different ways depending on version
      let serverModule: any;
      
      // Try CommonJS require first (Next.js standalone typically uses CommonJS)
      // Use absolute path to ensure module resolution works correctly
      try {
        const pathModule = await import('path');
        const absoluteServerPath = pathModule.resolve(process.cwd(), NEXT_SERVER_PATH);
        console.log(`Attempting to require server.js from: ${absoluteServerPath}`);
        
        const { createRequire } = await import('module');
        const cjsRequire = createRequire(import.meta.url || __filename);
        serverModule = cjsRequire(absoluteServerPath);
        console.log('Next.js server module loaded successfully (CommonJS)');
        console.log('CJS module keys:', Object.keys(serverModule));
        console.log('CJS module type:', typeof serverModule);
      } catch (cjsError) {
        // Fallback to ESM import if CommonJS fails
        console.log('CommonJS require failed, trying ESM import...');
        try {
          serverModule = await import(NEXT_SERVER_PATH);
          console.log('Next.js server module loaded successfully (ESM)');
        } catch (esmError) {
          console.error('Both CJS and ESM imports failed');
          throw new Error(`Failed to import Next.js server.js: CJS error: ${cjsError}, ESM error: ${esmError}`);
        }
      }
      
      console.log('Module keys:', Object.keys(serverModule));
      console.log('Module type:', typeof serverModule);
      console.log('Module has default:', 'default' in serverModule);
      
      // If default exists, log its details
      if (serverModule.default !== undefined) {
        console.log('Default export exists, type:', typeof serverModule.default);
        console.log('Default export keys:', typeof serverModule.default === 'object' && serverModule.default !== null ? Object.keys(serverModule.default) : 'N/A');
      }
      
      // Try different export patterns
      let handler: any = null;
      
      // Check if default is an empty object (Next.js 15 might use this pattern)
      const defaultExport = serverModule.default;
      const defaultIsEmptyObject = defaultExport && typeof defaultExport === 'object' && Object.keys(defaultExport).length === 0;
      
      console.log('Default export:', {
        exists: !!defaultExport,
        type: typeof defaultExport,
        isEmptyObject: defaultIsEmptyObject,
        keys: defaultExport && typeof defaultExport === 'object' ? Object.keys(defaultExport) : 'N/A'
      });
      
      // Pattern 1: Check all named exports first (Next.js 15 might export handler as named export)
      // Common Next.js 15 standalone exports: handler, server, createServer, getRequestHandler, app
      const namedExports = ['handler', 'server', 'createServer', 'getRequestHandler', 'app', 'render', 'prepare'];
      for (const exportName of namedExports) {
        if (serverModule[exportName] && typeof serverModule[exportName] === 'function') {
          handler = serverModule[exportName];
          console.log(`Using named export: ${exportName}`);
          break;
        }
      }
      
      // Pattern 2: If default is empty object, check if serverModule itself is a function
      if (!handler && defaultIsEmptyObject && typeof serverModule === 'function') {
        handler = serverModule;
        console.log('Using serverModule directly as function (default was empty)');
      }
      // Pattern 3: Default export (if not empty)
      else if (!handler && defaultExport && !defaultIsEmptyObject) {
        handler = defaultExport;
        console.log('Using default export');
        console.log('Default export type:', typeof handler);
        console.log('Default export keys:', typeof handler === 'object' ? Object.keys(handler) : 'N/A');
      }
      // Pattern 4: Try to call default if it exists (might be a factory function)
      else if (!handler && defaultExport && typeof defaultExport === 'function') {
        handler = defaultExport;
        console.log('Using default export as function');
      }
      // Pattern 5: Try all non-default exports
      else if (!handler) {
        console.log('Checking all module exports for functions...');
        for (const key of Object.keys(serverModule)) {
          if (key !== 'default' && typeof serverModule[key] === 'function') {
            handler = serverModule[key];
            console.log(`Found function export: ${key}`);
            break;
          }
        }
      }
      
      // Pattern 6: If default is empty object, try reading the actual server.js file to understand structure
      if (!handler && defaultIsEmptyObject) {
        console.log('Default is empty object, attempting to read server.js file directly...');
        try {
          const fs = await import('fs/promises');
          const serverJsContent = await fs.readFile(NEXT_SERVER_PATH, 'utf-8');
          console.log(`server.js file size: ${serverJsContent.length} bytes`);
          console.log(`server.js first 500 chars: ${serverJsContent.substring(0, 500)}`);
          
          // Check if it's a CommonJS module that exports differently
          if (serverJsContent.includes('module.exports') || serverJsContent.includes('exports.')) {
            console.log('Detected CommonJS exports, trying require()...');
            try {
              const { createRequire } = await import('module');
              const cjsRequire = createRequire(import.meta.url || __filename);
              const cjsModule = cjsRequire(NEXT_SERVER_PATH);
              console.log('CJS module keys:', Object.keys(cjsModule));
              console.log('CJS module type:', typeof cjsModule);
              
              // Try to get handler from CJS module - check all exports
              if (typeof cjsModule === 'function') {
                handler = cjsModule;
                console.log('CJS module is a function');
              } else if (cjsModule && typeof cjsModule === 'object') {
                // Check all properties of CJS module
                for (const key of Object.keys(cjsModule)) {
                  const value = cjsModule[key];
                  console.log(`CJS module.${key}: type=${typeof value}`);
                  if (typeof value === 'function') {
                    handler = value;
                    console.log(`Using CJS module.${key} as handler`);
                    break;
                  }
                }
              }
            } catch (cjsError) {
              console.warn('CJS require failed:', cjsError);
            }
          }
          
          // Also try checking if file uses a different export pattern
          // Next.js 15 might export handler differently
          if (!handler && serverJsContent) {
            // Look for export patterns
            const exportPatterns = [
              /export\s+default\s+function\s+(\w+)/,
              /module\.exports\s*=\s*function/,
              /module\.exports\s*=\s*(\w+)/,
              /exports\.(\w+)\s*=/,
            ];
            
            for (const pattern of exportPatterns) {
              const match = serverJsContent.match(pattern);
              if (match) {
                console.log(`Found export pattern: ${pattern}`);
                // Try requiring again with better error handling
                try {
                  const { createRequire } = await import('module');
                  const cjsRequire = createRequire(import.meta.url || __filename);
                  const cjsResult = cjsRequire(NEXT_SERVER_PATH);
                  // Try all exports one more time
                  if (typeof cjsResult === 'function') {
                    handler = cjsResult;
                    break;
                  }
                  for (const key of Object.keys(cjsResult)) {
                    if (typeof cjsResult[key] === 'function') {
                      handler = cjsResult[key];
                      break;
                    }
                  }
                } catch (e) {
                  // Ignore
                }
                break;
              }
            }
          }
        } catch (fileError) {
          console.warn('Could not read server.js file:', fileError);
        }
      }
      
      // Pattern 7: Check if we need to try alternative file paths
      if (!handler) {
        console.log('No handler found, trying alternative import paths...');
        
        // Try server-handler.js or other common patterns
        const alternativePaths = [
          './server-handler.js', 
          './server-handler', 
          './index.js',
          './.next/server/server.js',
          './server/server.js',
          // Try with absolute path resolution
          require.resolve ? require.resolve('./server.js') : './server.js',
        ];
        
        for (const altPath of alternativePaths) {
          try {
            console.log(`Attempting to import: ${altPath}`);
            const altModule = await import(altPath);
            console.log(`Successfully imported ${altPath}, keys:`, Object.keys(altModule));
            
            // Check default export
            if (altModule.default) {
              if (typeof altModule.default === 'function') {
                handler = altModule.default;
                console.log(`Found handler.default function in ${altPath}`);
                break;
              } else if (altModule.default.getRequestHandler && typeof altModule.default.getRequestHandler === 'function') {
                handler = altModule.default.getRequestHandler();
                console.log(`Found handler via getRequestHandler() in ${altPath}`);
                break;
              }
            }
            
            // Check named exports
            if (!handler && altModule.handler && typeof altModule.handler === 'function') {
              handler = altModule.handler;
              console.log(`Found handler.handler in ${altPath}`);
              break;
            }
            
            // Check all exports
            for (const key of Object.keys(altModule)) {
              if (key !== 'default' && typeof altModule[key] === 'function') {
                handler = altModule[key];
                console.log(`Found handler.${key} in ${altPath}`);
                break;
              }
            }
            
            if (handler) break;
          } catch (e) {
            console.log(`Import failed for ${altPath}:`, (e as Error).message);
            // Ignore import errors for alternative paths
          }
        }
        
          // Last resort: Try using file:// protocol with absolute path
          if (!handler) {
            try {
              const pathModule = await import('path');
              const fs = await import('fs/promises');
              const absolutePath = pathModule.resolve(process.cwd(), NEXT_SERVER_PATH);
            console.log(`Trying absolute path: ${absolutePath}`);
            
            // Check if file exists
            try {
              await fs.access(absolutePath);
              const fileUrl = `file://${absolutePath}`;
              console.log(`Trying file:// import: ${fileUrl}`);
              const fileModule = await import(fileUrl);
              console.log(`File import keys:`, Object.keys(fileModule));
              
              if (fileModule.default && typeof fileModule.default === 'function') {
                handler = fileModule.default;
              } else {
                // Check all exports
                for (const key of Object.keys(fileModule)) {
                  if (typeof fileModule[key] === 'function') {
                    handler = fileModule[key];
                    break;
                  }
                }
              }
            } catch (accessError) {
              console.warn(`File does not exist at ${absolutePath}`);
            }
          } catch (fileError) {
            console.warn('File:// import failed:', fileError);
          }
        }
      }
      
      if (!handler) {
        const allExports = Object.keys(serverModule).map(key => {
          const value = serverModule[key];
          return `${key}(${typeof value})${typeof value === 'object' && value !== null ? `:${Object.keys(value).join(',')}` : ''}`;
        }).join(', ');
        throw new Error(`Next.js server.js does not export a handler. Available exports: ${allExports}`);
      }
      
      // Handle case where handler is an object (Next.js 15 standalone sometimes exports server instance)
      if (typeof handler !== 'function') {
        console.log('Handler is not a function, checking for request handler methods...');
        console.log('Handler object keys:', Object.keys(handler));
        console.log('Handler object type:', typeof handler);
        console.log('Handler value:', handler);
        
        // Check for Symbol properties
        const symbolKeys = Object.getOwnPropertySymbols(handler);
        console.log('Handler symbol keys:', symbolKeys.length);
        
        // Check if handler is a Promise that resolves to a function
        if (handler && typeof handler.then === 'function') {
          console.log('Handler is a Promise, awaiting...');
          handler = await handler;
          console.log('Promise resolved to type:', typeof handler);
        }
        
        // If still not a function after awaiting, try object patterns
        if (typeof handler !== 'function') {
          // Next.js standalone might export an object with a request handler
          // Try common patterns - check all possible property names
          const possibleMethods = ['handle', 'request', 'listener', 'default', 'handler', 'app', 'server', 'createServer', 'getRequestHandler'];
          
          for (const methodName of possibleMethods) {
            if (handler[methodName] && typeof handler[methodName] === 'function') {
              console.log(`Found handler.${methodName} method`);
              handler = handler[methodName].bind(handler);
              break;
            }
          }
          
          // If we still don't have a function, try checking all enumerable properties
          if (typeof handler !== 'function') {
            console.log('Checking all enumerable properties...');
            for (const key in handler) {
              console.log(`  Checking property: ${key}, type: ${typeof handler[key]}`);
              if (typeof handler[key] === 'function') {
                console.log(`Found function property: ${key}`);
                handler = handler[key].bind(handler);
                break;
              }
            }
          }
          
          // Last resort: check if it has a __esModule flag and default export
          if (typeof handler !== 'function' && handler.__esModule && handler.default) {
            console.log('Found ESM module with default export');
            handler = handler.default;
          }
          
          // If still not a function, try using it as a request listener with http.createServer
          if (typeof handler !== 'function') {
            console.log('Attempting to use handler as request listener...');
            const http = await import('http');
            
            // In Next.js standalone, the export might be a request listener function
            // that needs to be wrapped. But if handler is empty, this won't work.
            // Let's check if we can inspect the constructor or prototype
            console.log('Handler constructor:', handler.constructor?.name);
            console.log('Handler prototype:', Object.getPrototypeOf(handler)?.constructor?.name);
            
            // If handler is an empty object or has no usable properties, try alternative approaches
            if (Object.keys(handler).length === 0 && (!handler.constructor || handler.constructor === Object)) {
              console.log('Handler appears to be an empty object, trying alternative approaches...');
              
              // Try 1: Check if serverModule itself is a function (bypass default)
              if (serverModule && typeof serverModule === 'function') {
                console.log('Using serverModule directly as function');
                handler = serverModule;
              }
              // Try 2: Check all non-default exports in serverModule
              else {
                console.log('Checking all non-default exports in serverModule...');
                for (const key of Object.keys(serverModule)) {
                  if (key !== 'default') {
                    const value = serverModule[key];
                    console.log(`  Checking ${key}: type=${typeof value}`);
                    if (typeof value === 'function') {
                      handler = value;
                      console.log(`  Found function export: ${key}`);
                      break;
                    } else if (value && typeof value === 'object' && value.getRequestHandler && typeof value.getRequestHandler === 'function') {
                      // Next.js app instance
                      console.log(`  Found Next.js app instance: ${key}`);
                      handler = value.getRequestHandler();
                      console.log(`  Got request handler from app instance`);
                      break;
                    }
                  }
                }
              }
              
              // Try 3: If still not a function handler, read the actual server.js content to understand export structure
              if (typeof handler !== 'function') {
                try {
                  const fs = await import('fs/promises');
                  const serverJsContent = await fs.readFile(NEXT_SERVER_PATH, 'utf-8');
                  
                  // Look for patterns like: export default function, module.exports = function, etc.
                  if (serverJsContent.includes('export default') || serverJsContent.includes('module.exports')) {
                    // Try requiring it as CommonJS if ESM import gave empty object
                    try {
                      const { createRequire } = await import('module');
                      const cjsRequire = createRequire(import.meta.url || __filename);
                      const cjsResult = cjsRequire(NEXT_SERVER_PATH);
                      console.log('CJS require result keys:', Object.keys(cjsResult));
                      if (typeof cjsResult === 'function') {
                        handler = cjsResult;
                        console.log('CJS require returned function');
                      } else if (cjsResult && typeof cjsResult === 'object') {
                        // Try to find handler in CJS result
                        for (const key of Object.keys(cjsResult)) {
                          if (typeof cjsResult[key] === 'function') {
                            handler = cjsResult[key];
                            console.log(`Found function in CJS result: ${key}`);
                            break;
                          }
                        }
                      }
                    } catch (cjsError) {
                      console.warn('CJS require failed:', cjsError);
                    }
                  }
                } catch (readError) {
                  console.warn('Could not read server.js for analysis:', readError);
                }
              }
              
              // Final error if still no handler function
              if (typeof handler !== 'function') {
                const allKeys = [
                  ...Object.keys(handler || {}),
                  ...Object.getOwnPropertyNames(handler || {}),
                  ...symbolKeys.map(s => s.toString())
                ];
                throw new Error(`Next.js handler must be a function. Got empty object. Module keys: ${Object.keys(serverModule).join(', ')}, Handler keys: ${allKeys.join(', ') || 'none'}. Try checking if server.js is correctly copied to Lambda.`);
              }
            } else {
              throw new Error(`Next.js handler must be a function or have a handle/request/listener/default method. Got type: ${typeof handler}, keys: ${Object.keys(handler).join(', ') || 'none'}`);
            }
          }
        }
      }
      
      // Final check after all processing
      if (typeof handler !== 'function') {
        throw new Error(`Next.js handler processing failed. Final type: ${typeof handler}, value: ${JSON.stringify(handler ? Object.keys(handler) : 'null')}`);
      }
      
      console.log('Handler type after processing:', typeof handler);
      console.log('Handler name:', handler.name || 'anonymous');
      
      // Next.js standalone server exports a request handler function
      // that expects Node.js IncomingMessage/ServerResponse
      nextServer = handler;
      
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
    
    const server = await getNextServer();
    
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

