import { createRoot } from 'react-dom/client';
import { App } from '../../src/app/App';
import { createPublicServices } from '../../src/client/public-events';
import '../../src/app/styles.css';

const root = document.getElementById('public-app-fixture');
if (!root) throw new Error('Missing fictional public app fixture.');
const services = createPublicServices(`${window.location.origin}/__public-api`);
createRoot(root).render(<App publicServices={services} />);
