// Shared stylized UI mockups for Local Compile for Overleaf promo materials
const { useState } = React;

function Logo({ size = 64, style }) {
  return (
    <img
      src="assets/logo-1024.png"
      alt="Local Compile for Overleaf logo"
      width={size}
      height={size}
      style={{ display: 'block', ...style }}
    />
  );
}

function LogoTile({ size = 64, radius, style }) {
  // White rounded tile behind the logo so the dark laptop reads on dark backgrounds
  const pad = Math.round(size * 0.14);
  return (
    <div
      style={{
        flex: 'none',
        width: size, height: size,
        borderRadius: radius != null ? radius : Math.round(size * 0.22),
        background: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 2px 10px rgba(0,0,0,0.25)',
        ...style,
      }}
    >
      <Logo size={size - pad * 2} />
    </div>
  );
}

function WindowDots() {
  return (
    <React.Fragment>
      <span className="window__dot"></span>
      <span className="window__dot"></span>
      <span className="window__dot"></span>
    </React.Fragment>
  );
}

// The injected compile button group — the heart of the extension
function CompileGroup({ scale = 1, highlight = false }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10 * scale,
        transform: scale !== 1 ? `scale(${scale})` : undefined,
        transformOrigin: 'left center',
        position: 'relative',
      }}
    >
      <div style={{ position: 'relative' }}>
        <div className="btn-recompile">
          <div className="btn-recompile__main">Recompile</div>
          <div className="btn-recompile__caret"><span className="caret-down"></span></div>
        </div>
        {highlight && (
          <div
            style={{
              position: 'absolute',
              inset: -7,
              borderRadius: 30,
              border: '2.5px solid var(--green-soft)',
              boxShadow: '0 0 0 5px rgba(21,163,87,0.22)',
              pointerEvents: 'none',
            }}
          ></div>
        )}
      </div>
      <div className="btn-web">Compile on web</div>
    </div>
  );
}

const TEX_LINES = [
  [1, [['tk-cmd', '\\documentclass'], ['tk-txt', '{article}']]],
  [2, [['tk-com', '% compiled locally with latexmk']]],
  [3, [['tk-cmd', '\\usepackage'], ['tk-txt', '{amsmath}']]],
  [4, [['tk-cmd', '\\usepackage'], ['tk-txt', '{graphicx}']]],
  [5, [['tk-cmd', '\\title'], ['tk-txt', '{Your Paper}']]],
  [6, [['tk-cmd', '\\author'], ['tk-txt', '{You}']]],
  [7, [['tk-cmd', '\\begin'], ['tk-txt', '{document}']]],
  [8, [['tk-cmd', '\\maketitle']]],
  [9, [['tk-cmd', '\\section'], ['tk-txt', '{Introduction}']]],
  [10, [['tk-txt', 'Your introduction goes here.']]],
  [11, [['tk-cmd', '\\input'], ['tk-txt', '{results}']]],
  [12, [['tk-cmd', '\\end'], ['tk-txt', '{document}']]],
];

function CodeLines({ from = 0, to = TEX_LINES.length }) {
  return (
    <React.Fragment>
      {TEX_LINES.slice(from, to).map(([n, toks]) => (
        <div className="ed__ln" key={n}>
          <span className="ed__lnum">{n}</span>
          <span>
            {toks.map(([cls, text], i) => (
              <span className={cls} key={i}>{text}</span>
            ))}
          </span>
        </div>
      ))}
    </React.Fragment>
  );
}

function PaperContent() {
  return (
    <div>
      <div style={{ fontFamily: 'Georgia, serif', textAlign: 'center', color: '#1B222C' }}>
        <div style={{ fontSize: 23, fontWeight: 400 }}>Your Paper</div>
        <div style={{ fontSize: 13, marginTop: 8 }}>You</div>
      </div>
      <div style={{ display: 'grid', gap: 9, marginTop: 26 }}>
        <div className="bar" style={{ width: '34%', background: '#B9BfC6' }}></div>
        <div className="bar bar--dim"></div>
        <div className="bar bar--dim"></div>
        <div className="bar bar--dim" style={{ width: '72%' }}></div>
      </div>
      <div style={{ display: 'grid', gap: 9, marginTop: 22 }}>
        <div className="bar" style={{ width: '46%', background: '#B9BFC6' }}></div>
        <div className="bar bar--dim"></div>
        <div className="bar bar--dim" style={{ width: '88%' }}></div>
        <div className="bar bar--dim"></div>
        <div className="bar bar--dim" style={{ width: '60%' }}></div>
      </div>
    </div>
  );
}

// Full simplified Overleaf editor. width/height set by parent container.
function EditorMockup({ highlight = true, style }) {
  return (
    <div className="window ed" style={style}>
      <div className="ed__top">
        <LogoTile size={30} radius={7} style={{ boxShadow: 'none' }} />
        <div className="ed__menu">
          <span>File</span><span>Edit</span><span>View</span><span>Help</span>
        </div>
        <div className="ed__projname">my-paper</div>
        <div style={{ width: 110 }}></div>
      </div>
      <div className="ed__body">
        <div className="ed__tree">
          <div className="ed__tree-h">File tree</div>
          <div className="ed__file ed__file--active"><span className="ed__ficon"></span>main.tex</div>
          <div className="ed__file"><span className="ed__ficon"></span>results.tex</div>
          <div className="ed__file"><span className="ed__ficon"></span>sample.bib</div>
          <div className="ed__file"><span className="ed__ficon"></span>figure.pdf</div>
        </div>
        <div className="ed__code">
          <CodeLines />
        </div>
        <div className="ed__pdf">
          <div className="ed__pdfbar">
            <CompileGroup highlight={highlight} />
          </div>
          <div className="ed__pdfpage">
            <PaperContent />
          </div>
        </div>
      </div>
    </div>
  );
}

function Terminal({ children, title = 'zsh — ~', style }) {
  return (
    <div className="window" style={style}>
      <div className="window__bar">
        <WindowDots />
        <span className="window__title">{title}</span>
      </div>
      <div className="term">{children}</div>
    </div>
  );
}

function PopupMockup() {
  return (
    <div className="popup">
      <div className="popup__head">
        <Logo size={36} />
        <div>
          <p className="popup__title" style={{ whiteSpace: 'nowrap' }}>Local Compile for Overleaf</p>
          <p className="popup__sub">Self-hosted Overleaf detected</p>
        </div>
      </div>
      <div
        style={{
          marginTop: 14,
          fontFamily: 'var(--mono)',
          fontSize: 13.5,
          color: 'var(--slate-500)',
          background: 'var(--paper-dim)',
          borderRadius: 8,
          padding: '10px 12px',
        }}
      >
        overleaf.lab.example.edu
      </div>
      <div className="popup__btn">Enable on this instance</div>
      <div className="popup__btn popup__btn--ghost">Disable this instance</div>
    </div>
  );
}

function Arrow({ label, flip = false }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, flex: 'none' }}>
      <svg width="92" height="26" viewBox="0 0 92 26" style={{ display: 'block', transform: flip ? 'scaleX(-1)' : undefined }}>
        <line x1="2" y1="13" x2="78" y2="13" stroke="#55657C" strokeWidth="2.5" strokeDasharray="1 7" strokeLinecap="round"></line>
        <path d="M76 5 L88 13 L76 21 Z" fill="var(--green-soft)"></path>
      </svg>
      {label && <span style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--slate-400)', whiteSpace: 'nowrap' }}>{label}</span>}
    </div>
  );
}

Object.assign(window, {
  Logo, LogoTile, WindowDots, CompileGroup, CodeLines, PaperContent,
  EditorMockup, Terminal, PopupMockup, Arrow, TEX_LINES,
});
