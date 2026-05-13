const devInstanceSuffix = import.meta.env.VITE_BURETTE_DEV_INSTANCE ?? "8a18";

export const appInstanceLabel = import.meta.env.DEV
  ? `Burette Dev ${devInstanceSuffix}`
  : "Burette";
