// page.tsx - Updated to use chat interface
'use client';

import { useState } from 'react';
import ChatInterface from './components/ChatInterface';
import dynamic from 'next/dynamic';

// Chart context + parts
const ChartProvider = dynamic(() => import('./components/ChartJS').then(m => m.ChartProvider), { ssr: false });
const ChartCanvas   = dynamic(() => import('./components/ChartJS').then(m => m.ChartCanvas),   { ssr: false });
const ChartControls = dynamic(() => import('./components/ChartJS').then(m => m.ChartControls), { ssr: false });

type Row = Record<string, any>;

export default function Home() {
  const [sql, setSql] = useState('');
  const [assumptions, setAssumptions] = useState<string[]>([]);
  const [limit, setLimit] = useState(1000);
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSqlGenerated = (newSql: string, newAssumptions: string[]) => {
    setSql(newSql);
    setAssumptions(newAssumptions);
    setErr(null);
  };

  async function runSql() {
    if (!sql) return;
    
    setErr(null);
    setLoading(true);
    try {
      const r = await fetch('/api/run-sql', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sql, limit, offset }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Run failed');
      setRows(j.rows);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  const hasRows = !!(rows && rows.length > 0);

  return (
    <main style={{ 
      maxWidth: '100%', 
      padding: 16, 
      minHeight: '100vh', 
      display: 'flex', 
      flexDirection: 'column' 
    }}>
      <div style={{ gridColumn: '1 / -1' }}>
        <h1 className="h1">Midnight NL→SQL Chat</h1>
        <p className="subtitle">Chat with your database in natural language. Context-aware and conversational.</p>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '35% minmax(0, 1fr) 25%',
          gap: 16,
          alignItems: 'stretch',
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        {/* LEFT: Chat Interface */}
        <section className="card" style={{ 
          display: 'flex', 
          flexDirection: 'column',
          minHeight: 0,
          height: '100%'
        }}>
          <div className="toolbar" style={{ marginBottom: 12 }}>
            <span className="badge">SQL Chat Assistant</span>
          </div>
          <ChatInterface onSqlGenerated={handleSqlGenerated} />
        </section>

        {/* MIDDLE + RIGHT wrapped in chart provider */}
        <ChartProvider rows={rows ?? []}>
          {/* MIDDLE: Chart and Results */}
          <div
            style={{
              display: 'grid',
              gridTemplateRows: '50% 50%',
              gap: 12,
              height: '100%',
              minHeight: 0,
              minWidth: 0,
              overflow: 'hidden',
            }}
          >
            {/* Top: Chart card */}
            <section className="card" style={{ 
              display: 'grid', 
              gridTemplateRows: 'auto auto 1fr', 
              minHeight: 0, 
              maxHeight: '100%', 
              overflow: 'hidden' 
            }}>
              <div className="toolbar" style={{ marginBottom: 8 }}>
                <span className="badge">Visualization</span>
                {sql && (
                  <button 
                    onClick={runSql} 
                    disabled={loading} 
                    className="btn secondary"
                    style={{ marginLeft: 'auto' }}
                  >
                    {loading ? 'Running...' : 'Execute SQL'}
                  </button>
                )}
              </div>
              
              {/* SQL Preview */}
              {sql && (
                <div style={{ 
                  marginBottom: 12, 
                  padding: 8, 
                  backgroundColor: '#f8f9fa', 
                  borderRadius: 4,
                  fontSize: '12px',
                  fontFamily: 'monospace',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}>
                  {sql.length > 100 ? `${sql.substring(0, 100)}...` : sql}
                </div>
              )}
              
              <div style={{ position: 'relative', minHeight: 0 }}>
                {hasRows ? (
                  <div style={{ position: 'absolute', inset: 0 }}>
                    <ChartCanvas style={{ width: '100%', height: '100%' }} />
                  </div>
                ) : (
                  <div className="note" style={{ 
                    position: 'absolute', 
                    inset: 0, 
                    display: 'grid', 
                    placeItems: 'center' 
                  }}>
                    {sql ? 'Click "Execute SQL" to see the chart' : 'Chat to generate a query, then execute to see the chart'}
                  </div>
                )}
              </div>
              
              {err && (
                <div className="error" style={{ marginTop: 8, fontSize: '14px' }}>
                  {err}
                </div>
              )}
            </section>

            {/* Bottom: Table card */}
            <section className="card" style={{ 
              display: 'grid', 
              gridTemplateRows: 'auto 1fr', 
              maxHeight: '100%', 
              minHeight: 0, 
              overflow: 'hidden' 
            }}>
              <div className="toolbar" style={{ marginBottom: 8 }}>
                <span className="badge">Results{hasRows ? ` (${rows!.length})` : ''}</span>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span className="label" style={{ margin: 0, fontSize: '12px' }}>Limit</span>
                  <input 
                    className="input" 
                    type="number" 
                    value={limit} 
                    min={1} 
                    onChange={(e) => setLimit(Number(e.target.value))}
                    style={{ width: '70px' }}
                  />
                  <span className="label" style={{ margin: 0, fontSize: '12px' }}>Offset</span>
                  <input 
                    className="input" 
                    type="number" 
                    value={offset} 
                    min={0} 
                    onChange={(e) => setOffset(Number(e.target.value))}
                    style={{ width: '70px' }}
                  />
                </div>
              </div>
              
              <div style={{ minHeight: 0, overflow: 'auto' }}>
                {hasRows ? (
                  <table role="table" style={{ width: '100%' }}>
                    <thead>
                      <tr>
                        {Object.keys(rows![0] || {}).map((k) => (
                          <th key={k}>{k}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows!.map((r, i) => (
                        <tr key={i}>
                          {Object.keys(rows![0] || {}).map((k) => (
                            <td key={k}>{String(r[k])}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="note" style={{ 
                    height: '100%', 
                    display: 'grid', 
                    placeItems: 'center' 
                  }}>
                    Results will appear here after executing SQL.
                  </div>
                )}
              </div>
            </section>
          </div>

          {/* RIGHT: Chart Controls */}
          <section className="card" style={{ 
            minWidth: 0, 
            height: '100%', 
            minHeight: 0, 
            overflow: 'auto' 
          }}>
            <div className="toolbar" style={{ marginBottom: 8 }}>
              <span className="badge">Chart Controls</span>
            </div>
            {hasRows ? (
              <ChartControls />
            ) : (
              <p className="note">Chart controls will appear after executing a query with results.</p>
            )}
          </section>
        </ChartProvider>
      </div>

      <footer className="footer" style={{ marginTop: 16 }}>
        <span>Timezone: {process.env.NEXT_PUBLIC_TZ ?? 'Europe/Paris'}</span>
        <span>•</span>
        <span>Read-only mode enabled</span>
        <span>•</span>
        <span>Context preserved across chat</span>
      </footer>
    </main>
  );
}