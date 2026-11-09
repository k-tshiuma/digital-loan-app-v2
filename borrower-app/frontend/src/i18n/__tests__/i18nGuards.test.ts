// i18n/RTL guards for this app's App.tsx and components, against this app's full dictionary (shared
// groups plus the groups registered by appMessages.ts). The shared components are checked by the
// shared package's own suite (shared/frontend/__tests__/i18nGuards.test.ts).
import path from 'path';
import {
  componentFiles,
  describeBareLocale,
  describeDictionary,
  describeHardcodedText,
  describeKeysExist,
  describeMessageGroups,
  describeNoNativeDate,
  describePhysicalDirection,
} from '@quickloan/ui-core/test-utils/i18nGuards';

const files = componentFiles(path.resolve(__dirname, '../..'));

describeHardcodedText(files);
describeMessageGroups();
describePhysicalDirection(files);
describeBareLocale(files);
describeKeysExist(files, 700); // 753 literal t() calls today
describeNoNativeDate(files);
describeDictionary();
