// i18n/RTL guards for the shared components and the shared dictionary (no app message groups).
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
} from '../test-utils/i18nGuards';

const files = componentFiles(path.resolve(__dirname, '..'));

describeHardcodedText(files);
describeMessageGroups();
describePhysicalDirection(files);
describeBareLocale(files);
describeKeysExist(files, 15); // 18 literal t() calls today
describeNoNativeDate(files);
describeDictionary();
