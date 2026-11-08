/** A group of UI strings. Only English and Hebrew are maintained; other languages fall back to English. */
export interface MessageModule {
  en: Record<string, string>;
  he: Record<string, string>;
}
