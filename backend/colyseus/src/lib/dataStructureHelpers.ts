/**
 * Data Structure Helpers
 * Provides ListNode and TreeNode class definitions and serialization functions
 * for all supported languages (Python, JavaScript, Java, C++)
 */

/**
 * Check if a parameter type is a complex data structure
 */
export function isComplexDataType(type: string): boolean {
  const complexTypes = ['ListNode', 'TreeNode', 'ListNode[]', 'TreeNode[]'];
  return complexTypes.includes(type);
}

/**
 * Check if a parameter type is ListNode (including array)
 */
export function isListNodeType(type: string): boolean {
  return type === 'ListNode' || type === 'ListNode[]';
}

/**
 * Check if a parameter type is TreeNode (including array)
 */
export function isTreeNodeType(type: string): boolean {
  return type === 'TreeNode' || type === 'TreeNode[]';
}

/**
 * Get Python helper code for ListNode and TreeNode
 */
export function getPythonHelpers(): string {
  return `
# ListNode definition
class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next

# TreeNode definition
class TreeNode:
    def __init__(self, val=0, left=None, right=None):
        self.val = val
        self.left = left
        self.right = right

# Helper functions for ListNode
def deserialize_list(data):
    """Convert array to ListNode"""
    if not data:
        return None
    head = ListNode(data[0])
    current = head
    for val in data[1:]:
        current.next = ListNode(val)
        current = current.next
    return head

def serialize_list(head):
    """Convert ListNode to array"""
    result = []
    current = head
    while current:
        result.append(current.val)
        current = current.next
    return result

# Helper functions for TreeNode
def deserialize_tree(data):
    """Convert level-order array to TreeNode"""
    if not data:
        return None
    root = TreeNode(data[0])
    queue = [root]
    i = 1
    while queue and i < len(data):
        node = queue.pop(0)
        if i < len(data) and data[i] is not None:
            node.left = TreeNode(data[i])
            queue.append(node.left)
        i += 1
        if i < len(data) and data[i] is not None:
            node.right = TreeNode(data[i])
            queue.append(node.right)
        i += 1
    return root

def serialize_tree(root):
    """Convert TreeNode to level-order array with nulls"""
    if not root:
        return []
    result = []
    queue = [root]
    while queue:
        node = queue.pop(0)
        if node:
            result.append(node.val)
            queue.append(node.left)
            queue.append(node.right)
        else:
            result.append(None)
    # Remove trailing nulls
    while result and result[-1] is None:
        result.pop()
    return result

# Linked list helpers for special inputs
def attach_cycle(head, pos):
    if head is None or pos is None or pos < 0:
        return head

    current = head
    tail = None
    cycle_node = None
    idx = 0

    while current:
        if idx == pos:
            cycle_node = current
        tail = current
        current = current.next
        idx += 1

    if cycle_node is None or tail is None:
        return head

    tail.next = cycle_node
    return head
`;
}

/**
 * Get JavaScript helper code for ListNode and TreeNode
 */
export function getJavaScriptHelpers(): string {
  return `
// ListNode definition
class ListNode {
    constructor(val = 0, next = null) {
        this.val = val;
        this.next = next;
    }
}

// TreeNode definition
class TreeNode {
    constructor(val = 0, left = null, right = null) {
        this.val = val;
        this.left = left;
        this.right = right;
    }
}

// Helper functions for ListNode
function deserializeList(data) {
    if (!data || data.length === 0) {
        return null;
    }
    const head = new ListNode(data[0]);
    let current = head;
    for (let i = 1; i < data.length; i++) {
        current.next = new ListNode(data[i]);
        current = current.next;
    }
    return head;
}

function serializeList(head) {
    const result = [];
    let current = head;
    while (current) {
        result.push(current.val);
        current = current.next;
    }
    return result;
}

// Helper functions for TreeNode
function deserializeTree(data) {
    if (!data || data.length === 0) {
        return null;
    }
    const root = new TreeNode(data[0]);
    const queue = [root];
    let i = 1;
    while (queue.length > 0 && i < data.length) {
        const node = queue.shift();
        if (i < data.length && data[i] !== null) {
            node.left = new TreeNode(data[i]);
            queue.push(node.left);
        }
        i++;
        if (i < data.length && data[i] !== null) {
            node.right = new TreeNode(data[i]);
            queue.push(node.right);
        }
        i++;
    }
    return root;
}

function serializeTree(root) {
    if (!root) {
        return [];
    }
    const result = [];
    const queue = [root];
    while (queue.length > 0) {
        const node = queue.shift();
        if (node) {
            result.push(node.val);
            queue.push(node.left);
            queue.push(node.right);
        } else {
            result.push(null);
        }
    }
    // Remove trailing nulls
    while (result.length > 0 && result[result.length - 1] === null) {
        result.pop();
    }
    return result;
}

function attachCycle(head, pos) {
    if (!head || typeof pos !== 'number' || pos < 0) {
        return head;
    }
    let current = head;
    let tail = null;
    let cycleNode = null;
    let idx = 0;
    while (current) {
        if (idx === pos) {
            cycleNode = current;
        }
        tail = current;
        current = current.next;
        idx += 1;
    }
    if (!cycleNode || !tail) {
        return head;
    }
    tail.next = cycleNode;
    return head;
}
`;
}

/**
 * Get Java helper code for ListNode and TreeNode
 */
export function getJavaHelpers(): string {
  return `
// ListNode definition
class ListNode {
    int val;
    ListNode next;
    ListNode() {}
    ListNode(int val) { this.val = val; }
    ListNode(int val, ListNode next) { this.val = val; this.next = next; }
}

// TreeNode definition
class TreeNode {
    int val;
    TreeNode left;
    TreeNode right;
    TreeNode() {}
    TreeNode(int val) { this.val = val; }
    TreeNode(int val, TreeNode left, TreeNode right) {
        this.val = val;
        this.left = left;
        this.right = right;
    }
}

// Helper functions for ListNode
class ListHelper {
    public static ListNode deserializeList(java.util.List<Integer> data) {
        if (data == null || data.isEmpty()) {
            return null;
        }
        ListNode head = new ListNode(data.get(0));
        ListNode current = head;
        for (int i = 1; i < data.size(); i++) {
            current.next = new ListNode(data.get(i));
            current = current.next;
        }
        return head;
    }
    
    public static java.util.List<Integer> serializeList(ListNode head) {
        java.util.List<Integer> result = new java.util.ArrayList<>();
        ListNode current = head;
        while (current != null) {
            result.add(current.val);
            current = current.next;
        }
        return result;
    }

    public static ListNode attachCycle(ListNode head, int pos) {
        if (head == null || pos < 0) {
            return head;
        }

        ListNode current = head;
        ListNode tail = null;
        ListNode cycleNode = null;
        int idx = 0;

        while (current != null) {
            if (idx == pos) {
                cycleNode = current;
            }
            tail = current;
            current = current.next;
            idx++;
        }

        if (cycleNode == null || tail == null) {
            return head;
        }

        tail.next = cycleNode;
        return head;
    }
}

// Helper functions for TreeNode
class TreeHelper {
    public static TreeNode deserializeTree(java.util.List<Integer> data) {
        if (data == null || data.isEmpty()) {
            return null;
        }
        TreeNode root = new TreeNode(data.get(0));
        java.util.Queue<TreeNode> queue = new java.util.LinkedList<>();
        queue.offer(root);
        int i = 1;
        while (!queue.isEmpty() && i < data.size()) {
            TreeNode node = queue.poll();
            if (i < data.size() && data.get(i) != null) {
                node.left = new TreeNode(data.get(i));
                queue.offer(node.left);
            }
            i++;
            if (i < data.size() && data.get(i) != null) {
                node.right = new TreeNode(data.get(i));
                queue.offer(node.right);
            }
            i++;
        }
        return root;
    }
    
    public static java.util.List<Integer> serializeTree(TreeNode root) {
        java.util.List<Integer> result = new java.util.ArrayList<>();
        if (root == null) {
            return result;
        }
        java.util.Queue<TreeNode> queue = new java.util.LinkedList<>();
        queue.offer(root);
        while (!queue.isEmpty()) {
            TreeNode node = queue.poll();
            if (node != null) {
                result.add(node.val);
                queue.offer(node.left);
                queue.offer(node.right);
            } else {
                result.add(null);
            }
        }
        // Remove trailing nulls
        while (!result.isEmpty() && result.get(result.size() - 1) == null) {
            result.remove(result.size() - 1);
        }
        return result;
    }
}
`;
}

/**
 * Get C++ helper code for ListNode and TreeNode
 */
export function getCppHelpers(): string {
  return `
// ListNode definition
struct ListNode {
    int val;
    ListNode *next;
    ListNode() : val(0), next(nullptr) {}
    ListNode(int x) : val(x), next(nullptr) {}
    ListNode(int x, ListNode *next) : val(x), next(next) {}
};

// TreeNode definition
struct TreeNode {
    int val;
    TreeNode *left;
    TreeNode *right;
    TreeNode() : val(0), left(nullptr), right(nullptr) {}
    TreeNode(int x) : val(x), left(nullptr), right(nullptr) {}
    TreeNode(int x, TreeNode *left, TreeNode *right) : val(x), left(left), right(right) {}
};

// Helper functions for ListNode
ListNode* deserializeList(const vector<int>& data) {
    if (data.empty()) {
        return nullptr;
    }
    ListNode* head = new ListNode(data[0]);
    ListNode* current = head;
    for (int i = 1; i < data.size(); i++) {
        current->next = new ListNode(data[i]);
        current = current->next;
    }
    return head;
}

vector<int> serializeList(ListNode* head) {
    vector<int> result;
    ListNode* current = head;
    while (current) {
        result.push_back(current->val);
        current = current->next;
    }
    return result;
}

// Helper functions for TreeNode
TreeNode* deserializeTree(const vector<int>& data) {
    if (data.empty()) {
        return nullptr;
    }
    TreeNode* root = new TreeNode(data[0]);
    queue<TreeNode*> q;
    q.push(root);
    int i = 1;
    while (!q.empty() && i < data.size()) {
        TreeNode* node = q.front();
        q.pop();
        if (i < data.size() && data[i] != -1) {  // Using -1 for null in C++
            node->left = new TreeNode(data[i]);
            q.push(node->left);
        }
        i++;
        if (i < data.size() && data[i] != -1) {
            node->right = new TreeNode(data[i]);
            q.push(node->right);
        }
        i++;
    }
    return root;
}

vector<int> serializeTree(TreeNode* root) {
    vector<int> result;
    if (!root) {
        return result;
    }
    queue<TreeNode*> q;
    q.push(root);
    while (!q.empty()) {
        TreeNode* node = q.front();
        q.pop();
        if (node) {
            result.push_back(node->val);
            q.push(node->left);
            q.push(node->right);
        } else {
            result.push_back(-1);  // Using -1 for null in C++
        }
    }
    // Remove trailing -1s
    while (!result.empty() && result.back() == -1) {
        result.pop_back();
    }
    return result;
}

ListNode* attachCycle(ListNode* head, int pos) {
    if (!head || pos < 0) {
        return head;
    }

    ListNode* current = head;
    ListNode* tail = nullptr;
    ListNode* cycleNode = nullptr;
    int idx = 0;

    while (current) {
        if (idx == pos) {
            cycleNode = current;
        }
        tail = current;
        current = current->next;
        idx++;
    }

    if (!cycleNode || !tail) {
        return head;
    }

    tail->next = cycleNode;
    return head;
}

std::string serializeBool(bool value) {
    return value ? "true" : "false";
}
`;
}

/**
 * Get helper code for a specific language
 */
export function getHelpersForLanguage(language: 'python' | 'javascript' | 'java' | 'cpp'): string {
  switch (language) {
    case 'python':
      return getPythonHelpers();
    case 'javascript':
      return getJavaScriptHelpers();
    case 'java':
      return getJavaHelpers();
    case 'cpp':
      return getCppHelpers();
    default:
      throw new Error(`Unsupported language: ${language}`);
  }
}

/**
 * Check if any parameter in a function signature uses complex data types
 */
export function hasComplexDataTypes(signature: {
  functionName: string;
  parameters: Array<{ name: string; type: string }>;
  returnType: string;
}): boolean {
  const allTypes = [
    ...signature.parameters.map(p => p.type),
    signature.returnType
  ];
  return allTypes.some(type => isComplexDataType(type));
}

