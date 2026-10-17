import Link from "next/link";
import { currentUser } from "@/lib/http";
import { LogoMark } from "./Logo";
import { NavLinks } from "./NavLinks";
import { ThemeToggle } from "./ThemeToggle";
import { LogoutButton } from "./LogoutButton";
import { isGuest } from "@/lib/services/trial";

export async function TopBar() {
  const user = await currentUser();
  const guest = isGuest(user);
  const links = guest
    ? [
        { href: "/try", label: "Free trial" },
        { href: "/history", label: "My answers" },
        { href: "/how-we-evaluate", label: "How we mark" },
      ]
    : user
    ? [
        { href: "/today", label: "Today" },
        { href: "/practice", label: "Practice" },
        { href: "/progress", label: "Progress" },
        { href: "/history", label: "History" },
        { href: "/how-we-evaluate", label: "How we mark" },
        ...(user.role !== "student" ? [{ href: "/admin", label: "Review desk" }] : []),
      ]
    : [
        { href: "/try", label: "Try free" },
        { href: "/how-we-evaluate", label: "How we mark" },
      ];
  return (
    <header className="topbar">
      <div className="container topbar-inner">
        <Link href={guest ? "/try" : user ? "/today" : "/"} className="brand" aria-label="MarkMyWords home">
          <LogoMark />
          <span>MarkMyWords</span>
        </Link>
        <NavLinks links={links} />
        <ThemeToggle />
        {guest ? (
          <div className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
            <span className="chip butter" title="Private guest trial">Guest</span>
            <Link className="btn" href="/signup">Save my work</Link>
          </div>
        ) : user ? (
          <div className="row" style={{ gap: 10, flexWrap: "nowrap" }}>
            <Link href="/settings" className="user-chip" style={{ color: "var(--inv-fg)", textDecoration: "none" }} aria-label="Settings">
              <span className="avatar">{user.display_name.slice(0, 1).toUpperCase()}</span>
            </Link>
            <LogoutButton />
          </div>
        ) : (
          <div className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
            <Link className="nav-plain" href="/login" style={{ color: "var(--inv-fg)", fontWeight: 650, textDecoration: "none" }}>Log in</Link>
            <Link className="btn" href="/signup">Start free</Link>
          </div>
        )}
      </div>
    </header>
  );
}
