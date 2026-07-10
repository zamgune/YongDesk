export type UserRole = "anonymous" | "member" | "admin";

export type UserContext = {
  userId: string | null;
  authenticated: boolean;
  roles: UserRole[];
  permissions: string[];
};

export const anonymousUserContext: UserContext = {
  userId: null,
  authenticated: false,
  roles: ["anonymous"],
  permissions: [],
};
