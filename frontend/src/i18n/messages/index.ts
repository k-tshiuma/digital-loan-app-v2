import type { MessageModule } from './types';
import { common } from './common';
import { auth } from './auth';
import { wizard } from './wizard';
import { status } from './status';
import { backoffice } from './backoffice';
import { leadFlow } from './leadFlow';

/** Extra UI strings, grouped by area and merged into TRANSLATIONS. Keys must be unique across all groups. */
export const MESSAGE_MODULES: Record<string, MessageModule> = { common, auth, wizard, status, backoffice, leadFlow };
