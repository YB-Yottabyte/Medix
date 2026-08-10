export type UserType = "guest" | "regular";

export type AppUser = {
  id: string;
  email: string | null;
  name?: string | null;
  image?: string | null;
  type: UserType;
};

export type AppSession = {
  user: AppUser;
};
