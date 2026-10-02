import React from 'react';
import { Route, Routes } from 'react-router-dom';

import ResearchPage from './pages/research/ResearchPage';
import NotFound from './pages/NotFound/NotFound';

const RoutesComponent = () => {
  return (
    <Routes>
      <Route index element={<ResearchPage />} />
      <Route path="strategies" element={<ResearchPage />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
};

export default RoutesComponent;
