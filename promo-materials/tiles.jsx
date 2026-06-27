// Promo tiles: small (440×280) + marquee (1400×560)

/* =================== SMALL TILES 440×280 =================== */

function TileSmallDark() {
  return (
    <div className="board board--dark" style={{ width: 440, height: 280, display: 'flex', alignItems: 'center', gap: 24, padding: '0 32px' }}>
      <LogoTile size={116} style={{ flex: 'none' }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 27, fontWeight: 700, lineHeight: 1.18, letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}>
          Local Compile<br />for Overleaf
        </div>
        <div className="brand-rule" style={{ margin: '14px 0' }}></div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 14, color: 'var(--slate-300)', whiteSpace: 'nowrap' }}>
          Your TeX. One click.
        </div>
      </div>
    </div>
  );
}

function TileSmallGreen() {
  return (
    <div className="board" style={{ width: 440, height: 280, background: 'var(--green)', color: '#fff', display: 'flex', alignItems: 'center', gap: 22, padding: '0 32px' }}>
      <div
        style={{
          flex: 'none', width: 124, height: 124, borderRadius: 26,
          background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 10px 28px rgba(0,0,0,0.22)',
        }}
      >
        <Logo size={96} />
      </div>
      <div>
        <div style={{ fontSize: 27, fontWeight: 700, lineHeight: 1.18, letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}>
          Local Compile<br />for Overleaf
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 14, marginTop: 12, color: 'rgba(255,255,255,0.85)', whiteSpace: 'nowrap' }}>
          latexmk, on your machine
        </div>
      </div>
    </div>
  );
}

function TileSmallLight() {
  return (
    <div className="board" style={{ width: 440, height: 280, background: '#FAFBFA', color: 'var(--ink)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, borderTop: '8px solid var(--green)' }}>
      <Logo size={108} />
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 25, fontWeight: 700, letterSpacing: '-0.01em' }}>Local Compile for Overleaf</div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 13.5, color: 'var(--slate-500)', marginTop: 8 }}>
          compile with your local TeX installation
        </div>
      </div>
    </div>
  );
}

/* =================== MARQUEE TILES 1400×560 =================== */

function MarqueeProduct() {
  return (
    <div className="board board--dark" style={{ width: 1400, height: 560 }}>
      <div style={{ position: 'absolute', left: 84, top: 0, bottom: 0, width: 590, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <LogoTile size={56} />
          <span style={{ fontFamily: 'var(--mono)', fontSize: 16, color: 'var(--slate-300)', letterSpacing: '0.06em' }}>
            LOCAL COMPILE FOR OVERLEAF
          </span>
        </div>
        <h1 className="h1" style={{ fontSize: 54, marginTop: 26 }}>
          Compile Overleaf projects on your own machine.
        </h1>
        <p className="sub" style={{ marginTop: 18, fontSize: 21 }}>
          One click in the editor. latexmk and your TeX installation do the rest.
        </p>
      </div>
      <div style={{ position: 'absolute', left: 740, top: 64, width: 900, height: 560 }}>
        <EditorMockup style={{ height: '100%', borderRadius: '14px 0 0 0' }} />
      </div>
    </div>
  );
}

function MarqueeGreen() {
  return (
    <div className="board" style={{ width: 1400, height: 560, background: 'var(--green)', color: '#fff' }}>
      <div
        style={{
          position: 'absolute', right: -60, top: -130,
          fontFamily: 'var(--mono)', fontSize: 560, fontWeight: 600,
          color: 'rgba(255,255,255,0.10)', letterSpacing: '-0.06em',
          lineHeight: 1, userSelect: 'none', whiteSpace: 'nowrap',
        }}
      >
        \{'{'}{'}'}
      </div>
      <div style={{ position: 'absolute', left: 84, top: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', maxWidth: 880 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
          <div style={{ width: 96, height: 96, borderRadius: 22, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 12px 32px rgba(0,0,0,0.20)' }}>
            <Logo size={74} />
          </div>
          <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: '-0.01em' }}>
            Local Compile for Overleaf
          </div>
        </div>
        <h1 className="h1" style={{ fontSize: 58, marginTop: 36 }}>
          No timeouts. No queue.<br />Just your TeX installation.
        </h1>
        <div style={{ display: 'flex', gap: 14, marginTop: 34 }}>
          <span className="chip" style={{ background: 'rgba(255,255,255,0.14)', border: '1px solid rgba(255,255,255,0.35)', color: '#fff' }}>
            pip install local-compile-for-overleaf
          </span>
        </div>
      </div>
    </div>
  );
}

function MarqueeSplit() {
  return (
    <div className="board" style={{ width: 1400, height: 560, background: '#FAFBFA', color: 'var(--ink)' }}>
      <div style={{ position: 'absolute', left: 84, top: 0, bottom: 0, width: 560, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Logo size={60} />
          <span style={{ fontSize: 23, fontWeight: 700, letterSpacing: '-0.01em' }}>
            Local Compile for Overleaf
          </span>
        </div>
        <h1 className="h1" style={{ fontSize: 50, marginTop: 24, color: 'var(--ink)' }}>
          The Recompile button, rewired to your machine.
        </h1>
        <div className="brand-rule" style={{ marginTop: 26 }}></div>
      </div>
      <div style={{ position: 'absolute', left: 720, top: 0, bottom: 0, right: 0, background: 'var(--slate-900)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 560 }}>
          <Terminal title="terminal">
            <div style={{ fontSize: 17, lineHeight: 2.1 }}><span className="p">$ </span>pip install local-compile-for-overleaf</div>
            <div style={{ fontSize: 17, lineHeight: 2.1 }}><span className="p">$ </span>python3 -m local_compile_for_overleaf</div>
            <div style={{ fontSize: 17, lineHeight: 2.1 }}><span className="ok">✓</span> Ready — open Overleaf and hit Recompile</div>
          </Terminal>
        </div>
      </div>
    </div>
  );
}

window.PROMO_TILES = [
  { id: 'tile-small-dark', name: 'Small A · Dark', w: 440, h: 280, C: TileSmallDark },
  { id: 'tile-small-green', name: 'Small B · Green', w: 440, h: 280, C: TileSmallGreen },
  { id: 'tile-small-light', name: 'Small C · Light', w: 440, h: 280, C: TileSmallLight },
  { id: 'marquee-product', name: 'Marquee A · Product', w: 1400, h: 560, C: MarqueeProduct },
  { id: 'marquee-green', name: 'Marquee B · Green type', w: 1400, h: 560, C: MarqueeGreen },
  { id: 'marquee-split', name: 'Marquee C · Split terminal', w: 1400, h: 560, C: MarqueeSplit },
];
