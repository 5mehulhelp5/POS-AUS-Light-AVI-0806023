import React from 'react';
import ReactDOM from 'react-dom/client';
import { Provider } from 'react-redux';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import App from './App';
import { store } from './store';
import { initTheme } from './utils/theme';
import './index.css';

initTheme();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Provider store={store}>
      <BrowserRouter>
        <App />
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 3000,
            style: {
              background: 'rgb(var(--pos-card))',
              color: 'rgb(var(--pos-text))',
              border: '1px solid rgb(var(--gray-700))',
            },
          }}
        />
      </BrowserRouter>
    </Provider>
  </React.StrictMode>
);
