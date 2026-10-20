import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

// Role constants for type safety
export const RoleNames = {
  SALES_STAFF: 'sales_staff',
  MANAGER: 'manager',
  ADMIN: 'admin',
  // Checks and keeps prices right (Sally, 20 Oct 2026): Products with cost
  // prices (and can amend them), the Prices page and the full Backorders
  // report — not admin.
  PRICE_MATCH: 'price_match',
} as const;
