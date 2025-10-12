const JUDGE0_URL = process.env.JUDGE0_URL || 'http://codeclashers-judge0:2358';

export async function submitToJudge0(language_id: number, source_code: string, stdin?: string) {
  const payload: any = { 
    language_id, 
    source_code,
  };
  
  if (stdin !== undefined) {
    payload.stdin = stdin;
  }
  
  const res = await fetch(`${JUDGE0_URL}/submissions?base64_encoded=false&wait=false`, {
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
  const res = await fetch(`${JUDGE0_URL}/submissions/${token}?base64_encoded=false&fields=*`);
  if (!res.ok) {
    const errorText = await res.text();
    console.error(`Judge0 poll failed: ${res.status}`, errorText);
    throw new Error(`Judge0 poll failed: ${res.status} - ${errorText}`);
  }
  return res.json();
}


