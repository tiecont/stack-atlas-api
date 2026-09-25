import { API_PREFIX } from '../../../app.config';

export const SESSION_COOKIE_NAME = 'stack_atlas_session';
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
export const SESSION_TTL_MILLISECONDS = SESSION_TTL_SECONDS * 1000;
export const SESSION_COOKIE_PATH = `/${API_PREFIX}`;
