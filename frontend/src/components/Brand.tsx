import { Link } from "react-router-dom";

/**
 * The wordmark sets the whole system's thesis in four characters: two numerals
 * in the display face with the join set in mono, so the name reads as two
 * people either side of a connector.
 */
export function Brand({
  tone = "light",
  to = "/",
}: {
  tone?: "light" | "dark";
  to?: string;
}) {
  return (
    <Link className={`brand brand--${tone}`} to={to}>
      <svg
        className="brand__mark"
        width="26"
        height="26"
        viewBox="0 0 32 32"
        aria-hidden="true"
        focusable="false"
      >
        <rect width="32" height="32" rx="5" fill="currentColor" />
        <rect x="6" y="8" width="13" height="6" rx="1.5" fill="#f1f4f2" />
        <rect x="13" y="18" width="13" height="6" rx="1.5" fill="#8fd3c1" />
      </svg>
      <span className="brand__word">
        1<span className="brand__join">on</span>1
      </span>
    </Link>
  );
}
