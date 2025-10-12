// themes/codeClashTheme.ts

import { editor } from 'monaco-editor';

export const codeClashTheme: editor.IStandaloneThemeData = {
  base: 'vs-dark', // Use 'vs' for light theme or 'vs-dark' for dark theme
  inherit: true, // Inherit default settings
  rules: [
    { token: 'comment', foreground: '6A9955' },
    { token: 'keyword', foreground: '569CD6' },
    { token: 'string', foreground: 'CE9178' },
    { token: 'number', foreground: 'B5CEA8' },
    { token: 'type', foreground: '4EC9B0' },
    { token: 'function', foreground: 'DCDCAA' },
    // Add more token customizations as needed
  ],
  colors: {
    'editor.background': '#0F172A', // Match your application's background color
    'editor.foreground': '#FFFFFF', // Match your application's text color
    'editorCursor.foreground': '#FFFFFF',
    'editorLineNumber.foreground': '#858585',
    'editorLineNumber.activeForeground': '#FFFFFF',
    'editor.selectionBackground': '#264F78',
    // Add more color customizations as needed
  },
};
