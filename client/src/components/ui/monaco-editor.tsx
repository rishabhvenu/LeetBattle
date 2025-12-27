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
  const [monacoModule, setMonacoModule] = useState<any>(null);

  // Dynamically load Monaco Editor only on client side
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    import('monaco-editor').then((monaco) => {
      setMonacoModule(monaco);
      setMonacoLoaded(true);
    }).catch((error) => {
      console.error('Failed to load Monaco Editor:', error);
    });
  }, []);

  useEffect(() => {
    if (!editorRef.current || !monacoLoaded || !monacoModule) {
      return;
    }

    const monaco = monacoModule;

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
      fontFamily: "'Courier New', Courier, monospace",
      fontLigatures: false,
    });

    monacoEditorRef.current = editor;

    // Handle content changes
    if (onChange) {
      editor.onDidChangeModelContent(() => {
        const newValue = editor.getValue();
        onChange(newValue);
      });
    }

    // Cleanup function
    return () => {
      editor.dispose();
    };
  }, [monacoLoaded, monacoModule]);

  useEffect(() => {
    if (monacoEditorRef.current && monacoEditorRef.current.getValue() !== value) {
      monacoEditorRef.current.setValue(value);
    }
  }, [value]);

  useEffect(() => {
    if (!monacoEditorRef.current || !monacoModule) return;
    
    monacoModule.editor.setModelLanguage(monacoEditorRef.current.getModel()!, language);
  }, [language, monacoModule]);

  useEffect(() => {
    if (monacoEditorRef.current) {
      monacoEditorRef.current.updateOptions({ readOnly });
    }
  }, [readOnly]);

  if (!monacoLoaded) {
    return (
      <div 
        style={{ height }}
        className={`border border-gray-600 rounded ${className} flex items-center justify-center bg-gray-50`}
      >
        <span className="text-gray-500">Loading editor...</span>
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
