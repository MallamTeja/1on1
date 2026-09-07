import { Link } from "react-router-dom";
import { Brand } from "../components/Brand";
import {
  IconArrowRight,
  IconAssistant,
  IconBell,
  IconCheck,
  IconShare,
  IconTranscript,
  IconVideo,
  IconWhiteboard,
} from "../components/Icons";
import "./landing.css";

/* Availability mirrors the product's own example: Monday 6–8 PM,
   Wednesday 7–10 PM, Saturday 10 AM–1 PM. */
const week = [
  {
    day: "Mon",
    date: "25",
    slots: [
      { time: "18:00", tag: "Free", kind: "free" as const },
      { time: "19:00", tag: "₹999", kind: "paid" as const },
    ],
  },
  { day: "Tue", date: "26", slots: [] },
  {
    day: "Wed",
    date: "27",
    slots: [
      { time: "19:00", tag: "₹999", kind: "paid" as const },
      { time: "20:00", tag: "Full", kind: "full" as const },
      { time: "21:00", tag: "₹999", kind: "paid" as const },
    ],
  },
  { day: "Thu", date: "28", slots: [] },
  { day: "Fri", date: "29", slots: [] },
  {
    day: "Sat",
    date: "30",
    slots: [
      { time: "10:00", tag: "₹499", kind: "group" as const },
      { time: "11:00", tag: "₹999", kind: "paid" as const },
      { time: "12:00", tag: "Free", kind: "free" as const },
    ],
  },
  { day: "Sun", date: "31", slots: [] },
];

const loop = [
  {
    verb: "Discover",
    body: "Search people by skill, company, experience, rating, price or when they are actually free. Not courses — people.",
  },
  {
    verb: "Follow",
    body: "One direction, no request to approve. You can follow someone who will never follow you back.",
  },
  {
    verb: "Engage",
    body: "Read what they publish — posts, code snippets, polls — and comment before you ever ask for their time.",
  },
  {
    verb: "Request a session",
    body: "Pick a slot from their published availability, say what you want out of it, and they accept or decline.",
  },
  {
    verb: "Meet",
    body: "The room opens in the tab you are already in. Camera, screen share, whiteboard, shared notes, code, polls.",
  },
  {
    verb: "Collaborate",
    body: "The recap is written before you close the tab, and it stays attached to the session instead of scrolling away.",
  },
];

const offerings = [
  {
    title: "Career Discussion",
    duration: "30 min",
    price: "Free",
    shape: "1:1",
    note: "A short conversation with no invoice attached. Plenty of providers only ever offer these.",
    tone: "free" as const,
  },
  {
    title: "React Architecture Review",
    duration: "60 min",
    price: "₹999",
    shape: "1:1",
    note: "Bring a repository and a decision you are stuck on. Screen share and whiteboard are already in the room.",
    tone: "paid" as const,
  },
  {
    title: "System Design Group Session",
    duration: "90 min",
    price: "₹499",
    shape: "Group · 8 seats",
    note: "Group sessions are not an upgrade tier. They exist from the first day, at the provider's own capacity.",
    tone: "paid" as const,
  },
];

const policy = [
  { when: "More than 3 hours before", fee: "10% fee", refund: "90% refunded" },
  { when: "1–3 hours before", fee: "20% fee", refund: "80% refunded" },
  {
    when: "Under 1 hour",
    fee: "Provider's policy",
    refund: "Set per offering",
  },
  { when: "Provider cancels", fee: "No fee", refund: "100% refunded" },
];

const roomFeatures = [
  { icon: IconVideo, label: "Camera, mic and speaker control" },
  { icon: IconShare, label: "Screen, window or tab sharing" },
  { icon: IconWhiteboard, label: "Shared whiteboard" },
  { icon: IconTranscript, label: "Shared notes and code snippets" },
  { icon: IconBell, label: "Raise hand, reactions, live Q&A" },
  { icon: IconCheck, label: "Polls during the session" },
];

export default function Landing() {
  return (
    <div className="ld">
      <header className="ld-nav">
        <div className="ui-shell ld-nav__inner">
          <Brand />
          <nav className="ld-nav__links" aria-label="Sections">
            <a href="#loop">How it works</a>
            <a href="#sessions">Sessions</a>
            <a href="#room">The room</a>
            <a href="#assistant">AI</a>
          </nav>
          <div className="ld-nav__actions">
            <Link className="ld-nav__login" to="/login">
              Log in
            </Link>
            <Link className="ui-btn ui-btn--sm" to="/register">
              Create your profile
            </Link>
          </div>
        </div>
      </header>
      <hr className="ui-rule" />

      <main>
        {/* ---------------- Hero: the thesis is a week of someone's time ---- */}
        <section className="ld-hero">
          <div className="ui-shell ld-hero__grid">
            <div className="ld-hero__copy">
              <p className="ui-label">Open professional network · Sessions at the centre</p>
              <h1 className="ld-hero__title">
                Follow the people worth following. Then book an hour of their
                time.
              </h1>
              <p className="ld-hero__sub">
                1on1 has no connection requests. Follow anyone, engage with what
                they publish, and request a free or paid session — one to one or
                in a group. The meeting runs in your browser, and the recap is
                waiting when you leave.
              </p>
              <div className="ld-hero__actions">
                <Link className="ui-btn" to="/register">
                  Create your profile
                  <IconArrowRight size={18} />
                </Link>
                <Link className="ld-hero__second" to="/login">
                  Already here? Log in
                </Link>
              </div>
              <p className="ui-label ld-hero__fine">
                Email and password. No phone number, ever.
              </p>
            </div>

            {/* The signature artifact: a real week of published availability. */}
            <div className="ld-hero__art">
              <div className="ld-week">
                <div className="ld-week__head">
                  <div className="ld-week__who">
                    <span className="ld-week__avatar" aria-hidden="true">
                      AR
                    </span>
                    <span>
                      <span className="ld-week__name">Ananya Rao</span>
                      <span className="ld-week__role">
                        Staff Engineer, Payments · 1.2k followers
                      </span>
                    </span>
                  </div>
                  <span className="ui-pill ui-pill--free">Free + paid</span>
                </div>

                <div className="ld-week__grid">
                  {week.map((d) => (
                    <div className="ld-day" key={d.day}>
                      <div className="ld-day__head">
                        <span className="ld-day__name">{d.day}</span>
                        <span className="ld-day__date ui-num">{d.date}</span>
                      </div>
                      {d.slots.length === 0 ? (
                        <span className="ld-day__empty" aria-label="No slots">
                          —
                        </span>
                      ) : (
                        d.slots.map((s) => (
                          <button
                            type="button"
                            key={s.time}
                            className={`ld-chip ld-chip--${s.kind}`}
                            disabled={s.kind === "full"}
                          >
                            <span className="ld-chip__time ui-num">
                              {s.time}
                            </span>
                            <span className="ld-chip__tag">{s.tag}</span>
                          </button>
                        ))
                      )}
                    </div>
                  ))}
                </div>

                <div className="ld-week__foot">
                  <span className="ui-label">Times shown in IST · Asia/Kolkata</span>
                  <Link className="ui-btn ui-btn--sm" to="/register">
                    Request a session
                  </Link>
                </div>
              </div>

              {/* What the request becomes. The states are the real ones. */}
              <div className="ld-track">
                <p className="ui-label">After you ask</p>
                <ol className="ld-track__states">
                  <li className="ld-track__state ld-track__state--now">
                    Requested
                  </li>
                  <li className="ld-track__state">Accepted</li>
                  <li className="ld-track__state">In progress</li>
                  <li className="ld-track__state">Completed</li>
                </ol>
                <p className="ld-track__note">
                  The provider moves it forward, and every transition is decided
                  on the server — so no two people are looking at a different
                  version of the same session.
                </p>
              </div>
            </div>
          </div>
        </section>
        <hr className="ui-rule" />

        {/* ---------------- The loop ---------------------------------------- */}
        <section className="ld-loop" id="loop">
          <div className="ui-shell">
            <div className="ld-sec__head">
              <p className="ui-label">The loop</p>
              <h2 className="ld-sec__title">
                Six steps, and none of them is a course.
              </h2>
              <p className="ld-sec__lede">
                The platform has one primitive — the session — and everything
                else exists to get two people into one.
              </p>
            </div>

            <ol className="ld-loop__list">
              {loop.map((step, i) => (
                <li className="ld-step" key={step.verb}>
                  <span className="ld-step__n ui-num">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <h3 className="ld-step__verb">{step.verb}</h3>
                  <p className="ld-step__body">{step.body}</p>
                </li>
              ))}
            </ol>

            <p className="ld-loop__return">
              <span className="ui-label">Then</span> review it, follow them, and
              come back for the next one.
            </p>
          </div>
        </section>
        <hr className="ui-rule" />

        {/* ---------------- Sessions: free/paid, 1:1/group ------------------ */}
        <section className="ld-sessions" id="sessions">
          <div className="ui-shell">
            <div className="ld-sec__head">
              <p className="ui-label">Offerings</p>
              <h2 className="ld-sec__title">Free or paid. One person or eight.</h2>
              <p className="ld-sec__lede">
                Providers describe sessions in their own words and set their own
                price. There is no marketplace taxonomy to squeeze into, and
                becoming a provider is optional.
              </p>
            </div>

            <div className="ld-offers">
              {offerings.map((o) => (
                <article className={`ld-offer ld-offer--${o.tone}`} key={o.title}>
                  <div className="ld-offer__top">
                    <span className="ld-offer__price ui-num">{o.price}</span>
                    <span className="ui-label">{o.duration}</span>
                  </div>
                  <h3 className="ld-offer__title">{o.title}</h3>
                  <p className="ld-offer__shape ui-label">{o.shape}</p>
                  <p className="ld-offer__note">{o.note}</p>
                </article>
              ))}
            </div>

            <div className="ld-policy">
              <div className="ld-policy__intro">
                <h3 className="ld-policy__title">
                  Cancelling is arithmetic, not a negotiation.
                </h3>
                <p className="ld-policy__body">
                  The refund is calculated on the server from the time left
                  before the session and the provider's published rule — the
                  same number every time, shown before you confirm.
                </p>
              </div>
              <table className="ld-policy__table">
                <caption className="ui-visually-hidden">
                  Cancellation fees and refunds by notice given
                </caption>
                <tbody>
                  {policy.map((row) => (
                    <tr key={row.when}>
                      <th scope="row">{row.when}</th>
                      <td className="ui-num">{row.fee}</td>
                      <td className="ui-num ld-policy__refund">{row.refund}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
        <hr className="ui-rule" />

        {/* ---------------- The meeting room -------------------------------- */}
        <section className="ld-room" id="room">
          <div className="ui-shell ld-room__grid">
            <div className="ld-sec__head ld-sec__head--tight">
              <p className="ui-label">The room</p>
              <h2 className="ld-sec__title">
                The meeting is part of the product, not a link to somewhere
                else.
              </h2>
              <p className="ld-sec__lede">
                Accepting a session gets you a room in the browser you already
                have open. Nothing to install, no dial-in, no link to chase five
                minutes late.
              </p>
            </div>
            <ul className="ld-room__list">
              {roomFeatures.map(({ icon: Glyph, label }) => (
                <li className="ld-room__item" key={label}>
                  <Glyph size={19} />
                  <span>{label}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
        <hr className="ui-rule" />

        {/* ---------------- AI: recap + assistant --------------------------- */}
        <section className="ld-ai" id="assistant">
          <div className="ui-shell">
            <div className="ld-sec__head">
              <p className="ui-label">Intelligence</p>
              <h2 className="ld-sec__title">
                Two kinds of AI, both with their hands tied.
              </h2>
              <p className="ld-sec__lede">
                One writes up the meeting after it ends. The other operates the
                platform for you — and asks first whenever something costs money
                or cannot be undone.
              </p>
            </div>

            <div className="ld-ai__grid">
              {/* Recap artifact */}
              <article className="ld-recap">
                <header className="ld-recap__head">
                  <span className="ui-label">Session recap</span>
                  <span className="ui-label ui-num">24 Aug · 60 min</span>
                </header>
                <h3 className="ld-recap__title">React Architecture Review</h3>
                <dl className="ld-recap__body">
                  <dt className="ui-label">Summary</dt>
                  <dd>
                    Walked the payments dashboard's rendering path. Agreed the
                    slow screen is a data-fetch waterfall, not React.
                  </dd>
                  <dt className="ui-label">Decisions</dt>
                  <dd>
                    Move the three sequential requests behind one endpoint before
                    touching memoisation.
                  </dd>
                  <dt className="ui-label">Action items</dt>
                  <dd>
                    <ul className="ld-recap__items">
                      <li>
                        <span className="ld-recap__owner">Tej</span> will send
                        the project architecture by Friday.
                      </li>
                      <li>
                        <span className="ld-recap__owner">Ananya</span> will
                        share the endpoint contract she uses on payments.
                      </li>
                    </ul>
                  </dd>
                </dl>
              </article>

              {/* Assistant, with the confirmation gate */}
              <article className="ld-assist">
                <header className="ld-assist__head">
                  <IconAssistant size={18} />
                  <span className="ui-label">Assistant</span>
                </header>

                <p className="ld-assist__ask">
                  Find Python mentors free tomorrow evening
                </p>
                <p className="ld-assist__ask">
                  Who that I follow posted about vector search?
                </p>

                <div className="ld-assist__turn">
                  <p className="ld-assist__you">Cancel my session with Rahul.</p>
                  <div className="ld-assist__reply">
                    <p>
                      Your session with Rahul is today at 19:00. Cancelling now
                      applies a <strong>20% fee</strong> — you get{" "}
                      <span className="ui-num">₹799</span> of{" "}
                      <span className="ui-num">₹999</span> back.
                    </p>
                    <div className="ld-assist__gate">
                      <button type="button" className="ui-btn ui-btn--sm">
                        Cancel the session
                      </button>
                      <button
                        type="button"
                        className="ui-btn ui-btn--ghost ui-btn--sm"
                      >
                        Keep it
                      </button>
                    </div>
                  </div>
                </div>

                <p className="ld-assist__fine ui-label">
                  Every action the assistant takes passes the same authorization
                  as the buttons in the interface.
                </p>
              </article>
            </div>
          </div>
        </section>
        <hr className="ui-rule" />

        {/* ---------------- Proof ------------------------------------------- */}
        <section className="ld-proof">
          <div className="ui-shell">
            <p className="ui-label">What providers say</p>
            <div className="ld-proof__grid">
              <blockquote className="ld-quote">
                <p className="ld-quote__ph">
                  [ Quote from an early provider — replace before launch ]
                </p>
                <footer className="ld-quote__by ui-label">
                  [ Name ] · [ Role, company ]
                </footer>
              </blockquote>
              <blockquote className="ld-quote">
                <p className="ld-quote__ph">
                  [ Quote from someone who booked a session — replace before
                  launch ]
                </p>
                <footer className="ld-quote__by ui-label">
                  [ Name ] · [ Role, company ]
                </footer>
              </blockquote>
            </div>
          </div>
        </section>
        <hr className="ui-rule" />

        {/* ---------------- Close ------------------------------------------- */}
        <section className="ld-close">
          <div className="ui-shell ld-close__inner">
            <h2 className="ld-close__title">
              Build the profile first. Offer sessions only if you want to.
            </h2>
            <p className="ld-close__body">
              You can follow people, post, and request sessions without ever
              publishing availability of your own. Providers are users who
              decided to.
            </p>
            <Link className="ui-btn" to="/register">
              Create your profile
              <IconArrowRight size={18} />
            </Link>
          </div>
        </section>
      </main>

      <footer className="ld-foot">
        <hr className="ui-rule" />
        <div className="ui-shell ld-foot__inner">
          <Brand />
          <p className="ui-label ld-foot__note">
            Prototype build · payments are simulated · no real money moves
          </p>
          <nav className="ld-foot__links" aria-label="Footer">
            <Link to="/login">Log in</Link>
            <Link to="/register">Create profile</Link>
            <Link to="/dashboard">Dashboard</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
