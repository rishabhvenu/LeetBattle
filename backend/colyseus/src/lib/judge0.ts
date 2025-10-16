const JUDGE0_URL = process.env.JUDGE0_URL || 'http://codeclashers-judge0:2358';

export async function submitToJudge0(language_id: number, source_code: string, stdin?: string) {
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
  
  // Decode base64 fields back to UTF-8
  if (result.stdout) {
    result.stdout = Buffer.from(result.stdout, 'base64').toString('utf8');
  }
  if (result.stderr) {
    result.stderr = Buffer.from(result.stderr, 'base64').toString('utf8');
  }
  if (result.compile_output) {
    result.compile_output = Buffer.from(result.compile_output, 'base64').toString('utf8');
  }
  if (result.message) {
    result.message = Buffer.from(result.message, 'base64').toString('utf8');
  }
  
  return result;
}


