'use client';

import { useEffect, useRef, useState } from 'react';
import { codeClashTheme } from '@/themes/codeClashTheme';

interface MonacoEditorProps {
  value: string;
  language: string;
  height?: string;
  className?: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
}

export function MonacoEditor({ 
  value, 
  language, 
  height = '300px',
  className = '',
  onChange,
  readOnly = false
}: MonacoEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const monacoEditorRef = useRef<any>(null);
  const [monacoLoaded, setMonacoLoaded] = useState(false);

  useEffect(() => {
    // Dynamically import Monaco Editor only on client side
    if (typeof window === 'undefined') return;

    let editorInstance: any = null;

    import('monaco-editor').then((monaco) => {
      if (!editorRef.current) return;

      setMonacoLoaded(true);

      // Register the custom theme
      monaco.editor.defineTheme('codeclash', codeClashTheme);

      // Create the editor
      const editor = monaco.editor.create(editorRef.current, {
        value,
        language,
        theme: 'codeclash',
        readOnly,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        wordWrap: 'on',
        lineNumbers: 'on',
        folding: true,
        lineDecorationsWidth: 0,
        lineNumbersMinChars: 0,
        renderLineHighlight: 'line',
        cursorStyle: 'line',
        selectOnLineNumbers: true,
        glyphMargin: false,
        contextmenu: true,
        mouseWheelZoom: true,
        scrollbar: {
          vertical: 'auto',
          horizontal: 'auto',
          verticalScrollbarSize: 8,
          horizontalScrollbarSize: 8,
        },
        automaticLayout: true,
      });

      editorInstance = editor;
      monacoEditorRef.current = editor;

      // Handle content changes
      if (onChange) {
        editor.onDidChangeModelContent(() => {
          const newValue = editor.getValue();
          onChange(newValue);
        });
      }
    }).catch((error) => {
      console.error('Failed to load Monaco Editor:', error);
    });

    // Cleanup function
    return () => {
      if (editorInstance) {
        editorInstance.dispose();
      }
    };
  }, [onChange]);

  useEffect(() => {
    if (monacoEditorRef.current && monacoEditorRef.current.getValue() !== value) {
      monacoEditorRef.current.setValue(value);
    }
  }, [value]);

  useEffect(() => {
    if (!monacoEditorRef.current || !monacoLoaded) return;
    
    import('monaco-editor').then((monaco) => {
      if (monacoEditorRef.current) {
        monaco.editor.setModelLanguage(monacoEditorRef.current.getModel()!, language);
      }
    });
  }, [language, monacoLoaded]);

  useEffect(() => {
    if (monacoEditorRef.current) {
      monacoEditorRef.current.updateOptions({ readOnly });
    }
  }, [readOnly]);

  if (!monacoLoaded) {
    return (
      <div 
        style={{ height }}
        className={`border border-gray-600 rounded flex items-center justify-center ${className}`}
      >
        <div className="text-sm text-gray-500">Loading editor...</div>
      </div>
    );
  }

  return (
    <div 
      ref={editorRef} 
      style={{ height }}
      className={`border border-gray-600 rounded ${className}`}
    />
  );
}
