import { useState } from 'react';

interface JsonViewerProps {
  data: unknown;
  initialExpanded?: boolean;
  maxDepth?: number;
}

function JsonNode({ data, depth, maxDepth }: { data: unknown; depth: number; maxDepth: number }) {
  const [expanded, setExpanded] = useState(depth < 1);

  if (data === null || data === undefined) {
    return <span className="text-gray-400">null</span>;
  }
  if (typeof data === 'boolean') {
    return <span className="text-purple-600 dark:text-purple-400">{String(data)}</span>;
  }
  if (typeof data === 'number') {
    return <span className="text-blue-600 dark:text-blue-400">{data}</span>;
  }
  if (typeof data === 'string') {
    return <span className="text-green-700 dark:text-green-400">"{data}"</span>;
  }

  if (Array.isArray(data)) {
    if (data.length === 0) return <span className="text-gray-400">[]</span>;
    if (depth >= maxDepth) return <span className="text-gray-400">[...{data.length}]</span>;
    return (
      <span>
        <button onClick={() => setExpanded(!expanded)} className="text-gray-500 hover:text-gray-800">
          {expanded ? '[-]' : `[+${data.length}]`}
        </button>
        {expanded && (
          <div className="ml-4">
            {data.map((item, i) => (
              <div key={i}>
                <JsonNode data={item} depth={depth + 1} maxDepth={maxDepth} />
                {i < data.length - 1 && ','}
              </div>
            ))}
          </div>
        )}
      </span>
    );
  }

  if (typeof data === 'object') {
    const entries = Object.entries(data as Record<string, unknown>);
    if (entries.length === 0) return <span className="text-gray-400">{'{}'}</span>;
    if (depth >= maxDepth) return <span className="text-gray-400">{'{'}...{entries.length}{'}'}</span>;
    return (
      <span>
        <button onClick={() => setExpanded(!expanded)} className="text-gray-500 hover:text-gray-800">
          {expanded ? '{-}' : `{+${entries.length}}`}
        </button>
        {expanded && (
          <div className="ml-4">
            {entries.map(([key, val], i) => (
              <div key={key}>
                <span className="text-red-700 dark:text-red-400">"{key}"</span>:{' '}
                <JsonNode data={val} depth={depth + 1} maxDepth={maxDepth} />
                {i < entries.length - 1 && ','}
              </div>
            ))}
          </div>
        )}
      </span>
    );
  }

  return <span>{String(data)}</span>;
}

export function JsonViewer({ data, maxDepth = 4 }: JsonViewerProps) {
  return (
    <pre className="text-xs font-mono bg-gray-50 dark:bg-gray-900 p-3 rounded overflow-auto max-h-96">
      <JsonNode data={data} depth={0} maxDepth={maxDepth} />
    </pre>
  );
}
