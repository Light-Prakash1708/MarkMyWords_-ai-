"use client";
import { api } from "./api";

export function LogoutButton() {
  return (
    <button
      type="button"
      className="btn sm"
      onClick={async () => {
        await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
        window.location.href = "/";
      }}
    >
      Log out
    </button>
  );
}
