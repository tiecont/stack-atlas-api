export const PLATFORM_PERMISSION = {
  ADMIN_DASHBOARD: 'admin:dashboard',
  CONTENT_READ: 'content:read',
  CONTENT_CREATE: 'content:create',
  CONTENT_UPDATE: 'content:update',
  CONTENT_PUBLISH: 'content:publish',
  CONTENT_ARCHIVE: 'content:archive',
} as const;

export type PlatformPermission =
  (typeof PLATFORM_PERMISSION)[keyof typeof PLATFORM_PERMISSION];

export const PLATFORM_PERMISSIONS = Object.freeze(
  Object.values(PLATFORM_PERMISSION),
);
export const PLATFORM_ROLES = Object.freeze([
  'platform-admin',
  'content-editor',
  'content-publisher',
] as const);
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export function isPlatformPermission(
  value: unknown,
): value is PlatformPermission {
  return PLATFORM_PERMISSIONS.some((permission) => permission === value);
}

export function isPlatformRole(value: unknown): value is PlatformRole {
  return PLATFORM_ROLES.some((role) => role === value);
}
