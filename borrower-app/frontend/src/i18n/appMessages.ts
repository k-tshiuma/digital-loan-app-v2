// Registers this app's own UI text groups with the shared translations. Import it first, before any
// component (main.tsx, the test setup and scripts/generate-hebrew-review.ts do).
import { registerMessages } from '@quickloan/ui-core/i18n/translations';
import { auth } from './messages/auth';
import { wizard } from './messages/wizard';
import { leadFlow } from './messages/leadFlow';

registerMessages({ auth, wizard, leadFlow });
