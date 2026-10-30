import React from 'react';
import { createRoot } from 'react-dom/client';
import { ChatRoom } from './ChatRoom';
import './style.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Missing root element.');

createRoot(rootElement).render(
  <React.StrictMode>
    <ChatRoom />
  </React.StrictMode>,
);
