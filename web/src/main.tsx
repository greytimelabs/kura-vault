import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/index.css';

const root = createRoot(document.getElementById('root')!);

// Browsers expose WebCrypto only on https:// and localhost. Without it nothing can
// be decrypted, so say that plainly instead of failing somewhere deep inside.
if (!window.isSecureContext || !globalThis.crypto?.subtle) {
  root.render(
    <main className="flex min-h-dvh items-center justify-center p-6 text-center">
      <div className="max-w-md">
        <h1 className="text-xl font-semibold">A secure connection is required</h1>
        <p className="mt-2 text-sm text-muted">
          Kura Vault decrypts your photos in the browser, which browsers only allow over HTTPS. Open this page using
          an https:// address.
        </p>
      </div>
    </main>,
  );
} else {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
