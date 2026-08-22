import { useMemo, useRef, useState } from "react";
import {
  saveRole,
  deleteRole,
  saveUser,
  setUserStatus,
  type Entitlements,
  type Role,
  type SaveRoleCommand,
  type SaveUserCommand,
  type User,
} from "@mezan/domain";
import { createLocalStore } from "../local-store";

export interface StoreResult<T> {
  ok: boolean;
  value?: T;
  error?: string;
}

async function attempt<T>(fn: () => Promise<T>): Promise<StoreResult<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * React binding over `local-store.ts`'s in-memory UnitOfWork: exposes the
 * current roles/users as plain arrays (re-derived on every mutation) plus
 * action functions that call straight into `@mezan/domain`'s real
 * `saveRole` / `saveUser` / `deleteRole` / `setUserStatus` use-cases.
 */
export function useUsersRolesStore(seed: { roles: Role[]; users: User[] }) {
  const storeRef = useRef(createLocalStore(seed));
  const [version, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);

  const roles = useMemo(() => storeRef.current.listRoles(), [version]);
  const users = useMemo(() => storeRef.current.listUsers(), [version]);

  async function createOrUpdateRole(
    cmd: SaveRoleCommand,
    entitlements: Entitlements,
  ): Promise<StoreResult<Role>> {
    const result = await attempt(() => saveRole(cmd, storeRef.current.uow, entitlements));
    if (result.ok) bump();
    return result;
  }

  async function removeRole(roleId: string): Promise<StoreResult<void>> {
    const result = await attempt(() => deleteRole(roleId, storeRef.current.uow));
    if (result.ok) bump();
    return result;
  }

  async function createOrUpdateUser(cmd: SaveUserCommand): Promise<StoreResult<User>> {
    const result = await attempt(() => saveUser(cmd, storeRef.current.uow, storeRef.current.hasher));
    if (result.ok) bump();
    return result;
  }

  async function toggleUserStatus(userId: string, status: User["status"]): Promise<StoreResult<User>> {
    const result = await attempt(() => setUserStatus(userId, status, storeRef.current.uow));
    if (result.ok) bump();
    return result;
  }

  return { roles, users, createOrUpdateRole, removeRole, createOrUpdateUser, toggleUserStatus };
}
