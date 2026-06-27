#!/usr/bin/env node

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const esbuild = require('esbuild');
const { chromium } = require('playwright');

const PROMO_DIR = __dirname;
const DEFAULT_OUT_DIR = path.join(PROMO_DIR, 'exports');

const OUTPUT_NAMES = {
  'slide-1-hero': 'screenshot-1-hero',
  'slide-2-timeouts': 'screenshot-2-no-timeouts',
  'slide-3-setup': 'screenshot-3-setup',
  'slide-4-how': 'screenshot-4-how-it-works',
  'slide-5-ce': 'screenshot-5-self-hosted',
  'tile-small-dark': 'small-tile-A-dark',
  'tile-small-green': 'small-tile-B-green',
  'tile-small-light': 'small-tile-C-light',
  'marquee-product': 'marquee-A-product',
  'marquee-green': 'marquee-B-green',
  'marquee-split': 'marquee-C-split',
};

const JSX_SOURCES = ['mockups.jsx', 'slides.jsx', 'tiles.jsx'];

function usage() {
  return [
    'Usage: npm run rasterize:promo -- [options]',
    '',
    'Options:',
    '  --format jpg|png       Output format, default: jpg',
    '  --quality 1-100        JPEG quality, default: 95',
    '  --out-dir DIR          Output directory, default: promo-materials/exports',
    '  --only ID[,ID...]      Rasterize a subset of artboard IDs',
    '  --list                 Print artboard IDs and exit',
    '  --help                 Show this help',
  ].join('\n');
}

function parseArgs(argv) {
  const options = {
    format: 'jpg',
    quality: 95,
    outDir: DEFAULT_OUT_DIR,
    only: null,
    list: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`${arg} requires a value`);
      return argv[i];
    };

    if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    } else if (arg === '--format') {
      options.format = next().toLowerCase();
    } else if (arg === '--quality') {
      options.quality = Number(next());
    } else if (arg === '--out-dir') {
      options.outDir = path.resolve(next());
    } else if (arg === '--only') {
      options.only = new Set(next().split(',').map((id) => id.trim()).filter(Boolean));
    } else if (arg === '--list') {
      options.list = true;
    } else {
      throw new Error(`Unknown option: ${arg}\n\n${usage()}`);
    }
  }

  if (options.format === 'jpeg') options.format = 'jpg';
  if (!['jpg', 'png'].includes(options.format)) {
    throw new Error(`Unsupported format "${options.format}". Use "jpg" or "png".`);
  }
  if (!Number.isInteger(options.quality) || options.quality < 1 || options.quality > 100) {
    throw new Error('--quality must be an integer from 1 to 100.');
  }

  return options;
}

async function buildHtml() {
  const css = await fs.readFile(path.join(PROMO_DIR, 'promo.css'), 'utf8');
  const compiled = [];

  for (const file of JSX_SOURCES) {
    const source = await fs.readFile(path.join(PROMO_DIR, file), 'utf8');
    const result = await esbuild.transform(source, {
      loader: 'jsx',
      jsxFactory: 'React.createElement',
      jsxFragment: 'React.Fragment',
      legalComments: 'none',
      target: 'es2019',
    });
    compiled.push(`/* ${file} */\n${result.code}`);
  }

  const baseHref = pathToFileURL(PROMO_DIR + path.sep).href;
  const script = `${tinyReactRuntime()}\n${compiled.join('\n')}\n${bootScript()}`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<base href="${baseHref}" />
<style>${escapeStyle(css)}</style>
<style>
  html, body { margin: 0; background: #555; width: fit-content; overflow: hidden; }
  #stage { display: block; }
</style>
</head>
<body>
<div id="stage"></div>
<script>${escapeScript(script)}</script>
</body>
</html>`;
}

function escapeScript(value) {
  return value.replaceAll('</script', '<\\/script');
}

function escapeStyle(value) {
  return value.replaceAll('</style', '<\\/style');
}

function bootScript() {
  return `
const ALL = [...window.PROMO_SLIDES, ...window.PROMO_TILES];
const root = ReactDOM.createRoot(document.getElementById('stage'));
window.ART_ITEMS = ALL.map(({ id, name, w, h }) => ({ id, name, w, h }));
window.ART_IDS = window.ART_ITEMS.map((item) => item.id);
window.showArt = function showArt(id) {
  const item = ALL.find((artboard) => artboard.id === id);
  if (!item) throw new Error('unknown artboard: ' + id);
  root.render(React.createElement(item.C));
  return { id: item.id, name: item.name, w: item.w, h: item.h };
};
window.showArt(ALL[0].id);
`;
}

function tinyReactRuntime() {
  return `
(() => {
  const Fragment = Symbol('Fragment');
  const svgAttrs = {
    clipPath: 'clip-path',
    clipRule: 'clip-rule',
    fillRule: 'fill-rule',
    stopColor: 'stop-color',
    stopOpacity: 'stop-opacity',
    strokeDasharray: 'stroke-dasharray',
    strokeDashoffset: 'stroke-dashoffset',
    strokeLinecap: 'stroke-linecap',
    strokeLinejoin: 'stroke-linejoin',
    strokeMiterlimit: 'stroke-miterlimit',
    strokeOpacity: 'stroke-opacity',
    strokeWidth: 'stroke-width',
  };
  const unitless = new Set([
    'animationIterationCount',
    'aspectRatio',
    'borderImageOutset',
    'borderImageSlice',
    'borderImageWidth',
    'boxFlex',
    'boxFlexGroup',
    'boxOrdinalGroup',
    'columnCount',
    'columns',
    'fillOpacity',
    'flex',
    'flexGrow',
    'flexNegative',
    'flexOrder',
    'flexPositive',
    'flexShrink',
    'fontWeight',
    'gridArea',
    'gridColumn',
    'gridColumnEnd',
    'gridColumnSpan',
    'gridColumnStart',
    'gridRow',
    'gridRowEnd',
    'gridRowSpan',
    'gridRowStart',
    'lineClamp',
    'lineHeight',
    'opacity',
    'order',
    'orphans',
    'stopOpacity',
    'strokeDasharray',
    'strokeDashoffset',
    'strokeMiterlimit',
    'strokeOpacity',
    'strokeWidth',
    'tabSize',
    'widows',
    'zIndex',
    'zoom',
  ]);

  function createElement(type, props, ...children) {
    const nextProps = props ? { ...props } : {};
    delete nextProps.__self;
    delete nextProps.__source;
    if (children.length === 1) nextProps.children = children[0];
    else if (children.length > 1) nextProps.children = children;
    return { type, props: nextProps };
  }

  function append(parent, value, inSvg) {
    if (value == null || value === false || value === true) return;
    if (Array.isArray(value)) {
      for (const child of value) append(parent, child, inSvg);
      return;
    }
    if (typeof value === 'string' || typeof value === 'number') {
      parent.appendChild(document.createTextNode(String(value)));
      return;
    }
    if (typeof value.type === 'function') {
      append(parent, value.type(value.props || {}), inSvg);
      return;
    }
    if (value.type === Fragment) {
      append(parent, value.props && value.props.children, inSvg);
      return;
    }

    const isSvg = inSvg || value.type === 'svg';
    const element = isSvg
      ? document.createElementNS('http://www.w3.org/2000/svg', value.type)
      : document.createElement(value.type);

    setProps(element, value.props || {}, isSvg);
    append(element, value.props && value.props.children, isSvg);
    parent.appendChild(element);
  }

  function setProps(element, props, isSvg) {
    for (const [name, value] of Object.entries(props)) {
      if (name === 'children' || name === 'key' || name === 'ref' || value == null || value === false) continue;
      if (name === 'className') {
        element.setAttribute('class', value);
      } else if (name === 'htmlFor') {
        element.setAttribute('for', value);
      } else if (name === 'style' && typeof value === 'object') {
        setStyle(element, value);
      } else if (name.startsWith('on') && typeof value === 'function') {
        element.addEventListener(name.slice(2).toLowerCase(), value);
      } else {
        element.setAttribute(isSvg && svgAttrs[name] ? svgAttrs[name] : name, value === true ? '' : String(value));
      }
    }
  }

  function setStyle(element, style) {
    for (const [name, value] of Object.entries(style)) {
      if (value == null) continue;
      const cssName = name.startsWith('--') ? name : name.replace(/[A-Z]/g, (letter) => '-' + letter.toLowerCase());
      const cssValue = typeof value === 'number' && value !== 0 && !unitless.has(name) ? value + 'px' : String(value);
      element.style.setProperty(cssName, cssValue);
    }
  }

  window.React = {
    createElement,
    Fragment,
    useState(initialValue) {
      const value = typeof initialValue === 'function' ? initialValue() : initialValue;
      return [value, () => {}];
    },
  };
  window.ReactDOM = {
    createRoot(container) {
      return {
        render(element) {
          container.textContent = '';
          append(container, element, false);
        },
      };
    },
  };
})();
`;
}

async function waitForAssets(page) {
  await page.evaluate(async () => {
    if (document.fonts && document.fonts.ready) {
      try {
        await document.fonts.ready;
      } catch {}
    }
    await Promise.all(Array.from(document.images, (image) => {
      if (image.complete) return Promise.resolve();
      return new Promise((resolve) => {
        image.onload = resolve;
        image.onerror = resolve;
      });
    }));
  });
}

function outputBaseName(id) {
  return OUTPUT_NAMES[id] || id.replace(/[^a-z0-9.-]+/gi, '-').replace(/^-+|-+$/g, '');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const html = await buildHtml();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'promo-rasterize-'));
  const tempHtmlPath = path.join(tempDir, 'export.html');
  await fs.writeFile(tempHtmlPath, html);

  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    const errors = [];

    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });

    await page.goto(pathToFileURL(tempHtmlPath).href, { waitUntil: 'load' });
    await page.waitForFunction(() => Array.isArray(window.ART_ITEMS) && window.ART_ITEMS.length > 0);

    const artboards = await page.evaluate(() => window.ART_ITEMS);
    const selected = options.only ? artboards.filter((item) => options.only.has(item.id)) : artboards;

    if (options.list) {
      for (const item of artboards) console.log(`${item.id} ${item.w}x${item.h}`);
      return;
    }

    if (options.only) {
      const found = new Set(selected.map((item) => item.id));
      const missing = [...options.only].filter((id) => !found.has(id));
      if (missing.length) throw new Error(`Unknown artboard ID(s): ${missing.join(', ')}`);
    }

    await fs.mkdir(options.outDir, { recursive: true });

    const imageType = options.format === 'jpg' ? 'jpeg' : 'png';
    const ext = options.format;
    for (const item of selected) {
      await page.setViewportSize({ width: item.w, height: item.h });
      await page.evaluate((id) => window.showArt(id), item.id);
      await waitForAssets(page);

      const artboard = page.locator('#stage > .board').first();
      const box = await artboard.boundingBox();
      if (!box) throw new Error(`Could not find rendered artboard for ${item.id}`);
      if (Math.round(box.width) !== item.w || Math.round(box.height) !== item.h) {
        throw new Error(`${item.id} rendered as ${Math.round(box.width)}x${Math.round(box.height)}, expected ${item.w}x${item.h}`);
      }

      const outPath = path.join(options.outDir, `${outputBaseName(item.id)}.${ext}`);
      const screenshotOptions = { path: outPath, type: imageType, scale: 'css' };
      if (imageType === 'jpeg') screenshotOptions.quality = options.quality;
      await artboard.screenshot(screenshotOptions);
      console.log(`wrote ${path.relative(process.cwd(), outPath)} (${item.w}x${item.h})`);
    }

    if (errors.length) {
      throw new Error(`Browser errors while rendering:\n${errors.join('\n')}`);
    }
  } finally {
    if (browser) await browser.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
