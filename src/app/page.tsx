// page.tsx - Enhanced with resizable and collapsible panels
'use client';

import { useState, useRef } from 'react';
import dynamic from 'next/dynamic';
import { Panel, PanelGroup, PanelResizeHandle, ImperativePanelHandle } from 'react-resizable-panels';
import { useChartCtx } from './components/ChartJS';

const ChatInterface = dynamic(() => import('./components/ChatInterface'), { 
  ssr: false,
  loading: () => <div className="note">Loading chat...</div>
});
const ChartProvider = dynamic(() => import('./components/ChartJS').then(m => m.ChartProvider), { ssr: false });
const ChartCanvas   = dynamic(() => import('./components/ChartJS').then(m => m.ChartCanvas),   { ssr: false });
const ChartControls = dynamic(() => import('./components/ChartJS').then(m => m.ChartControls), { ssr: false });

type Row = Record<string, any>;

export default function Home() {
  const [sql, setSql] = useState('');
  const [assumptions, setAssumptions] = useState<any>({});
  const [limit, setLimit] = useState(1000);
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [chartSpec, setChartSpec] = useState(null);

  // Panel collapse states
  const [isControlsCollapsed, setIsControlsCollapsed] = useState(false);
  
  // Panel refs for programmatic control
  const chartPanelRef = useRef<ImperativePanelHandle>(null);
  const tablePanelRef = useRef<ImperativePanelHandle>(null);

  const handleSqlGenerated = (newSql: string, newAssumptions: any) => {
    setSql(newSql);
    setAssumptions(newAssumptions);

    if (newAssumptions && typeof newAssumptions === 'object' && newAssumptions.chart) {
      setChartSpec(newAssumptions.chart);
    } else {
      setChartSpec(null);
    }

    setErr(null);

    // 🚀 auto-run if it’s a data query
    if (newSql && newSql.trim()) {
      handleExecuteQuery(newSql, newAssumptions);
    }
  };


  const handleExecuteQuery = async (sql: string, assumptions: any): Promise<void> => {
    setSql(sql);
    setAssumptions(assumptions);
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
  };

  const toggleChartPanel = () => {
    const panel = chartPanelRef.current;
    if (panel) {
      if (panel.isCollapsed()) {
        panel.expand();
      } else {
        panel.collapse();
      }
    }
  };

  const toggleTablePanel = () => {
    const panel = tablePanelRef.current;
    if (panel) {
      if (panel.isCollapsed()) {
        panel.expand();
      } else {
        panel.collapse();
      }
    }
  };

  const handleTestQuery = async (testSql: string, description: string) => {
    setSql(testSql);
    setAssumptions({ ack: `Test query: ${description}` });
    setErr(null);
    setLoading(true);
    
    try {
      const r = await fetch('/api/run-sql', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sql: testSql, limit, offset }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Run failed');
      setRows(j.rows);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  const hasRows = !!(rows && rows.length > 0);

  return (
    <main style={{ 
      maxWidth: '100%', 
      padding: 16, 
      height: '100vh',
      display: 'flex', 
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
     {/* <div style={{ gridColumn: '1 / -1' }}>
        <h1 className="h1">Midnight NL→SQL Chat</h1>
        <p className="subtitle">Chat with your database in natural language. Context-aware and conversational.</p>
      </div>
      */}

      <ChartProvider
         rows={rows ?? []}
         prefill={chartSpec}
         onPrefillWarnings={(warns) => {
           console.warn('[Chart prefill]', warns.join(' | '));
         }}
      >
        <PanelGroup direction="horizontal" style={{ flex: 1, minHeight: 0 }}>
          {/* LEFT: Chat Interface */}
          <Panel 
            defaultSize={35} 
            minSize={15}
          >
            <section className="card" style={{ 
              display: 'flex', 
              flexDirection: 'column',
              minHeight: 0,
              height: '100%',
              maxHeight: '100%',
              overflow: 'hidden',
              position: 'relative'
            }}>
              <div className="toolbar chat-header">
                <span className="badge">SQL Chat Assistant</span>
              </div>
              <ChatInterface 
                onSqlGenerated={handleSqlGenerated} 
                onExecuteQuery={handleExecuteQuery} 
              />
            </section>
          </Panel>

          <PanelResizeHandle style={{
            width: '6px',
            background: 'transparent',
            cursor: 'col-resize',
            margin: '0 2px',
            borderRadius: '2px'
          }} />

          {/* MIDDLE: Chart and Results */}
          <Panel defaultSize={40} minSize={20}>
            <PanelGroup direction="vertical" style={{ height: '100%' }}>
              {/* Top: Chart card */}
              <Panel 
                ref={chartPanelRef}
                defaultSize={50} 
                minSize={15}
                collapsible={true}
              >
                <section className="card" style={{ 
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden'
                }}>
                  <div className="toolbar" style={{ marginBottom: 8, flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="badge">Visualization</span>
                    <button 
                      onClick={toggleChartPanel}
                      style={{ 
                        background: 'none', 
                        border: 'none', 
                        cursor: 'pointer',
                        fontSize: '16px',
                        padding: '2px 6px'
                      }}
                      title="Toggle chart panel"
                    >
                      ↕
                    </button>
                  </div>              
                  <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                    {hasRows ? (
                      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
                        <ChartCanvas style={{ 
                          width: '100%', 
                          height: '100%',
                          position: 'absolute',
                          top: 0,
                          left: 0
                        }} />
                      </div>
                    ) : (
                      <div className="note" style={{ 
                        flex: 1,
                        display: 'grid', 
                        placeItems: 'center' 
                      }}>
                        {sql ? 'Click "Execute" to see the chart' : 'Chat to generate a query, then execute to see the chart'}
                      </div>
                    )}
                    
                    {err && (
                      <div className="error" style={{ marginTop: 8, fontSize: '14px', flexShrink: 0 }}>
                        {err}
                      </div>
                    )}
                  </div>
                </section>
              </Panel>

              <PanelResizeHandle style={{
                height: '6px',
                background: 'transparent',
                cursor: 'row-resize',
                margin: '2px 0',
                borderRadius: '2px'
              }} />

              {/* Bottom: Table card */}
              <Panel 
                ref={tablePanelRef}
                defaultSize={50} 
                minSize={15}
                collapsible={true}
              >
                <section className="card" style={{ 
                  height: '100%',
                  display: 'flex', 
                  flexDirection: 'column',
                  overflow: 'hidden' 
                }}>
                  <div className="toolbar" style={{ marginBottom: 8, flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="badge">Results{hasRows ? ` (${rows!.length})` : ''}</span>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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
                      <button 
                        onClick={toggleTablePanel}
                        style={{ 
                          background: 'none', 
                          border: 'none', 
                          cursor: 'pointer',
                          fontSize: '16px',
                          padding: '2px 6px'
                        }}
                        title="Toggle table panel"
                      >
                        ↕
                      </button>
                    </div>
                  </div>
                  
                  <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
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
              </Panel>
            </PanelGroup>
          </Panel>

          <PanelResizeHandle style={{
            width: '6px',
            background: 'transparent',
            cursor: 'col-resize',
            margin: '0 2px',
            borderRadius: '2px'
          }} />

          {/* RIGHT: Chart Controls */}
          <Panel 
            defaultSize={25} 
            minSize={15}
            collapsible={true}
            onCollapse={() => setIsControlsCollapsed(true)}
            onExpand={() => setIsControlsCollapsed(false)}
          >
            <section className="card" style={{ 
              minWidth: 0, 
              height: '100%', 
              minHeight: 0, 
              overflow: 'auto',
              display: 'flex',
              flexDirection: 'column'
            }}>
              <div className="toolbar" style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="badge">Chart Controls</span>
                {isControlsCollapsed ? (
                  <button 
                    onClick={() => setIsControlsCollapsed(false)}
                    style={{ 
                      background: 'none', 
                      border: 'none', 
                      cursor: 'pointer',
                      fontSize: '16px',
                      padding: '2px 6px'
                    }}
                    title="Expand controls panel"
                  >
                    ←
                  </button>
                ) : (
                  <button 
                    onClick={() => setIsControlsCollapsed(true)}
                    style={{ 
                      background: 'none', 
                      border: 'none', 
                      cursor: 'pointer',
                      fontSize: '16px',
                      padding: '2px 6px'
                    }}
                    title="Collapse controls panel"
                  >
                    →
                  </button>
                )}
              </div>
              <div style={{ 
                display: isControlsCollapsed ? 'none' : 'block',
                flex: 1,
                minHeight: 0,
                overflow: 'auto'
              }}>
                {hasRows ? (
                  <ChartControls />
                ) : (
                  <p className="note">Chart controls will appear after executing a query with results.</p>
                )}
              </div>
            </section>
          </Panel>
        </PanelGroup>
      </ChartProvider>

      {/* Quick test buttons 
      <div style={{ marginTop: 16, marginBottom: 8 }}>
        <span className="badge">Quick Tests</span>
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <button 
            className="btn secondary"
            onClick={() => handleTestQuery(
              'SELECT COUNT(*) as total_blocks FROM block b ORDER BY total_blocks LIMIT $1 OFFSET $2',
              'Total block count'
            )}
          >
            Count Blocks
          </button>
          
          <button 
            className="btn secondary"
            onClick={() => handleTestQuery(
              'SELECT vm.ticker, va.live_delegators, va.live_stake FROM validator va LEFT JOIN validator_metadata vm ON va.aura_pub_key = vm.aura_pub_key ORDER BY va.live_stake DESC LIMIT $1 OFFSET $2',
              'Top validators by stake'
            )}
          >
            Top Validators
          </button>
          
          <button 
            className="btn secondary"
            onClick={() => handleTestQuery(
              'SELECT date_trunc(\'day\', b.time) as day, COUNT(*) as tx_count FROM tx t JOIN block b ON t.block_hash = b.block_hash WHERE b.time >= NOW() - INTERVAL \'60 days\' GROUP BY day ORDER BY day DESC LIMIT $1 OFFSET $2',
              'Transactions last 7 days'
            )}
          >
            Recent Transactions
          </button>
        </div>
      </div>
      */}
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