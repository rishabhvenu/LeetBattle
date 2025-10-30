const JUDGE0_URL = process.env.JUDGE0_URL || 'http://codeclashers-judge0:2358';

export async function submitToJudge0(language_id: number, source_code: string, stdin?: string) {
  try {
    // Encode source code and stdin to base64 to handle special characters
    const encodedSourceCode = Buffer.from(source_code, 'utf8').toString('base64');
    
    const payload: any = { 
      language_id, 
      source_code: encodedSourceCode,
    };
    
    if (stdin !== undefined) {
      payload.stdin = Buffer.from(stdin, 'utf8').toString('base64');
    }
    
    const res = await fetch(`${JUDGE0_URL}/submissions?base64_encoded=true&wait=false`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Judge0 submit failed: ${res.status} ${errorText}`);
    }
    return res.json(); // { token }
  } catch (error) {
    console.error('Judge0 submission error:', error);
    console.error('Source code length:', source_code.length);
    console.error('Language ID:', language_id);
    throw error;
  }
}

export async function pollJudge0(token: string) {
  // Request all fields including stdout, stderr, compile_output, message, etc.
  const res = await fetch(`${JUDGE0_URL}/submissions/${token}?base64_encoded=true&fields=*`);
  if (!res.ok) {
    const errorText = await res.text();
    console.error(`Judge0 poll failed: ${res.status}`, errorText);
    throw new Error(`Judge0 poll failed: ${res.status} - ${errorText}`);
  }
  const result = await res.json();
  
  console.log('Judge0 poll result keys:', Object.keys(result));
  console.log('Judge0 poll result status:', result.status);
  
  // Decode base64 fields back to UTF-8 with error handling
  try {
    if (result.stdout) {
      console.log('Decoding stdout, length:', result.stdout.length);
      result.stdout = Buffer.from(result.stdout, 'base64').toString('utf8');
    }
    if (result.stderr) {
      console.log('Decoding stderr, length:', result.stderr.length);
      result.stderr = Buffer.from(result.stderr, 'base64').toString('utf8');
    }
    if (result.compile_output) {
      console.log('Decoding compile_output, length:', result.compile_output.length);
      result.compile_output = Buffer.from(result.compile_output, 'base64').toString('utf8');
    }
    if (result.message) {
      console.log('Decoding message, length:', result.message.length);
      result.message = Buffer.from(result.message, 'base64').toString('utf8');
    }
  } catch (bufferError) {
    console.error('Buffer decoding error:', bufferError);
    console.error('Buffer error details:', {
      message: bufferError instanceof Error ? bufferError.message : String(bufferError),
      stack: bufferError instanceof Error ? bufferError.stack : undefined,
      stdoutLength: result.stdout?.length,
      stderrLength: result.stderr?.length,
      compileOutputLength: result.compile_output?.length,
      messageLength: result.message?.length
    });
    console.error('Raw result:', JSON.stringify(result, null, 2));
    // Return the result with raw base64 fields if decoding fails
    return result;
  }
  
  return result;
}


