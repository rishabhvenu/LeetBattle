'use server';

import connectDB, { getMongoClient } from '../mongodb';
import { ObjectId } from 'mongodb';
import { tryToObjectId } from '../utilsObjectId';
import { ensureAdminAccess } from './shared';
import { adminLimiter, rateLimit, getClientIdentifier } from '../rateLimiter';
import { DB_NAME, ADMIN_GUARD_ERROR, AUTH_REQUIRED_ERROR } from './constants';
import type { SpecialInputConfig } from '@/types/db';
import {
  PROBLEM_REWRITE_PROMPT,
  PROBLEM_ARTIFACT_PROMPT,
  GENERATION_LANGUAGES,
  type GeneratedProblemPayload,
  type GeneratedArtifacts,
  type NormalizedSolutionLanguage,
  type NormalizedSolutionsMap,
  applyLinkedListCycleMetadata,
  normalizeArtifactSolutions,
  normalizeTestCaseOutputByReturnType,
  buildLeetCodeDetails,
  LEETCODE_GRAPHQL_ENDPOINT,
  LEETCODE_GRAPHQL_QUERY,
} from './problem/helpers';
import type { SpecialInputHint } from '@/types/admin';

function serializeProblemForAdmin(problem: any) {
  const createdAt = problem?.createdAt ? new Date(problem.createdAt) : new Date();
  const updatedAt = problem?.updatedAt ? new Date(problem.updatedAt) : createdAt;
  const verifiedAtValue = problem?.verifiedAt ? new Date(problem.verifiedAt) : null;

  return {
    ...problem,
    _id: problem?._id?.toString?.() ?? String(problem?._id ?? ''),
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
    verifiedAt: verifiedAtValue ? verifiedAtValue.toISOString() : null,
    verificationError: problem?.verificationError || [],
    verificationResults: problem?.verificationResults || null,
    allTestCases: problem?.allTestCases || null,
    failedTestCases: problem?.failedTestCases || null,
    specialInputs: problem?.specialInputs || [],
    solutions: normalizeArtifactSolutions(problem?.solutions),
    testCases: Array.isArray(problem?.testCases)
      ? problem.testCases.map((testCase: any) => ({
          input: testCase?.input ?? {},
          output: normalizeTestCaseOutputByReturnType(
            problem?.signature?.returnType,
            testCase?.output
          ),
          specialInputData: testCase?.specialInputData || undefined,
        }))
      : [],
  };
}

export async function fetchLeetCodeProblemDetails(url: string) {
  const adminError = await ensureAdminAccess();
  if (adminError) {
    return { success: false, error: adminError };
  }

  if (!url || typeof url !== 'string') {
    return { success: false, error: 'Please provide a LeetCode problem URL' };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return { success: false, error: 'Invalid LeetCode URL' };
  }

  const slugMatch = parsedUrl.pathname.match(/\/problems\/([a-z0-9-]+)/i);
  if (!slugMatch) {
    return { success: false, error: 'Could not extract the problem slug from the provided URL' };
  }

  const titleSlug = slugMatch[1].toLowerCase();

  try {
    const response = await fetch(LEETCODE_GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Referer: 'https://leetcode.com',
      },
      body: JSON.stringify({
        query: LEETCODE_GRAPHQL_QUERY,
        variables: { titleSlug },
      }),
      cache: 'no-store',
    });

    if (!response.ok) {
      return { success: false, error: `LeetCode request failed with status ${response.status}` };
    }

    const payload = (await response.json()) as {
      data?: { question?: { [key: string]: unknown } };
      errors?: Array<{ message?: string }>;
    };

    if (payload.errors && payload.errors.length > 0) {
      const message = payload.errors.map(err => err.message).filter(Boolean).join('; ') || 'Unknown error';
      return { success: false, error: message };
    }

    const details = buildLeetCodeDetails((payload.data?.question ?? {}) as {
      title?: string;
      difficulty?: string;
      content?: string;
      exampleTestcases?: string | null;
      exampleTestcaseList?: string[] | null;
    });

    if (!details) {
      return { success: false, error: 'Unable to parse LeetCode problem details' };
    }

    return { success: true, details };
  } catch (error) {
    console.error('Failed to fetch LeetCode problem details:', error);
    if (error instanceof Error && error.message) {
      return { success: false, error: error.message };
    }
    return { success: false, error: 'Failed to fetch LeetCode problem details' };
  }
}

export async function generateProblem(data: {
  title: string;
  description: string;
  examples: { input: string; output: string; explanation: string | null }[];
  constraints: string[];
  difficulty: 'Easy' | 'Medium' | 'Hard';
  timeComplexity: string;
  specialInputHint?: SpecialInputHint;
}) {
  const adminError = await ensureAdminAccess();
  if (adminError) {
    return { success: false, error: adminError };
  }

  const identifier = await getClientIdentifier();
  try {
    await rateLimit(adminLimiter, identifier);
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message };
  }

  const { title, description, examples, constraints, difficulty, timeComplexity, specialInputHint } = data;
  if (!title || !description || !Array.isArray(examples) || !Array.isArray(constraints)) {
    return { success: false, error: 'Invalid payload: title, description, examples, constraints required' };
  }

  try {
    console.log('[generateProblem] Incoming admin payload:', {
      title,
      description,
      examples,
      constraints,
      difficulty,
      timeComplexity,
    });

    const OpenAI = (await import('openai')).default;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const rewriteResponse = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: PROBLEM_REWRITE_PROMPT },
        { role: 'user', content: JSON.stringify({ title, description, examples, constraints }, null, 2) },
      ],
      temperature: 0.2,
      response_format: { type: 'json_object' },
    });

    const rewriteContent = rewriteResponse.choices[0]?.message?.content;
    if (!rewriteContent) {
      throw new Error('OpenAI returned empty rewrite response');
    }

    let generatedProblem: GeneratedProblemPayload;
    try {
      generatedProblem = JSON.parse(rewriteContent) as GeneratedProblemPayload;
    } catch (error) {
      throw new Error('Failed to parse rewrite response JSON');
    }

    console.log('[generateProblem] Rewritten problem from OpenAI:', {
      title: generatedProblem?.title,
      description: generatedProblem?.description,
      examples: generatedProblem?.examples,
      constraints: generatedProblem?.constraints,
      signature: generatedProblem?.signature,
    });

    if (!generatedProblem.signature || !generatedProblem.signature.functionName || !generatedProblem.signature.parameters || !generatedProblem.signature.returnType) {
      throw new Error('Rewrite response missing signature information');
    }

    const specialInputInstructions =
      specialInputHint && specialInputHint.type === 'linked_list_cycle'
        ? `Special input metadata:

- The function has a linked-list parameter "${specialInputHint.parameterName}" that may contain a cycle.
- For EVERY test case, include a numeric "pos" or "cycleIndex" field in the JSON "input" object
  alongside "${specialInputHint.parameterName}" (e.g., { "${specialInputHint.parameterName}": [...], "pos": 1 } or "pos": -1 when there is no cycle).
- Do NOT rename these fields; use "pos" or "cycleIndex" exactly so the runner can detect them.`
        : '';

    const artifactsResponse = await openai.chat.completions.create({
      // Use a stronger model for generating solutions and test cases
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: PROBLEM_ARTIFACT_PROMPT },
        ...(specialInputInstructions
          ? [{ role: 'system' as const, content: specialInputInstructions }]
          : []),
        {
          role: 'user',
          content: JSON.stringify(
            {
              problem: generatedProblem,
              languages: GENERATION_LANGUAGES,
              numTestCases: 15,
              maxInputSizeHint: 30,
              targetTimeComplexity: timeComplexity,
            },
            null,
            2
          ),
        },
      ],
      // Allow high diversity in artifacts generation
      temperature: 1,
      response_format: { type: 'json_object' },
    });

    const artifactContent = artifactsResponse.choices[0]?.message?.content;
    if (!artifactContent) {
      throw new Error('OpenAI returned empty artifacts response');
    }

    let artifacts: GeneratedArtifacts;
    try {
      artifacts = JSON.parse(artifactContent) as GeneratedArtifacts;
    } catch (error) {
      throw new Error('Failed to parse artifacts response JSON');
    }

    applyLinkedListCycleMetadata({ generatedProblem, artifacts });

    const normalizedSolutions = normalizeArtifactSolutions(artifacts.solutions);
    const testCases = Array.isArray(artifacts.testCases) ? artifacts.testCases : [];
    if (testCases.length === 0) {
      throw new Error('No test cases generated by OpenAI');
    }

    const normalizedTestCases = testCases.map((testCase) => ({
      input: testCase.input ?? {},
      output: normalizeTestCaseOutputByReturnType(
        generatedProblem.signature?.returnType,
        testCase.output
      ),
      specialInputData:
        testCase.specialInputData && Object.keys(testCase.specialInputData).length > 0
          ? testCase.specialInputData
          : undefined,
    }));

    const specialInputs = generatedProblem.specialInputs || artifacts.specialInputs || [];

    await connectDB();
    const client = await getMongoClient();
    const db = client.db(DB_NAME);
    const problemsCollection = db.collection('problems');

    const now = new Date();
    const problemDocument = {
      ...generatedProblem,
      topics: Array.isArray(generatedProblem.topics) ? generatedProblem.topics : [],
      examples: Array.isArray(generatedProblem.examples) ? generatedProblem.examples : [],
      constraints: Array.isArray(generatedProblem.constraints) ? generatedProblem.constraints : [],
      specialInputs,
      difficulty,
      timeComplexity,
      solutions: normalizedSolutions,
      testCases: normalizedTestCases,
      createdAt: now,
      updatedAt: now,
      verified: false,
    };

    console.log('[generateProblem] Final problemDocument to insert:', {
      title: problemDocument.title,
      description: problemDocument.description,
      examples: problemDocument.examples,
      constraints: problemDocument.constraints,
      signature: problemDocument.signature,
      difficulty: problemDocument.difficulty,
      timeComplexity: problemDocument.timeComplexity,
    });

    const insertResult = await problemsCollection.insertOne(problemDocument as any);

    return {
      success: true,
      problemId: insertResult.insertedId.toString(),
      problem: {
        ...problemDocument,
        _id: insertResult.insertedId.toString(),
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
      verified: false,
      verificationSummary: 'Problem stored - verification pending',
    };
  } catch (error: unknown) {
    console.error('Error generating problem:', error);
    return { success: false, error: (error as Error).message || 'Failed to generate problem' };
  }
}

export async function legacyGenerateProblem(data: {
  title: string;
  description: string;
  examples: { input: string; output: string; explanation: string | null }[];
  constraints: string[];
  difficulty: 'Easy' | 'Medium' | 'Hard';
  timeComplexity: string;
}) {
  return generateProblem(data);
}

/**
 * Verify an existing problem's solutions against test cases
 */
export async function verifyProblemSolutions(problemId: string) {
  const adminError = await ensureAdminAccess();
  if (adminError) {
    return { success: false, error: adminError };
  }

  // Rate limiting for admin operations
  const identifier = await getClientIdentifier();
  try {
    await rateLimit(adminLimiter, identifier);
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message };
  }

  try {
    console.log(`Verifying problem ${problemId}...`);
    
    // Get the problem from MongoDB
    await connectDB();
    const client = await getMongoClient();
    
    const db = client.db(DB_NAME);
    const problemsCollection = db.collection('problems');

    const problem = await problemsCollection.findOne({ 
      _id: new ObjectId(problemId) 
    });

    if (!problem) {
      return { success: false, error: 'Problem not found' };
    }

    if (!problem.signature || !problem.solutions || !problem.testCases) {
      return { success: false, error: 'Problem missing signature, solutions, or test cases' };
    }

    const normalizedSolutions = normalizeArtifactSolutions(problem.solutions);
    const rawSolutionsJson = JSON.stringify(problem.solutions ?? {});
    const normalizedSolutionsJson = JSON.stringify(normalizedSolutions);

    if (normalizedSolutionsJson !== rawSolutionsJson) {
      await problemsCollection.updateOne(
        { _id: new ObjectId(problemId) },
        { $set: { solutions: normalizedSolutions } }
      );
      problem.solutions = normalizedSolutions;
    }

    const requiredLanguages: NormalizedSolutionLanguage[] = ['python', 'js', 'java', 'cpp'];
    const missingLanguages = requiredLanguages.filter((lang) => !normalizedSolutions[lang]);
    if (missingLanguages.length > 0) {
      return {
        success: false,
        error: `Missing solutions for required languages: ${missingLanguages.join(', ')}`
      };
    }

    const validationSolutions: { python: string; js: string; java: string; cpp: string } = {
      python: normalizedSolutions.python!,
      js: normalizedSolutions.js!,
      java: normalizedSolutions.java!,
      cpp: normalizedSolutions.cpp!,
    };

    // Call Colyseus validation endpoint
    const COLYSEUS_URL = process.env.NEXT_PUBLIC_COLYSEUS_HTTP_URL || 'http://localhost:2567';
    
    // Forward session cookie to backend for admin auth (Edge operation via dynamic import)
    const { getSessionCookie } = await import('../session-edge');
    const sessionId = await getSessionCookie();
    const cookieHeader = sessionId ? `codeclashers.sid=${sessionId}` : '';
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    
    let validationResponse: Response;
    try {
      validationResponse = await fetch(`${COLYSEUS_URL}/admin/validate-solutions`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...(cookieHeader ? { Cookie: cookieHeader } : {}),
        },
        credentials: 'include',
        body: JSON.stringify({
          signature: problem.signature,
          solutions: validationSolutions,
          testCases: problem.testCases,
          specialInputs: problem.specialInputs || []
        }),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timeout);
      const reason =
        error instanceof Error && error.name === 'AbortError'
          ? 'Verification request timed out after 60 seconds'
          : (error as Error).message;
      return {
        success: false,
        error: `Validation request failed: ${reason}`,
      };
    } finally {
      clearTimeout(timeout);
    }
 
    if (!validationResponse.ok) {
      return {
        success: false,
        error: `Validation endpoint error: ${validationResponse.status} ${validationResponse.statusText}`
      };
    }
 
    const validationResult = await validationResponse.json();
    console.log('Validation result received:', JSON.stringify(validationResult, null, 2));

    // Update problem with verification status (whether success or failure)
    await connectDB();
    const updateClient = await getMongoClient();
    
    const updateDb = updateClient.db(DB_NAME);
    const updateProblemsCollection = updateDb.collection('problems');

    // Extract test case details for each language (both passed and failed)
    const allTestCases: Record<string, Array<{
      testNumber: number;
    input: unknown;
    expected: unknown;
    actual: unknown;
      error?: string;
      passed: boolean;
    }>> = {};

    const failedTestCases: Record<string, Array<{
      testNumber: number;
    input: unknown;
    expected: unknown;
    actual: unknown;
      error?: string;
    }>> = {};

    for (const [lang, result] of Object.entries(validationResult.results)) {
      const langResult = result as { results?: Array<{ testNumber?: number; testCase?: { input?: unknown }; expected?: unknown; actual?: unknown; error?: string; passed: boolean }> };
      console.log(`Processing ${lang} results:`, JSON.stringify(langResult, null, 2));
      if (langResult.results) {
        const allTests = langResult.results
          .map((r) => ({
            testNumber: r.testNumber || 0,
            input: r.testCase?.input,
            expected: (r.testCase as { output?: unknown })?.output,
            actual: (r as { actualOutput?: unknown }).actualOutput,
            error: (r as { error?: string }).error,
            passed: (r as { passed?: boolean }).passed || false,
          }));
        
        const failed = allTests.filter((r) => !r.passed);
        
        allTestCases[lang] = allTests;
        console.log(`All tests for ${lang}:`, allTests);
        console.log(`Failed tests for ${lang}:`, failed);
        
        if (failed.length > 0) {
          failedTestCases[lang] = failed;
        }
      }
    }
    
    console.log('Final allTestCases:', JSON.stringify(allTestCases, null, 2));
    console.log('Final failedTestCases:', JSON.stringify(failedTestCases, null, 2));

    if (!validationResult.success) {
      // Store failure details so user can see what went wrong
      await updateProblemsCollection.updateOne(
        { _id: new ObjectId(problemId) },
        { 
          $set: { 
            verified: false,
            verifiedAt: new Date(),
            verificationResults: validationResult.results,
            verificationError: validationResult.details || [],
            allTestCases, // Store ALL test case details
            failedTestCases, // Store specific failed test details
          }
        }
      );

      return {
        success: false,
        error: 'Solution verification failed: ' + (validationResult.details || []).join('; '),
        details: validationResult.details,
        results: validationResult.results,
        allTestCases,
        failedTestCases,
      };
    }

    // Success case - still store all test case details
    await updateProblemsCollection.updateOne(
      { _id: new ObjectId(problemId) },
      { 
        $set: { 
          verified: true,
          verifiedAt: new Date(),
          verificationResults: validationResult.results,
          verificationError: null,
          allTestCases, // Store ALL test case details even on success
          failedTestCases: null, // Clear failed test cases on success
        }
      }
    );

    return {
      success: true,
      message: 'All solutions verified successfully',
      results: validationResult.results
    };

  } catch (error: unknown) {
    console.error('Error verifying problem:', error);
    return {
      success: false,
      error: (error as Error).message || 'Failed to verify problem'
    };
  }
}

/**
 * Fetch all unverified problems from the database
 */
export async function getUnverifiedProblems() {
  const adminError = await ensureAdminAccess();
  if (adminError) {
    throw new Error(adminError);
  }

  try {
    await connectDB();
    const client = await getMongoClient();
    
    const db = client.db(DB_NAME);
    const problemsCollection = db.collection('problems');
    
    // Find all problems that are either not verified or explicitly marked as unverified
    const unverifiedProblems = await problemsCollection
      .find({ 
        $or: [
          { verified: { $exists: false } },
          { verified: false }
        ]
      })
      .sort({ createdAt: -1 }) // Most recent first
      .toArray();


    // Serialize ObjectIds and Dates for client components
    return unverifiedProblems.map(serializeProblemForAdmin);
  } catch (error: unknown) {
    console.error('Error fetching unverified problems:', error);
    if (
      error instanceof Error &&
      (error.message === ADMIN_GUARD_ERROR || error.message === AUTH_REQUIRED_ERROR)
    ) {
      throw error;
    }
    return [];
  }
}

/**
 * Get a single problem by ID for editing
 */
export async function getProblemById(problemId: string) {
  const adminError = await ensureAdminAccess();
  if (adminError) {
    throw new Error(adminError);
  }

  try {
    await connectDB();
    const client = await getMongoClient();
    
    const db = client.db(DB_NAME);
    const problemsCollection = db.collection('problems');
    
    const problem = await problemsCollection.findOne({ 
      _id: new ObjectId(problemId) 
    });


    if (!problem) {
      return null;
    }

    // Serialize ObjectIds and Dates for client components
    return {
      ...problem,
      _id: problem._id.toString(),
      createdAt: problem.createdAt.toISOString(),
      updatedAt: problem.updatedAt.toISOString(),
      verifiedAt: problem.verifiedAt?.toISOString() || null,
      verificationError: problem.verificationError || [],
      verificationResults: problem.verificationResults || null,
      failedTestCases: problem.failedTestCases || null,
      specialInputs: problem.specialInputs || [],
      testCases: (problem.testCases || []).map((testCase: any) => ({
        input: testCase.input,
        output: testCase.output,
        specialInputData: testCase.specialInputData || undefined,
      })),
    };
  } catch (error: unknown) {
    console.error('Error fetching problem:', error);
    if (
      error instanceof Error &&
      (error.message === ADMIN_GUARD_ERROR || error.message === AUTH_REQUIRED_ERROR)
    ) {
      throw error;
    }
    return null;
  }
}

/**
 * Update a problem's test cases and/or solutions
 */
export async function updateProblem(problemId: string, updates: {
  testCases?: Array<{ input: Record<string, unknown>; output: unknown; specialInputData?: Record<string, Record<string, unknown>> }>;
  solutions?: { python?: string; cpp?: string; java?: string; js?: string };
  signature?: {
    functionName: string;
    parameters: Array<{ name: string; type: string }>;
    returnType: string;
    comparisonMode?: 'strict' | 'unordered' | 'set' | 'custom';
    customComparator?: string;
  };
  specialInputs?: SpecialInputConfig[];
}) {
  const adminError = await ensureAdminAccess();
  if (adminError) {
    return { success: false, error: adminError };
  }

  try {
    await connectDB();
    const client = await getMongoClient();
    
    const db = client.db(DB_NAME);
    const problemsCollection = db.collection('problems');

    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (updates.testCases) {
      updateData.testCases = updates.testCases;
    }

    if (updates.solutions) {
      updateData.solutions = updates.solutions;
    }

    if (updates.signature) {
      updateData.signature = updates.signature;
    }

    if (updates.specialInputs) {
      updateData.specialInputs = updates.specialInputs;
    }

    await problemsCollection.updateOne(
      { _id: new ObjectId(problemId) },
      { $set: updateData }
    );


    return { success: true };
  } catch (error: unknown) {
    console.error('Error updating problem:', error);
    return { success: false, error: (error as Error).message };
  }
}

export async function getVerifiedProblems(limit: number = 100) {
  const adminError = await ensureAdminAccess();
  if (adminError) {
    throw new Error(adminError);
  }

  try {
    await connectDB();
    const client = await getMongoClient();

    const db = client.db(DB_NAME);
    const problemsCollection = db.collection('problems');

    const verifiedProblems = await problemsCollection
      .find({ verified: true })
      .sort({ updatedAt: -1 })
      .limit(Math.max(1, limit))
      .toArray();

    return verifiedProblems.map(serializeProblemForAdmin);
  } catch (error: unknown) {
    console.error('Error fetching verified problems:', error);
    if (
      error instanceof Error &&
      (error.message === ADMIN_GUARD_ERROR || error.message === AUTH_REQUIRED_ERROR)
    ) {
      throw error;
    }
    return [];
  }
}

export async function deleteProblem(problemId: string) {
  const adminError = await ensureAdminAccess();
  if (adminError) {
    return { success: false, error: adminError };
  }

  const objectId = tryToObjectId(problemId);
  if (!objectId) {
    return { success: false, error: 'Invalid problem ID' };
  }

  try {
    await connectDB();
    const client = await getMongoClient();

    const db = client.db(DB_NAME);
    const problemsCollection = db.collection('problems');

    const result = await problemsCollection.deleteOne({ _id: objectId });

    if (result.deletedCount === 0) {
      return { success: false, error: 'Problem not found' };
    }

    return { success: true };
  } catch (error: unknown) {
    console.error('Error deleting problem:', error);
    return { success: false, error: (error as Error).message };
  }
}

