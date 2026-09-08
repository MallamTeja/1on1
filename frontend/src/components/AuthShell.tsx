import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Brand } from "./Brand";
import { IconChevronLeft, IconGoogle } from "./Icons";
import { googleAuthorizeUrl } from "../lib/api";
import "./authShell.css";

/**
 * Login and Register share one shell so the two screens are unmistakably the
 * same product: a spruce panel carrying a real piece of the product on the
 * left, the form on white to the right.
 */
export function AuthShell({
  eyebrow,
  title,
  sub,
  panel,
  panelFine,
  children,
  footer,
}: {
  eyebrow: string;
  title: string;
  sub: string;
  panel: ReactNode;
  panelFine: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="au">
      <aside className="au-panel">
        <Brand tone="dark" />
        <div className="au-panel__body">{panel}</div>
        <p className="ui-label au-panel__fine">{panelFine}</p>
      </aside>

      <main className="au-main">
        <div className="au-card">
          <Link className="au-back" to="/">
            <IconChevronLeft size={16} />
            Back to 1on1
          </Link>

          <header className="au-head">
            <p className="ui-label">{eyebrow}</p>
            <h1 className="au-title">{title}</h1>
            <p className="au-sub">{sub}</p>
          </header>

          {children}

          <div className="au-or">
            <span className="ui-label">or</span>
          </div>

          {/* A full-page navigation, not a fetch — Google has to see the
              browser. The backend sets the refresh cookie on its callback and
              returns here with no token in the URL; a failure comes back as
              /login?error=<code>. */}
          <button
            type="button"
            className="au-google"
            onClick={() => window.location.assign(googleAuthorizeUrl())}
          >
            <IconGoogle size={18} />
            Continue with Google
          </button>

          <p className="au-foot">{footer}</p>
        </div>
      </main>
    </div>
  );
}
