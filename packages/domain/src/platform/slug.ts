const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/;

export function isValidSlug(value: string): boolean {
  return SLUG.test(value);
}
