const PRODUCTION_API_URL = 'https://mab-path-editor.onrender.com';

const configuredApiUrl = process.env.EXPO_PUBLIC_BACKEND_URL?.trim();

/**
 * Local development can override this with EXPO_PUBLIC_BACKEND_URL. Public
 * builds fail safe to production instead of a visitor's localhost.
 */
export const API_URL = (configuredApiUrl || PRODUCTION_API_URL).replace(/\/$/, '');

