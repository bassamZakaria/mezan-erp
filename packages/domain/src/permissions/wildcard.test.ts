import { describe, it, expect } from "vitest";
import {
  ALL_PERMISSION_CODES,
  ALL_SCOPE,
  WILDCARD_PERMISSION,
  can,
  createAuthContext,
  isKnownPermission,
  isTenantAdmin,
  resolvePermissions,
  visibilityTier,
} from "./index.js";
