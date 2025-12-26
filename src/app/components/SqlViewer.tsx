// src/components/SqlViewer.tsx  (or your path)
'use client';

import { useMemo } from 'react';
import hljs from 'highlight.js/lib/core';
import sql from 'highlight.js/lib/languages/sql';
import 'highlight.js/styles/github-dark.css';

// Register SQL exactly once (core build doesn't expose `languages`)
if (!hljs.getLanguage('sql')) {
  hljs.registerLanguage('sql', sql);
}

function normalizeNewlines(s: string) {
  return (s ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .trim();
}

const DEFAULT_SQL = `
SELECT date_trunc('day', b."time" AT TIME ZONE 'Europe/Paris') AS day, 
       COUNT(t.tx_hash) AS total_transactions
FROM public.tx AS t
JOIN public.block AS b ON t.block_hash = b.block_hash
WHERE t.call_count > 0 
  AND b."time" >= NOW() - INTERVAL '30 days'
GROUP BY day
ORDER BY day DESC
LIMIT $1 OFFSET $2
`;

export default function SqlViewer({ code = DEFAULT_SQL }: { code: string }) {
  const highlighted = useMemo(() => {
    const text = normalizeNewlines(code);
    try {
      return hljs.highlight(text, { language: 'sql', ignoreIllegals: true }).value;
    } catch {
      // fallback: escape HTML
      return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }
  }, [code]);

  return (
    <pre className="code" style={{ overflowX: 'auto' }}>
      <code className="hljs language-sql" dangerouslySetInnerHTML={{ __html: highlighted }} />
    </pre>
  );
}
