interface CodeBlockProps {
  code: string;
  language?: string;
  maxHeight?: string;
}

export function CodeBlock({ code, maxHeight = 'max-h-96' }: CodeBlockProps) {
  return (
    <pre className={`text-xs font-mono bg-gray-900 text-gray-100 p-3 rounded overflow-auto ${maxHeight}`}>
      {code}
    </pre>
  );
}
