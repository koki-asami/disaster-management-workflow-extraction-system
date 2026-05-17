import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import 'bootstrap/dist/css/bootstrap.min.css';
import './index.css';
import App from './App';

/** Catches render errors so the tab is not silently blank (check Console → All levels). */
class RootErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('RootErrorBoundary:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      const e = this.state.error;
      const msg = e && typeof e === 'object' && 'message' in e ? e.message : String(e);
      const stack = e && typeof e === 'object' && 'stack' in e ? e.stack : '';
      return (
        <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif', maxWidth: 720 }}>
          <h1 style={{ fontSize: '1.25rem' }}>画面の表示中にエラーが発生しました</h1>
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              background: '#fef2f2',
              padding: 12,
              borderRadius: 8,
              color: '#991b1b',
              fontSize: 13,
            }}
          >
            {msg}
            {stack ? `\n\n${stack}` : ''}
          </pre>
          <p style={{ color: '#444', fontSize: 14 }}>
            開発者ツールの Console を開き、フィルタを「Default levels」すべて表示にしてください（Cursor 内蔵ブラウザではエラーが隠れることがあります）。
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('要素 #root が見つかりません。index.html を確認してください。');
}

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </RootErrorBoundary>
  </React.StrictMode>
);
