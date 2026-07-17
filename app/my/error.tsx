'use client';

export default function MyError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div style={{
      minHeight: '100vh', background: '#0A1628', color: '#eaf6f9',
      padding: 24, fontFamily: 'monospace',
    }}>
      <h2 style={{ color: '#FF6B4A', marginBottom: 12, fontSize: 16 }}>頁面發生錯誤</h2>
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
    </div>
  );
}
