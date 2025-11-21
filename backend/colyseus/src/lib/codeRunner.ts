/**
 * Code Runner Module
 * Generates runnable code by wrapping Solution classes with test harness
 */

import {
  hasComplexDataTypes,
  getHelpersForLanguage,
  isListNodeType,
  isTreeNodeType,
} from './dataStructureHelpers';
import type { RuntimeSpecialInput } from './specialInputs';

interface FunctionSignature {
  functionName: string;
  parameters: Array<{ name: string; type: string }>;
  returnType: string;
}

interface RunnerTestCase {
  input: Record<string, unknown>;
  output: unknown;
  runtimeSpecialInputs?: RuntimeSpecialInput[];
}

interface LinkedListCycleInstruction {
  parameter: string;
  cycleIndex: number;
}

interface PreparedTestCase {
  input: Record<string, unknown>;
  output: unknown;
  linkedListCycles?: LinkedListCycleInstruction[];
}

function toPreparedTestCases(testCases: RunnerTestCase[]): PreparedTestCase[] {
  return testCases.map((testCase) => {
    const linkedListCycles = (testCase.runtimeSpecialInputs || [])
      .filter((instruction) => instruction.type === 'linked_list_cycle')
      .flatMap((instruction) =>
        instruction.targets
          .filter((target) => typeof target.cycleIndex === 'number' && target.cycleIndex !== undefined)
          .map((target) => ({
            parameter: target.parameter,
            cycleIndex: Number(target.cycleIndex),
          }))
      )
      .filter((entry) => Number.isFinite(entry.cycleIndex) && entry.cycleIndex >= 0);

    const prepared: PreparedTestCase = {
      input: testCase.input,
      output: testCase.output,
    };

    if (linkedListCycles.length > 0) {
      prepared.linkedListCycles = linkedListCycles;
    }

    return prepared;
  });
}

function getLinkedListCyclePositions(testCase: RunnerTestCase, parameter: string): number[] {
  return (testCase.runtimeSpecialInputs || [])
    .filter((instruction) => instruction.type === 'linked_list_cycle')
    .flatMap((instruction) => instruction.targets)
    .filter((target) => target.parameter === parameter && Number.isFinite(target.cycleIndex))
    .map((target) => Number(target.cycleIndex))
    .filter((cycleIndex) => cycleIndex >= 0);
}

function buildPythonCycleAttachment(listNodeParams: string[]): string {
  if (listNodeParams.length === 0) {
    return '';
  }

  const conditions = listNodeParams
    .map((name, idx) => {
      const keyword = idx === 0 ? 'if' : 'elif';
      return `            ${keyword} name == "${name}":\n                ${name} = attach_cycle(${name}, index)\n`;
    })
    .join('');

  return `
        linked_list_cycles = test_case.get("linkedListCycles") or []
        for cycle in linked_list_cycles:
            name = cycle.get("parameter")
            index = cycle.get("cycleIndex", -1)
            if index is None or index < 0:
                continue
${conditions}`;
}

function buildJavaScriptCycleAttachment(listNodeParams: string[]): string {
  if (listNodeParams.length === 0) {
    return '';
  }

  const conditions = listNodeParams
    .map((name, idx) => {
      const keyword = idx === 0 ? 'if' : 'else if';
      return `        ${keyword} (name === "${name}") {\n            ${name} = attachCycle(${name}, index);\n        }\n`;
    })
    .join('');

  return `
    const linkedListCycles = Array.isArray(testCase.linkedListCycles) ? testCase.linkedListCycles : [];
    for (const cycle of linkedListCycles) {
        const name = cycle.parameter;
        const index = typeof cycle.cycleIndex === 'number' ? cycle.cycleIndex : -1;
        if (index < 0) {
            continue;
        }
${conditions}        else {
            continue;
        }
    }
`;
}

function wrapJavaListNodeExpression(expression: string, cyclePositions: number[]): string {
  if (!cyclePositions || cyclePositions.length === 0) {
    return expression;
  }

  const cycleIndex = cyclePositions[cyclePositions.length - 1];
  return `ListHelper.attachCycle(${expression}, ${cycleIndex})`;
}

function buildCppCycleAttachment(variableName: string, cyclePositions: number[]): string {
  if (!cyclePositions || cyclePositions.length === 0) {
    return '';
  }

  const cycleIndex = cyclePositions[cyclePositions.length - 1];
  return `
    ${variableName} = attachCycle(${variableName}, ${cycleIndex});`;
}

/**
 * Generate Python runner code
 */
export function generatePythonRunner(
  solutionCode: string,
  signature: FunctionSignature,
  testInput: Record<string, unknown>
): string {
  const { functionName, parameters, returnType } = signature;
  
  // Check if we need helper functions for complex data types
  const needsHelpers = hasComplexDataTypes(signature);
  const helpers = needsHelpers ? getHelpersForLanguage('python') : '';
  
  // Build function call arguments from test input with deserialization
  const args = parameters.map(param => {
    if (isListNodeType(param.type)) {
      return `deserialize_list(input_data["${param.name}"])`;
    } else if (isTreeNodeType(param.type)) {
      return `deserialize_tree(input_data["${param.name}"])`;
    } else {
      return `input_data["${param.name}"]`;
    }
  }).join(', ');
  
  // Handle output serialization
  let outputSerialization = 'result';
  if (isListNodeType(returnType)) {
    outputSerialization = 'serialize_list(result)';
  } else if (isTreeNodeType(returnType)) {
    outputSerialization = 'serialize_tree(result)';
  }
  
  return `${helpers}
${solutionCode}

import json
import sys

# Test runner
if __name__ == "__main__":
    solution = Solution()
    input_data = ${JSON.stringify(testInput)}
    result = solution.${functionName}(${args})
    print(json.dumps(${outputSerialization}))
`;
}

/**
 * Generate JavaScript runner code
 */
export function generateJavaScriptRunner(
  solutionCode: string,
  signature: FunctionSignature,
  testInput: Record<string, unknown>
): string {
  const { functionName, parameters, returnType } = signature;
  
  // Check if we need helper functions for complex data types
  const needsHelpers = hasComplexDataTypes(signature);
  const helpers = needsHelpers ? getHelpersForLanguage('javascript') : '';
  
  // Build function call arguments from test input with deserialization
  const args = parameters.map(param => {
    if (isListNodeType(param.type)) {
      return `deserializeList(input.${param.name})`;
    } else if (isTreeNodeType(param.type)) {
      return `deserializeTree(input.${param.name})`;
    } else {
      return `input.${param.name}`;
    }
  }).join(', ');
  
  // Handle output serialization
  let outputSerialization = 'result';
  if (isListNodeType(returnType)) {
    outputSerialization = 'serializeList(result)';
  } else if (isTreeNodeType(returnType)) {
    outputSerialization = 'serializeTree(result)';
  }
  
  return `${helpers}
${solutionCode}

// Test runner
const solution = new Solution();
const input = ${JSON.stringify(testInput)};
const result = solution.${functionName}(${args});
console.log(JSON.stringify(${outputSerialization}));
`;
}

/**
 * Generate Java runner code
 */
export function generateJavaRunner(
  solutionCode: string,
  signature: FunctionSignature,
  testInput: Record<string, unknown>
): string {
  const { functionName, parameters, returnType } = signature;
  
  // Check if we need helper functions for complex data types
  const needsHelpers = hasComplexDataTypes(signature);
  const helpers = needsHelpers ? getHelpersForLanguage('java') : '';
  
  // Map type names to Java types (case-insensitive). Only wrap primitives inside List<>.
  const mapType = (type: string): string => {
    const normalized = type.replace(/\s+/g, '');
    const lower = normalized.toLowerCase();

    // Direct primitives and arrays remain as-is (valid Java types already mapped elsewhere)
    const directMap: Record<string, string> = {
      'int[]': 'int[]',
      'string[]': 'String[]',
      'double[]': 'double[]',
      'float[]': 'float[]',
      'long[]': 'long[]',
      'boolean[]': 'boolean[]',
      'char[]': 'char[]',
      'byte[]': 'byte[]',
      'short[]': 'short[]',
      'int': 'int',
      'string': 'String',
      'boolean': 'boolean',
      'double': 'double',
      'float': 'float',
      'long': 'long',
      'char': 'char',
      'byte': 'byte',
      'short': 'short',
      'listnode': 'ListNode',
      'treenode': 'TreeNode',
    };
    if (directMap[lower]) return directMap[lower];

    // If it's a List<...>, ensure primitives inside are wrapped (Integer, Boolean, etc.)
    const listMatch = lower.match(/^list<(.+)>$/);
    if (listMatch) {
      const innerRaw = listMatch[1];
      // Handle nested lists recursively
      if (/^list<.+>$/.test(innerRaw)) {
        const mappedInner = mapType(innerRaw.replace(/^list</, 'List<'));
        return `List<${mappedInner}>`;
      }
      // Map primitive to wrapper inside List
      const wrapperMap: Record<string, string> = {
        'int': 'Integer',
        'integer': 'Integer',
        'string': 'String',
        'boolean': 'Boolean',
        'double': 'Double',
        'float': 'Float',
        'long': 'Long',
        'char': 'Character',
        'byte': 'Byte',
        'short': 'Short',
      };
      const wrapped = wrapperMap[innerRaw] || innerRaw;
      return `List<${wrapped}>`;
    }

    // If it's already using proper Java generics but with capitalized List, normalize case
    if (normalized.startsWith('List<')) {
      // Extract inner and map recursively to enforce wrappers
      const inner = normalized.slice(5, -1);
      // Reuse logic by converting to lower-case list<> form first
      return mapType(`list<${inner}>`);
    }

    return type; // Fallback untouched
  };

  const javaReturnType = mapType(returnType);

  // Helper to detect Java List types
  const isJavaList = (type: string) => /^list<.+>$/i.test(type.replace(/\s+/g, ''));
  const isJavaNestedList = (type: string) => /^list<\s*list<.+>\s*>$/i.test(type.replace(/\s+/g, ''));
  const getJavaInnerType = (type: string) => {
    const match = type.replace(/\s+/g, '').match(/list<(.+)>/i);
    return match ? match[1] : type;
  };

  // Generate input parsing and function call
  const inputParsing = parameters.map((param, idx) => {
    const javaType = mapType(param.type);
    
    // Handle complex data types
    if (isListNodeType(param.type)) {
      return `        ListNode ${param.name} = ListHelper.deserializeList((List<Integer>) input.get("${param.name}"));`;
    } else if (isTreeNodeType(param.type)) {
      return `        TreeNode ${param.name} = TreeHelper.deserializeTree((List<Integer>) input.get("${param.name}"));`;
    }
    // Handle Java List types
    else if (isJavaList(param.type)) {
      const inner = getJavaInnerType(param.type).toLowerCase();
      if (isJavaNestedList(param.type)) {
        // For List<List<...>>, we need to parse nested arrays
        return `        List<List<Integer>> ${param.name} = parseNestedIntegerList(input.get("${param.name}"));`;
      } else {
        // For List<...>, parse as single array
        if (inner === 'int' || inner === 'integer') {
          return `        List<Integer> ${param.name} = parseIntegerList(input.get("${param.name}"));`;
        } else if (inner === 'string') {
          return `        List<String> ${param.name} = parseStringList(input.get("${param.name}"));`;
        }
      }
    }
    // Handle different primitive types
    else if (param.type.toLowerCase().includes('int[]')) {
      return `        int[] ${param.name} = parseIntArray(input.get("${param.name}"));`;
    } else if (param.type.toLowerCase().includes('string[]')) {
      return `        String[] ${param.name} = parseStringArray(input.get("${param.name}"));`;
    } else if (param.type.toLowerCase() === 'int') {
      return `        int ${param.name} = ((Number) input.get("${param.name}")).intValue();`;
    } else if (param.type.toLowerCase() === 'string') {
      return `        String ${param.name} = (String) input.get("${param.name}");`;
    } else if (param.type.toLowerCase() === 'boolean') {
      return `        boolean ${param.name} = (Boolean) input.get("${param.name}");`;
    }
    return `        ${javaType} ${param.name} = (${javaType}) input.get("${param.name}");`;
  }).join('\n');

  const args = parameters.map(param => param.name).join(', ');
  
  // Handle output serialization
  let outputSerialization = 'gson.toJson(result)';
  if (isListNodeType(returnType)) {
    outputSerialization = 'gson.toJson(ListHelper.serializeList(result))';
  } else if (isTreeNodeType(returnType)) {
    outputSerialization = 'gson.toJson(TreeHelper.serializeTree(result))';
  } else if (isJavaNestedList(returnType)) {
    // Print List<List<...>> as JSON-like [[...],[...]]
    outputSerialization = 'serializeNestedList(result)';
  } else if (isJavaList(returnType)) {
    // Print List<...> as JSON-like [a,b,c]
    outputSerialization = 'serializeList(result)';
  }

  return `import com.google.gson.Gson;
import com.google.gson.reflect.TypeToken;
import java.util.*;

${helpers}
${solutionCode}

public class Main {
    public static void main(String[] args) {
        Gson gson = new Gson();
        String inputJson = ${JSON.stringify(JSON.stringify(testInput))};
        Map<String, Object> input = gson.fromJson(inputJson, new TypeToken<Map<String, Object>>(){}.getType());
        
${inputParsing}
        
        Solution solution = new Solution();
        ${javaReturnType} result = solution.${functionName}(${args});
        
        System.out.println(${outputSerialization});
    }
    
    private static int[] parseIntArray(Object obj) {
        List<Number> list = (List<Number>) obj;
        int[] arr = new int[list.size()];
        for (int i = 0; i < list.size(); i++) {
            arr[i] = list.get(i).intValue();
        }
        return arr;
    }
    
    private static String[] parseStringArray(Object obj) {
        List<String> list = (List<String>) obj;
        return list.toArray(new String[0]);
    }
    
    private static List<Integer> parseIntegerList(Object obj) {
        List<Number> list = (List<Number>) obj;
        List<Integer> result = new ArrayList<>();
        for (Number num : list) {
            result.add(num.intValue());
        }
        return result;
    }
    
    private static List<String> parseStringList(Object obj) {
        return (List<String>) obj;
    }
    
    private static List<List<Integer>> parseNestedIntegerList(Object obj) {
        List<List<Number>> outerList = (List<List<Number>>) obj;
        List<List<Integer>> result = new ArrayList<>();
        for (List<Number> innerList : outerList) {
            List<Integer> innerResult = new ArrayList<>();
            for (Number num : innerList) {
                innerResult.add(num.intValue());
            }
            result.add(innerResult);
        }
        return result;
    }
    
    private static String serializeList(List<?> list) {
        StringBuilder sb = new StringBuilder();
        sb.append("[");
        for (int i = 0; i < list.size(); i++) {
            Object val = list.get(i);
            if (val instanceof String) {
                sb.append("\\"").append(val).append("\\"");
            } else {
                sb.append(String.valueOf(val));
            }
            if (i < list.size() - 1) sb.append(",");
        }
        sb.append("]");
        return sb.toString();
    }
    
    private static String serializeNestedList(List<?> outerList) {
        StringBuilder sb = new StringBuilder();
        sb.append("[");
        for (int i = 0; i < outerList.size(); i++) {
            List<?> innerList = (List<?>) outerList.get(i);
            sb.append("[");
            for (int j = 0; j < innerList.size(); j++) {
                Object val = innerList.get(j);
                if (val instanceof String) {
                    sb.append("\\"").append(val).append("\\"");
                } else {
                    sb.append(String.valueOf(val));
                }
                if (j < innerList.size() - 1) sb.append(",");
            }
            sb.append("]");
            if (i < outerList.size() - 1) sb.append(",");
        }
        sb.append("]");
        return sb.toString();
    }
}
`;
}

/**
 * Generate C++ runner code
 */
export function generateCppRunner(
  solutionCode: string,
  signature: FunctionSignature,
  testInput: Record<string, unknown>
): string {
  const { functionName, parameters, returnType } = signature;
  
  // Check if we need helper functions for complex data types
  const needsHelpers = hasComplexDataTypes(signature);
  const helpers = needsHelpers ? getHelpersForLanguage('cpp') : '';
  
  // Map type names to C++ types
  const mapType = (type: string): string => {
    const normalizedType = type.replace(/\s+/g, '');
    const typeMap: Record<string, string> = {
      'int[]': 'vector<int>',
      'string[]': 'vector<string>',
      'int': 'int',
      'string': 'string',
      'boolean': 'bool',
      'double': 'double',
      'float': 'float',
      'long': 'long',
      'ListNode': 'ListNode*',
      'TreeNode': 'TreeNode*',
      // Add List types mapping to C++ vectors
      'list<int>': 'vector<int>',
      'list<string>': 'vector<string>',
      'list<list<int>>': 'vector<vector<int>>',
      'list<list<string>>': 'vector<vector<string>>',
      'List<int>': 'vector<int>',
      'List<string>': 'vector<string>',
      'List<List<int>>': 'vector<vector<int>>',
      'List<List<string>>': 'vector<vector<string>>',
    };
    return typeMap[normalizedType.toLowerCase()] || type;
  };

  const cppReturnType = mapType(returnType);

  // Generate input parsing
  const inputParsing = parameters.map((param, idx) => {
    const cppType = mapType(param.type);
    
    // Handle complex data types
    if (isListNodeType(param.type)) {
      return `    ListNode* ${param.name} = deserializeList(input["${param.name}"].get<vector<int>>());`;
    } else if (isTreeNodeType(param.type)) {
      return `    TreeNode* ${param.name} = deserializeTree(input["${param.name}"].get<vector<int>>());`;
    }
    // Handle primitive types
    else if (param.type.toLowerCase().includes('int[]')) {
      return `    vector<int> ${param.name} = input["${param.name}"].get<vector<int>>();`;
    } else if (param.type.toLowerCase().includes('string[]')) {
      return `    vector<string> ${param.name} = input["${param.name}"].get<vector<string>>();`;
    } else if (param.type.toLowerCase() === 'int') {
      return `    int ${param.name} = input["${param.name}"].get<int>();`;
    } else if (param.type.toLowerCase() === 'string') {
      return `    string ${param.name} = input["${param.name}"].get<string>();`;
    } else if (param.type.toLowerCase() === 'boolean') {
      return `    bool ${param.name} = input["${param.name}"].get<bool>();`;
    }
    return `    ${cppType} ${param.name} = input["${param.name}"].get<${cppType}>();`;
  }).join('\n');

  const args = parameters.map(param => param.name).join(', ');
  
  // Handle output serialization
  let outputSerialization = 'result';
  if (isListNodeType(returnType)) {
    outputSerialization = 'serializeList(result)';
  } else if (isTreeNodeType(returnType)) {
    outputSerialization = 'serializeTree(result)';
  } else if (cppReturnType.includes('vector<vector')) {
    // Handle nested vectors (e.g., vector<vector<int>>)
    outputSerialization = `[&]() {
      cout << "[";
      for (int i = 0; i < result.size(); i++) {
        cout << "[";
        for (int j = 0; j < result[i].size(); j++) {
          cout << result[i][j];
          if (j < result[i].size() - 1) cout << ",";
        }
        cout << "]";
        if (i < result.size() - 1) cout << ",";
      }
      cout << "]";
      return json::array();
    }()`;
  } else if (cppReturnType.includes('vector')) {
    // Handle single vectors (e.g., vector<int>)
    outputSerialization = `[&]() {
      cout << "[";
      for (int i = 0; i < result.size(); i++) {
        cout << result[i];
        if (i < result.size() - 1) cout << ",";
      }
      cout << "]";
      return json::array();
    }()`;
  }

  const printsDirectly = outputSerialization.includes('cout');
  const finalCppPrint = cppReturnType === 'bool'
    ? 'cout << serializeBool(result) << endl;'
    : printsDirectly
      ? outputSerialization
      : `json output = ${outputSerialization};
    cout << output.dump() << endl;`;
 
  return `#include <iostream>
#include <vector>
#include <string>
#include <queue>
#include <algorithm>
#include <unordered_map>
#include <unordered_set>
#include <map>
#include <set>
#include <nlohmann/json.hpp>

using json = nlohmann::json;
using namespace std;

${helpers}
${solutionCode}

int main() {
    string input_str = R"(${JSON.stringify(testInput)})";
    json input = json::parse(input_str);
    
${inputParsing}
    
    Solution solution;
    ${cppReturnType} result = solution.${functionName}(${args});
    
    ${finalCppPrint}
    
    return 0;
}
`;
}

/**
 * Main function to generate runnable code for any language
 */
export function generateRunnableCode(
  language: 'python' | 'javascript' | 'java' | 'cpp',
  solutionCode: string,
  signature: FunctionSignature,
  testInput: Record<string, unknown>
): string {
  switch (language) {
    case 'python':
      return generatePythonRunner(solutionCode, signature, testInput);
    case 'javascript':
      return generateJavaScriptRunner(solutionCode, signature, testInput);
    case 'java':
      return generateJavaRunner(solutionCode, signature, testInput);
    case 'cpp':
      return generateCppRunner(solutionCode, signature, testInput);
    default:
      throw new Error(`Unsupported language: ${language}`);
  }
}

/**
 * Generate batch Python runner code
 */
export function generateBatchPythonRunner(
  solutionCode: string,
  signature: FunctionSignature,
  testCases: RunnerTestCase[]
): string {
  const { functionName, parameters, returnType } = signature;
  
  // Check if we need helper functions for complex data types
  const needsHelpers = hasComplexDataTypes(signature);
  const helpers = needsHelpers ? getHelpersForLanguage('python') : '';
  const preparedTestCases = toPreparedTestCases(testCases);
  const testCasesJson = JSON.stringify(preparedTestCases);
  const testCasesLiteral = JSON.stringify(testCasesJson);
  const listNodeParameters = parameters.filter(param => isListNodeType(param.type)).map(param => param.name);
  const cycleAttachment = buildPythonCycleAttachment(listNodeParameters);
  
  // Build argument deserialization
  const argsDeserialization = parameters.map(param => {
    if (isListNodeType(param.type)) {
      return `        ${param.name} = deserialize_list(input_data["${param.name}"])`;
    } else if (isTreeNodeType(param.type)) {
      return `        ${param.name} = deserialize_tree(input_data["${param.name}"])`;
    } else {
      return `        ${param.name} = input_data["${param.name}"]`;
    }
  }).join('\n');
  
  // Handle output serialization
  let outputSerialization = 'result';
  if (isListNodeType(returnType)) {
    outputSerialization = 'serialize_list(result)';
  } else if (isTreeNodeType(returnType)) {
    outputSerialization = 'serialize_tree(result)';
  }
  
  const args = parameters.map(param => param.name).join(', ');
  
  return `${helpers}
${solutionCode}

import json
import sys

# Test runner
if __name__ == "__main__":
    solution = Solution()
    test_cases = json.loads(${testCasesLiteral})
    
    for i, test_case in enumerate(test_cases):
        input_data = test_case["input"]
        expected = test_case["output"]
        
${argsDeserialization}
${cycleAttachment ? `${cycleAttachment}
` : ''}
        result = solution.${functionName}(${args})
        print(f"Test {i}: {json.dumps(${outputSerialization})}")
`;
}

/**
 * Generate batch JavaScript runner code
 */
export function generateBatchJavaScriptRunner(
  solutionCode: string,
  signature: FunctionSignature,
  testCases: RunnerTestCase[]
): string {
  const { functionName, parameters, returnType } = signature;
  
  // Check if we need helper functions for complex data types
  const needsHelpers = hasComplexDataTypes(signature);
  const helpers = needsHelpers ? getHelpersForLanguage('javascript') : '';
  const preparedTestCases = toPreparedTestCases(testCases);
  const listNodeParameters = parameters.filter(param => isListNodeType(param.type)).map(param => param.name);
  const cycleAttachment = buildJavaScriptCycleAttachment(listNodeParameters);
  
  // Build argument deserialization
  const argsDeserialization = parameters.map(param => {
    if (isListNodeType(param.type)) {
      return `    let ${param.name} = deserializeList(input.${param.name});`;
    } else if (isTreeNodeType(param.type)) {
      return `    const ${param.name} = deserializeTree(input.${param.name});`;
    } else {
      return `    const ${param.name} = input.${param.name};`;
    }
  }).join('\n');
  
  // Handle output serialization
  let outputSerialization = 'result';
  if (isListNodeType(returnType)) {
    outputSerialization = 'serializeList(result)';
  } else if (isTreeNodeType(returnType)) {
    outputSerialization = 'serializeTree(result)';
  }
  
  const args = parameters.map(param => param.name).join(', ');
  
  return `${helpers}
${solutionCode}

const solution = new Solution();
const testCases = ${JSON.stringify(preparedTestCases)};

for (let i = 0; i < testCases.length; i++) {
    const testCase = testCases[i];
    const input = testCase.input;
    const expected = testCase.output;
    
${argsDeserialization}
${cycleAttachment}
    
    const result = solution.${functionName}(${args});
    console.log('Test ' + i + ': ' + JSON.stringify(${outputSerialization}));
}
`;
}

/**
 * Generate batch Java runner code
 */
export function generateBatchJavaRunner(
  solutionCode: string,
  signature: FunctionSignature,
  testCases: RunnerTestCase[]
): string {
  const { functionName, parameters, returnType } = signature;
  
  // Check if we need helper functions for complex data types
  const needsHelpers = hasComplexDataTypes(signature);
  const helpers = needsHelpers ? getHelpersForLanguage('java') : '';
  
  // Map return type to Java type using same logic as single runner
  const mapReturnType = (type: string): string => {
    const normalized = (type || '').trim().toLowerCase();
    if (normalized === 'bool') {
      return 'boolean';
    }
    if (normalized === 'boolean') {
      return 'boolean';
    }
    // Reuse the mapType defined above via a minimal inline replica to avoid scope issues
    const wrap = (t: string): string => {
      const normalizedInner = t.replace(/\s+/g, '');
      const lower = normalizedInner.toLowerCase();
      const directMap: Record<string, string> = {
        'int[]': 'int[]',
        'string[]': 'String[]',
        'double[]': 'double[]',
        'float[]': 'float[]',
        'long[]': 'long[]',
        'boolean[]': 'boolean[]',
        'char[]': 'char[]',
        'byte[]': 'byte[]',
        'short[]': 'short[]',
        'int': 'int',
        'string': 'String',
        'boolean': 'boolean',
        'double': 'double',
        'float': 'float',
        'long': 'long',
        'char': 'char',
        'byte': 'byte',
        'short': 'short',
        'listnode': 'ListNode',
        'treenode': 'TreeNode',
      };
      if (directMap[lower]) return directMap[lower];
      const listMatch = lower.match(/^list<(.+)>$/);
      if (listMatch) {
        const innerRaw = listMatch[1];
        if (/^list<.+>$/.test(innerRaw)) {
          const mappedInner = wrap(innerRaw.replace(/^list</, 'List<'));
          return `List<${mappedInner}>`;
        }
        const wrapperMap: Record<string, string> = {
          'int': 'Integer', 'integer': 'Integer', 'string': 'String', 'boolean': 'Boolean', 'double': 'Double',
          'float': 'Float', 'long': 'Long', 'char': 'Character', 'byte': 'Byte', 'short': 'Short',
        };
        const wrapped = wrapperMap[innerRaw] || innerRaw;
        return `List<${wrapped}>`;
      }
      if (normalized.startsWith('List<')) {
        const inner = normalized.slice(5, -1);
        return wrap(`list<${inner}>`);
      }
      return t;
    };
    return wrap(type);
  };

  const javaReturnType = mapReturnType(returnType);
  
  // Helper to detect Java List types
  const isJavaList = (type: string) => /^list<.+>$/i.test(type.replace(/\s+/g, ''));
  const isJavaNestedList = (type: string) => /^list<\s*list<.+>\s*>$/i.test(type.replace(/\s+/g, ''));
  const getJavaInnerType = (type: string) => {
    const match = type.replace(/\s+/g, '').match(/list<(.+)>/i);
    return match ? match[1] : type;
  };
  
  // Remove 'public' from Solution class to avoid filename conflicts
  const fixedSolutionCode = solutionCode.replace(/public\s+class\s+Solution/g, 'class Solution');
  
  // Generate hardcoded test cases since Java doesn't have easy JSON parsing in Judge0
  const testCode = testCases.map((testCase, index) => {
    // Build deserialized arguments
    const args = parameters.map(p => {
      const value = testCase.input[p.name];
      const type = p.type.toLowerCase();

      // Handle complex data types
      if (isListNodeType(p.type)) {
        const arrayValue = Array.isArray(value) ? value : [];
        const baseExpression = `ListHelper.deserializeList(java.util.Arrays.asList(${arrayValue.map(v => String(v)).join(', ')}))`;
        const cyclePositions = getLinkedListCyclePositions(testCase, p.name);
        return wrapJavaListNodeExpression(baseExpression, cyclePositions);
      } else if (isTreeNodeType(p.type)) {
        const arrayValue = Array.isArray(value) ? value : [];
        return `TreeHelper.deserializeTree(java.util.Arrays.asList(${arrayValue.map(v => v === null ? 'null' : String(v)).join(', ')}))`;
      }
      // Handle Java List types
      else if (isJavaList(p.type)) {
        const inner = getJavaInnerType(p.type).toLowerCase();
        if (isJavaNestedList(p.type)) {
          // For List<List<...>>, value is array of arrays
          const vv = Array.isArray(value) ? (value as any[]) : [];
          const innerInner = getJavaInnerType(getJavaInnerType(p.type));
          const items = vv.map(innerArr => `java.util.Arrays.asList(${(Array.isArray(innerArr)? innerArr:[]).map((x:any)=> inner === 'list<int>' || innerInner.toLowerCase()==='int' ? String(x) : (innerInner.toLowerCase()==='string'?`"${x}"`: String(x))).join(', ')})`).join(', ');
          return `new java.util.ArrayList<>(java.util.Arrays.asList(${items}))`;
        } else {
          const arr = Array.isArray(value) ? value : [];
          if (inner === 'int' || inner === 'integer') {
            return `new java.util.ArrayList<>(java.util.Arrays.asList(${arr.map((x:any)=>String(x)).join(', ')}))`;
          }
          if (inner === 'string') {
            return `new java.util.ArrayList<>(java.util.Arrays.asList(${arr.map((x:any)=>`"${x}"`).join(', ')}))`;
          }
          // default fallback
          return `new java.util.ArrayList<>(java.util.Arrays.asList(${arr.map((x:any)=>String(x)).join(', ')}))`;
        }
      }
      // Handle primitive arrays
      else if (Array.isArray(value)) {
        if (type === 'int[]') return `new int[]{${value.join(', ')}}`;
        if (type === 'string[]') return `new String[]{${value.map(v => `"${v}"`).join(', ')}}`;
        if (type === 'double[]') return `new double[]{${value.join(', ')}}`;
        if (type === 'float[]') return `new float[]{${value.join('f, ')}f}`; // append 'f' suffix
        if (type === 'long[]') return `new long[]{${value.join('L, ')}L}`;
      }

      if (type === 'string') return `"${value}"`;
      if (type === 'char') return `'${value}'`;
      if (type === 'boolean') return value ? 'true' : 'false';
      return String(value);
    }).join(', ');
    
    // Generate output based on return type
    let outputCode;
    if (isListNodeType(returnType)) {
      outputCode = `System.out.println("Test ${index}: " + ListHelper.serializeList(result${index}));`;
    } else if (isTreeNodeType(returnType)) {
      outputCode = `System.out.println("Test ${index}: " + TreeHelper.serializeTree(result${index}));`;
    } else if (isJavaNestedList(returnType)) {
      // Print List<List<...>> as proper JSON [[...],[...]]
      outputCode = `  {
        StringBuilder sb = new StringBuilder();
        sb.append("Test ${index}: [");
        for (int i = 0; i < result${index}.size(); i++) {
          java.util.List<?> inner = result${index}.get(i);
          sb.append("[");
          for (int j = 0; j < inner.size(); j++) {
            Object val = inner.get(j);
            if (val instanceof String) {
              sb.append("\\"").append(val).append("\\"");
            } else {
              sb.append(String.valueOf(val));
            }
            if (j < inner.size() - 1) sb.append(",");
          }
          sb.append("]");
          if (i < result${index}.size() - 1) sb.append(",");
        }
        sb.append("]");
        System.out.println(sb.toString());
      }`;
    } else if (isJavaList(returnType)) {
      // Print List<...> as proper JSON [a,b,c]
      outputCode = `  {
        StringBuilder sb = new StringBuilder();
        sb.append("Test ${index}: [");
        for (int i = 0; i < result${index}.size(); i++) {
          Object val = result${index}.get(i);
          if (val instanceof String) {
            sb.append("\\"").append(val).append("\\"");
          } else {
            sb.append(String.valueOf(val));
          }
          if (i < result${index}.size() - 1) sb.append(",");
        }
        sb.append("]");
        System.out.println(sb.toString());
      }`;
    } else if (javaReturnType.includes('[]')) {
      outputCode = `System.out.println("Test ${index}: " + java.util.Arrays.toString(result${index}));`;
    } else {
      outputCode = `System.out.println("Test ${index}: " + result${index});`;
    }
    
    return `        // Test ${index + 1}
        ${javaReturnType} result${index} = solution.${functionName}(${args});
        ${outputCode}`;
  }).join('\n');
  
  return `import java.util.*;
${helpers}
${fixedSolutionCode}

public class Main {
    public static void main(String[] args) {
        Solution solution = new Solution();
        
${testCode}
    }
}
`;
}

/**
 * Generate batch C++ runner code
 */
export function generateBatchCppRunner(
  solutionCode: string,
  signature: FunctionSignature,
  testCases: RunnerTestCase[]
): string {
  const { functionName, parameters, returnType } = signature;
  
  // Check if we need helper functions for complex data types
  const needsHelpers = hasComplexDataTypes(signature);
  const helpers = needsHelpers ? getHelpersForLanguage('cpp') : '';
  
  // Map return type to C++ type
  const mapReturnType = (type: string): string => {
    const normalizedType = type.replace(/\s+/g, '');
    const typeMap: Record<string, string> = {
      'int[]': 'vector<int>',
      'string[]': 'vector<string>',
      'int': 'int',
      'string': 'string',
      'boolean': 'bool',
      'double': 'double',
      'float': 'float',
      'long': 'long',
      'ListNode': 'ListNode*',
      'TreeNode': 'TreeNode*',
      // Add List types mapping to C++ vectors
      'list<int>': 'vector<int>',
      'list<string>': 'vector<string>',
      'list<list<int>>': 'vector<vector<int>>',
      'list<list<string>>': 'vector<vector<string>>',
      'List<int>': 'vector<int>',
      'List<string>': 'vector<string>',
      'List<List<int>>': 'vector<vector<int>>',
      'List<List<string>>': 'vector<vector<string>>',
    };
    return typeMap[normalizedType.toLowerCase()] || type;
  };

  const cppReturnType = mapReturnType(returnType);
  
  // Generate hardcoded test cases - create variables first to avoid reference issues
  const testCode = testCases.map((testCase, index) => {
    // Create variables for array parameters to avoid binding rvalue to non-const reference
    const arrayVars = parameters
      .map((p, pIdx) => {
        const value = testCase.input[p.name];
        if (Array.isArray(value)) {
          // Handle complex data types
          if (isListNodeType(p.type)) {
            const arrayValue = value.map(v => v === null ? -1 : v); // Use -1 for null in C++
            const variableName = `test${index}_${p.name}`;
            const cycleAttachment = buildCppCycleAttachment(variableName, getLinkedListCyclePositions(testCase, p.name));
            return `    vector<int> test${index}_${p.name}_arr = {${arrayValue.join(', ')}};
    ListNode* ${variableName} = deserializeList(test${index}_${p.name}_arr);${cycleAttachment}`;
          } else if (isTreeNodeType(p.type)) {
            const arrayValue = value.map(v => v === null ? -1 : v); // Use -1 for null in C++
            return `    vector<int> test${index}_${p.name}_arr = {${arrayValue.join(', ')}};
    TreeNode* test${index}_${p.name} = deserializeTree(test${index}_${p.name}_arr);`;
          } else {
            return `    vector<int> test${index}_${p.name} = {${value.join(', ')}};`;
          }
        }
        return null;
      })
      .filter(Boolean)
      .join('\n');
    
    const args = parameters.map(p => {
      const value = testCase.input[p.name];
      if (Array.isArray(value)) {
        if (isListNodeType(p.type) || isTreeNodeType(p.type)) {
          return `test${index}_${p.name}`;
        } else {
          return `test${index}_${p.name}`;
        }
      }
      return String(value);
    }).join(', ');
    
    // Generate output based on return type
    let outputCode;
    if (isListNodeType(returnType)) {
      outputCode = `    vector<int> result${index}_serialized = serializeList(result${index});
    cout << "Test ${index}: [";
    for (int i = 0; i < result${index}_serialized.size(); i++) {
        cout << result${index}_serialized[i];
        if (i < result${index}_serialized.size() - 1) cout << ",";
    }
    cout << "]" << endl;`;
    } else if (isTreeNodeType(returnType)) {
      outputCode = `    vector<int> result${index}_serialized = serializeTree(result${index});
    cout << "Test ${index}: [";
    for (int i = 0; i < result${index}_serialized.size(); i++) {
        cout << result${index}_serialized[i];
        if (i < result${index}_serialized.size() - 1) cout << ",";
    }
    cout << "]" << endl;`;
    } else if (cppReturnType.includes('vector<vector')) {
      // Handle nested vectors (e.g., vector<vector<int>>)
      outputCode = `    cout << "Test ${index}: [";
    for (int i = 0; i < result${index}.size(); i++) {
        cout << "[";
        for (int j = 0; j < result${index}[i].size(); j++) {
            cout << result${index}[i][j];
            if (j < result${index}[i].size() - 1) cout << ",";
        }
        cout << "]";
        if (i < result${index}.size() - 1) cout << ",";
    }
    cout << "]" << endl;`;
    } else if (cppReturnType.includes('vector')) {
      // Handle single vectors (e.g., vector<int>)
      outputCode = `    cout << "Test ${index}: [";
    for (int i = 0; i < result${index}.size(); i++) {
        cout << result${index}[i];
        if (i < result${index}.size() - 1) cout << ",";
    }
    cout << "]" << endl;`;
    } else if (cppReturnType === 'bool') {
      outputCode = `    cout << "Test ${index}: " << serializeBool(result${index}) << endl;`;
    } else {
      outputCode = `    cout << "Test ${index}: " << result${index} << endl;`;
    }
    
    return `    // Test ${index + 1}
${arrayVars}
    ${cppReturnType} result${index} = solution.${functionName}(${args});
${outputCode}`;
  }).join('\n');
  
  // Ensure includes are always present - unordered_map requires C++11 but should be available in Judge0
  // IMPORTANT: All includes must be at the top before any code
  return `#include <iostream>
#include <vector>
#include <string>
#include <queue>
#include <algorithm>
#include <unordered_map>
#include <unordered_set>
#include <map>
#include <set>

using namespace std;

${helpers}
${solutionCode}

int main() {
    Solution solution;
    
${testCode}
    
    return 0;
}
`;
}

/**
 * Generate batch runnable code for multiple test cases
 */
export function generateBatchRunnableCode(
  language: 'python' | 'javascript' | 'java' | 'cpp',
  solutionCode: string,
  signature: FunctionSignature,
  testCases: RunnerTestCase[]
): string {
  switch (language) {
    case 'python':
      return generateBatchPythonRunner(solutionCode, signature, testCases);
    case 'javascript':
      return generateBatchJavaScriptRunner(solutionCode, signature, testCases);
    case 'java':
      return generateBatchJavaRunner(solutionCode, signature, testCases);
    case 'cpp':
      return generateBatchCppRunner(solutionCode, signature, testCases);
    default:
      throw new Error(`Unsupported language: ${language}`);
  }
}

/**
 * Get Judge0 language ID for each language
 */
export function getJudge0LanguageId(language: string): number {
  const languageMap: Record<string, number> = {
    'python': 71,      // Python 3
    'javascript': 63,  // JavaScript (Node.js)
    'java': 62,        // Java
    'cpp': 54,         // C++ (GCC 9.2.0)
    'js': 63,          // Alias for javascript
  };
  
  const langId = languageMap[language.toLowerCase()];
  if (!langId) {
    throw new Error(`Unknown language: ${language}`);
  }
  return langId;
}

/**
 * Parse test result from stdout
 */
export function parseTestResult(stdout: string): unknown {
  try {
    return JSON.parse(stdout.trim());
  } catch (error) {
    throw new Error(`Failed to parse test output: ${stdout}`);
  }
}

/**
 * Compare expected output with actual output
 */
export function compareOutputs(expected: unknown, actual: unknown): boolean {
  return JSON.stringify(expected) === JSON.stringify(actual);
}

