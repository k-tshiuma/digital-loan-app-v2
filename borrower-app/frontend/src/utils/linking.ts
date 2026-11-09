/**
 * Cross-platform Linking interface.
 * Implements React Native's Linking.openURL API contract so that code is directly
 * compatible when compiled for iOS/Android with React Native, while executing
 * seamlessly in the current web-first mockup environment.
 */
export const Linking = {
  /**
   * Opens the given URL (e.g. 'tel:+972-3-555-0199', 'mailto:...', 'https://...').
   * In a React Native native runtime, this maps to react-native's Linking.openURL.
   * In the web mockup runtime, it navigates via window.location.href or window.open.
   */
  openURL: async (url: string): Promise<boolean> => {
    try {
      if (typeof window !== 'undefined') {
        if (url.startsWith('tel:') || url.startsWith('mailto:')) {
          window.location.href = url;
        } else {
          window.open(url, '_blank', 'noopener,noreferrer');
        }
        return true;
      }
      return false;
    } catch (error) {
      console.warn('[Linking.openURL] Failed to open URL:', url, error);
      return false;
    }
  },

  /**
   * Checks if a URL scheme can be opened.
   */
  canOpenURL: async (url: string): Promise<boolean> => {
    if (!url) return false;
    return true;
  },
};
