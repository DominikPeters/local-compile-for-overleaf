// Carousel slides (1280×800) for the Chrome Web Store listing
const SLIDE_W = 1280;
const SLIDE_H = 800;

function SlideBase({ children, style }) {
  return (
    <div className="board board--dark" style={{ width: SLIDE_W, height: SLIDE_H, ...style }}>
      {children}
    </div>
  );
}

function CornerMark() {
  return (
    <div style={{ position: 'absolute', top: 44, right: 56 }}>
      <LogoTile size={54} />
    </div>
  );
}

/* ---- 01 · Hero ---- */
function SlideHero() {
  return (
    <SlideBase>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '52px 0 0 96px' }}>
        <LogoTile size={60} />
        <span style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.01em' }}>
          Local Compile for Overleaf
        </span>
      </div>
      <div style={{ padding: '30px 96px 0', maxWidth: 1000 }}>
        <h1 className="h1" style={{ fontSize: 62 }}>
          Compile Overleaf projects on your own machine.
        </h1>
        <p className="sub" style={{ marginTop: 20, maxWidth: 860 }}>
          A Recompile button in the Overleaf toolbar that runs latexmk with your
          local TeX installation — and puts the PDF right back in the preview.
        </p>
      </div>
      <div style={{ position: 'absolute', left: 96, right: 96, top: 400, height: 460 }}>
        <EditorMockup style={{ height: '100%', borderRadius: '14px 14px 0 0' }} />
      </div>
    </SlideBase>
  );
}

/* ---- 02 · No timeouts ---- */
function LogLine({ children }) {
  return <div style={{ whiteSpace: 'pre' }}>{children}</div>;
}

function SlideNoTimeouts() {
  return (
    <SlideBase>
      <CornerMark />
      <div style={{ padding: '104px 96px 0' }}>
        <div className="eyebrow">Your machine, full power</div>
        <h1 className="h1" style={{ marginTop: 16 }}>No compile timeouts.</h1>
        <p className="sub" style={{ marginTop: 18, maxWidth: 880 }}>
          Long documents, heavy TikZ figures, large bibliographies — compiled with
          your own hardware, as often as you like.
        </p>
      </div>
      <div style={{ display: 'flex', gap: 36, padding: '76px 96px 0', alignItems: 'stretch' }}>
        <div
          style={{
            flex: 1, borderRadius: 14, padding: '34px 36px', minHeight: 300,
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.10)',
            opacity: 0.85,
          }}
        >
          <div className="footnote" style={{ marginBottom: 20 }}>web compile · free plan</div>
          <div
            style={{
              borderRadius: 10, padding: '20px 22px',
              background: 'rgba(194,72,63,0.13)',
              border: '1px solid rgba(194,72,63,0.45)',
            }}
          >
            <div style={{ fontSize: 19, fontWeight: 600, color: '#E89A93' }}>Compile timed out</div>
            <div style={{ fontSize: 15.5, color: 'var(--slate-300)', marginTop: 6, lineHeight: 1.45 }}>
              This project exceeded the compile time limit.
            </div>
          </div>
          <div style={{ display: 'grid', gap: 10, marginTop: 22 }}>
            <div className="bar" style={{ background: 'rgba(255,255,255,0.10)' }}></div>
            <div className="bar" style={{ background: 'rgba(255,255,255,0.10)', width: '74%' }}></div>
          </div>
        </div>
        <div
          style={{
            flex: 1.25, borderRadius: 14, padding: '34px 36px', minHeight: 300,
            background: '#161D27',
            border: '1.5px solid var(--green)',
            boxShadow: '0 0 0 4px rgba(9,136,66,0.15)',
            fontFamily: 'var(--mono)', fontSize: 17.5, lineHeight: 2.15,
            color: '#D7DEE6',
          }}
        >
          <div className="footnote" style={{ marginBottom: 16, color: 'var(--green-soft)' }}>
            local compile · this machine
          </div>
          <LogLine><span className="dim" style={{ color: '#66788E' }}>$ </span>latexmk -pdf main.tex</LogLine>
          <LogLine><span style={{ color: '#8B9AAD' }}>Running pdflatex … 3 passes, bibtex, 214 figures</span></LogLine>
          <LogLine><span style={{ color: '#8B9AAD' }}>Output written on main.pdf (412 pages)</span></LogLine>
          <LogLine><span style={{ color: 'var(--green-soft)', fontWeight: 600 }}>✓ Finished in 38.1 s — no limits</span></LogLine>
        </div>
      </div>
    </SlideBase>
  );
}

/* ---- 03 · Setup ---- */
function SlideSetup() {
  return (
    <SlideBase>
      <CornerMark />
      <div style={{ padding: '88px 96px 0' }}>
        <div className="eyebrow">Install</div>
        <h1 className="h1" style={{ marginTop: 16 }}>Set up in two commands.</h1>
        <p className="sub" style={{ marginTop: 18, maxWidth: 860 }}>
          The extension talks to a small native host. Install it once with pip and
          it registers itself with Chrome — no config files.
        </p>
      </div>
      <div style={{ padding: '52px 170px 0' }}>
        <Terminal title="terminal">
          <div><span className="p">$ </span>pip install local-compile-for-overleaf</div>
          <div><span className="p">$ </span>python3 -m local_compile_for_overleaf</div>
          <div><span className="ok">✓</span> Native messaging host registered for Chrome</div>
          <div><span className="ok">✓</span> Found latexmk — ready to compile</div>
        </Terminal>
        <div className="footnote" style={{ marginTop: 26, textAlign: 'center' }}>
          Requires Python 3 and a local TeX installation (latexmk).
        </div>
      </div>
    </SlideBase>
  );
}

/* ---- 04 · How it works ---- */
function SlideHowItWorks() {
  return (
    <SlideBase>
      <CornerMark />
      <div style={{ padding: '104px 96px 0' }}>
        <div className="eyebrow">Under the hood</div>
        <h1 className="h1" style={{ marginTop: 16 }}>How it works.</h1>
        <p className="sub" style={{ marginTop: 18, maxWidth: 900 }}>
          A project snapshot goes out, a compiled PDF comes back. To Overleaf it
          looks like any other compile — logs included.
        </p>
      </div>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 18,
          padding: '110px 96px 0',
        }}
      >
        <div className="node" style={{ flex: 1.05, padding: '30px 30px' }}>
          <span className="node__kicker">in the browser</span>
          <span className="node__title">Extension</span>
          <span className="node__desc">Snapshots your project from the Overleaf editor</span>
        </div>
        <Arrow label="native messaging" />
        <div className="node" style={{ flex: 1.05, padding: '30px 30px', borderColor: 'var(--green)', boxShadow: '0 0 0 4px rgba(9,136,66,0.14)' }}>
          <span className="node__kicker" style={{ color: 'var(--green-soft)' }}>on your machine</span>
          <span className="node__title">Native host</span>
          <span className="node__desc">Runs latexmk with your own TeX installation</span>
        </div>
        <Arrow label="pdf + logs" />
        <div className="node" style={{ flex: 1.05, padding: '30px 30px' }}>
          <span className="node__kicker">back in overleaf</span>
          <span className="node__title">PDF preview</span>
          <span className="node__desc">Output and raw logs appear in the editor</span>
        </div>
      </div>
    </SlideBase>
  );
}

/* ---- 05 · Self-hosted CE ---- */
function SlideSelfHosted() {
  return (
    <SlideBase>
      <div style={{ padding: '88px 96px 0', maxWidth: 720 }}>
        <div className="eyebrow">Community Edition</div>
        <h1 className="h1" style={{ marginTop: 16 }}>Self-hosted Overleaf? Supported.</h1>
        <p className="sub" style={{ marginTop: 18 }}>
          overleaf.com works out of the box. Enable your own Community Edition
          instance from the toolbar popup — the extension only gets access to
          hosts you approve.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 44 }}>
          <div className="chip">1 &nbsp;·&nbsp; Open a project on your CE instance</div>
          <div className="chip">2 &nbsp;·&nbsp; Click the toolbar icon</div>
          <div className="chip">3 &nbsp;·&nbsp; Enable on this instance</div>
        </div>
      </div>
      <div style={{ position: 'absolute', right: 130, top: 218 }}>
        <div
          style={{
            position: 'absolute', right: 6, top: -44,
            fontFamily: 'var(--mono)', fontSize: 14, color: 'var(--slate-400)',
          }}
        >
          toolbar popup ↓
        </div>
        <PopupMockup />
      </div>
    </SlideBase>
  );
}

window.PROMO_SLIDES = [
  { id: 'slide-1-hero', name: '01 · Hero', w: SLIDE_W, h: SLIDE_H, C: SlideHero },
  { id: 'slide-2-timeouts', name: '02 · No timeouts', w: SLIDE_W, h: SLIDE_H, C: SlideNoTimeouts },
  { id: 'slide-3-setup', name: '03 · Setup', w: SLIDE_W, h: SLIDE_H, C: SlideSetup },
  { id: 'slide-4-how', name: '04 · How it works', w: SLIDE_W, h: SLIDE_H, C: SlideHowItWorks },
  { id: 'slide-5-ce', name: '05 · Self-hosted CE', w: SLIDE_W, h: SLIDE_H, C: SlideSelfHosted },
];
