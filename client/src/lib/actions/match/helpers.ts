
// Helper functions for type conversion
export function convertToJavaType(type: string): string {
  const normalized = type.replace(/\s+/g, '');
  const lower = normalized.toLowerCase();

  // Direct primitives and arrays
  const directMap: Record<string, string> = {
    'int': 'int',
    'int[]': 'int[]',
    'string': 'String',
    'string[]': 'String[]',
    'bool': 'boolean',
    'bool[]': 'boolean[]',
    'double': 'double',
    'double[]': 'double[]',
    'float': 'float',
    'float[]': 'float[]',
    'long': 'long',
    'long[]': 'long[]',
    'char': 'char',
    'char[]': 'char[]',
    'byte': 'byte',
    'byte[]': 'byte[]',
    'short': 'short',
    'short[]': 'short[]',
  };
  if (directMap[lower]) return directMap[lower];

  // List generics: wrap primitives in Java wrappers; recurse for nested
  const listMatch = lower.match(/^list<(.+)>$/);
  if (listMatch) {
    const innerRaw = listMatch[1];
    // Nested List
    if (/^list<.+>$/.test(innerRaw)) {
      const mappedInner = convertToJavaType(innerRaw.replace(/^list</, 'List<'));
      return `List<${mappedInner}>`;
    }
    const wrapperMap: Record<string, string> = {
      'int': 'Integer',
      'integer': 'Integer',
      'string': 'String',
      'bool': 'Boolean',
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

  // Already capitalized List<?> case
  if (normalized.startsWith('List<')) {
    const inner = normalized.slice(5, -1);
    return convertToJavaType(`list<${inner}>`);
  }

  return type;
}

export function convertToCppType(type: string): string {
  const typeMap: Record<string, string> = {
    'int': 'int',
    'int[]': 'vector<int>',
    'string': 'string',
    'string[]': 'vector<string>',
    'bool': 'bool',
    'bool[]': 'vector<bool>',
  };
  return typeMap[type.toLowerCase()] || type;
}

export function getJavaDefaultReturn(returnType: string): string {
  if (returnType.includes('[]')) return 'return new ' + returnType.replace('[]', '[0]') + ';';
  if (returnType === 'int') return 'return 0;';
  if (returnType === 'boolean') return 'return false;';
  if (returnType === 'String') return 'return "";';
  return 'return null;';
}

export function getCppDefaultReturn(returnType: string): string {
  if (returnType.includes('vector')) return 'return {};';
  if (returnType === 'int') return 'return 0;';
  if (returnType === 'bool') return 'return false;';
  if (returnType === 'string') return 'return "";';
  return 'return {};';
}

/**
 * Generate starter code from function signature
 */
export function generateStarterCode(signature: { functionName: string; parameters: Array<{ name: string; type: string }>; returnType: string } | null) {
  if (!signature) return null;
  
  const { functionName, parameters, returnType } = signature;
  
  const starterCode: Record<string, string> = {};
  
  // JavaScript
  const jsParams = parameters.map((p) => p.name).join(', ');
  starterCode.javascript = `class Solution {
    /**
 * @param {${parameters.map((p) => `${p.type} ${p.name}`).join(', ')}}
 * @return {${returnType}}
 */
    ${functionName}(${jsParams}) {
    // Your code here
    }
}`;
  
  // Python
  const pyParams = parameters.map((p) => p.name).join(', ');
  starterCode.python = `class Solution:
    def ${functionName}(self, ${pyParams}):
    """
    Args:
            ${parameters.map((p) => `${p.name}: ${p.type}`).join('\n            ')}
    Returns:
        ${returnType}
    """
    # Your code here
    pass`;
  
  // Java
  const javaParams = parameters.map((p) => `${convertToJavaType(p.type)} ${p.name}`).join(', ');
  starterCode.java = `class Solution {
    public ${convertToJavaType(returnType)} ${functionName}(${javaParams}) {
        // Your code here
        ${getJavaDefaultReturn(returnType)}
    }
}`;
  
  // C++
  const cppParams = parameters.map((p) => `${convertToCppType(p.type)} ${p.name}`).join(', ');
  starterCode.cpp = `class Solution {
public:
    ${convertToCppType(returnType)} ${functionName}(${cppParams}) {
        // Your code here
        ${getCppDefaultReturn(returnType)}
    }
};`;
  
  return starterCode;
}

