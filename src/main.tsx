import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {ApprovalHost} from './security/approval';
import {FullControlBadge} from './security/FullControlBadge';
import {PhoneConnect} from './security/PhoneConnect';
import {installSecureFetch} from './security/session';
import './index.css';

installSecureFetch();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <ApprovalHost />
    <FullControlBadge />
    <PhoneConnect />
  </StrictMode>,
);
