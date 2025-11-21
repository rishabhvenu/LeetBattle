/*
 * Manual verification helper to debug C++ runner generation
 */

const { MongoClient, ObjectId } = require('mongodb');

async function main() {
  const uri = process.env.MONGODB_URI || 'mongodb://admin:admin123@localhost:27017/codeclashers?authSource=admin';
  console.log('Connecting to MongoDB:', uri.replace(/admin:.*@/, 'admin:***@'));

  const client = new MongoClient(uri);
  await client.connect();

  try {
    const db = client.db('codeclashers');

    // Find problem by title or signature
    const problem = await db.collection('problems').findOne({ 'signature.functionName': 'findTwoSumIndices' });
    if (!problem) {
      console.error('Problem not found');
      return;
    }

    console.log('Loaded problem:', problem._id.toString(), problem.title);

    const { executeAllTestCases } = require('../dist/lib/testExecutor');
    const { prepareTestCasesForExecution } = require('../dist/lib/specialInputs');

    const languageMap = {
      python: 'python',
      js: 'javascript',
      java: 'java',
      cpp: 'cpp',
    };

    const aggregateResults = {};
    const allTestCases = {};
    const failedTestCases = {};

    let allPassed = true;

    const preparedTestCases = prepareTestCasesForExecution(
      problem.testCases || [],
      problem.specialInputs || problem.specialInputConfigs || []
    );

    for (const [langKey, langValue] of Object.entries(languageMap)) {
      const solution = problem.solutions?.[langKey];
      if (!solution) {
        console.warn(`Skipping ${langKey} - no solution found`);
        allPassed = false;
        continue;
      }

      console.log(`Running verification for ${langKey}...`);
      const result = await executeAllTestCases(langValue, solution, problem.signature, preparedTestCases);
      aggregateResults[langKey] = result;
      if (!result.allPassed) {
        allPassed = false;
      }

      if (result.results) {
        const tests = result.results.map((r) => ({
          testNumber: r.testNumber ?? 0,
          input: r.testCase?.input,
          expected: r.testCase?.output,
          actual: r.actualOutput,
          error: r.error,
          passed: r.passed,
        }));
        allTestCases[langKey] = tests;
        const failed = tests.filter((t) => !t.passed);
        if (failed.length > 0) {
          failedTestCases[langKey] = failed;
        }
      }
    }

    console.log('Aggregate verification results:', JSON.stringify(aggregateResults, null, 2));

    const update = {
      verified: allPassed,
      verifiedAt: new Date(),
      verificationResults: aggregateResults,
      verificationError: allPassed ? null : Object.entries(aggregateResults)
        .filter(([_, res]) => !res.allPassed)
        .map(([lang, res]) => `${lang} solution failed ${res.failedTests}/${res.totalTests} tests`),
      allTestCases,
      failedTestCases: allPassed ? null : failedTestCases,
    };

    await db.collection('problems').updateOne(
      { _id: new ObjectId(problem._id) },
      { $set: update }
    );

    console.log('Problem document updated with verification results.');
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error('Manual verification error:', err);
  process.exit(1);
});


