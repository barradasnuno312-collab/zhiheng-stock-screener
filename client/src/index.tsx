import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ErrorBoundary } from 'react-error-boundary';
import { AppContainer } from '@lark-apaas/client-toolkit/components/AppContainer';
import App from './app';
import './index.css';

const CLIENT_BASE_PATH = process.env.CLIENT_BASE_PATH || '/';

const MainApp = () => {
  return <BrowserRouter basename={CLIENT_BASE_PATH}>
    <AppContainer defaultTheme="light">
      <ErrorBoundary fallbackRender={({ resetErrorBoundary }) => <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
        <div role="alert" className="max-w-md rounded-lg border bg-card p-6 text-center">
          <h1 className="text-lg font-semibold">页面未能完成载入</h1>
          <p className="mt-2 text-sm text-muted-foreground">请重试；已保存的策略和数据版本不会因此改变。</p>
          <button className="mt-5 min-h-11 rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground"
            onClick={resetErrorBoundary}>重新载入页面</button>
        </div>
      </main>}>
        <App />
      </ErrorBoundary>
    </AppContainer>
  </BrowserRouter>;
};

createRoot(document.getElementById('root')!).render(<MainApp />);
