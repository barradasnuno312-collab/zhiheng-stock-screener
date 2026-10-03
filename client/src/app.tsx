import React, { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';

const ResearchPage = lazy(() => import('./pages/research/ResearchPage'));
const NotFound = lazy(() => import('./pages/NotFound/NotFound'));

const App = () => <Suspense fallback={<main className="min-h-screen bg-background p-6 text-foreground" aria-busy="true">
  <div className="mx-auto max-w-[1600px] space-y-6">
    <div className="flex h-16 items-center justify-between rounded-lg border bg-card px-5">
      <strong className="tracking-[0.2em]">知衡</strong>
      <span className="text-xs text-muted-foreground">正在恢复研究工作台</span>
    </div>
    <div className="grid gap-6 lg:grid-cols-[0.85fr_1.4fr]">
      <div className="h-40 animate-pulse rounded-lg bg-muted" />
      <div className="h-56 animate-pulse rounded-lg bg-muted" />
    </div>
  </div>
</main>}>
  <Routes>
    <Route index element={<ResearchPage />} />
    <Route path="strategies" element={<ResearchPage />} />
    <Route path="*" element={<NotFound />} />
  </Routes>
</Suspense>;

export default App;
