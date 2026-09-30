import { SetMetadata } from '@nestjs/common';
import type { PlatformPermission } from '../constants/platform-permissions';

export const REQUIRED_PLATFORM_PERMISSIONS = 'stack-atlas:platform-permissions';

/** Method requirements override class requirements; every listed permission is required. */
export function RequirePermissions(
  ...permissions: PlatformPermission[]
): ReturnType<typeof SetMetadata> {
  return SetMetadata(REQUIRED_PLATFORM_PERMISSIONS, permissions);
}
