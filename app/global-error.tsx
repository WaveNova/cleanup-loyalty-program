'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="zh-Hant">
      <body style={{
        minHeight: '100vh', background: '#0A1628', color: '#eaf6f9',
        padding: 24, fontFamily: 'monospace', margin: 0,
      }}>
        <h2 style={{ color: '#FF6B4A', marginBottom: 12, fontSize: 16 }}>全域錯誤</h2>
        <pre style={{
          whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.5,
          background: 'rgba(255,255,255,0.06)', padding: 12, borderRadius: 8,
          overflowX: 'auto',
        }}>
          {error.message}
          {'\n\n'}
          {error.stack?.split('\n').slice(0, 8).join('\n')}
          {error.digest ? `\n\ndigest: ${error.digest}` : ''}
        </pre>
        <button
          onClick={reset}
          style={{
            marginTop: 16, padding: '10px 20px', background: '#24B5CB',
            border: 0, borderRadius: 8, color: '#04222b', cursor: 'pointer', fontSize: 14,
          }}
        >
          重試
        </button>
      </body>
    </html>
  );
}
