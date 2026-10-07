export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
    public details?: unknown,
  ) {
    super(message);
  }
}
export function requireValue<T>(value: T | null | undefined, message = 'Not found'): T {
  if (value == null) throw new AppError(message, 404);
  return value;
}
export function admin(user: { role: string }) {
  if (user.role !== 'admin') throw new AppError('Administrator access is required.', 403);
}
