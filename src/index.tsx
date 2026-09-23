import { createRoot } from 'react-dom/client';
import './index.css';
import App from './shell/App';
import ErrorBoundary from './shell/ErrorBoundary';

createRoot(document.getElementById('root')!).render(<ErrorBoundary><App /></ErrorBoundary>);
