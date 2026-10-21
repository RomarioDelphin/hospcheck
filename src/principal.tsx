import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Aplicacao } from './Aplicacao';
import './estilos.css';

const raiz = document.getElementById('raiz');
if (raiz) {
  createRoot(raiz).render(
    <React.StrictMode>
      <BrowserRouter>
        <Aplicacao />
      </BrowserRouter>
    </React.StrictMode>
  );
}
