import type { MessageModule } from './types';
import { common } from './common';
import { status } from './status';

/**
 * Extra UI strings, grouped by area and merged into TRANSLATIONS. Keys must be unique across all groups.
 * Only the groups both apps use are listed here; each app adds its own with registerMessages() in
 * translations.ts (see ../appMessages.ts), so shared code never imports app-specific text.
 */
export const MESSAGE_MODULES: Record<string, MessageModule> = { common, status };
