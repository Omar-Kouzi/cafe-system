
import {
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";

import { auth } from "./config";

export const login = async (email, password) => {
  if (!email?.trim() || !password) {
    throw new Error("Email and password are required.");
  }

  const result = await signInWithEmailAndPassword(
    auth,
    email.trim(),
    password
  );

  return result.user;
};

export const logout = async () => {
  await signOut(auth);
};
