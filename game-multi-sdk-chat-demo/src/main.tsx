import React from 'react';
import { createRoot } from 'react-dom/client';
import { ChatRoom } from './ChatRoom';
import './style.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ChatRoom />
  </React.StrictMode>,
);
