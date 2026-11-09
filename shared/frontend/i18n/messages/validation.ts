import type { MessageModule } from './types';

/** Validation messages produced by shared code (visa date checks in config/appConfig.ts). */
export const validation: MessageModule = {
  en: {
    'visa.err.required': 'Visa expiry date is required.',
    'visa.err.invalidDate': 'Invalid date format.',
    'visa.err.expired': 'Visa has already expired.',
    'visa.err.tooShort': 'Visa must have at least {min} months of validity remaining (currently {current} months).',
  },
  he: {
    'visa.err.required': 'יש להזין את תאריך תפוגת האשרה.',
    'visa.err.invalidDate': 'פורמט תאריך לא תקין.',
    'visa.err.expired': 'תוקף האשרה כבר פג.',
    'visa.err.tooShort': 'לאשרה חייבים להישאר לפחות {min} חודשי תוקף (כרגע {current} חודשים).',
  },
};
